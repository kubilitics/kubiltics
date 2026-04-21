# Privacy-First Routing Bench — Design Spec

> Brainstormed 2026-04-21. Approved by the user. Next step: `superpowers:writing-plans` turns this into an implementation plan.

## Purpose

Prove, with reproducible evidence, Kubilitics' core privacy claim: **"Sensitive Kubernetes cluster data never reaches the LLM."** Deliver an investor-grade HTML report built from real production-shape traffic that (a) shows per-request routing between our backend, the LLM, and the cluster, (b) quantifies what the LLM sees vs. what it does not, (c) reports real token/cost numbers, and (d) honestly bounds what is and is not proven.

This work also folds in three deferred code fixes (`MaxTurns` 10→20, OpenAI 429 retry + backoff, rate-limit tier doc) so the bench runs against the latest-greatest pipeline.

## Success criteria

1. A privacy-guardrail test suite passes locally AND during the bench run; zero instances of raw secrets, tokens, annotations, or kubeconfig material in any LLM-bound payload.
2. A 50-prompt investor-demo run produces an HTML report containing 50 per-prompt routing SVG mini-diagrams with measured byte counts.
3. A 500-prompt scale run completes within the $5 budget on a single GPU VM, with auto-termination and report commit.
4. The report is self-contained (opens offline, no external JS/CSS), committed to the repo under `docs/reports/`.
5. Failure modes are classified; no failures outside {rate_limit, capacity, max_turns} appear in the final report without root-cause analysis.

## Non-goals

- No multi-model dashboard overlay (single-model HTML first).
- No CI-gating of the big-VM path (manual / on-demand).
- No destructive-tool coverage (`delete_resource`, etc.).
- No claim that `kagent` is in the hot path (it is a registered skeleton; current chat traffic runs through the `llmEngine`).

## Architecture — what this spec adds

```
┌────────────────────────────────────────────────────────────────────┐
│                      Existing chat pipeline                        │
│                                                                    │
│   user ─► backend ─► brain (llmEngine → LLMAdapterBridge)          │
│                         │                                          │
│                         ├─► LLM (system prompt + tool schemas)     │
│                         │                                          │
│                         └─► clusterIDInjectingExecutor             │
│                                  │                                 │
│                                  └─► mcpToolExecutor               │
│                                         │                          │
│                                         └─► mcpServer.ExecuteTool  │
│                                                 │                  │
│                                                 └─► REST → backend │
│                                                         │          │
│                                                         └─► K8s    │
└────────────────────────────────────────────────────────────────────┘
         │
         │  NEW — this spec adds:
         ▼
┌────────────────────────────────────────────────────────────────────┐
│               Routing Tracer + Cost Accounting                     │
│                                                                    │
│   tracing.StageRecorder   ←── hooks injected at every boundary     │
│        │                                                           │
│        ├── stage, ts, bytes, tokens, redaction markers             │
│        └── JSONL per chat turn → /tmp/kubilitics-traces/<turn>.jl  │
│                                                                    │
│   llm/accounting.Reporter ←── token-count delta × model price      │
│        └── USD per turn                                            │
│                                                                    │
│   cmd/chat-quality-bench     ─── writes traces alongside JUnit     │
│   cmd/bench-report           ─── reads traces + JUnit → HTML+SVG   │
│                                                                    │
│   internal/mcp/server/privacy_test.go                              │
│        └── inject sensitive K8s objects → assert redaction         │
└────────────────────────────────────────────────────────────────────┘
```

## Components — each unit, its purpose, its interface

### 1. `internal/tracing/routing/` (NEW)

**Purpose.** Record every stage of a chat turn to a structured JSONL trace. One file per turn. Reader-friendly (single JSON object per line) so both Go and SVG-generating tooling can consume.

**Interface.**

```go
package routing

type Recorder interface {
    Stage(name string, fields map[string]any)
    Close() error
}

func NewFileRecorder(turnID string, dir string) (Recorder, error)
func FromContext(ctx context.Context) Recorder   // no-op if absent
func WithRecorder(ctx context.Context, r Recorder) context.Context
```

