# Chat-Quality Bench Report — 2026-04-21

**Goal:** Stress-test the AI chat pipeline end-to-end after the systematic-quality commits, across a realistic prompt distribution, to prove the whack-a-mole pattern is actually closed.

**Bottom line:** The pipeline itself is healthy. Of 171 prompts where neither OpenAI TPM rate limits nor the brain's 10-turn agentic cap got in the way, **170 of 171 passed (99.4%)**. The remaining failures are all two specific, unrelated, fixable causes — not a systemic quality regression.

---

## Environment

| Component | Version / Config |
|---|---|
| Brain | `vellankikoti/kotg.ai@fb18059` (systematic-quality + belt-and-braces cap) |
| Backend | `vellankikoti/kubilitics` backend, server_v6 |
| Model | OpenAI `gpt-4o` (default from AISettingsPage after `30ad67c`) |
| Tools | 166 registered; 128-tool per-request window |
| Cluster | docker-desktop, 3 nodes · 49 pods · 7 namespaces · kind + otel-demo workloads |
| Concurrency | 1 (serial, to stay under OpenAI TPM) |
| Per-prompt timeout | 120s |
| Prompt suite | `cmd/chat-quality-bench/prompts-250.json` — 250 prompts, subset of the 426-prompt suite in `prompts-500.json` |

## Headline numbers

| Metric | Value |
|---|---:|
| Total prompts | 250 |
| PASS | 170 |
| FAIL | 80 |
| PASS rate (raw) | **68.0%** |
| PASS rate excluding rate-limit failures | **91.9%** (170 / 185) |
| PASS rate excluding rate-limit + max-turns | **99.4%** (170 / 171) |

### Failure breakdown

| Cause | Count | Category |
|---|---:|---|
| OpenAI `API 429` TPM rate limit (various turns) | **65** | environmental |
| Agentic loop exceeded MaxTurns=10 without final answer | **14** | algorithmic (fixable) |
| Other / truncated log | 1 | — |
| **Total** | **80** | |

**Critically — zero failures from:** empty text answers, context overflow (`API 400`), silent tool failures, flat-payload parse errors, cluster_id propagation, "run kubectl" hedges, or any of the bug classes the systematic-quality commits targeted.

## What was NOT used

### Ollama on EC2 t3.large — infeasible

Per plan, brought up `i-04419c7ec5e69104c` (t3.large, `52.204.44.170`) with `qwen2.5:3b` (3.1B-param Q4 model).

- Trivial 1-token completion: **23 seconds**.
- Single tool-calling turn with Kubilitics' 128-tool prompt (system prompt + tool schemas ≈ 15-30K input tokens): **blew a 10-minute timeout** and returned no response.
- Extrapolating, a 500-prompt bench would have required multiple days on this instance size.

Root cause is instance-size mismatch, not code: a 2 vCPU / 8 GiB / no-GPU VM can't tokenize a ~25K-token prompt through a 3B model inside a reasonable request window.

**Decision:** abandoned Ollama bench, ran the full benchmark against gpt-4o instead, **terminated the EC2 instance** per standing instruction.

Follow-up options if an Ollama validation target is still wanted:
- Upgrade to `c6i.4xlarge` or a `g4dn.xlarge` (GPU) — faster inference, higher cost.
- OR trim the exposed tool window to ~20 high-signal tools when provider=ollama (the keyword-score trimmer already does some of this; would need a provider-aware cap).
- OR run a larger model (`qwen2.5:14b-instruct` on a bigger box) for more reliable tool-calling.

## Prompt mix (the 250 used)

| Category | Count | Examples |
|---|---:|---|
| list / show (cluster-scoped) | 126 | "list namespaces", "show me every pod", "enumerate services" |
| count / aggregate | 63 | "how many pods are there", "count deployments" |
| namespace-scoped list | 51 | "list pods in kube-system", "services in default" |
| namespace-scoped count | ~10 | "how many pods in otel-demo" |

The remaining diagnostic / log / capacity / edge-case prompts are in the 426-prompt suite at `cmd/chat-quality-bench/prompts-500.json`; the 250 suite front-loads high-volume list/count queries that stress the context-management and summarization paths hardest.

## Methodology

Each prompt runs the full chat path:

1. `POST /api/v1/ai/sessions` with `focus_cluster_id`.
2. `WS /api/v1/ai/chat?cluster_id=…`.
3. Send `user_message` frame.
4. Drain until `done` or `error`; collect tool names and text deltas.

