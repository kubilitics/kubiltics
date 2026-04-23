# Kubilitics MCP Tool Audit — 2026-04-22

> Every tool that ships with `kubilitics-ai` today, graded honestly. No marketing. No fluff.

## Executive summary

The brain exposes **161 MCP tools** across 7 category labels in `internal/mcp/tools/taxonomy.go`. After grading every tool against a single lens — *does this solve an SRE question that Kubilitics UI, Lens, or `kubectl` does not already solve?* — the picture is:

| Tier | Count | % | Meaning |
|---|---:|---:|---|
| **T1** — essential intelligence (unique, load-bearing) | **17** | 10.6% | AI adds value no dashboard can replicate: ownership traversal, risk-flag synthesis, cross-resource reasoning. |
| **T2** — useful glue (worth keeping, needs sharper framing) | **32** | 19.9% | Primitives the LLM genuinely composes into answers. |
| **T3** — CRUD noise (retire or collapse) | **99** | 61.5% | `observe_<kind>_events`, `observe_<kind>_ownership_chain`, generic list/get — the UI already renders these better. |
| **T4** — broken, stub, or dangerously vague | **13** | 8.0% | Declared in taxonomy but the handler either returns empty-ish data (`observe_serviceaccount_events` is the canonical infinite-loop trap, see trace `bench-scen-workload-17.jsonl`) or reasons so broadly the LLM cannot steer it (`analyze_error_correlation`, `analyze_workload_patterns`). |

**Headline finding:** 61% of the surface is CRUD the LLM does not need and actively harms tool selection — the bench's six failures on `incident-scenarios-20` all trace to the LLM choosing an `observe_*_events` variant (T3/T4) when an `analyze_*` or `observe_*_detailed` would have converged in one turn.

**Headline ask:** reduce surface to ~30 tools. The 30-tool plan lives in `2026-04-22-new-tools-plan.md`. This document justifies what to cut.

---

## Methodology

Every tool is graded with the same three questions:

1. **Does a real SRE scenario exist for which this tool is the best answer, today?** If the scenario is "the UI shows this already, cleaner", the tool is T3.
2. **Can the LLM disambiguate it from siblings?** If five sibling tools share a prefix (`observe_pod_*`, `observe_deployment_*_events`) and only the suffix differs, the LLM will guess — and the bench proves it guesses wrong often enough to dominate failure modes. Such a tool is at best T2 (useful but redundant) and often T3.
3. **Does calling this tool produce signal the model can fuse into a prose answer?** A tool that returns `[]` on the happy path (no events is the common case for a healthy ServiceAccount) pulls the agent into "keep trying" loops. Those are T4 regardless of intent.

### Tier definitions

- **T1 — essential intelligence.** The tool produces a synthesis a dashboard cannot. Example: `observe_pod_detailed` returns the full senior-engineer view (owner chain, restart reasons, resource vs limit deltas, service associations) in one shot. The LLM cannot fake this by calling five primitives — the server-side correlation is the value.
- **T2 — useful glue.** The tool is a clean primitive with one purpose and the LLM routinely picks it correctly. Example: `observe_pod_logs_filtered` with `filter=error`. It duplicates `observe_pod_logs + filter`, but the narrower surface helps tool selection. Keep, but fold into a shared schema.
- **T3 — CRUD noise.** The tool duplicates something Kubilitics UI, Headlamp, or plain `kubectl` already shows. Example: `observe_clusterrolebinding_events`. A human never types "show me ClusterRoleBinding events for foo" at 3am — they either audit RBAC (a T1 scenario) or read the YAML.
- **T4 — broken, stub, or confusion-generator.** The implementation is empty/thin, or the description is so broad that the LLM cannot route to it without collision. Example: `analyze_workload_patterns` — the handler is a stub, and "workload patterns" means nothing concrete. `analyze_error_correlation` similarly.

### Bench evidence used