**Stage taxonomy (fixed list).**

| Stage | Fields |
|---|---|
| `user_msg` | `bytes`, `contains_pii` (heuristic) |
| `llm_prompt_in` | `model`, `input_tokens`, `system_prompt_bytes`, `tool_schemas_bytes`, `contains_cluster_data: false` |
| `tool_dispatch` | `tool_name`, `arg_keys`, `cluster_id: <uuid>` |
| `backend_k8s_fetch` | `path`, `method`, `resp_bytes`, `contains_secrets_raw`, `contains_configmap_raw` |
| `tool_result_summarized` | `bytes_in`, `bytes_out`, `dropped_fields: [...]` |
| `llm_tool_result_in` | `tokens`, `bytes`, `contains_cluster_data: true`, `contains_secrets_post_redaction: false` |
| `llm_text_out` | `output_tokens`, `bytes` |
| `cost` | `usd_total` (cumulative for turn) |
| `done` | `finish_reason`, `duration_ms` |

**Hook points** (kept thin — add `Stage(...)` calls, do not restructure existing code):

- `internal/runtime/llm_adapter.go` — `user_msg`, `llm_prompt_in`, `llm_text_out`
- `internal/runtime/llm_adapter.go` — `clusterIDInjectingExecutor.Execute` → `tool_dispatch`
- `internal/server/tool_executor.go` → `tool_result_summarized` (bytes_in = raw from ExecuteTool, bytes_out = post-cap)
- `internal/mcp/server/backend_http.go` → `backend_k8s_fetch` with redaction heuristics

### 2. `internal/llm/accounting/` (NEW)

**Purpose.** Map token counts × model unit prices to USD, surface per-turn cost.

```go
type Tallier struct{ ... }
func NewTallier(model string) *Tallier
func (t *Tallier) AddInput(tokens int)
func (t *Tallier) AddOutput(tokens int)
func (t *Tallier) USD() float64
```

**Price table** lives in `prices.go` with explicit comments on source (OpenAI docs, as of Apr 2026). Ollama = $0. Unknown models = $0 and a one-time WARN log.

### 3. `internal/mcp/server/privacy_test.go` (NEW)

**Purpose.** Synthesize K8s payloads carrying sensitive material, run them through `capToolOutput` + `summarizeListForLLM`, assert redaction.

**Scenarios (each a table-driven sub-test):**

| # | Input shape | Assertion |
|---|---|---|
| 1 | `Secret{data:{password:"..."}}` | output string never contains `password|secret-value|`base64 of value` |
| 2 | `ConfigMap{data:{"aws-credentials":"..."}}` | output doesn't contain the credential bytes |
| 3 | `Pod{spec.containers[0].env=[{name:DB_PASS,value:"xyz"}]}` | no `env` in output; no `xyz` in output |
| 4 | `Pod{metadata.annotations={"kubectl.kubernetes.io/last-applied-configuration":"... full manifest with secrets ..."}}` | annotation absent from output |
| 5 | `ServiceAccount{secrets:[{name:"token-abc"}]}` + secret object with token bytes | token bytes absent from output |
| 6 | `Node{status.nodeInfo.kubeletVersion:"v1.28.3"}` (benign, should pass) | version STILL present (we want useful data through) |

**Non-goal.** This test does not claim secrets can never leak through a hypothetical future handler. It locks the current behavior for the handlers we expose.

### 4. Code fixes

**A. `MaxTurns` 10 → 20 + env override.** One-line change in `internal/llm/types/tool_execution.go`, plus environment override in `DefaultAgentConfig()`, plus one test.

**B. OpenAI 429 retry with backoff.** Wrap the HTTP call in `internal/llm/provider/openai/tool_loop.go` (and `client_impl.go` completion path). Honor the `Please try again in X ms` hint from the error body. Exponential backoff otherwise. Max 3 retries. Metrics counter on retries. Unit test with `httptest.Server` returning 429 → 200.

**C. Rate-limit docs.** `docs/ops/rate-limits.md`: tier table, how to request upgrade, TPM math (tokens/min ÷ avg tokens per turn = throughput).

### 5. `cmd/chat-quality-bench` additions

- `--trace-dir` flag. When set, each turn emits `<dir>/<prompt-id>.jsonl`.
- Appends a compact summary line to the bench log: `tokens_in=... tokens_out=... usd=0.00xx`.
- No change to existing PASS/FAIL criteria.

### 6. `cmd/bench-report/` (NEW)

**Purpose.** Turn JUnit XML + per-prompt trace JSONL into a single self-contained HTML file.

**Interface.**

```
bench-report \
  --junit    chat_quality_final.xml \
  --traces   /tmp/kubilitics-traces/ \
  --suite    investor-demo-50 \
  --out      docs/reports/2026-04-21-investor-bench/report.html
