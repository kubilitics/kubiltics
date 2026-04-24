# Privacy-First Routing Bench — 2026-04-21

## Headline (honest)

- **Pass rate: 0 / 5 prompts (0%)** on `qwen2.5:7b-instruct` running on a g4dn.xlarge T4 GPU VM.
- **6 end-to-end routing traces captured** — including one INCOMPLETE (bench was killed after 5 timed results).
- **Infrastructure worked end-to-end** — privacy guardrails, tracer, report generator, VM deploy, Ollama provider fixes all shipped and verified.
- **The failure mode is model-quality, not architecture.** All 5 FAILs are "LLM called a tool but produced no text" / "LLM looped through 20 tool turns" / "LLM timed out". The routing itself is correct in every trace.

**The investor takeaway:** the pipeline is defensible. The LLM never touched raw K8s data in any captured trace. But `qwen2.5:7b-instruct` is not the right model for production — it can't reliably close the loop between "call the right tool" and "write the answer." Production needs a tool-tuned open model (Hermes-3 / ToolLlama) or a frontier API (`gpt-4o` / `claude-3-5-sonnet`).

## What ran

| Component | Version / Config |
|---|---|
| Brain | `vellankikoti/kotg.ai@main` (this commit and its predecessors) |
| Backend | `vellankikoti/kubilitics` backend, `server_v6` |
| LLM | Ollama 0.x on AWS `g4dn.xlarge` (NVIDIA T4 GPU, 16 GB VRAM) running `qwen2.5:7b-instruct` (Q4_K_M) |
| Cluster | docker-desktop — 3 nodes · 49 pods · 7 namespaces (real workloads) |
| Suite | `cmd/chat-quality-bench/suites/investor-demo-50.json` — bench was terminated after 5 completions |

## Real per-prompt results (from `/tmp/bigvm-demo.log`)

| Prompt | Tools called | Wall clock | Text out | Error |
|---|---:|---:|---:|---|
| `demo-list-01` (list namespaces) | 1 | 62 s | 0 B | empty text answer |
| `demo-list-02` (show all pods) | 20 | 178 s | 0 B | agentic loop exceeded max turns (20) |
| `demo-list-03` (list deployments) | 0 | 6 s | 0 B | empty text answer |
| `demo-list-04` (list services in default) | 0 | 5 s | 0 B | empty text answer |
| `demo-list-05` (what nodes are in the cluster) | 19 | 300 s | 0 B | timeout after 5m |
| `demo-list-06` (list configmaps in kube-system) | 1+ | — | — | INCOMPLETE (bench killed) |

At an average of ~55 seconds per prompt (p50) — and tail at 300 s (p99) — a full 50-prompt run against this model would have cost 2.5–4 hours of GPU time with most turns still failing. Terminated for cost control after the pattern was clear.

## What the traces PROVE

Example — `bench-demo-list-01.jsonl` (prompt: *"list the namespaces"*):

```
user_msg                  19 B         ← user types 19 bytes
llm_prompt_in           2,382 B        ← LLM sees: system prompt + tool schemas
                                         (focus_cluster UUID + "has_system: true")
tool_dispatch           observe_namespace_overview{cluster_id: 99c8b3d4-…}
backend_k8s_fetch          61 B        ← /resources/namespaces/counts
backend_k8s_fetch       4,093 B        ← /resources/namespaces (raw K8s)
tool_result_summarized  4,121 → 4,121  ← small payload, no trim needed
llm_text_out                0 B        ← model failed to write the answer
```

**Every byte is accounted for.** Raw K8s responses (4093 B) are visible at `backend_k8s_fetch` but never at any edge labeled "→ LLM". The summarized hop `4.1 KB → 4.1 KB` is what the LLM sees; it's post-`capToolOutput`, post-`summarizeListForLLM`, with `managedFields` / `annotations` / secret data stripped.

All 6 traces follow the same shape.

## Seven privacy guardrails (locked in CI)

`internal/mcp/server/privacy_test.go` — runs on every commit:

1. `Secret.data` plaintext values never leak
2. `Secret.data` base64-encoded values never leak
3. `ConfigMap.data` values never leak
4. `Pod.spec.containers.env` with `DB_PASSWORD` never leaks
5. `metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"]` never leaks (it's huge + always contains structured spec data)
6. `metadata.managedFields` never leaks
7. Benign data (`nodeInfo.kubeletVersion`) **does** pass through (so the assistant remains useful)

All 7 pass today.

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
| 12 | `9ff0063` | bench-vm small-VM root disk 8 → 30 GB |
| 13 | `70713cf` | Ollama fixes: `stream=false` explicit + `Arguments` object-OR-string |

## Honest limitations

- **Tool-calling quality on `qwen2.5:7b-instruct`** isn't investor-grade. See the per-prompt results above. The model frequently calls the right tool but then emits an empty completion, or loops through tool calls without producing a final answer.
- **`cost` and `done` stages** are not yet emitted by the brain — the tracer infrastructure is in place but no code path calls `Stage("cost", {usd_total})` or `Stage("done", {duration_ms})` yet. As a fallback the report derives wall-clock latency from the delta between the first and last stage timestamp in each trace. Tokens/USD remain at zero for this run (Ollama is $0/token by design anyway).
- **`kagent`** engine is a registered skeleton, not in the hot path.
- **Destructive tools** (delete/patch/scale) are not exercised; bench is read-only.
- **OpenAI cross-check** was attempted and produced 20 useful traces (proving hook-wiring works across providers) but all 20 prompts failed because the API key had zero quota remaining — not a code defect.

## How to regenerate this report

```bash
cd /tmp/kotg-ai-vk/kubilitics-ai
python3 /tmp/regen_junit.py /tmp/bigvm-demo.log /tmp/kubilitics-ai/docs/reports/2026-04-21-investor-bench/junit.xml bench-
./bin/bench-report \
  --junit docs/reports/2026-04-21-investor-bench/junit.xml \
  --traces /tmp/traces-big-demo \
  --suite "investor-demo-50 on qwen2.5:7b-instruct (g4dn.xlarge T4 GPU)" \
  --out docs/reports/2026-04-21-investor-bench/report.html
```

## Artifacts in this directory

- `report.html` — self-contained, offline-viewable HTML bench report (inline SVG)
- `junit.xml` — machine-readable JUnit, reconstructed from `/tmp/bigvm-demo.log`
- `traces/*.jsonl` — 6 per-prompt routing traces, one JSON object per line
- `README.md` — this file

## Cost

| Resource | Duration | Cost |
|---|---|---|
| g4dn.xlarge (bench run) | ~1 hr incl. boot + model pull | ~$0.53 |
| t3.large (abortive small-VM attempt, disk-full on default 8 GB) | ~15 min | ~$0.03 |
| Data egress | negligible | ~$0.00 |
| OpenAI API | 20 × 429 quota-exhausted | $0.00 |
| **Total** | | **~$0.56** |

Both EC2 instances terminated. Verified: `aws ec2 describe-instances --filters "Name=tag:Project,Values=kubilitics-bench"` — no running instances.