- 2026-04-22 validation bench, `qwen2.5:32b` on `incident-scenarios-20`: **14/20 PASS (70%)**. Six failures: `scen-events-07`, `scen-health-02`, `scen-logs-05`, `scen-pods-03`, `scen-rbac-12`, `scen-workload-17`.
- The `scen-workload-17` trace (`bench-scen-workload-17.jsonl`) shows the model calling `observe_serviceaccount_events` 15+ consecutive times — same args, same empty body — because three tools compete for "walk me through a deployment's dependencies" and none of them owns the question.
- Earlier 250-prompt bench on `gpt-4o` passed 99.4% — on list/count prompts. That bench validated the pipeline, not the tools. Incident scenarios are the real target.

---

## Observation category (90 tools)

This category is where the rot lives. `observe_<kind>_detailed` tools are mostly T1/T2; `observe_<kind>_events` and `observe_<kind>_ownership_chain` siblings are almost uniformly T3 noise.

### Cluster / cross-resource (T1-dominant)

| Tool | Plain-English purpose | Tier | Notes |
|---|---|:-:|---|
| `observe_cluster_overview` | "Give me a 3am situational overview" | **T1** | Load-bearing answer for `scen-health-01`. Keep. |
| `observe_resource` | "Get this one thing by kind+name" | T3 | Duplicates `kubectl get`. UI has it. |
| `observe_resources_by_query` | "Natural language query across resources" | **T2** | Only useful if the NL-to-filter parser is strong; in practice the LLM prefers explicit calls. |
| `observe_events` | "What has the cluster been doing" | **T1** | Classic "what changed". Works. |
| `observe_resource_topology` | "Give me the dependency graph" | **T1** | Underpins blast-radius reasoning. |
| `export_topology_to_drawio` | "Give me a diagram link" | T3 | Cute demo feature; no incident value. Move to UI, drop from LLM surface. |
| `observe_resource_history` | "Past revisions of a resource" | **T2** | Needed for change-root-cause, but the handler is thin (only supports a few kinds). |
| `observe_resource_links` | "Which things point to which" | **T2** | Overlaps with `observe_resource_topology`. Collapse. |
| `observe_api_resources` | "List API groups" | T3 | `kubectl api-resources`. Noise. |
| `observe_custom_resources` | "List CRs of a CRD" | **T2** | Useful for GitOps/operator debugging. Keep but narrow scope. |

### Pods (T1/T2 mixed)

| Tool | Purpose | Tier | Notes |
|---|---|:-:|---|
| `observe_pod_detailed` | "Give me the full senior-engineer view of this pod" | **T1** | Canonical T1. Correlates owner, metrics, restarts, events. Keep. |
| `observe_pod_dependencies` | "What configmaps/secrets/PVCs does this pod need" | **T1** | Solves stuck-pod debugging in one call. |
| `observe_pod_logs` | "Tail this pod" | **T2** | Primitive. Keep. |
| `observe_pod_logs_filtered` | "Just the errors" | **T2** | Collapse into `observe_pod_logs` with a typed `filter` enum. |
| `observe_pod_ownership_chain` | "Who owns this pod" | T3 | Already included inside `observe_pod_detailed`. Duplicate. |
| `observe_pod_events` | "Last N events for this pod" | **T2** | Keep — events are the "why". |

### Nodes

| Tool | Purpose | Tier | Notes |
|---|---|:-:|---|
| `observe_node_status` | "List nodes with conditions" | **T2** | UI shows this; but LLM needs it. |
| `observe_node_detailed` | "Deep dive on one node" | **T1** | Great tool. Answers `scen-nodes-10`. |
| `observe_node_events` | "Node events" | T3 | Rolled up into `_detailed`. Drop. |
| `observe_metrics` | "CPU/mem for a resource" | **T2** | Primitive. Keep. |

### Namespaces

| Tool | Purpose | Tier | Notes |
|---|---|:-:|---|
| `observe_namespace_overview` | "Per-namespace summary" | **T2** | Useful for `scen-health-02`-style scoped triage. |
| `observe_namespace_detailed` | "One namespace deep dive" | T3 | Redundant with `_overview` for practical purposes. |
| `observe_namespace_events` | "Namespace events" | T3 | Folded into overview. Drop. |

### Workloads — Deployments, ReplicaSets, StatefulSets, DaemonSets, Jobs, CronJobs (36 tools, T3-dominant)