```

**Output.**

```
docs/reports/2026-04-21-investor-bench/
├── report.html                      # main, inline SVG, self-contained
├── traces/<prompt-id>.jsonl         # copied for auditability
├── junit.xml                        # preserved
├── architecture.svg                 # static; checked into repo
└── privacy-proof.md                 # guardrail test pass summary
```

**HTML structure.**

1. Cover — title, date, commit SHA, model, cluster profile, total runtime, total cost.
2. Executive summary — pass count, cost, avg tokens, one-line privacy headline.
3. Privacy architecture — embedded `architecture.svg` + live evidence: "N turns traced. 0 turns sent `backend_k8s_fetch.resp_bytes` verbatim to the LLM. N summarizer invocations dropped managedFields / annotations / secret data."
4. **50 per-prompt flow SVGs**, grid layout, scannable. Each ≈ 220×120 px, shows: user→backend→LLM→backend→K8s→summarizer→LLM→user with byte counts annotated on each edge.
5. Token/cost table — sortable HTML `<table>`, per prompt, with totals row.
6. Latency distribution — inline SVG histogram, p50/p95/p99 lines.
7. Failure taxonomy — inline SVG pie, with expandable rows showing the failing prompt's trace.
8. 10 deep-dive samples (5 easy + 5 hard) — full expanded trace inline, redaction evidence highlighted.
9. Methodology + honest limitations — kagent not in hot path, destructive tools not covered, OpenAI rate limits hit at X, etc.
10. Appendix — prompt list, commit, raw JUnit link.

**No external deps.** All SVG built from Go templates. All CSS inline. Must open from a USB stick with no network.

### 7. Prompt suites

- `cmd/chat-quality-bench/suites/smoke-20.json` — 20 prompts covering list/count/analyze/events/logs/edge. For small-VM validation.
- `cmd/chat-quality-bench/suites/investor-demo-50.json` — 50 curated "narrative" prompts grouped by theme (5 categories × 10), used for the big HTML report.
- `cmd/chat-quality-bench/suites/full-500.json` — existing 426-prompt suite. Background/scale validation.

## Execution plan — one pass, no iterations

| # | Stage | Location | Expected duration | Cost |
|---|---|---|---|---|
| 1 | Code: fixes A+B+C, tracer, accounting, privacy tests, bench report generator | laptop | ~2 hr | $0 |
| 2 | Unit tests all green | laptop | ~2 min | $0 |
| 3 | Local OpenAI smoke (smoke-20) | laptop | ~5 min | ~$0.25 |
| 4 | Small-VM smoke (t3.large + qwen2.5:3b + 30-tool window + smoke-20) | EC2 | ~15 min | ~$0.05 |
| 5 | Big-VM scale (g4dn.xlarge + qwen2.5:7b-instruct + 500-prompt + investor-demo-50 with full traces) | EC2 | ~40 min | ~$0.40 |
| 6 | Report generation + commit + push + auto-terminate | EC2 | <2 min | — |
| **Total** | | | **~3 hr** | **~$0.70** |

## Hard-kill rules

- **Privacy guardrail test fails at any stage** → stop. Code fix required. No VM spend.
- **Local OpenAI smoke < 95%** → stop. Local fix. No VM spend.
- **Small-VM smoke < 95%** → stop. Terminate VM. Local fix.
- **Big-VM failures outside {rate_limit, capacity, max_turns}** → terminate immediately, root-cause locally, no relaunch until fix is proven.
- **$5 budget** (AWS cost explorer tag query) → terminate.
- **Idle > 5 min between prompts** → bench is broken, terminate.

## Visual style — routing mini-diagram

Each of the 50 demo prompts gets a small SVG like this (ASCII schematic):

```
user ──(42B)──► backend ──(2.8K)──► LLM
                                     │
                                     │ tool_call: list_resources{kind=Pod}
                                     ▼
                              backend ──(148K raw K8s)──► summarizer ──(4.8K capped)──► LLM
                                                                                        │
                                                                                        ▼
                                                                                  answer (201 tok, 0.8K)
                                                                                        │
                                                                                        ▼
                                                                                       user
