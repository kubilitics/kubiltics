# Kubilitics Validation Bench — Design Spec

> Brainstormed 2026-04-21 after an initial bench on `qwen2.5:7b-instruct` revealed the model-quality ceiling blocked the investor narrative. Decision taken: re-run against a frontier-grade open model so the bench result itself is usable as product validation, not just infrastructure validation.
> Next step: `superpowers:writing-plans` turns this into an implementation plan.

## Purpose

Deliver a self-contained, investor-grade validation bench that demonstrates Kubilitics is a **real working product**, not scaffolding, through:

1. An end-to-end bench run on a model that actually understands Kubernetes and reliably uses tools (`qwen2.5:72b-instruct` on `g5.12xlarge`).
2. Full coverage documentation of every MCP tool the system exposes — what it does, when the LLM picks it, what data flows.
3. Real per-query token accounting + per-turn compute cost so "it works" is defensible with receipts.
4. A **non-technical interactive HTML report** that a PM or investor with zero Kubernetes knowledge can open in a browser and understand the flow of an arbitrary chat query.

Failure modes that explicitly must not recur from the last bench attempt:

- Cards labelled PASS when the turn actually failed (last report's badge-matcher bug — now fixed but needs verification on a real run).
- Token/cost columns all zeros (stages `cost` + `done` are still unwired — must be done before this run).
- "infrastructure works, model doesn't" ambiguity — this pass must end with a genuinely passing bench.

## Success criteria

1. ≥ 90% pass on the 50-prompt `investor-demo-50` suite.
2. ≥ 80% pass on the 426-prompt `full-500` suite (allowing for long-tail edge cases).
3. Every row in the token/cost table populated with real input/output token counts and per-turn compute cost (USD).
4. Every one of the 166 MCP tools has at least one sentence of non-technical prose in the report, grouped by category, searchable client-side.
5. Zero raw Kubernetes data visible on any `→ LLM` edge in the routing traces (privacy claim holds).
6. EC2 instance terminated within 2 min of bench completion, verified by `aws ec2 describe-instances` returning no running `Project=kubilitics-bench` tag.
7. Report opens offline (no CDN deps). Tool explorer search works with JS enabled; content is readable with JS disabled (progressive enhancement).

## Non-goals

- No paid-API fallback (no OpenAI, no Anthropic).
- No multi-model comparison dashboard.
- No destructive-tool coverage (delete/patch/scale). Bench remains read-only.
- No CI integration of the GPU-VM path (manual, on-demand).

## Decision summary

| Axis | Choice | Rationale |
|---|---|---|
| Instance | `g5.12xlarge` (4× A10G, 96 GB VRAM, 48 vCPU, 192 GB RAM) | Zero quota risk (g5 universally available), proven DLAMI, fits any open 70B model with headroom. |
| Model | `qwen2.5:72b-instruct` via Ollama (Q4_K_M, ~46 GB) | #1 open-weight on Berkeley Tool-Calling Leaderboard; strong K8s coverage from pretraining; Ollama-native. |
| Root disk | 100 GB | Fits 46 GB model + OS + Ollama + bench binary + traces. |
| Cluster | `kind-kubilitics-test` (K8s v1.33.1, 3 nodes) | Already provisioned, clean state, seeded with `demo`/`data` namespaces (nginx Deployment+Service, redis, ConfigMap, Secret with fake creds for privacy-claim exercise). |
| Suites | `investor-demo-50` + `full-500` | Already committed; no change. |

Approximate run: boot 5 min + model pull 10 min + demo-50 ~20 min + full-500 ~20 min + report gen < 1 min + terminate = **~55 min end-to-end, ~$5.20**.

## Architecture

```
laptop                                                g5.12xlarge
──────                                                ───────────
chat-quality-bench ──▶ kubilitics backend (8190)     ollama (11434)
                            │                             ▲
                            │    brain (28081, 50051)     │
                            │           │                 │
                            │           └─── llm ◀────────┘
                            │                             (schemas + summarized
                            │                              tool results only)
                            ├─ REST ─▶ kind-kubilitics-test
                            │           (3 nodes, demo/data workloads)
                            │
                trace dir ──▶  bench-report (Go) ──▶ report.html
                                                     (static + inline JS
                                                      for tool-explorer)
```

## Components (what exists vs what this spec adds)

### Exists (from prior work today)

- `internal/tracing/routing/` — JSONL recorder per turn
- `internal/llm/accounting/` — token × price → USD
- `internal/mcp/server/privacy_test.go` — 7 guardrail tests
- Tracer hooks at all 4 boundaries
- `cmd/chat-quality-bench` with `--trace-dir`
- `cmd/bench-report` v1 (static HTML + inline SVG)
- Ollama client fixes (stream, Arguments)
- Suites: `smoke-20`, `investor-demo-50`, `full-500`
- VM launch/terminate scripts (`launch-big.sh`, `terminate.sh`, `cloud-init.yaml`)

### This spec adds

#### 1. Two missing tracer stages (blockers for report correctness)

In `internal/runtime/llm_adapter.go` at the end of `StreamCompletionWithTools`' goroutine:

- `Stage("done", {duration_ms, finish_reason})` — emit at stream close with wall-clock latency.
- `Stage("cost", {input_tokens, output_tokens, usd_total})` — pull token counts from provider return (Ollama's `prompt_eval_count` + `eval_count`; OpenAI's `usage.prompt_tokens` + `completion_tokens`) via a new `TokenUsage` field on `toolStreamEvent`.

Blocker: the Ollama provider currently discards token counts before the adapter sees them. Need to plumb `prompt_eval_count`/`eval_count` from `ollamaChatResponse` up through `AgentStreamEvent`.

#### 2. Instance + model parameterization

Turn `launch-big.sh` from a thin wrapper into a proper parameterizable script:

- `INSTANCE_TYPE` default `g5.12xlarge`
- `MODEL` default `qwen2.5:72b-instruct`
- `ROOT_DISK_GB` default `100`
- `MAX_WAIT_SEC` for model pull, default `1200`

Add a preflight check script `deploy/bench-vm/preflight.sh`:

- Verifies AWS creds
- Checks g-family vCPU quota >= 48 for `g5.12xlarge`, fails with the exact quota-increase command to run
- Verifies security group has 11434 open to the caller's public IP
- Verifies DLAMI ID (`ami-0e2c8caa4b6378d8c`) is still present and published

#### 3. MCP tool catalog extractor

New Go tool at `cmd/tool-catalog/`:

- Reads `internal/mcp/tools/taxonomy.go` (`ToolTaxonomy` slice) + `chat_tools.go` (`GetChatToolDefinitions`) in-process
- Emits a single JSON file (`docs/reports/<date>-kubilitics-validation/tool-catalog.json`) with one entry per tool:

```json
{
  "name": "list_resources",
  "category": "Observation",
  "description": "List Kubernetes resources of ANY kind...",
  "parameters": [
    {"name": "cluster_id", "type": "string", "required": false},
    {"name": "kind", "type": "string", "required": true, "examples": ["Pod","Deployment","Namespace"]}
  ],
  "plain_english": "Shows you a list of things that live in your cluster. Tell it 'list pods' or 'list namespaces' and it fetches them from Kubernetes.",
  "example_prompt": "list all the pods",
  "example_args": {"kind": "Pod"}
}
```

The `plain_english` field is new — hand-authored (one sentence per tool). Required for the non-tech story. 166 sentences, grouped by category; takes ~2 hours of focused writing.

#### 4. Interactive HTML report v2

New `cmd/bench-report/` renderer (extends the existing generator):

**Sections:**

1. **Cover** — date, cluster, model, one-line pass rate headline.
2. **"What is this?" (non-tech intro)** — 3-paragraph explanation of Kubilitics suitable for a PM or investor. Includes a hero SVG showing the routing flow with annotations.
3. **Executive summary** — headline pass rate + key stats (tokens, cost, latency, trace count).
4. **Architecture diagram** (inline SVG, annotated) — static, demonstrates the privacy claim visually.
5. **Tool Explorer** — client-side-searchable grid of all 166 tools. Filters: category, parameter presence, used-in-demo. Each tool card: plain-English sentence, technical description (collapsed), example prompt + expected args (collapsed), list of demo prompts that actually called it.
6. **Prompt Walkthroughs** — 50 cards, each collapsible. Open a card to see:
   - The prompt as the user would type it
   - Plain-English "what the system did" narration
   - The sequence of tool calls the LLM emitted
   - Per-hop byte counts with the same SVG flow diagram we already have
   - The final answer (truncated preview; full expansion available)
   - Token counts + compute cost for this turn
7. **Full 500-prompt results** — dense table, sortable by pass/fail, category, latency, cost. No routing diagram (too many).
8. **Privacy proof** — the 7 guardrail tests + per-run evidence (count of turns where `resp_bytes` was never seen on a `→ LLM` edge).
9. **Methodology + limitations** — honest, as before.
10. **Appendix** — links to JUnit XML, raw traces, commit SHA, model hash.

**Interactivity budget (deliberately tiny):**

- ~200 lines of vanilla JS, no framework, no build step.
- One `<script>` block at end of body.
- Keyboard shortcuts: `/` to focus search, `Esc` to clear.
- All content renders server-side — JS only adds filter/search/expand on top.

#### 5. Hand-authored plain-English tool prose

Deliverable: a JSON file `docs/reports/<date>-kubilitics-validation/plain-english.json` keyed by tool name with one sentence each. Example:

```json
{
  "list_resources": "Shows you a list of things in your cluster — pods, services, anything. You ask 'list pods' and it fetches them from Kubernetes.",
  "analyze_pod_health": "Checks every pod for common problems: restarts, memory pressure, image issues, and CrashLoopBackOffs. Gives a plain summary instead of a dump of YAML.",
  "get_logs": "Gets recent log lines from a specific pod, so you can see what the application actually said."
}
```

The tool-catalog extractor merges this file into the catalog JSON at report generation time. Missing entries render as `"(no plain-English description yet)"` and are flagged in the report's methodology section.

#### 6. Teardown guarantees

Update `scripts/run-investor-bench.sh` (existing) to:

- `trap` terminate on ERR + EXIT
- Write the report BEFORE terminating (so a failed report gen doesn't orphan the instance)
- Final `aws ec2 describe-instances --filters "Name=tag:Project,Values=kubilitics-bench"` verification line — if any tagged instance is returned, exit non-zero

## Execution sequence (one pass, strict gates)

| # | Step | Location | Gate / cost |
|---|---|---|---|
| 1 | Plumb token counts through Ollama provider → AgentStreamEvent | laptop | unit tests green |
| 2 | Wire `done` + `cost` tracer stages in llm_adapter | laptop | unit tests green |
| 3 | Write `cmd/tool-catalog/` + plain-English.json seed (~100 tools to start; rest marked `"(TBD)"`) | laptop | catalog JSON generates cleanly |
| 4 | Build report-v2 HTML template + inline JS | laptop | `open report.html` renders; search filters work |
| 5 | Preflight: quota + SG + AMI check | laptop | all green |
| 6 | Launch `g5.12xlarge` + pull `qwen2.5:72b-instruct` | AWS | ~$1 so far |
| 7 | Point brain at remote Ollama; run `investor-demo-50` + `full-500` with `--trace-dir` | AWS | ≥ 90% / ≥ 80% pass |
| 8 | Generate report; copy to repo; commit + push | laptop | commit pushed |
| 9 | Terminate instance; verify zero running | AWS | clean |

## Hard-kill rules

- Preflight fails → abort, do not launch.
- Pass rate on `investor-demo-50` < 80% after completion → terminate, analyze locally, no relaunch until fix is proven. DO NOT debug on GPU VM.
- Wall-clock > 90 min → terminate.
- $8 AWS cost tag → terminate.

## File layout after this spec lands

```
kotg.ai/
├── internal/
│   ├── llm/provider/ollama/client.go          MODIFIED (surface token counts)
│   ├── llm/types/tool_execution.go            MODIFIED (add TokenUsage to AgentStreamEvent)
│   ├── runtime/llm_adapter.go                 MODIFIED (emit done + cost stages)
├── cmd/
│   ├── tool-catalog/                          NEW
│   │   ├── main.go
│   │   └── main_test.go
│   ├── bench-report/                          MAJOR REWORK
│   │   ├── main.go
│   │   ├── template_v2.go
│   │   ├── svg.go
│   │   ├── tool_explorer.go
│   │   ├── prompt_walkthrough.go
│   │   └── static/
│   │       ├── app.js
│   │       └── styles.css
├── deploy/bench-vm/
│   ├── launch-big.sh                          MODIFIED (parameterize)
│   ├── preflight.sh                           NEW
│   └── cloud-init.yaml                        MODIFIED (100 GB disk default)
├── docs/
│   ├── reports/
│   │   └── 2026-04-21-kubilitics-validation/  RUN OUTPUT
│   │       ├── report.html
│   │       ├── plain-english.json
│   │       ├── tool-catalog.json
│   │       ├── traces/
│   │       ├── junit.xml
│   │       └── README.md
│   └── superpowers/specs/                     (this file)
└── scripts/
    └── run-investor-bench.sh                  MODIFIED (trap, terminate verification)
```

## Open risks (acknowledged)

1. **Plain-English prose for 166 tools** — single-author bottleneck. Mitigation: seed 100 tools (the most commonly-called from our bench data). Mark remaining 66 as `"(description pending)"` and document as known gap. Report calls this out honestly.
2. **qwen2.5:72b first-token latency** on multi-GPU Ollama is ~5-10s; multi-turn tool-calling amplifies. Mitigation: `OLLAMA_KEEP_ALIVE=30m` so the model stays loaded between prompts, and `OLLAMA_NUM_PARALLEL=1` to avoid KV-cache thrashing.
3. **K8s cluster state drift during bench** — `demo` namespace pods can restart, events accumulate. Mitigation: snapshot cluster state at bench start, include in report appendix, so reviewers can see the exact cluster shape that generated the traces.

## Sign-off

- **Design approved by user:** yes (decision D'' approved, scope approved in the "proceed" reply before cleanup).
- **Cleanup pre-requisite:** done. Kind cluster `kubilitics-test` is up with seeded workloads.
- **Scope:** bounded as above.
- **Next:** `superpowers:writing-plans` expands this into step-by-step TDD plan.
