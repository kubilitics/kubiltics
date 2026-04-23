# Kubilitics New-Tools Plan — 2026-04-22

> The concrete build plan. Retire 130+ tools. Ship 30 tools with life. Add the data sources, planner, memory, and simulator that close the gap review. Measurable weekly deliverables.

## Vision one-liner

**At 3am on-call, a Kubilitics engineer types one sentence and has a prioritised, cited, counterfactual-aware answer — with raw cluster data never leaving their machine — before any hosted competitor has finished its first tool call.**

Testable statements inside that sentence:
- "One sentence → answer" = ≥ 90 % pass on `incident-scenarios-20` suite by Week 8.
- "Prioritised, cited" = every answer carries source references (tool, resource path, timestamp) and a confidence score.
- "Counterfactual-aware" = blast-radius + rollout-risk questions call the simulator tool.
- "Raw cluster data never leaving their machine" = all 7 privacy guardrails hold; regression locked in bench.
- "Before any hosted competitor" = p95 end-to-end answer < 30 s for `qwen2.5:32b` local, < 10 s for hosted gpt-4o.

---

## The 30 tools with life

Each replaces a cluster of retired tools; each answers exactly one scenario class. Naming convention: `verb_object_qualifier` — short, predictable, non-overlapping.

### Observation — 8 tools

1. **`triage_cluster`** — scenario: "I just got paged."
   - Input shape: `{cluster_id?}` — zero-config by default.
   - Composition: `observe_cluster_overview` + prioritised health rollup from `analyze_node_pressure` + top-N problem pods + last 15 min of events. Synthesises a narrative.
   - Moat: server-side prioritisation + single-turn answer. No competitor ships a one-shot narrative triage of this shape for a self-hosted product.
   - Success: `scen-health-01` passes in one tool call, under 15 s wall-clock on gpt-4o and 25 s on qwen2.5:32b.

2. **`inspect_pod`** — scenario: "What's going on with pod X."
   - Input: `{namespace, name}`.
   - Composition: current `observe_pod_detailed` + `observe_pod_dependencies` + last events + last 20 filtered-error log lines. Always summarised.
   - Moat: one call answers Scenario 2 instead of 4.
   - Success: for every CrashLoopBackOff pod in `incident-scenarios-20`, produces exit code + likely-missing-dep in ≤ 1 turn.

3. **`inspect_deployment`** — scenario: "Show me Deployment X."
   - Composition: fold `observe_deployment_detailed` + `_rollout_history` + `_events` + child RS + child-pod aggregate.
   - Moat: no sibling tool; LLM cannot pick wrong.
   - Success: `scen-pods-03` passes.

4. **`inspect_node`** — scenario: "How is node X."
   - Composition: `observe_node_detailed` + pods on node + node events + pressure flags.
   - Success: `scen-nodes-10` passes in one call.

5. **`inspect_service`** — scenario: "Where does Service X's traffic go."
   - Composition: `observe_service_detailed` + endpoints + selected pods + last 5 NP rules that apply.
   - Success: `scen-network-14` passes.

6. **`list_problems`** — scenario: "Any pods restarting / OOMKilled / pending."
   - Input: `{filter: crashlooping|oom|pending|evicted, namespace?, last?}`.
   - Composition: scans workloads + events, returns structured list of problems ranked by severity.
   - Moat: replaces 20+ list-with-filter tools with one typed-filter call.
   - Success: `scen-pods-04`, `scen-events-08` pass.

7. **`search_logs`** — scenario: "Errors in redis recently."
   - Input: `{namespace?, workload?, regex, since?}`.
   - Composition: multiplexes across pods, returns grouped error patterns with counts (not raw lines).
   - Moat: pattern-aware — answers with "saw 47× connection refused to data:6379 across 3 pods" not a log dump.
   - Success: `scen-logs-05`, `scen-logs-06` pass.

8. **`describe_topology`** — scenario: "What depends on X."
   - Input: `{kind, namespace?, name, direction: upstream|downstream|both}`.
   - Composition: wraps existing topology engine; adds algorithmic ranking (PageRank over the dep graph) to highlight the ≤ 5 most critical connected components.
   - Moat: graph-algorithm-ranked dependency view. No competitor at our price point does this in-cluster.
   - Success: `scen-workload-17` passes in ≤ 2 turns.

