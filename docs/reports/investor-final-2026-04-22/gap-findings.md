# Brutally-Honest Gap Findings — 100-Prompt Real-World Bench
*2026-04-22 · Llama 3.3 70B Turbo (Together.ai) · 124-tool refactored taxonomy · tool router ON*

## TL;DR

- **100/100 prompts passed the bench gate** ("tool called + text produced")
- **89/100 answers are clean** (no error/retry language in assistant text)
- **11/100 answers contain honest failure recovery** — these are the real gaps
- **1/100 prompts fanned out to 95 tool calls** — architectural waste, answer correct
- **p50 tool calls per prompt: 1. p95: 3. Max outlier: 95.**
- **Wall clock: 6 min 41 s · Cost: ~$0.20**

**The bench's binary pass/fail hides answer-quality variance.** This doc mines the raw traces to surface what actually broke, why, and what to build next so future runs score 100% on both gates.

## Category breakdown (clean-answer rate)

| Category | Prompts | Clean | % |
|---|---:|---:|---:|
| events, nodes, observability, rbac, storage, summary, workload, cost | 44 | 44 | **100%** |
| health | 12 | 11 | 92% |
| config | 8 | 7 | 88% |
| network | 8 | 7 | 88% |
| logs | 5 | 4 | 80% |
| pods | 14 | 11 | 79% |
| change | 7 | 5 | 71% |
| capacity | 1 | 0 | 0% |
| compare | 1 | 0 | 0% |
| **OVERALL** | **100** | **89** | **89%** |

**The weak categories cluster around two root causes: missing metrics data + schema/scope confusion.**

## The 11 honest failures — root-cause buckets

### Bucket A · Missing data sources (6 of 11)

| Prompt | Failure |
|---|---|
| `scen-pods-33` "Web pods — CPU or memory pinned?" | "The metrics server is unavailable" → no live pod-level metrics |
| `scen-pods-42` "Pod with highest CPU this hour" | "Tool requires pod name" → no list-by-metric-aggregation |
| `scen-pods-37` "Any pods pending or stuck in ContainerCreating?" | "Unable to execute query" → no Prometheus-style filter |
| `scen-logs-48` "Recent logs from web pod" | "Proxy not initialized" → log-streaming not wired in this setup |
| `scen-capacity-11` "Scale web 3→10, realistic?" | No HPA / VPA advisor, no historical utilization data |
| `scen-change-101` "Anything deployed in last hour?" | No time-windowed rollout history |

**Gap:** Kubilitics today talks to the K8s API only. Real SRE questions need **Prometheus / Loki / OpenTelemetry / pod-metrics** adapters. This matches gap-review.md — Observability 2.0 is the biggest missing leg.

### Bucket B · Schema ambiguity → LLM parameter confusion (3 of 11)

| Prompt | Failure |
|---|---|
| `scen-change-105` "What changed recently — redis?" | LLM called with `namespace=default, name=redis` when redis lives in `data` |
| `scen-config-96` "Compare web env vars across replicas" | LLM called with `namespace=default` when web lives in `demo` |
| `scen-compare-18` "Live web vs git deploy" | Tool returned "no deployment found" because LLM used wrong namespace |

**Gap:** The tool schemas describe *what* a tool does but not *how to find the right params*. The LLM guesses and lands in the wrong namespace. **Fix: add a thin "resolver" step that maps {kind, name-hint} → concrete namespace before the real tool fires.**

### Bucket C · Missing "who/what/where" aggregators (2 of 11)

| Prompt | Failure |
|---|---|
| `scen-capacity-11` "Scale web 3→10, realistic?" | `analyze_blast_radius` failed — wanted `kind` + `name` but question is cluster-wide |
| `scen-network-85` "What does web service route to right now?" | `observe_resource_links` returned empty, no endpoint resolver |

**Gap:** Questions like *"who can do X"*, *"what depends on Y"*, *"can Z fit on the cluster"* need **one tool that aggregates across primitives**, not a tool per primitive. Matches the new-tools-plan — "tools with life, not CRUD".

## The 95-tool outlier — architectural waste

`scen-rbac-12` "Who has permission to delete pods in demo?" — **95 tool calls**, correct final answer. The LLM enumerated every ClusterRole one at a time via `inspect_clusterrole` because:

1. There is no "who can X on Y" query tool — only per-primitive inspectors
2. The `rbac` topic in the router returns ~11 RBAC tools; model tried all of them combinatorially

