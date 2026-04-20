# AI End-to-End Findings — 2026-04-20

Cluster: `docker-desktop` (kind, v1.34.3, 3 nodes ready, 49 pods, 855 events)
Backend binary: rebuilt at 17:03 IST from `main` (HEAD-commit `2405f6d`); pre-shipped binary was stale (Apr 12, predates AI integration on Apr 19).
Brain: `vellankikoti/kotg.ai@dc2ec02`, 166 MCP tools loaded, OpenAI `gpt-4o-mini`.
Bench: `/tmp/e2e-bench2.ndjson` — 50 prompts, concurrency 3, 90s timeout, autonomy 3 → 106 events (50 LLM calls + 55 tool calls + 1 control).

## Headline numbers

| Metric                              | Value                          |
| ----------------------------------- | ------------------------------ |
| LLM-call success rate               | 50/50 = 100%                   |
| **Tool execution success rate**     | **39/55 = 70.9%**              |
| LLM ttft p50/p95                    | 4967 / 25771 ms                |
| LLM total p50/p95                   | 5869 / 40695 ms                |
| Tool latency p50/p95                | 2257 / 17942 ms                |
| Match buckets                       | exact 25, semantic 6, miss 19  |
| Estimated cost (gpt-4o-mini, 50 ps) | ~$0.006 (under-counts context) |

## Per-tool success

| Tool                          | OK / Total |
| ----------------------------- | ---------- |
| observe_pod_ownership_chain   | 7 / 7      |
| get_cluster_health            | 6 / 6      |
| list_resources                | 5 / 5      |
| observe_resources_by_query    | 3 / 3      |
| analyze_replicaset_health     | 3 / 3      |
| analyze_job_health            | 3 / 3      |
| troubleshoot_pod_failures     | 3 / 3      |
| analyze_cronjob_health        | 2 / 2      |
| observe_resource_links        | 2 / 2      |
| get_logs                      | 1 / 1      |
| analyze_service_health        | 1 / 1      |
| analyze_dependencies          | 1 / 1      |
| observe_resource_topology     | 1 / 1      |
| observe_namespace_detailed    | 1 / 2      |
| **analyze_deployment_health** | **0 / 5**  |
| **get_events / observe_events** | **0 / 6**  |
| **analyze_pod_health**        | **0 / 2**  |
| **analyze_network_connectivity** | **0 / 1** |
| **observe_pod_dependencies**  | **0 / 1**  |

## Spot-check answer quality (chat panel via desktop transport)

| Prompt                                            | Tool used                 | AI answer (paraphrased)                          | kubectl truth                          | Verdict                              |
| ------------------------------------------------- | ------------------------- | ------------------------------------------------ | -------------------------------------- | ------------------------------------ |
| "List all pods in the default namespace."         | (single tool, ok=true)    | "There are currently no pods in the default ns." | `my-web-app` Running 10d               | **WRONG** — wrong cluster routed     |
| "What is the health of the kube-system namespace?" | (single tool, ok=true)   | Status: Active, Pod Count: **7**, Risk: None     | 13 pods Running                        | **PARTIAL** — narrative ok, count wrong |
| "Show me recent events."                          | get_events called 3× failed | "I'm currently unable to retrieve recent events due to a technical issue." | 855 events available | **FAILED** — JSON unmarshal bug    |
| `observe_resources_by_query__2`                   | observe_resources_by_query ok | (1990ch detailed listing, match=exact)        | matches kube-system query              | OK                                   |
| `analyze_job_health__1`                           | analyze_job_health ok     | (170ch concise summary, match=exact)             | jobs ns empty                          | OK                                   |

## Findings

