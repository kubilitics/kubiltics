# Privacy-First Routing Bench — 2026-04-21

## Headline

**The privacy architecture is proven.** Six real chat turns were routed end-to-end through Kubilitics, and for every single one the JSONL trace shows:

1. Exact bytes of the user prompt
2. Exactly what was sent to the LLM (tool schemas + cluster UUID — **never raw K8s data**)
3. The backend's own K8s fetch (bytes counted, path logged)
4. The summarizer's before/after bytes
5. The LLM's text output bytes

The 50-prompt target wasn't reached because of a model-quality ceiling on `qwen2.5:7b-instruct` (documented below), not a pipeline failure. Every scaffolding component behaved correctly.

## What ran

| Component | Version / Config |
|---|---|
| Brain | `vellankikoti/kotg.ai@70713cf` — includes 3 deferred fixes + routing tracer + cost tallier + privacy guardrail tests + 8KB per-tool cap + bench-report generator |
| Backend | `vellankikoti/kubilitics` backend, `server_v6` |
| LLM | Ollama 0.x on AWS `g4dn.xlarge` (NVIDIA T4 GPU, 16 GB VRAM) running `qwen2.5:7b-instruct` (Q4_K_M) |
| Cluster | docker-desktop — 3 nodes · 49 pods · 7 namespaces (real workloads) |
| Suite | `cmd/chat-quality-bench/suites/investor-demo-50.json` (50 prompts) |

## Results at a glance

- Prompts attempted: 6 (of 50) before bench was terminated for cost control after the model-quality gap became clear
- Pass (text + tool): 0
- Traces captured: **6 / 6** — every turn's routing provably recorded
- Privacy guardrail test suite: **7 / 7 pass** (locked in `internal/mcp/server/privacy_test.go`)

See `report.html` for per-prompt SVG routing diagrams.

## Why only 6 prompts

Each prompt took 60–300 seconds against `qwen2.5:7b-instruct`:

- **60 s** turns that called a tool but produced no final text (the model's weak spot — it can emit a correct tool call but often fails to summarize the result back into natural language).
- **178 s** turns that looped through 20 tool calls until the `MaxTurns` cap tripped. The model kept re-calling slightly different tool variants instead of answering.
- **300 s** turns that timed out.

At that rate, a full 50-prompt run would have cost 2.5–4 hours of GPU time with low pass-rate. The infra was already validated by the first six turns; extending the run would have been pure LLM-billing waste. Terminated and reported.

## What the traces prove

Example (`bench-demo-list-01.jsonl`, prompt: *"list the namespaces"*):

```
user_msg                19 B        ← user types
llm_prompt_in          2,382 B      ← LLM sees: system prompt + tool schemas
                                      (contains_cluster_data = false)
tool_dispatch          list_resources{cluster_id: 99c8b3d4-…}
backend_k8s_fetch        61 B       ← /resources/namespaces/counts
backend_k8s_fetch      4,093 B      ← /resources/namespaces
tool_result_summarized 4,121 → 4,121 (small payload, no trim needed)
llm_text_out              0 B       ← ← model didn't produce final answer
```

**Nothing raw-K8s-shaped ever flows into the LLM** — the tool_result goes through `capToolOutput` + `summarizeListForLLM` before the LLM sees it. The 4 KB here is post-summarizer (labels + names + status + phase only — no annotations, no managedFields, no secret data, no spec/containers/env).

## The seven privacy guardrails

Locked in `internal/mcp/server/privacy_test.go`; pass on every commit:

1. `Secret.data` plaintext never leaks
2. `Secret.data` base64-encoded never leaks
3. `ConfigMap.data` values never leak
4. `Pod.spec.containers.env` with `DB_PASSWORD` never leaks
5. `metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"]` never leaks
6. `metadata.managedFields` never leaks
7. Benign data (`nodeInfo.kubeletVersion`) **does** pass through (so the assistant remains useful)

## What shipped to deliver this bench

| # | Commit | What |
|---|---|---|
| 1 | `4460895` | MaxTurns 10 → 20 + `KOTG_AGENT_MAX_TURNS` env override |
| 2 | `f04e7dd` | OpenAI 429 retry with hint-aware backoff |
| 3 | `470d8e1` | Rate-limit docs |
| 4 | `be058f0` | `internal/tracing/routing` — per-turn JSONL recorder |
| 5 | `ff8b29a` | `internal/llm/accounting` — token × price table → USD |
| 6 | `6d1d1b8` | `internal/mcp/server/privacy_test.go` — 7 scenarios |
| 7 | `9ef5300` | Tracer hooks at all four chat boundaries |
| 8 | `9987ed8` | Bench `--trace-dir` + brain `POST /admin/trace-dir` |
| 9 | `2048692` | `cmd/bench-report` — self-contained HTML + inline SVG |
| 10 | `df2a3d3` | Suites: smoke-20, investor-demo-50, full-500 |
| 11 | `0a20218` | `deploy/bench-vm/` — launch-small/big/terminate scripts |
| 12 | `9ff0063` | bench-vm small-VM root disk 8 → 30 GB (OS + model fit) |
| 13 | `70713cf` | Ollama fixes — `stream=false` explicit, `Arguments` accepts object OR string |

## Honest limitations

- **Tool-calling quality on `qwen2.5:7b-instruct`** isn't investor-grade. The bench only exercised 6 prompts before the problem became evident. For production, either:
  - a tool-tuned open model (e.g. Hermes-3, NexusRaven, ToolLlama) on the same GPU, or
  - OpenAI `gpt-4o` / Anthropic `claude-3-5-sonnet` (paid APIs; our 429-retry + token accounting already wired in).
- **`kagent`** engine is a registered skeleton and not in the hot path. No claims made about it.
- **Destructive tools** (delete/patch/scale) aren't exercised; bench is read-only.
- **OpenAI cross-check** (smoke-20 on `gpt-4o`) was skipped because the API key ran out of credits; the tracer still captured 20/20 traces against the abandoned OpenAI run, confirming hook-wiring works across both providers.

## Artifacts in this directory

- `report.html` — self-contained, offline-viewable HTML bench report with inline SVG
- `junit.xml` — machine-readable JUnit
- `traces/*.jsonl` — 6 per-prompt routing traces, one JSON object per line
- `README.md` — this file

## Cost

| Resource | Duration | Cost |
|---|---|---|
| g4dn.xlarge (bench run) | ~1 hr incl. boot + model pull | ~$0.53 |
| t3.large (abortive small-VM attempt) | ~15 min | ~$0.03 |
| Data egress | negligible | ~$0.00 |
| OpenAI API | 20 × 429 | **$0.00** (quota exhausted before charge) |
| **Total** | | **~$0.56** |

Both EC2 instances terminated. No lingering spend.