**Cost:** ~20× what a dedicated `resolve_permissions_for_verb(verb, kind, namespace)` tool would use. Answer was right, execution was pathological.

**Fix:** one new tool `analyze_rbac_permissions` exists in taxonomy but either lacks the right schema or isn't in the composite chain. Needs a hard look.

## What the bench proved works

- **100% of events, nodes, observability, rbac, storage, cost, summary scenarios** — these are the "ask the cluster what's there" questions and they're solved
- **Tool router eliminates agentic-loop failures** — 0 prompts hit the 20-turn cap (Ollama had 4)
- **Composite `inspect_<kind>` tools** — no prompt had to chain `detailed + events + ownership_chain` manually. That refactor paid off.
- **Text-preview capture** shows the LLM's reasoning, not just byte counts — now visible per walkthrough card

## The prioritized build list (what to do next)

| # | Build | Closes gap in | Hours |
|---|---|---|---:|
| 1 | **Metrics adapter: kube-state-metrics + metrics.k8s.io** | pods-33/42/37 — live CPU/memory | 6 |
| 2 | **`resolve_resource(kind, name-hint)` → namespace** | change-105, config-96, compare-18 | 4 |
| 3 | **`who_can_do(verb, resource)` RBAC aggregator** | rbac-12 (95-tool outlier) | 5 |
| 4 | **`recent_changes(window)` event+rollout-history fusion** | change-101 | 3 |
| 5 | **Prometheus-PromQL adapter (optional, scoped, summarized)** | capacity-11, cost attribution, perf-bottlenecks | 12 |
| 6 | **OpenTelemetry span adapter (wide events)** | observability-112, 113, 114 | 16 |
| 7 | **Log-streaming resolver (pod → logs via backend, not proxy)** | logs-48 | 3 |
| 8 | **Blast-radius tool schema fix (optional params + cluster-wide mode)** | capacity-11 | 2 |
| | **Total Week-1 (items 1–4, 7, 8)** | 78% of gaps | **23h** |
| | **Total through item 6** | observability-2.0 parity | 51h |

## What this means for "best K8s AI tool on earth"

**Against today's open-source competitors:**
- K8sGPT: we're already ahead on tool depth + privacy architecture
- kagent: we match on agent architecture, ahead on privacy routing
- Komodor: they have metrics + change-history; we don't yet (items 1 + 4)

**Against SaaS AIOps (Datadog Bits, Dynatrace Davis, New Relic AI):**
- They have metrics/logs/traces as first-class data sources
- We have the privacy story + tool composability
- **Gap closes with items 1, 5, 6** — metrics + Prometheus + OTel

**After items 1–6 land, Kubilitics becomes the only tool that:**
1. Runs fully in-cluster (no SaaS dependency)
2. Never leaks raw cluster data to the LLM (7 enforced guardrails)
3. Answers real-world SRE questions with verifiable provenance (every byte traced)
4. Composites 27+ Kubernetes primitives into natural-language interfaces

## Honest remaining weaknesses (called out for transparency)

1. **Bench gate is too lenient.** "Called a tool + produced text" isn't answer correctness. Future work: ship an answer-quality judge (LLM-as-judge or rule-based ground-truth checks per prompt).
2. **Plain-English descriptions only cover 15 of 124 tools.** The other 109 are marked `(description pending)` and the LLM must pick them blind. Write-up is mechanical (estimated 8 hours).
3. **Kind cluster bench doesn't stress-test failure paths.** Everything is healthy. Next round: chaos-engineered prompts (intentionally broken pod, corrupted configmap, OOM-loop injection).
4. **No LLM-as-judge yet for subjective quality.** 100% pass looks great but 11% of answers contain error-recovery language. An evaluator model rating 1-5 would catch this automatically.
5. **Tool router uses keyword matching.** Fine for today. Future: optional LLM-routed classifier for ambiguous prompts.

## Command to reproduce

```bash
export TOGETHER_API_KEY=<key>
export SUITE=cmd/chat-quality-bench/suites/incident-scenarios-100.json
cd /path/to/kubilitics-ai
./scripts/run-together-bench.sh
# Report lands at docs/reports/YYYY-MM-DD-HHMM-together-bench/report.html
```

Total cost per run on Together.ai Llama 3.3 70B Turbo: **~$0.20–0.40**. Iteration loop is now a cheap, honest, reproducible feedback cycle.