```

Rendered as horizontal SVG with:
- Boxes for actors (user / backend / LLM / K8s).
- Arrows with byte/token labels inline.
- Red color on any edge where raw K8s data reaches the LLM (should be zero edges across all 50).
- Green on edges where summarizer dropped fields.
- Legend at the bottom of the report.

## File layout after this spec lands

```
kotg.ai/
├── internal/
│   ├── tracing/routing/                NEW
│   │   ├── recorder.go
│   │   └── recorder_test.go
│   ├── llm/
│   │   ├── accounting/                 NEW
│   │   │   ├── tallier.go
│   │   │   ├── prices.go
│   │   │   └── tallier_test.go
│   │   ├── provider/openai/
│   │   │   ├── tool_loop.go            MODIFIED (429 retry)
│   │   │   └── retry_test.go           NEW
│   │   └── types/
│   │       └── tool_execution.go       MODIFIED (MaxTurns)
│   ├── mcp/server/
│   │   ├── privacy_test.go             NEW
│   │   └── backend_http.go             MODIFIED (fetch stage record)
│   ├── runtime/llm_adapter.go          MODIFIED (hook points)
│   └── server/tool_executor.go         MODIFIED (hook points)
├── cmd/
│   ├── chat-quality-bench/
│   │   ├── main.go                     MODIFIED (--trace-dir)
│   │   └── suites/
│   │       ├── smoke-20.json           NEW
│   │       ├── investor-demo-50.json   NEW
│   │       └── full-500.json           RENAMED from prompts-500.json
│   └── bench-report/                   NEW
│       ├── main.go
│       ├── template.html.tmpl
│       └── svg.go
├── deploy/bench-vm/                    NEW
│   ├── cloud-init-t3-small.yaml
│   ├── cloud-init-g4dn.yaml
│   └── launch.sh
├── docs/
│   ├── ops/rate-limits.md              NEW
│   ├── reports/                        RUN OUTPUT
│   └── superpowers/specs/              (this file)
└── scripts/
    └── run-investor-bench.sh           NEW  (smoke → openai → small-vm → big-vm → report → terminate)
```

## Open risks (acknowledged)

1. **g4dn.xlarge + qwen2.5:7b tool-calling reliability.** Qwen 2.5 supports tool calls but 7B is small. Fallback: if pass rate on smoke-20 < 95% on the small VM with 30-tool window, escalate to `g5.xlarge` (A10G, ~$1/hr) with `qwen2.5:14b-instruct` for the scale run. Budget still fits under $5.
2. **Cloud-init model pull time** (~1-2 GB over the wire on instance boot). Mitigation: pre-bake an AMI with the model pulled in a prior session. Out of scope for this pass — accept 1-3 min bootstrap.
3. **Ollama tool-calling schema pruning on VM.** Our `ollama` provider must pass only the trimmed 30-tool window. One-line config from the bench flag. Tested locally against `localhost:11434` before remote.
4. **Privacy heuristics are not a substitute for a real DLP.** The `contains_*` flags in the tracer are keyword-matched. The report will call this out honestly.

## Sign-off

- **Design approved by user:** yes (2026-04-21, in the brainstorming message trail).
- **Scope:** bounded as above.
- **Next:** `superpowers:writing-plans` to expand into step-by-step TDD plan.