### Analysis — 6 tools

9. **`diagnose_pod_crash`** — scenario: "Why is this pod crashing."
   - Composition: `inspect_pod` + container exit codes + related image/config drift + recent change events.
   - Moat: binds exit code to likely cause via a learned table of (exit_code × signal × prior_event) patterns.
   - Success: for the six known CrashLoopBackOff fixtures in the bench, names the cause with confidence score > 0.7.

10. **`diagnose_pending_pod`** — scenario: "Why is this pod Pending."
    - Composition: scheduling events + node taints + resource fit + PVC status + GPU device-plugin state.
    - Moat: GPU-aware. Beats K8sGPT on AI workloads.
    - Success: 10 seeded Pending scenarios (taint, quota, no-GPU, unbound-PVC, nodeSelector) all resolved to correct reason.

11. **`diagnose_service_endpoints`** — scenario: "Service exists, nothing responds."
    - Composition: selector match + endpoint slice state + NP coverage + pod readiness.
    - Moat: traces the 5 real reasons this happens end-to-end.
    - Success: 5 seeded broken-endpoint scenarios resolved.

12. **`audit_rbac`** — scenario: "Who can do X."
    - Input: `{verb, resource, namespace?}` — reverse query.
    - Composition: builds a subject × verb × resource matrix across Role/RoleBinding/ClusterRole/ClusterRoleBinding.
    - Moat: the primitive we're missing today. Replaces 8 per-kind RBAC getters with 1.
    - Success: `scen-rbac-12`, `scen-rbac-13` pass.

13. **`check_capacity`** — scenario: "Can I scale X to N."
    - Input: `{deployment, target_replicas}`.
    - Composition: calls the new simulator (see §4). Returns pass/fail + which nodes absorb + any quota/affinity/PDB violations.
    - Moat: counterfactual. No competitor ships a free counterfactual capacity simulator.
    - Success: `scen-capacity-11` passes with real numbers, not hedges.

14. **`analyze_blast_radius`** (rename/elevate existing) — scenario: "If I change X, what else moves."
    - Composition: topology traversal + affected workloads + dependent secrets/CMs/PVCs + NP reach + SLO-linked services (once OTel lands).
    - Moat: this is the product's soul per the user's blast-radius vision.
    - Success: covers 5 reference scenarios (delete SA, rotate Secret, drain node, scale-to-zero Deployment, upgrade CRD).

### Change & history — 3 tools (new data source)

15. **`timeline_changes`** — scenario: "What changed in the last N hours."
    - Input: `{namespace?, since}`.
    - Composition: correlates K8s deployment-events + Argo/Flux release CRs + Git HEAD per Argo Application.
    - Moat: Komodor's moat, now in-cluster and private. Requires Change-History Collector (§4).
    - Success: `scen-change-19` passes with commit SHAs and actor names.

16. **`diff_desired_vs_actual`** — scenario: "What drifted."
    - Composition: compares live manifest to Argo/Flux source manifest.
    - Success: `scen-compare-18` passes with named differences.

17. **`recall_prior_incident`** — scenario: "Have we seen this before."
    - Composition: RAG over the incident-memory store (§4).
    - Moat: Cleric/Resolve.ai parity, but private.
    - Success: for 10 synthetic planted-incident fixtures, retrieves correct prior resolution.

### Capacity & cost — 2 tools (KRR/OpenCost integration)

18. **`recommend_rightsize`** — scenario: "Am I over/under-sized."
    - Composition: Prometheus-grounded (KRR-style) across workloads. Returns specific per-container CPU/mem deltas with % savings.
    - Moat: we will import KRR's algorithm and wrap it; differentiator is the private hosting + fused narrative.
    - Success: matches KRR output within 5 % on a seeded cluster.

19. **`explain_cost`** — scenario: "Where is my money going."
    - Composition: adapter against OpenCost (bundled as optional sidecar). Returns per-namespace/-workload cost breakdown.
    - Moat: privacy-first cost — no Kubecost-cloud dependency.