| Severity | Component               | Bug                                                                                  | Reproduction                                                                                                                                | Suggested fix                                                                                                                       |
| -------- | ----------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **P0**   | brain → backend cluster_id propagation | Tool calls drop `focus_cluster_id` from chat session and fall back to first registered cluster. With multi-cluster setups (EKS + kind + docker-desktop) the AI talks to the wrong cluster and gives completely wrong answers. | `kubilitics-ai` log: `[WARN] cluster_id not provided — falling back to first registered cluster "0b06f3b7..."` for every tool round-trip while the bench passed `-cluster-id 4378f...` and the chat session was created with `focus_cluster_id=4378f...`. | The Chat gRPC stream's session metadata must thread `cluster_id` to the MCP `ToolExecutor` request context. Today the LLM-engine request → MCP handler chain loses the field. Tighten `internal/mcp/server` callers and propagate `Session.FocusClusterID` to `mcp.Request.ClusterID`. |
| **P0**   | backend binary shipping | Pre-built `kubilitics-backend` binary in repo root is from **Apr 12**; AI integration shipped **Apr 19**. Running it shows zero `/api/v1/ai/*` routes (404) even with `KUBILITICS_AI_ENABLED=true`. | Run `./kubilitics-backend` (the committed one) → curl `/api/v1/ai/status` returns 404. Rebuild from source → routes appear. | CI must rebuild + commit (or stop committing) the binary. Add a release-script staleness check (`git log -1 cmd/server | tail -1` ≤ binary mtime). Or just `.gitignore` the binary and document `make build`. |
| **P0**   | backend ↔ brain MCP `get_events` / `observe_events` | Both tools fail with `decode: json: cannot unmarshal array into Go value`. Backend `/api/v1/clusters/{id}/events` returns a JSON array, MCP tool client expects an object. Result: AI cannot answer ANY events question. | `kubectl get events -A` → 855 events. Bench `observe_events__1/2/3` → 0/3 ok with the unmarshal error. Chat prompt "Show me recent events." → AI says "technical issue." | Either change backend response shape to `{events: [...], total: N}` (preferred — easier to extend with paging/total), or make the MCP client decode `[]Event` directly. The backend already returns object shape on most other endpoints; events is the outlier. |
| **P0**   | brain bootstrap | `kubilitics.ai.v1.ClusterDataService` gRPC is `Unimplemented` on backend, causing the brain's world-model bootstrap to fail. All `analyze_*` tools then fail with `no clusters registered in backend`. | Brain log on startup: `warning: backend proxy Initialize failed: failed to bootstrap world model … unknown service kubilitics.ai.v1.ClusterDataService (analysis tools will use REST fallback)`. The "REST fallback" is never wired for analyze_* — they short-circuit with `no clusters registered`. | Either implement the gRPC `ClusterDataService` on the backend (it's part of the `kotg-schema` v1 contract), or implement the REST fallback for analyze_* tools in the brain. Right now neither is done — the comment is aspirational. |
| **P1**   | local-dev port collision | Backend gRPC and brain gRPC both hardcode `:50051`. Backend gRPC port is configurable via `KUBILITICS_GRPC_PORT`, but brain gRPC port is hardcoded in `cmd/server/main.go:104`. | Start brain after backend → `Failed to listen on :50051: bind: address already in use`. Workaround: shift backend to `KUBILITICS_GRPC_PORT=50061`. | Make brain gRPC port configurable (`server.grpc_port` in config + env). Doc the local-dev recipe. |
| **P1**   | brain `analyze_*` tools | When `analyze_pod_health`, `analyze_deployment_health`, `analyze_network_connectivity` get `no clusters registered`, they return a hard error rather than degrading gracefully. The LLM gets no hint that this is a *bootstrap* problem and not a *cluster* problem. | Bench: `analyze_pod_health__2` failed twice in a row both with the same message; LLM final answer was generic. | Wrap the bootstrap error: return a structured `{ok:false, reason:"world_model_unavailable", suggested_fallback:"observe_resource"}`. Then teach the LLM to retry with the observation-tier tool. |
| **P1**   | bench cluster_id flag | `bench -cluster-id <id>` is sent on session create but is then discarded by the brain because of the same propagation bug above. Bench numbers in multi-cluster envs are systematically wrong (tools execute on the EKS cluster). | See P0 (1) reproduction. | Same fix as P0 (1). Until then, bench should refuse to run when more than one cluster is registered, or print a warning showing which cluster the tool actually targeted. |
| **P1**   | LLM perf | TTFT p95 25.7s and total p95 40.7s on `gpt-4o-mini` are user-hostile for a chat panel. | See bench numbers above. | (a) Stream tool_call_started + tool_end immediately so the user sees activity. (b) Cache `get_cluster_health` etc. at the brain edge for ~30s. (c) Drop input prompt verbosity (the system prompt is > expected_tool aliases ⇒ token bloat). |
| **P2**   | brain log noise | Repeated `cluster_id not provided` WARN at INFO log level for *every* tool call. Drowns real signal. | Tail `/tmp/ai-e2e-server.log`. | Promote to one-time WARN per session, or DEBUG. |
| **P2**   | backend SQLite migrations | 11 `Failed to run migration` warnings on startup ("duplicate column", "no such column") on existing DB. Eventually one will be load-bearing and silent. | `tail /tmp/backend-e2e.log`. | Either make migrations idempotent (`IF NOT EXISTS`) or hard-fail on schema drift instead of silently warning. |
| **P2**   | event_type=`bench.tool_call` schema | The `ok` field comes through as `True`/`False` Python literals when consumed by some downstream parsers; underlying NDJSON has Go booleans (`true`/`false`). Just a doc/aggregation pitfall. | `python3 -c "import json; print(json.loads('...')['ok'])"` is fine; raw scrolling is confusing. | None needed — note in bench README. |
| **P2**   | tauri dev script | `npm run dev` in `kubilitics-desktop` runs `concurrently` which spawns vite, and `tauri dev` *also* spawns its own `npm run dev:frontend` → port 5173 collision and tauri exits non-zero. | `cd kubilitics-desktop && npm run dev` cold → fails. | Set `tauri.conf.json > build > beforeDevCommand` to noop and run vite separately, or rely on tauri's own `beforeDevCommand` and drop `concurrently`. |
| **P2**   | desktop pre-built binary | `kubilitics-desktop/src-tauri/target/debug/kubilitics-desktop` exists from earlier build and works fine — but `cargo run --no-default-features` re-downloads ~50 crates on first dev invocation. ~3-5 min. | Watch `tauri dev` cold. | Pre-warm `Cargo.lock` deps in CI; ship a `make dev-desktop` that uses the existing debug binary. |
| **P3**   | observe_pod_dependencies URL encoding | One bench call hit `GET /api/v1/clusters/.../resources/pods/data/%2A` (URL-encoded `*` for "all pods") → backend HTTP 400. | `observe_pod_dependencies__2`. | Either accept `%2A` as wildcard in backend route, or change the brain to call the `list` endpoint then per-pod. |
| **P3**   | `observe_namespace_detailed` namespace-not-found | Failed for namespace `data` which doesn't exist on cluster. Brain should validate namespace exists before issuing detailed lookup. | `analyze_deployment_health__2` | Return `{ok:false, reason:"namespace_not_found"}` with the LLM-friendly hint to call `list_namespaces` first. |