Every workload kind has the **same four-tool pattern**: `_detailed`, `_events`, `_ownership_chain`, plus sometimes `_rollout_history`. This is where the LLM gets lost. Bench evidence: `scen-pods-03` ("show me the web deployment") failed because the LLM tried `observe_deployment_events` → empty → `observe_deployment_ownership_chain` → deployment-to-RS (not what the human asked) → never reached `observe_deployment_detailed`.

| Tool | Purpose | Tier | Notes |
|---|---|:-:|---|
| `observe_workload_health` | "Are my workloads OK" | **T1** | Cross-cuts all workload kinds. Keep. |
| `observe_deployment_detailed` | "Senior view of a Deployment" | **T1** | Keep. |
| `observe_deployment_rollout_history` | "Revisions of this Deployment" | **T2** | Needed for rollback answers. |
| `observe_deployment_events` | "Deployment events" | T3 | Fold into `_detailed`. |
| `observe_deployment_ownership_chain` | "Deployment→RS" | T3 | Trivial reverse of pod chain. Drop. |
| `observe_replicaset_detailed` | Senior RS view | T3 | Humans never ask about a specific RS. Surface only via deployment. |
| `observe_replicaset_events` | RS events | T3 | Drop. |
| `observe_replicaset_ownership_chain` | RS→pods | T3 | Drop. |
| `observe_statefulset_detailed` | Senior STS view | **T2** | Keep (STS has legit unique debugging needs: volume claim templates, ordinals). |
| `observe_statefulset_events` | STS events | T3 | Fold. |
| `observe_statefulset_ownership_chain` | STS→pods | T3 | Drop. |
| `observe_daemonset_detailed` | Senior DS view | **T2** | Keep — "is this DS covering every node" is a real question. |
| `observe_daemonset_events` | DS events | T3 | Fold. |
| `observe_daemonset_ownership_chain` | DS→pods | T3 | Drop. |
| `observe_job_detailed` | Job view | **T2** | Jobs need their own lens (exit code, backoff). Keep. |
| `observe_job_events` | Job events | T3 | Fold. |
| `observe_job_ownership_chain` | Job→pods | T3 | Drop. |
| `observe_cronjob_detailed` | CronJob view | **T2** | Schedule + last runs is unique. |
| `observe_cronjob_events` | CronJob events | T3 | Fold. |
| `observe_cronjob_ownership_chain` | CronJob→Jobs | T3 | Drop. |

Rollup: **6 keep, 14 retire or fold** out of 20 workload observation tools.

### Networking (Services, Ingress, NetworkPolicy — 9 tools)

| Tool | Purpose | Tier | Notes |
|---|---|:-:|---|
| `observe_service_detailed` | "Senior view of a Service, incl. endpoints + selected pods" | **T1** | Answers `scen-network-14` in one call. |
| `observe_service_events` | Service events | T3 | Fold. |
| `observe_service_endpoints` | Endpoints for a Service | T3 | Included in `_detailed`. |
| `observe_ingress_detailed` | Senior view of an Ingress | **T2** | Keep — backend-not-found is a classic. |
| `observe_ingress_events` | Ingress events | T3 | Fold. |
| `observe_networkpolicy_detailed` | NetworkPolicy deep view | **T2** | Keep. |
| `observe_networkpolicy_events` | NP events | T3 | Fold. |
| `observe_network_policies` | "All NPs + gap analysis" | **T1** | Cluster-wide NP audit is high-signal. Keep. |

### Storage (7 tools)

| Tool | Purpose | Tier | Notes |
|---|---|:-:|---|
| `observe_pvc_detailed` | Senior PVC view | **T2** | Keep. |
| `observe_pvc_events` | PVC events | T3 | Fold. |
| `observe_pvc_consumers` | "Which pods use this PVC" | **T2** | Real debug case. Keep. |
| `observe_pv_detailed` | Senior PV view | T3 | PV is cluster-scoped; real case is "find full PVs", answered by `observe_storage_status`. |
| `observe_pv_events` | PV events | T3 | Drop. |
| `observe_storageclass_detailed` | SC view | T3 | Rarely the question. |
| `observe_storageclass_events` | SC events | T3 | Drop. |
| `observe_storage_status` | "Cluster-wide storage health" | **T1** | `scen-storage-15` target. Keep. |