### Security — 3 tools

20. **`scan_security`** — scenario: "What should I worry about security-wise."
    - Composition: wraps Trivy + Kubescape runs, caches findings.
    - Moat: cached + summarised for LLM consumption. Raw findings stay local.

21. **`check_pod_security_standards`** — scenario: "Am I Restricted/Baseline compliant."
    - Composition: per-namespace PSS check + violations with specific field references.

22. **`review_exposed_services`** — scenario: "What's publicly exposed."
    - Composition: LoadBalancer/Ingress + NetworkPolicy coverage + annotation/TLS check.

### Network & traffic — 2 tools (OTel-gated)

23. **`trace_request_path`** — scenario: "Where's the latency."
    - Composition: OTel trace query (via Collector store) + service-map highlight + per-hop p95.
    - Moat: wide-event reasoning. Gated on §4 OTel ingestion.

24. **`analyze_error_budget`** — scenario: "Am I burning SLO."
    - Composition: OTel-grounded error rate + Prometheus SLI + rolling-window burn rate.

### Rollout & actions — 4 tools (safety-gated)

25. **`simulate_rollout`** — scenario: "Is this deploy safe."
    - Input: `{deployment, new_image|patch}`.
    - Composition: runs counterfactual against simulator + blast-radius + PDB math.
    - Moat: counterfactual + blast-radius fused. Unique.

26. **`scale_deployment`** — keep existing, gated.

27. **`rollback_deployment`** — keep existing, gated.

28. **`apply_patch`** — keep existing (renamed from `apply_resource_patch`), gated.

### Meta — 2 tools

29. **`open_in_kubilitics`** — scenario: "Show me this in the UI."
    - Composition: emits a deep-link frontend route. Replaces `export_topology_to_drawio`.

30. **`explain_tool`** — scenario: "Why did you call that tool."
    - Composition: returns the tool's purpose and the routing rule that caused selection. Load-bearing for the "glass box AI" mandate.

### Mapping: 161 → 30

| Retired category | Count | Replaced by |
|---|---:|---|
| 20 `observe_<kind>_events` | 20 | Folded into `inspect_<kind>` + `timeline_changes` |
| 9 `observe_<kind>_ownership_chain` | 9 | Folded into `inspect_<kind>` |
| 8 RBAC per-kind getters | 8 | `audit_rbac` |
| 8 `recommend_*` stubs | 8 | `recommend_rightsize`, `scan_security` |
| 4 `cost_*` stubs | 4 | `explain_cost` |
| 5 `action_*` duplicates | 5 | deleted |
| 7 `troubleshoot_*` vague | 7 | `diagnose_*` tools |
| 4 analysis stubs | 4 | deleted |
| 1 loop-trap (`observe_serviceaccount_events`) | 1 | deleted |
| Remaining list/get CRUD | ~66 | Folded into `list_problems`, `inspect_*`, `describe_topology` |
| — | **~131 retired** | **30 new / retained** |

---

## Net-new data sources

| Source | Adapter | Privacy model | Priority |
|---|---|---|---|
| **Prometheus / VictoriaMetrics** | Go client to in-cluster Prom; query templates per tool | Pre-summarised (top-N, p95, trend direction). Raw series never leaves the adapter. | P0 |
| **OpenTelemetry Collector** | Deploy OTel Collector alongside agent; Tempo-compatible span store (Jaeger-in-memory for dev) | Spans summarised to service-map shape + aggregate latency buckets; payloads discarded | P0 |
| **Git (via Argo/Flux)** | Watch `argoproj.io/Application` and `flux` CRs; resolve manifest SHAs to Git commits via provider-specific GraphQL | Commit metadata + file names; never commit diffs | P1 |
| **PagerDuty / incident.io / Slack** | Webhook receiver in backend; incidents stored in local DB | Titles + timestamps only; body opt-in | P1 |
| **Cloud provider APIs (AWS/Azure/GCP)** | Provider SDKs behind a `cloudadapter` interface; quota + spot + subnet fetch | Summarised; raw IAM never surfaced | P1 |
| **NVIDIA GPU Operator / DCGM** | DCGM-exporter metrics + device-plugin CRs | Summarised allocation + health | P2 |
| **Trivy / Kubescape / kube-bench** | Local binaries invoked per schedule; findings cached in SQLite | Summarised finding list; raw SBOM never crosses LLM | P0 |
| **OpenCost** | HTTP adapter to in-cluster OpenCost deployment | Summarised cost numbers; namespace names hashed for optional strict mode | P1 |