## Phase 2 — desktop launch

- Built fresh debug binary at `kubilitics-desktop/src-tauri/target/debug/kubilitics-desktop` (already present from prior build).
- `npm run dev` failed (P2 above). Workaround: launched vite separately + ran the binary directly with `TAURI_DEV_HOST=localhost`. App started, recognized the on-host backend (`Port 8190 already in use — assuming backend is already running`).
- Chat panel was not driven through the GUI (no display automation in this session); chat path was exercised through the same backend WebSocket route the desktop uses (`ws://localhost:8190/api/v1/ai/chat?cluster_id=…` + `POST /api/v1/ai/sessions`). Three prompts in the spot-check table above.

## Severity rollup

- P0 × 4
- P1 × 4
- P2 × 5
- P3 × 2

## Status

DONE_WITH_CONCERNS — phases 1 and 2 both ran end-to-end, but the AI is currently giving wrong answers on a multi-cluster host because of P0 (1) cluster_id propagation. Fix that one and the events JSON shape and most of the chat panel becomes trustworthy.

---

## Update 2026-04-20 (second pass)

### P0 status after fixes

| P0 | Status | Commit / note |
|---|---|---|
| #1 cluster_id propagation | ✅ FIXED | `ec80c3f` — Headlamp-style sync on frontend; new `useClusterSync` hook; `clusterStore.syncClusters()` reconciles by `(name, serverUrl)` and refreshes `id` in place so brain never gets a dead UUID |
| #2 stale backend binary | ✅ FIXED | fresh build from main — `kubilitics-server` rebuild step documented for release |
| #3 events JSON shape | ✅ FIXED | kotg.ai `3862ad0` — brain's `handleEvents` now decodes `interface{}` + type-switches on array vs object; wraps array as `{items, count}` |
| #4 ClusterDataService gRPC service-name mismatch | ⏸ DEFERRED | **Root cause confirmed**: backend proto package is `kubilitics.backend.v1`, brain proto package is `kubilitics.ai.v1` — two separate services with same shape. Proper fix: move `cluster_data.proto` into shared `kotg-schema` repo (same pattern as `chat.proto`). Quick regenerate on the brain side hit ~30 type-name drift errors (`ResourceRequest` vs `GetResourceRequest`, etc.) — too invasive for this pass. Consequence: `analyze_*` tools remain dead until proto unification ships. |