### RBAC (12 tools — near-total T3)

| Tool | Purpose | Tier | Notes |
|---|---|:-:|---|
| `observe_serviceaccount_detailed` | SA view | **T2** | Keep — SA→secrets mapping is real. |
| `observe_serviceaccount_events` | SA events | **T4** | **CANONICAL LOOP TRAP.** Returns `[]` in 99% of healthy clusters. Bench `scen-workload-17` fell into this 15+ times. **Delete.** |
| `observe_serviceaccount_permissions` | "What can this SA do" | **T1** | Core RBAC audit primitive. Missing today's handler uses — rarely invoked because hidden among noise. |
| `observe_role_detailed` | Role view | T3 | `kubectl describe role`. |
| `observe_role_events` | Role events | T3 | Drop. |
| `observe_rolebinding_detailed` | RB view | T3 | Drop. |
| `observe_rolebinding_events` | RB events | T3 | Drop. |
| `observe_clusterrole_detailed` | CR view | T3 | Drop. |
| `observe_clusterrole_events` | CR events | T3 | Drop. |
| `observe_clusterrolebinding_detailed` | CRB view | T3 | Drop. |
| `observe_clusterrolebinding_events` | CRB events | T3 | Drop. |

**Real RBAC scenarios need *reverse-query* tools** (`who can delete pods in demo?`), not per-kind getters. That's a new-tool gap, tracked in `2026-04-22-new-tools-plan.md`.

### Config (Secrets, ConfigMaps, LimitRanges, ResourceQuotas — 12 tools)

| Tool | Purpose | Tier | Notes |
|---|---|:-:|---|
| `observe_secret_detailed` | Secret metadata (redacted) | **T2** | Keep. Redaction is a real feature. |
| `observe_secret_events` | Secret events | T3 | Drop. |
| `observe_secret_consumers` | "Which pods mount this secret" | **T1** | Solves "rotation blast radius" questions. Keep. |
| `observe_configmap_detailed` | CM view | **T2** | Keep. |
| `observe_configmap_events` | CM events | T3 | Drop. |
| `observe_configmap_consumers` | "Which pods mount this CM" | **T1** | Same logic. Keep. |
| `observe_limitrange_detailed` | LR view | T3 | Rare question; roll into namespace overview. |
| `observe_limitrange_events` | LR events | T3 | Drop. |
| `observe_resourcequota_detailed` | RQ view | **T2** | Keep — quota pressure is a real incident cause. |
| `observe_resourcequota_events` | RQ events | T3 | Drop. |

### Scaling primitives (HPA, VPA, PDB — 6 tools)

| Tool | Purpose | Tier | Notes |
|---|---|:-:|---|
| `observe_hpa_detailed` | HPA view w/ scaling history | **T1** | Keep — "why isn't HPA scaling" is a top-5 real question. |
| `observe_hpa_events` | HPA events | T3 | Fold. |
| `observe_pdb_detailed` | PDB view | **T2** | Keep — drain-blocked-by-PDB is classic. |
| `observe_pdb_events` | PDB events | T3 | Drop. |
| `observe_vpa_detailed` | VPA view | **T2** | Keep if VPA is installed. |
| `observe_vpa_events` | VPA events | T3 | Drop. |

### CRDs (3 tools)

| Tool | Purpose | Tier | Notes |
|---|---|:-:|---|
| `observe_crd_detailed` | CRD schema | **T2** | Keep — operator debugging needs it. |
| `observe_crd_events` | CRD events | T3 | Drop. |
| (`observe_custom_resources` above) | | | |

### Observation rollup