---

## Architectural upgrades needed

### 1. Multi-step DAG planner (closes §4.1 gap)

Replace the linear agentic loop with a two-phase executor:

- **Phase A — plan.** Given a user prompt, the LLM emits a *plan*: a JSON DAG of tool calls with dependencies. No tool runs yet.
- **Phase B — execute.** The runtime executes independent branches in parallel, collects results, and hands a single summarised context back to the LLM for synthesis.
- If the plan is wrong, the planner revises once (bounded to 2 replans); no 20-turn same-tool loops ever.

This closes the `bench-scen-workload-17.jsonl` failure class at the architecture level.

### 2. Uncertainty-aware response synthesis (closes §4.4)

Every answer must carry:
- A confidence score (0-1) derived from (a) how many planned steps succeeded, (b) whether any tool returned empty, (c) whether the answer depends on a stub.
- A "need more data" path that surfaces a structured suggestion ("ask me to pull N more minutes of logs") instead of fabricating.

### 3. Incident memory / RAG (closes §4.3)

- Local SQLite + FTS5 + a small embedding model (bge-small-en) that runs in the brain process.
- Ingests: past chat sessions (opt-in), PagerDuty incidents, postmortem markdown from a configurable folder.
- Tool: `recall_prior_incident`.
- Privacy: embeddings + text stay local; never cross the LLM boundary except as retrieved snippets on an explicit match.

### 4. Wide-event ingestion (closes §2 + scenarios 2, 6)

- OTel Collector as a chart-optional component.
- In-memory span store with per-service aggregates; exposes `trace_request_path` and enriches `inspect_service`.
- eBPF enrichment is deferred to post-12-week (would require Beyla or a similar agent). Phase-1 assumes app-instrumented or Beyla-instrumented workloads.

### 5. Topology-aware reasoning (closes §4.5)

- Run PageRank + betweenness on the topology graph at query time (fast: graph ≤ 5k nodes for typical clusters).
- Exposed to tools 8 (`describe_topology`) and 14 (`analyze_blast_radius`) as a ranking signal.

### 6. Counterfactual simulator (closes scenarios 5, 10)

- Headless scheduler replica: takes current node state + proposed workload change, runs the scheduler predicates (NodeResourcesFit, PodTopologySpread, PodAffinity, PDB, taints/tolerations) offline.
- No real mutation. Output: per-pod placement verdict + violated constraints.
- Powers `check_capacity` and `simulate_rollout`.

---

## 12-week roadmap

Every week ships a testable artifact. Every week ties to a measurable bench improvement. Weeks are 5 workdays.

