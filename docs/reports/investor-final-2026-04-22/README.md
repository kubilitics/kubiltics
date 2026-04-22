# Kubilitics Real-World Validation — Investor Report
*2026-04-22 · incident-scenarios × 100 · Together.ai Llama 3.3 70B Turbo*

## Headline

- **100/100 prompts passed.** 6 min 41 s wall clock. ~$0.20 compute cost.
- **89/100 clean answers, 11 honest error-recoveries.** Details below.
- **On a refactored taxonomy of 124 tools** (was 163) with topic-aware router filtering to ~20 tools per query.
- **Zero agentic-loop failures** (Ollama had 4 on the same suite — architecture gap closed).
- **Every byte is traced and auditable** — per-prompt JSONL with `user_msg → llm_prompt_in → tool_dispatch → backend_k8s_fetch → tool_result_summarized → llm_text_out → done → cost` stages.

## What's in this report

| File | What it is |
|---|---|
| `report-100.html` | Interactive, offline-viewable, 100 walkthrough cards with actual Q → tool journey → assistant answer |
| `report-20.html` | Tighter 20-prompt run (v2 with text previews) — same date, lighter read |
| `traces/*.jsonl` | Raw per-prompt routing traces (privacy-proof audit trail) |
| `junit-100.xml` | Machine-readable test results |
| `tool-catalog.json` | All 124 tools with per-topic grouping the router uses |
| `gap-findings.md` | **The brutally honest part** — copy of `../strategy/2026-04-22-gap-findings-from-100-bench.md` |

## The honest story (unvarnished)

### What works

1. **Real-world SRE questions route correctly through real MCP tools against a real Kubernetes cluster.** Not demos, not mocks.
2. **Privacy-first architecture holds.** LLM never sees raw K8s payloads — only post-redaction, post-summarization results. Traces prove this byte-for-byte.
3. **Tool router (topic-aware selection) kills agentic-loop failures.** Ollama with all 163 tools hit 20-turn loops on 4 prompts. Llama 3.3 70B with filtered 20-ish tools hits zero.
4. **`inspect_<kind>` composites collapsed 61 single-purpose tools into 27 unified ones.** Each composite calls underlying handlers in parallel via sync.WaitGroup. Latency roughly 1/3 of sequential.
5. **Per-category clean-answer rate is 100% on 8 of 16 categories** (events, nodes, observability, rbac, storage, cost, summary, workload).

### What doesn't (yet)

1. **No live metrics / pod CPU & memory** — 3 prompts asked for this and got "metrics server unavailable". Needs a kube-state-metrics + metrics.k8s.io adapter. Estimated 6h build.
2. **LLM sometimes picks wrong namespace** when resource name is unambiguous in prose but ambiguous in cluster. 3 prompts hit this. Fix: resolver tool that maps name-hint → namespace. Estimated 4h.
3. **`rbac-12` exploded to 95 tool calls.** Answer was correct, execution was pathological. Needs a `who_can_do(verb, resource)` aggregator. Estimated 5h.
4. **Bench gate is lenient** ("called a tool + produced text" ≠ "answered correctly"). Next iteration needs an LLM-as-judge for subjective quality.
5. **108 of 124 tools lack plain-English descriptions.** Mechanical write-up, estimated 8h.

Full per-prompt analysis in `gap-findings.md`.

## Architecture at a glance

```
┌───────────────┐    ┌──────────────────┐    ┌──────────────────────┐
│     User      │───▶│   Backend REST   │───▶│  Brain (kubilitics-  │
│ "plain text"  │    │  (local server)  │    │    ai, gRPC :50051)  │
└───────────────┘    └────────┬─────────┘    └──────────┬───────────┘
                              │                         │
                              │ Raw k8s data            │ Tool schemas ONLY
                              │ (stays local)           │ + summarized results
                              ▼                         ▼
                   ┌────────────────────┐    ┌──────────────────────┐
                   │  Your Kubernetes   │    │  LLM (Llama 3.3 70B  │
                   │     cluster        │    │     via Together.ai) │
                   └────────────────────┘    └──────────────────────┘

Tool router selects ~20 topic-relevant tools from 124. Privacy redactor strips
Secret.data, ConfigMap.data, env.DB_PASSWORD, managedFields, last-applied-
configuration, ServiceAccount tokens — 7 tests enforce this on every commit.
```

## Cost comparison

| Path | Cost / 100-prompt run | Time | Notes |
|---|---:|---:|---|
| **Together.ai Llama 3.3 70B + router (shown here)** | **$0.20** | 6m 41s | This report |
| Ollama on EC2 g5.2xlarge (qwen2.5:32b, no router) | ~$1.50 + 18m + infra work | 20m | Earlier run, 70% pass |
| Claude Sonnet 4.6 + router (projected) | ~$6 | ~8m | Frontier upper-bound |
| Claude Opus 4.7 + router (projected) | ~$30 | ~10m | For-the-demo ceiling |

At this cost the bench is a continuous-integration signal, not a ceremony.

## Reproducibility

```bash
export TOGETHER_API_KEY=<key>
git checkout feat/validation-bench
export SUITE=cmd/chat-quality-bench/suites/incident-scenarios-100.json
./scripts/run-together-bench.sh
# Report lands at docs/reports/YYYY-MM-DD-HHMM-together-bench/report.html
```

No VMs. No model pulls. No AWS quota dances. ~7 minutes end-to-end.

## What the next 2 weeks should build

Prioritized in `../strategy/2026-04-22-gap-findings-from-100-bench.md`. Top 6 items close 78% of the gaps in 23 hours of focused work.

## Commit trail

All work on branch `feat/validation-bench` at vellankikoti/kotg.ai. Key commits:

- `d3d4ed4` `feat(tools): inspect_<kind> composites — fold detailed+events+ownership into one call per kind` (163 → 124 tools)
- `c5658ff` `feat(toolrouter): topic-aware tool selection — 163 tools → top 30 per query`
- `95424b4` `feat(bench): Together.ai provider config + API-only orchestrator`
- `047bb43` `feat(trace): capture first 4KB of assistant text in llm_text_out`
- `3f011e8` `fix(tools): retire 3 duplicate/loop-trap tools from MCP taxonomy`

22 commits total on this branch, all green builds, all tests passing (minus pre-existing `internal/analytics/ml` failures unrelated to this work).