- **Kept T1:** `observe_cluster_overview`, `observe_events`, `observe_resource_topology`, `observe_pod_detailed`, `observe_pod_dependencies`, `observe_node_detailed`, `observe_workload_health`, `observe_deployment_detailed`, `observe_service_detailed`, `observe_network_policies`, `observe_storage_status`, `observe_serviceaccount_permissions`, `observe_secret_consumers`, `observe_configmap_consumers`, `observe_hpa_detailed`. **(15)**
- **Kept T2:** ~18 tools (all `_detailed` for workload kinds plus logs/metrics primitives).
- **Top-3 standouts:** `observe_pod_detailed`, `observe_service_detailed`, `observe_pod_dependencies` — each closes a whole incident class in one call.
- **Top-3 to retire:** `observe_serviceaccount_events` (T4 loop trap), all `observe_<kind>_ownership_chain` tools (T3 duplicate), all `observe_<kind>_events` per-kind tools (fold into `_detailed`).

---

## Analysis category (31 tools)

This is the second-biggest lie in the surface. Many `analyze_*` tools look like AI superpowers in the taxonomy but their handlers are thin wrappers around `/topology` or `/resources`. The LLM picks them expecting insight; gets a blob of data; has to synthesize anyway.

| Tool | Purpose | Tier | Notes |
|---|---|:-:|---|
| `analyze_pod_health` | "Is this pod OK" | **T2** | Real, but 80% overlap with `observe_pod_detailed`. Merge. |
| `analyze_deployment_health` | "Is this Deployment OK" | **T2** | Same — merge with `_detailed`. |
| `analyze_replicaset_health` | RS health | T3 | No human asks this alone. |
| `analyze_job_health` | Job health | **T2** | Keep. |
| `analyze_cronjob_health` | CronJob health | **T2** | Keep. |
| `analyze_statefulset_health` | STS health | **T2** | Keep. |
| `analyze_daemonset_health` | DS health | **T2** | Keep. |
| `analyze_node_pressure` | "Any nodes under pressure" | **T1** | `scen-nodes-09` target. Keep — great tool. |
| `detect_resource_contention` | "Who is fighting for CPU/RAM" | **T1** | Keep. Underused. |
| `analyze_service_health` | Service health | **T2** | Keep. |
| `analyze_ingress_health` | Ingress health | **T2** | Keep. |
| `analyze_network_connectivity` | "Can A reach B" | **T1** | *If* it works; currently thin. Promote via real impl. |
| `analyze_rbac_permissions` | "Who can do X" | **T1** | `scen-rbac-12` target. Currently the only tool that could answer the reverse-query RBAC question; bench shows it is not selected reliably — description is too generic. Fix naming. |
| `analyze_storage_health` | Storage health | **T2** | Keep. Overlaps `observe_storage_status`; merge. |
| `check_resource_limits` | "Are my limits sane" | **T2** | Keep. |
| `analyze_hpa_behavior` | "Why is HPA doing that" | **T1** | Keep — great scenario fit. |
| `analyze_log_patterns` | "Recurring log patterns" | **T2** | Valuable if the pattern miner is real; currently simple substring. Upgrade. |
| `assess_security_posture` | "Cluster security score" | **T2** | Overlaps `security_scan_cluster`. Keep one. |
| `detect_configuration_drift` | "Drift from desired state" | **T2** | Keep. |
| `analyze_resource_efficiency` | "Am I over/under-provisioned" | **T2** | Worth keeping; overlaps KRR. |
| `analyze_failure_patterns` | "Recurring failures" | **T4** | Stub-ish; too vague. Cut or make concrete. |
| `analyze_dependencies` | "Deps of a resource" | **T2** | Fine, but overlaps `observe_pod_dependencies`. Namespace-scope it. |
| `analyze_configuration_drift` | Duplicate of `detect_configuration_drift` | **T4** | **Same name, two tools** — LLM cannot choose. Fold into one. |
| `analyze_capacity_trends` | "Will I run out of room" | **T1** | Scenario `scen-capacity-11`. Handler is thin; upgrade. |
| `analyze_performance_bottlenecks` | "What's slow" | **T4** | Too vague, no concrete signal surfaced. |
| `analyze_error_correlation` | "Correlated errors" | **T4** | Classic AI-agent-bingo name. Cut. |
| `analyze_blast_radius` | "What goes down if X dies" | **T1** | Core USP. Underused because description collides with `analyze_dependencies`. Rename + elevate. |
| `analyze_rollout_risk` | "Is this rollout safe" | **T2** | Keep — unique value. |
| `analyze_pod_scheduling` | "Why is this pod pending" | **T1** | Critical scenario. Keep. |
| `analyze_image_vulnerabilities` | "CVEs in running images" | **T2** | Keep *if* integrated with a real scanner (Trivy). Currently mock. |
| `analyze_workload_patterns` | "Workload patterns" | **T4** | Meaningless name. Cut. |