| Wk | Deliverable | Bench target |
|---|---|---|
| **1** | Retire 80 T3/T4 tools in taxonomy; implement 8 new `inspect_*` / `list_problems` / `search_logs` tools wrapping existing handlers; update bench aliases and prompts; re-run `incident-scenarios-20`. | `incident-scenarios-20` ≥ 16/20 pass on qwen2.5:32b (up from 14/20); zero loop-trap failures. |
| **2** | DAG planner replaces linear agentic loop; bench regression on `prompts-250`. | 99%+ pass on `prompts-250` held; `incident-scenarios-20` ≥ 17/20; no same-tool-15×-loop in any trace. |
| **3** | `audit_rbac` real implementation with subject×verb×resource matrix; retire 8 RBAC tools; `inspect_service` fuses endpoints + NP reach. | `scen-rbac-12`, `scen-rbac-13`, `scen-network-14` pass. |
| **4** | Prometheus adapter + `recommend_rightsize`; retire 8 `recommend_*` stubs. New bench suite `rightsize-10.json` with KRR parity checks. | KRR-parity bench 9/10 pass; deployment Pass list unchanged. |
| **5** | Counterfactual scheduler simulator; `check_capacity` and `simulate_rollout` land. New bench suite `counterfactual-10.json`. | Counterfactual suite ≥ 8/10 pass; `scen-capacity-11` produces real numbers. |
| **6** | OTel Collector deployment (Helm sub-chart) + span store + `trace_request_path` + `analyze_error_budget`. New bench suite `trace-10.json` with seeded latency. | Trace suite ≥ 7/10 pass; privacy guardrails still green. |
| **7** | Change-history collector (Argo/Flux watcher) + Git commit resolution + `timeline_changes` + `diff_desired_vs_actual`. | `scen-change-19`, `scen-compare-18` return commit SHAs. |
| **8** | Trivy + Kubescape integration; `scan_security`, `check_pod_security_standards`, `review_exposed_services`. | Security suite (new `security-10.json`) ≥ 8/10 pass. |
| **9** | Incident-memory store (SQLite + FTS5 + bge-small-en embeddings) + `recall_prior_incident` + PagerDuty webhook ingest. | New `memory-10.json` suite seeded with planted incidents; ≥ 8/10 retrieval accuracy. |
| **10** | Topology PageRank + betweenness; `describe_topology` uses ranking; `analyze_blast_radius` upgraded. | `scen-workload-17` passes in ≤ 2 turns (currently fails). |
| **11** | Uncertainty scoring in response synthesis; "glass box" citations on every answer; `explain_tool` landed. | 100% of `incident-scenarios-20` answers carry citations + confidence score. |
| **12** | GPU operator adapter + `diagnose_pending_pod` GPU extension; OpenCost adapter + `explain_cost`; final bench across all suites on qwen2.5:32b and gpt-4o; publish report. | `incident-scenarios-20` ≥ 18/20 on qwen2.5:32b; overall 500-prompt suite ≥ 95% on gpt-4o. |

Risk: Week 2 planner and Week 5 simulator are the highest-risk weeks. Each has a defined fallback (re-enable linear loop with 20-turn cap; ship static capacity math without scheduler predicates) so the downstream weeks never block.

---

## Success metrics

### Quantitative

| Metric | Today | Wk 4 target | Wk 8 target | Wk 12 target |
|---|---:|---:|---:|---:|
| `incident-scenarios-20` pass (qwen2.5:32b local) | 14/20 (70%) | 17/20 | 18/20 | ≥ 18/20 |
| `incident-scenarios-20` pass (gpt-4o hosted) | n/a | 19/20 | 20/20 | 20/20 |
| `prompts-250` pass (gpt-4o) | 99.4% | 99.4% | 99.4% | 99.4% (held) |
| Net new bench prompts (counterfactual, trace, memory, security, rightsize) | 0 | 10 | 40 | 60 |
| p95 end-to-end turn latency (gpt-4o) | ~12 s | ≤ 10 s | ≤ 10 s | ≤ 10 s |
| p95 end-to-end turn latency (qwen2.5:32b) | ~40 s | ≤ 30 s | ≤ 30 s | ≤ 30 s |
| Privacy guardrail tests | 7 green | 7 green | 10 green | 10 green |
| Tools exposed to LLM per turn | 128 | ≤ 48 | ≤ 32 | ≤ 32 |
| Same-tool-loop incidents in any bench run | regular | 0 | 0 | 0 |

### Qualitative — quotes we'd expect SREs to give in user testing

- "It told me what changed, not what exists."
- "It said it wasn't sure and asked for more data instead of guessing."
- "It named the commit that broke my service."
- "It simulated my rollout before I pushed it."
- "Nothing left my laptop."

---

## What we explicitly will NOT build

