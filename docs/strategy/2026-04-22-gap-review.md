# Kubilitics Gap Review — 2026-04-22

> What the best K8s AI tool on earth must do, graded against what Kubilitics ships today and what competitors actually shipped in 2025-2026.

## How this doc is organised

1. Ten SRE scenarios that matter most — per scenario: what the human types, what we do, what competitors do, and the structural gap.
2. Observability 2.0 — wide-event coverage, tracing, eBPF.
3. Data-access gaps — sources beyond the K8s API that real AIOps requires.
4. Reasoning gaps — what LLMs cannot currently do in our stack.
5. Ten things competitors do measurably better.
6. Non-negotiable architectural leverage — what no competitor can cheaply copy.
7. Honest conclusions.

All claims are linked to primary sources at the bottom of each subsection.

---

## 1. Ten SRE scenarios that matter most

Selected by cross-referencing incident postmortems (Cloudflare 2025 × 3, Datadog Cilium upgrade 2025, Reddit K8s upgrade 2025, Zalando's two-year study of thousands of postmortems) with the scenarios that repeatedly surface in Komodor's Klaudia, Parity, Cleric, Resolve.ai, Datadog Bits AI SRE, and Dynatrace Davis marketing content.

### Scenario 1 — "I just got paged, what's broken RIGHT NOW?"

- **Human:** "Give me a 90-second triage of this cluster. What's on fire?"
- **Kubilitics today:** Partial. `observe_cluster_overview` + `observe_events` returns facts but no prioritised narrative. Bench `scen-health-01` passed at 91 sec on qwen2.5:32b — correct answer, too slow for the "90 seconds to situational awareness" bar.
- **Competitors:** Komodor Klaudia claims 90-second root-cause hypothesis on alert receipt ([Komodor](https://komodor.com/blog/multi-agent-ai-sre-has-landed-and-its-built-for-your-most-complex-stacks/)). Datadog Bits AI SRE begins investigating before the engineer checks in, pre-computing a hypothesis ([Datadog](https://www.datadoghq.com/blog/bits-ai-sre/)). Dynatrace Davis uses Smartscape topology for deterministic causation, not LLM reasoning, in seconds ([Dynatrace](https://www.dynatrace.com/news/blog/root-cause-analysis-in-kubernetes-with-davis-ai/)).
- **Gap:** We have the data but not the prioritisation. We call ≤3 tools per triage turn; competitors run parallel hypothesis investigations and rank them. **Root cause: no parallel planner, no health-propagation signal.**

### Scenario 2 — "My checkout pod keeps crashing. What's going on?"

- **Human:** "pod/web-7b6 in demo is CrashLoopBackOff, figure it out."
- **Kubilitics today:** `observe_pod_detailed` gives the senior-engineer view. Good primitive. But the LLM does not *interpret* — it prints what it got.
- **Competitors:** Cleric runs parallel hypothesis testing with confidence scores ([Cleric via Metoro](https://metoro.io/comparisons/ai-sre/cleric-ai-alternatives)). Klaudia cites the specific log line + commit that caused the crash ("glass box AI" per Neubird's guardrail write-up — [Neubird](https://neubird.ai/blog/ai-sre-hallucination-guardrails/)).
- **Gap:** We lack causality. No tool links a container exit code to the specific configmap change that produced it. **Root cause: no change-history + log fusion.**

### Scenario 3 — "What changed in the last 2 hours?"

- **Human:** "I came back from lunch and things feel off. What's been deployed?"
- **Kubilitics today:** `observe_resource_history` is thin. No Git integration. No deployment-event correlation. Bench `scen-change-19` passed but the answer was generic.
- **Competitors:** Komodor's core USP since 2020 is the change intelligence timeline ([Komodor](https://komodor.com/platform/how-it-works/)). Datadog Bits AI correlates with deployment events, source code, and feature flags ([Datadog](https://www.datadoghq.com/blog/bits-ai-sre-deeper-reasoning/)).
- **Gap:** No Git-to-cluster binding, no deployment-event stream ingestion, no feature-flag provider hook. **Root cause: data source — change history is not collected.**

### Scenario 4 — "Who can delete pods in the demo namespace?" (reverse RBAC)

- **Human:** Security review question. Needs subject → verb → object answer.
- **Kubilitics today:** FAILED in bench (`scen-rbac-12`). The LLM got lost between `analyze_rbac_permissions`, `security_audit_rbac`, `troubleshoot_rbac_issues` — three tools, no clear winner.
- **Competitors:** Wiz, Kubescape, and Permiso do reverse-RBAC as a first-class query ([Wiz](https://www.wiz.io/academy/container-security/kubernetes-incident-response)). K8sGPT has a `Role` analyzer that flags excessive perms but not the reverse query.
- **Gap:** We never built a subject/verb/object index. **Root cause: missing primitive — a `can_i_matrix`.**

### Scenario 5 — "Can I scale web 3→10? Do I have capacity?"

- **Human:** Counterfactual capacity question.
- **Kubilitics today:** `analyze_capacity_trends` + `analyze_blast_radius` exist but thin. Bench `scen-capacity-11` passed on the trivial case; real clusters with taints, topology spread constraints, and quotas would fail.
- **Competitors:** StormForge and Cast.ai simulate scaling decisions against a learned cluster model. Davis AI uses deterministic capacity math on Smartscape.
- **Gap:** No simulator. We answer from point-in-time data, not from a counterfactual model. **Root cause: no what-if engine.**

### Scenario 6 — "My SLO is burning — what traffic path is broken?"

- **Human:** "Checkout p95 is up 4×. Where's the latency?"
- **Kubilitics today:** Not answered at all today. We don't ingest traces. `analyze_network_connectivity` is reachability, not latency.
- **Competitors:** Dynatrace Davis uses Smartscape + span attribution; Datadog Bits AI traces the RUM→API→DB chain ([Datadog](https://www.datadoghq.com/blog/bits-ai-sre-deeper-reasoning/)); Groundcover surfaces eBPF-attributed span latency ([Groundcover](https://www.groundcover.com/blog/otel-data-enrichment)).
- **Gap:** No OpenTelemetry ingestion. This is the single biggest competitive gap. **Root cause: data source.**

### Scenario 7 — "Is any node under pressure I should know about BEFORE I get paged?"

- **Human:** Pre-emption. Smart SRE asks this daily.
- **Kubilitics today:** `analyze_node_pressure` is genuinely good. Bench passed. One of our current wins.
- **Competitors:** KRR ([Robusta](https://github.com/robusta-dev/krr)) surfaces rightsizing recommendations; no direct equivalent of cluster-wide pressure narrative.
- **Gap:** None meaningful. We match or beat here. Elevate visibility.

### Scenario 8 — "My GPU pod is stuck in Pending — why?"

- **Human:** Modern AI-workload scheduling question.
- **Kubilitics today:** `analyze_pod_scheduling` exists but has no GPU/driver/taint awareness.
- **Competitors:** Komodor shipped GPU-specialised agents in their multi-agent architecture ([Komodor KubeCon EU 2026](https://cloudnativenow.com/kubecon-cloudnativecon-europe-2026/komodor-launches-extensible-multi-agent-architecture-for-ai-driven-site-reliability-engineering/)). Kubex and Run:ai surface GPU scheduling details ([kubex](https://kubex.ai/blog/kubernetes-gpu-resource-optimization/)).
- **Gap:** No device-plugin state, no NVIDIA-operator telemetry, no understanding of fractional GPU / MIG. **Root cause: data source + domain.**

### Scenario 9 — "Did this incident happen before? What did we do last time?"

- **Human:** Institutional memory question.
- **Kubilitics today:** Nothing. Each session starts blank.
- **Competitors:** Cleric explicitly markets "continuous learning that captures institutional knowledge" ([Metoro](https://metoro.io/comparisons/ai-sre/cleric-ai-alternatives)). Zalando published 2y results of AI-powered postmortem analysis at scale ([Zalando](https://engineering.zalando.com/posts/2025/09/dead-ends-or-data-goldmines-ai-powered-postmortem-analysis.html)). Resolve.ai markets incident-memory ([Resolve.ai via Metoro](https://metoro.io/comparisons/ai-sre/resolve-ai-alternatives)).
- **Gap:** No persistent memory, no RAG over prior incidents, no Slack/PagerDuty ingestion. **Root cause: no memory layer at all.**

### Scenario 10 — "Will this rollout hurt anything? Simulate it."

- **Human:** Blast-radius question pre-change.
- **Kubilitics today:** `analyze_blast_radius` exists and topology is good — but it's static, not counterfactual.
- **Competitors:** Anyshift's explicit thesis is that AI-SRE needs topology not just telemetry ([Anyshift](https://www.anyshift.io/blog/why-ai-sre-needs-topology-not-just-telemetry)). Shoreline automations are runbook-like, not simulated.
- **Gap:** Our topology is real; the simulator on top of it is not. Closing this gap turns the existing investment into a differentiator. **Root cause: no simulator layered on the graph.**

### Scenario scoreboard

| # | Scenario | Today | Target | Gap class |
|---|---|---|---|---|
| 1 | Paged-now triage | Partial | Solved | Planner |
| 2 | Pod crashloop root cause | Primitive | Solved | Fusion |
| 3 | What changed | Weak | Solved | Data source (Git, Argo, Flux) |
| 4 | Reverse RBAC | Fail | Solved | Primitive |
| 5 | Capacity counterfactual | Primitive | Solved | Simulator |
| 6 | SLO / latency / trace | None | Solved | Data source (OTel) |
| 7 | Node pressure pre-empt | Solved | Solved | — |
| 8 | GPU scheduling | Primitive | Solved | Data source (NVIDIA operator) |
| 9 | Incident memory | None | Solved | Memory layer |
| 10 | Rollout simulation | Primitive | Solved | Simulator |

---

## 2. Observability 2.0 — wide-event coverage gaps

Charity Majors' framing is now the industry's shared vocabulary: one wide-event source of truth, with logs/metrics/traces/spans all derivable from it ([Honeycomb](https://www.honeycomb.io/blog/time-to-version-observability-signs-point-to-yes), [Pragmatic Engineer podcast Jan 2025](https://newsletter.pragmaticengineer.com/p/observability-the-present-and-future)).

**Where Kubilitics is today:**

- K8s events: yes (`observe_events`, `observe_*_events`).
- Pod logs: yes, primitive-level.
- Metrics: yes, point-in-time via metrics-server.
- Traces: **none**.
- Wide structured events (request-scoped): **none**.
- eBPF signal (L3-L7, kernel syscalls, DNS, HTTP payload enrichment): **none**.

**What the market ships:**

- Groundcover pairs eBPF + OTel so a span carries user-ID, device, cross-AZ, and PII attributes ([Groundcover eBPF + OTel](https://www.groundcover.com/ebpf/opentelemetry-ebpf)).
- Pixie auto-instruments applications at kernel-level for APM without SDK code changes ([eBPF 2026 stack](https://devops.gheware.com/blog/posts/ebpf-kubernetes-observability-2026.html)).
- Beyla from Grafana emits OTel spans from eBPF with no application change.
- Cilium Hubble gives L3-L7 network flow visibility; Tetragon gives runtime security telemetry.

**Gap:** Kubilitics has no wide-event layer, and the K8s event stream is not the same thing — it's coarse, not request-scoped. Without wide events, Scenario 2 (pod crash with "this log line at 14:31") and Scenario 6 (SLO/latency) are impossible to answer from our data alone.

**Target architecture:** ingest OTel traces; enrich with eBPF attributes via a sidecar agent or a Beyla/Groundcover-compatible pipeline; store summarised spans (not raw payloads) for the LLM.

---

## 3. Data-access gaps

The K8s API is necessary and insufficient. A real AIOps product fuses:

| Source | Why it's load-bearing | Kubilitics today | Integration pattern |
|---|---|---|---|
| **Prometheus / VM metrics** | Trends, RED/USE metrics, HPA reasoning, rightsizing | Partial — metrics-server only | Promtool query pattern, adapter |
| **Loki / Elasticsearch logs** | Aggregated log search across pods/time | No — only per-pod tail | Log-provider abstraction |
| **OpenTelemetry traces** | Latency, service maps, error attribution | No | Collector → summarised span store |
| **Git history** | "What changed" — commit→manifest→deploy chain | No | Git adapter per cluster |
| **Argo / Flux / Helm release history** | Rollout correlation | No | CRD watcher |
| **PagerDuty / incident.io / Slack timelines** | Incident memory, prior resolutions | No | Webhook ingestion |
| **Cloud provider APIs** | Quota, spot/on-demand mix, subnet/IP exhaustion, cost | No | Provider SDKs, per-cloud |
| **GPU / NVIDIA operator** | AI-workload scheduling reality | No | DCGM + device-plugin CRDs |
| **kube-bench / Kubescape / Trivy** | Security, CVE, Pod Security Standards | No real integration — `analyze_image_vulnerabilities` is stub | Local scanner process, cached findings |
| **OpenCost / Kubecost** | Cost attribution | No — `cost_*` tools are stubs | API adapter |

**Privacy model for each:** summarise before LLM, never pass raw payloads, respect the 7 guardrails already defined in `internal/mcp/server/privacy_test.go`. Secret values and cost numbers get extra redaction.

---

## 4. Reasoning gaps

Things the current stack cannot do well and why.

### 4.1 Multi-step planning — we have an agentic loop, not a plan

Today: the agentic loop runs one tool → observes → picks next. `DefaultAgentConfig().MaxTurns=10` caps depth ([bench report 2026-04-21](../reports/2026-04-21-chat-quality-bench.md)). In `bench-scen-workload-17.jsonl` the loop repeated the *same* tool 15+ times — classic error propagation described in Neubird's guardrail analysis ([Neubird](https://neubird.ai/blog/ai-sre-hallucination-guardrails/)) and in the Komodor multi-agent architecture writeup ([Komodor](https://komodor.com/blog/building-trust-in-the-machine-a-guide-to-architecting-agentic-ai-for-sre/)).

Gap: no **DAG planner** that decides up-front, "answering this question requires calls A, B, C in parallel plus D depending on A." Komodor and Datadog both moved to planner + sub-agent architectures in 2026.

### 4.2 Counterfactual / what-if

No current tool answers "if I scale X to 10, will any node fail scheduling?" as a simulation. `analyze_capacity_trends` is point-in-time. Scenario 5 and 10 need this.

### 4.3 Incident memory (RAG over past incidents)

None. Each session starts blank. Zalando's experience over two years is that postmortem-scale corpora produce genuinely useful signal once you cross ~1000 incidents ([Zalando](https://engineering.zalando.com/posts/2025/09/dead-ends-or-data-goldmines-ai-powered-postmortem-analysis.html)). Cleric and Resolve.ai make this their primary differentiator.

### 4.4 Uncertainty quantification

Current answers are flat assertions. No confidence score. No "I need more data to be sure". The Neubird playbook explicitly identifies "pleasing bias" as the #1 AI-SRE failure mode; Cleric mitigates by shipping a confidence score with every hypothesis.

### 4.5 Topology-aware reasoning

We have a topology. We use it mostly to render the UI. We do not run graph algorithms (PageRank, shortest-path, betweenness centrality) on it at query time to rank "most likely failing component" or "most critical node". The Memgraph/Neo4j writeups and Anyshift's "topology not just telemetry" thesis both underline this is standard practice in 2026 ([Memgraph](https://memgraph.com/blog/pagerank-algorithm-for-graph-databases), [Anyshift](https://www.anyshift.io/blog/why-ai-sre-needs-topology-not-just-telemetry)).

---

## 5. Ten things competitors do measurably better

Ranked by impact on our win-loss against them.

1. **Komodor** — change intelligence timeline that binds Git commits, Argo rollouts, and K8s events into one pane. The thing they're famous for since 2020. We have none of this.
2. **Datadog Bits AI SRE** — pre-emptive investigation on alert receipt (hypothesis ready before engineer arrives). Requires an alerting integration we do not have.
3. **Dynatrace Davis** — deterministic causation via Smartscape topology. Not LLM reasoning — actual graph algorithms on a live-updated dependency graph. The topology we have could do this; the algorithms are missing.
4. **Groundcover + eBPF** — wide-event observability with no app changes and per-span payload enrichment (user-ID, PII, cross-AZ). Any span-level question is theirs to answer, not ours.
5. **Cleric** — parallel hypothesis testing with confidence scores and institutional memory. Both are architectural, not feature-level. Both are missing in Kubilitics.
6. **Komodor Klaudia multi-agent** — 50+ specialised sub-agents for GPU, AWS, networking, storage. Our single-agent tool-calling model cannot match this reach.
7. **K8sGPT operator mode** — in-cluster CRD-driven continuous scanning with results as CRDs ([CNCF](https://www.cncf.io/projects/k8sgpt/)). We only run on-demand via chat.
8. **Robusta KRR** — Prometheus-grounded rightsizing with concrete percent savings. Our `recommend_resource_optimization` is a stub.
9. **Honeycomb / Hunt for patterns** — BubbleUp-style dimensionality reduction on wide events. No equivalent in our stack.
10. **Parity / Resolve.ai** — Slack-first incident response with real async context retention across multi-day incidents. Our chat panel is session-scoped.

---

## 6. Non-negotiable architectural leverage — what nobody can cheaply copy

These are real, not aspirational. Every one is shipped code today.

1. **7-guardrail privacy-first routing** with a summariser that guarantees no raw cluster payload crosses the LLM boundary (`internal/mcp/server/privacy_test.go` + routing tracer). No hosted competitor can promise this — their architecture requires shipping raw telemetry to a vendor tenancy. Tauri desktop amplifies it: the brain can run fully local.
2. **166-tool real-cluster validation bench** (`cmd/chat-quality-bench` + `cmd/bench-report`) with per-prompt JSONL traces, per-turn cost accounting, and offline HTML reports. No competitor publishes a reproducible, self-contained validation bench of this shape.
3. **27 Zustand stores of domain state** in the frontend that already encode cluster lifecycle, simulation state, topology layout, and AI settings. Competitors building from scratch have to rebuild this surface; we already have it.
4. **Blast-radius topology** (`analyze_blast_radius` + the xyflow/elkjs frontend) already rendered, already producing the graph shape we need. Turning it into a live counterfactual simulator is an *additive* step, not a ground-up rebuild.
5. **Tauri local-first distribution** — no other AI-SRE vendor ships a desktop binary. This is the only way a regulated enterprise will allow LLM-in-the-loop Kubernetes access for RBAC-sensitive use cases. Komodor, Datadog, Dynatrace cannot replicate this cheaply because their business model is cloud-tenant SaaS.
6. **Cluster-lifecycle sync discipline** (Headlamp-style, landed April 2026) — the stale-store problem that every dashboard-class tool still has, we solved. That gives our LLM a guaranteed-fresh focus cluster; bench shows zero cluster_id drift failures.
7. **Chat-panel Cmd+I + AskAIButton on 10 pages** — the UX integration is done. Competitors building desktop parity ship Slack or web; we ship in-app.

---

## 7. Honest conclusions

### Where we're ahead today

- Privacy architecture (genuinely unmatched).
- Local/desktop distribution (structural).
- Topology foundation (data is there).
- Bench discipline (we can prove our claims).
- Node-pressure and pod-dependency tools (concretely better primitives than K8sGPT).

### Where we're behind today

- **Change intelligence** (Komodor's 5-year moat).
- **Trace/span/wide-event ingestion** (the Observability 2.0 story).
- **Incident memory / RAG** (Cleric, Resolve.ai, Zalando's lesson).
- **Parallel hypothesis planner** (Komodor, Datadog, Cleric).
- **Graph-algorithm-driven causation** (Dynatrace's moat).
- **Breadth of data sources** (every serious competitor fuses ≥5 sources; we fuse 2).

### The one honest statement

Kubilitics has the best *shell* and the best *privacy story* in the market. It does not yet have the best *brain*. The 12-week plan in `2026-04-22-new-tools-plan.md` closes the brain gap without re-opening the shell — leveraging the seven architectural advantages above as the foundation.

---

## Sources

- [K8sGPT GitHub](https://github.com/k8sgpt-ai/k8sgpt) · [K8sGPT CNCF](https://www.cncf.io/projects/k8sgpt/)
- [Komodor — Klaudia launch](https://komodor.com/blog/introducing-klaudiaai-redefining-kubernetes-troubleshooting/) · [Komodor — Multi-agent architecture](https://komodor.com/blog/komodor-introduces-extensible-autonomous-multi-agent-architecture-for-ai-driven-site-reliability-engineering/) · [Komodor KubeCon EU 2026 coverage](https://cloudnativenow.com/kubecon-cloudnativecon-europe-2026/komodor-launches-extensible-multi-agent-architecture-for-ai-driven-site-reliability-engineering/) · [Komodor — Architecting agentic AI for SRE](https://komodor.com/blog/building-trust-in-the-machine-a-guide-to-architecting-agentic-ai-for-sre/)
- [kagent.dev](https://kagent.dev/) · [kagent GitHub](https://github.com/kagent-dev/kagent)
- [Cleric via Metoro](https://metoro.io/comparisons/ai-sre/cleric-ai-alternatives) · [Resolve.ai via Metoro](https://metoro.io/comparisons/ai-sre/resolve-ai-alternatives)
- [Parity](https://www.tryparity.com/) · [Parity YC profile](https://www.ycombinator.com/companies/parity)
- [Datadog Bits AI SRE launch](https://www.datadoghq.com/blog/bits-ai-sre/) · [Datadog Bits AI SRE — deeper reasoning](https://www.datadoghq.com/blog/bits-ai-sre-deeper-reasoning/)
- [Dynatrace Davis AI + K8s root cause](https://www.dynatrace.com/news/blog/root-cause-analysis-in-kubernetes-with-davis-ai/)
- [Honeycomb — Observability 2.0](https://www.honeycomb.io/blog/time-to-version-observability-signs-point-to-yes) · [Honeycomb — O11y 1.0 vs 2.0](https://www.honeycomb.io/blog/one-key-difference-observability1dot0-2dot0) · [Pragmatic Engineer w/ Charity Majors Jan 2025](https://newsletter.pragmaticengineer.com/p/observability-the-present-and-future)
- [Groundcover + OTel integration](https://itopstimes.com/observability/groundcover-announces-integration-of-its-ebpf-based-observability-platform-with-opentelemetry/) · [Groundcover OTel data enrichment](https://www.groundcover.com/blog/otel-data-enrichment) · [Groundcover eBPF + OTel explainer](https://www.groundcover.com/ebpf/opentelemetry-ebpf)
- [2026 eBPF stack writeup](https://devops.gheware.com/blog/posts/ebpf-kubernetes-observability-2026.html)
- [Anyshift — Topology, not just telemetry](https://www.anyshift.io/blog/why-ai-sre-needs-topology-not-just-telemetry)
- [Memgraph — PageRank for graph DBs](https://memgraph.com/blog/pagerank-algorithm-for-graph-databases)
- [Neubird — AI SRE hallucination guardrails](https://neubird.ai/blog/ai-sre-hallucination-guardrails/)
- [Robusta KRR](https://github.com/robusta-dev/krr)
- [Zalando — 2y of AI-powered postmortem analysis](https://engineering.zalando.com/posts/2025/09/dead-ends-or-data-goldmines-ai-powered-postmortem-analysis.html)
- [Cloudflare Nov 2025 outage post-mortem](https://news.ycombinator.com/item?id=45973709) · [Gremlin — lessons from 2025 Cloudflare outage](https://www.gremlin.com/blog/reliability-lessons-from-the-2025-cloudflare-outage)
- [Wiz — K8s incident response playbook](https://www.wiz.io/academy/container-security/kubernetes-incident-response)
- [Kubex — GPU optimization 2026](https://kubex.ai/blog/kubernetes-gpu-resource-optimization/)
- [incident.io — AI SRE guide 2026](https://incident.io/blog/what-is-ai-sre-complete-guide-2026)