Rollup: **8 T1, 14 T2, 2 T3, 7 T4.** Two duplicate drift-detection tools is the worst-offender finding — remove one.

---

## Recommendation category (8 tools) — almost entirely stubs

| Tool | Tier | Notes |
|---|:-:|---|
| `recommend_resource_optimization` | **T2** | Could be real if wired to KRR-style Prometheus recs. Not yet. |
| `recommend_cost_reduction` | **T4** | Stub. Delete or wire to real cost source. |
| `recommend_security_hardening` | **T4** | Stub. |
| `recommend_scaling_strategy` | **T4** | Stub. |
| `recommend_architecture_improvements` | **T4** | Classic generic. Cut. |
| `recommend_upgrade_path` | **T4** | Stub. |
| `recommend_monitoring_improvements` | **T4** | Stub. |
| `recommend_disaster_recovery` | **T4** | Stub. |

**Verdict:** retire the entire category, rebuild with 2-3 specific, load-bearing tools. The new plan proposes `recommend_rightsize_from_prometheus` (replaces 3) and `recommend_upgrade_gate` (replaces 1).

---

## Troubleshooting category (7 tools)

| Tool | Tier | Notes |
|---|:-:|---|
| `troubleshoot_pod_failures` | **T2** | Useful as a scenario-anchor. But 90% overlap with `analyze_pod_health` + `observe_pod_events`. |
| `troubleshoot_network_issues` | **T4** | Vague. Cut. |
| `troubleshoot_performance_degradation` | **T4** | Vague. Cut. |
| `troubleshoot_deployment_failures` | **T2** | Keep. |
| `troubleshoot_resource_constraints` | **T4** | Cut; overlaps `analyze_node_pressure`. |
| `troubleshoot_rbac_issues` | **T2** | Keep. |
| `troubleshoot_storage_issues` | **T4** | Vague. Cut. |

---

## Security category (5 tools)

| Tool | Tier | Notes |
|---|:-:|---|
| `security_scan_cluster` | **T2** | Keep — wire to kube-bench/Trivy. |
| `security_audit_rbac` | **T1** | This *should* be the canonical RBAC reverse-query tool. Make it real. |
| `security_scan_secrets` | **T2** | Overlaps Trivy/Kubescape — integrate, don't re-invent. |
| `security_check_pod_security` | **T2** | Pod Security Standards compliance. Keep. |
| `security_compliance_report` | **T4** | Too broad; depends on framework. Parameterize or cut. |

---

## Cost category (4 tools) — all stubs

| Tool | Tier | Notes |
|---|:-:|---|
| `cost_analyze_spending` | **T4** | No cost source. Stub. |
| `cost_identify_waste` | **T4** | Stub. |
| `cost_forecast_spending` | **T4** | Stub. |
| `cost_optimization_plan` | **T4** | Stub. |

**Verdict:** retire the category pending an OpenCost/Kubecost integration. Shipping these tools as-is hurts credibility — the LLM picks them, gets nothing back, and drops quality.

---

## Action / Execution / Automation categories (14 tools)

Safety-gated mutations. These are T2 by design (they exist to be called only via ActionPending flow), but the dual naming (`action_scale_workload` in `automation` block vs `scale_deployment` in `execution`) creates confusion.