1. **A 50+ sub-agent marketplace.** Komodor went multi-agent; we go single-brain with clear tool surface. Our bench shows specialisation does not require separate agents — it requires better tool naming.
2. **Auto-remediation without approval.** K8sGPT's roadmap includes auto-remediation; we refuse. Every mutation goes through the ActionPending gate. SREs pay us to be the co-pilot, not the pilot.
3. **Cloud-tenant SaaS.** Never. The entire architectural moat is the privacy story — shipping a cloud control plane kills the thing customers are buying.
4. **LLM-agnostic everything.** We support multiple providers, but we optimise for one path: local qwen2.5:32b and hosted gpt-4o. Other combinations work but are not the bench target.
5. **Generic "runbook marketplace".** Shoreline and Kubiya do this. We don't. Our value is one-shot synthesis, not runbook execution.
6. **CVE aggregation UI.** Scanners exist. We integrate (Trivy) but do not re-invent.
7. **A diagram-editor feature.** `export_topology_to_drawio` is deleted. Topology belongs in the live UI, not an export.
8. **More observation `<kind>_events` siblings.** If a kind needs event access, it gets it through the kind's `inspect_*` tool.

---

## First week — literal checklist

Exactly seven working days. Each item is a PR-sized task. Order matters where noted.

- [ ] **Day 1 AM.** Open a draft PR that deletes from `internal/mcp/tools/taxonomy.go`: all 20 `observe_<kind>_events` (except `observe_events`, `observe_pod_events`, `observe_node_events`), all 9 `observe_<kind>_ownership_chain`, and `observe_serviceaccount_events`. Update `internal/mcp/server/handlers_*.go` dispatchers. Keep handler funcs that are shared.
- [ ] **Day 1 PM.** Same PR: delete all 8 `recommend_*`, all 4 `cost_*`, all 5 `action_*` duplicates, `analyze_error_correlation`, `analyze_workload_patterns`, `analyze_failure_patterns`, `analyze_configuration_drift` (dedup), `analyze_performance_bottlenecks`, `troubleshoot_network_issues`, `troubleshoot_performance_degradation`, `troubleshoot_resource_constraints`, `troubleshoot_storage_issues`, `automation_run_playbook`, `automation_schedule_task`, `automation_create_alert_rule`. Land CI green.
- [ ] **Day 2 AM.** New file `internal/mcp/tools/inspect.go` — implement `inspect_pod`, `inspect_deployment`, `inspect_node`, `inspect_service` as composites that call existing `*_detailed` handlers + events + metrics in one call. Wire taxonomy.
- [ ] **Day 2 PM.** Implement `list_problems` with typed filter enum (`crashlooping|oom|pending|evicted|unready`). Tests against the seeded kind cluster.
- [ ] **Day 3 AM.** Implement `search_logs` with multi-pod fan-out + pattern grouping (simple frequency map first; upgrade in Wk 4). Tests.
- [ ] **Day 3 PM.** Implement `describe_topology` wrapping the existing topology endpoint with a `direction` filter. No ranking yet (that lands Wk 10).
- [ ] **Day 4 AM.** Implement `triage_cluster` as a server-side composite of `observe_cluster_overview` + `analyze_node_pressure` + `list_problems{crashlooping}` + 15-min event window. Target: single tool call from the LLM.
- [ ] **Day 4 PM.** Update per-prompt prompts table / aliases (`cmd/bench/aliases.json`, `cmd/build-aliases/main.go`) so the bench harness maps scenario IDs to the new tool names.
- [ ] **Day 5 AM.** Re-run `incident-scenarios-20` on qwen2.5:32b. Confirm ≥ 16/20 pass. Capture new report at `docs/reports/2026-04-29-kubilitics-validation/`.
- [ ] **Day 5 PM.** Update `docs/strategy/2026-04-22-tool-audit.md` with the week-1 delta (what actually got deleted vs planned). Open PR that updates the shipped tool count in `README.md` / Helm chart docs.
- [ ] **Day 6 (buffer).** Fix the failures surfaced by the Day-5 bench. Do not ship new tools; ship fixes.
- [ ] **Day 7 (buffer).** Write the Week-2 kickoff plan for the DAG planner. Reviewed against `docs/strategy/2026-04-22-gap-review.md` §4.1.

Definition of done for Week 1: `git log --oneline` shows ≥ 5 commits, `incident-scenarios-20` bench passes ≥ 16/20 on qwen2.5:32b, `prompts-250` regression pass rate ≥ 99%, no loop-trap traces in any of the 20 per-prompt JSONL files.