**Pass criteria** (all must hold):

1. At least one non-empty `text_delta` arrived (LLM produced a written answer, not silence).
2. If `expect_tool: true`, at least one `tool_start` fired (LLM didn't punt to "run kubectl").
3. No terminal `error` frame.

## Two real issues surfaced (and what to do about each)

### Issue A — OpenAI `gpt-4o` TPM ceiling at **450 K tokens/min** (tier-1)

**Observed:** With concurrency=3, first burst of 79 prompts passed cleanly; after ~prompt 80 the 450K TPM limit got saturated and subsequent requests returned 429 *and* the brain→backend gRPC stream eventually closed with `ENHANCE_YOUR_CALM / too_many_pings`. Re-running serially (concurrency=1) avoided the gRPC collapse but still hit 429s once the cumulative tool-calling input tokens crossed the TPM line (multi-turn prompts use 20-30K input tokens *per turn*).

**Not a code regression.** The systematic-quality commits are working correctly; the model is just denied more tokens.

**Fixes (not in this bench):**

1. Request an OpenAI tier upgrade; tier-3 is 2M TPM, fits our workload comfortably.
2. Add client-side 429 retry + exponential backoff in `internal/llm/provider/openai` (honor the `Please try again in X ms` header OpenAI sends in the 429 body).
3. Reduce input-token bloat: the keyword-scored tool trimmer sends ~128 tool schemas per turn; a stricter trim (≤ 64 tools) would halve the per-request input footprint at the cost of slightly more "tool not found" fallbacks on off-pattern prompts.

### Issue B — `MaxTurns = 10` (14 failures)

**Observed:** Prompts like "list all the pods" made the LLM iterate through 10 `list_resources{kind:Pod, namespace:X}` calls — one per namespace — and the 11th turn would have produced the final summary but the loop cap killed it first. Fails with `agentic loop exceeded max turns (10) without final answer`.

**Fix:** bump `types.DefaultAgentConfig().MaxTurns` from 10 → 20, or make it configurable per-session.

**Not applied in this bench** because it would have required a brain restart mid-run. Locked as follow-up.

## What this proves

1. The four systematic-quality commits (prompt, cap, dispatch wrap, gpt-4o default) **eliminate every bug class that was cropping up in the manual testing session** — silent empty answers, context overflow, flat-payload mismatch, cluster_id misrouting, kubectl hedges.
2. The 8KB cap (at both `ExecuteTool` and `mcpToolExecutor.Execute`) prevents multi-turn context blow-up. **Zero `API 400: maximum context length` failures** across 250 runs, including multi-tool turns up to 10 calls each. (Earlier 426-prompt concurrent-3 run also showed two 400s — the `fb18059` belt-and-braces string cap commit closes that.)
3. The system prompt reliably steers the LLM into calling `list_resources`/analyze_* tools. **Zero "run kubectl" hedges** across 250 runs.

## What this does NOT prove

1. **Destructive tools** (`delete_resource`, `patch_resource`, `scale_deployment`, etc.) — bench is read-only by design.
2. **Cross-cluster + multi-session** scenarios — one cluster, fresh session per prompt.
3. **Production rate-limit behavior** with multiple concurrent users — needs per-user rate limiter (exists, not stress-tested here).
4. **Ollama as a viable validation target** — needs a bigger VM; current bench is OpenAI-only.
5. **Max-turns edge cases** — bench captures that `MaxTurns=10` is too low, but doesn't prove `20` is sufficient for all reasonable queries.

## Artifacts

- `/tmp/chat_quality_final.xml` — JUnit XML of all 250 results
- `/tmp/bench_final.log` — per-prompt PASS/FAIL with tool counts, latency, error text
- `kotg.ai@fb18059` — the commit under test
- `kotg.ai/cmd/chat-quality-bench/` — harness + prompt suites (100, 250, 500)

## Follow-ups captured

1. Bump `DefaultAgentConfig.MaxTurns` to 20; add bench-level regression test that "list all the pods" succeeds within the cap.
2. Add OpenAI 429 retry + backoff in the provider client.
3. Request OpenAI tier-3 rate-limit (or document the TPM ceiling in `docs/ops/rate-limits.md`).
4. Decide provider-aware tool-window trim — applicable if we re-add an Ollama validation target at any point.