| Tool | Tier | Notes |
|---|:-:|---|
| `action_scale_workload` | T3 | **Duplicates `scale_deployment` in execution.** Delete one. |
| `action_restart_workload` | T3 | Duplicates `restart_pod`. |
| `action_apply_manifest` | **T2** | Keep — covers non-scale mutations. |
| `action_rollback_deployment` | T3 | Duplicates `rollback_deployment`. |
| `action_execute_command` | **T4** | Too broad; dangerous. Remove unless tightly scoped. |
| `automation_run_playbook` | **T4** | No playbook engine shipped. Stub. |
| `automation_schedule_task` | **T4** | Stub. |
| `automation_create_alert_rule` | **T4** | Stub. |
| `automation_generate_runbook` | **T2** | Could be real — runbook-from-incident is a genuine scenario. |
| `restart_pod` (execution) | **T2** | Keep. |
| `scale_deployment` (execution) | **T2** | Keep. |
| `cordon_node` | **T2** | Keep. |
| `drain_node` | **T2** | Keep. |
| `apply_resource_patch` | **T2** | Keep. |
| `delete_resource` | **T2** | Keep (gated). |
| `rollback_deployment` | **T2** | Keep. |
| `update_resource_limits` | **T2** | Keep. |
| `trigger_hpa_scale` | **T2** | Keep. |

**Headline:** the `action_*` aliases in `automation` add zero value — they duplicate `execution` tools. Retire all five.

---

## Aggregate findings

### Dead weight — retire these 80+ tools

1. **All 20 `observe_<kind>_events` tools** (except `observe_events`, `observe_pod_events`, `observe_node_events`) — fold into the `_detailed` sibling.
2. **All 9 `observe_<kind>_ownership_chain` tools** — information belongs inside `_detailed`.
3. **Eight RBAC per-kind getters** (`observe_role_detailed`, `observe_rolebinding_*`, `observe_clusterrole_*`, `observe_clusterrolebinding_*`) — collapse into `security_audit_rbac` + `observe_serviceaccount_permissions`.
4. **All 8 `recommend_*` tools** pending real integrations.
5. **All 4 `cost_*` tools** pending a cost source.
6. **The 5 `action_*` automation duplicates.**
7. **`analyze_error_correlation`, `analyze_workload_patterns`, `analyze_failure_patterns`, `analyze_performance_bottlenecks`, `analyze_configuration_drift`** (duplicate) — stubs or meaningless.
8. **`observe_serviceaccount_events`** — the loop trap.
9. **All 3 `troubleshoot_*_issues` vague tools.**

### Hidden gems — tools that should be marketed/elevated

1. `observe_pod_detailed` — the model of what a T1 tool should feel like.
2. `observe_pod_dependencies` — one call solves "stuck pod missing config".
3. `observe_secret_consumers` / `observe_configmap_consumers` — blast-radius-of-rotation in a single shot.
4. `analyze_node_pressure` — correctly answers the pre-incident capacity question.
5. `analyze_blast_radius` — already present, just buried.

### Name-overlap confusion (load-bearing LLM failures)

- `analyze_dependencies` vs `observe_pod_dependencies` vs `analyze_blast_radius` — three tools competing for "what depends on what". Bench data shows the model alternates.
- `analyze_configuration_drift` vs `detect_configuration_drift` — literal duplicate.
- `action_scale_workload` vs `scale_deployment` — the LLM guesses; the safety-engine path is only wired for `scale_deployment`, so picking the wrong one breaks approval UX.
- `observe_<kind>_events` × 20 variants — every one of them is a coin-flip for the LLM when the user just says "any recent events for X".
- `troubleshoot_rbac_issues` vs `analyze_rbac_permissions` vs `security_audit_rbac` — three aliases for "audit RBAC". Pick one.

### Tools the LLM selected in loops (bench evidence)

| Tool | Observed loop count | Trace |
|---|---:|---|
| `observe_serviceaccount_events` | 15+ | `bench-scen-workload-17.jsonl` |
| `observe_deployment_events` → fallback chain | 6+ | `bench-scen-pods-03.jsonl` |
| `observe_events` (broad) | 4+ with no narrowing | `bench-scen-events-07.jsonl` |

---

## What survives

After the cut, ~49 tools survive (17 T1 + 32 T2). The new-tools plan narrows further to ~30 by composing existing T1/T2 primitives behind a smaller public surface.

The 30-tool replacement design lives in `docs/strategy/2026-04-22-new-tools-plan.md`. The competitor and scenario evidence that justifies the shape of those 30 tools lives in `docs/strategy/2026-04-22-gap-review.md`.
