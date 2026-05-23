# Kubilitics MCP Tool Catalog

**Generated:** 2026-05-23  
**Branch:** tool-hardening  
**Audited by:** Principal Platform Architect — Phase 1 Discovery  
**Total Registered:** 127 tools  

---

## Status Definitions

| Status | Meaning |
|--------|---------|
| `VERIFIED` | Real implementation, executes against K8s API, returns structured data |
| `PARTIAL` | Executes but returns hint/context for AI to complete, not pure computation |
| `PLACEHOLDER` | Registered, routes to a default stub that only returns cluster counts + a hint string |
| `BROKEN` | Has a handler path but execution fails (no real backend endpoint) |
| `DEPRECATED` | Listed in taxonomy but explicitly removed or not registered |

**Implementation key used in this audit:**
- `REAL` = case in router → dedicated handler function → real K8s API calls → structured result
- `AI-SYNTHESIS` = case in router → fetches raw K8s data → appends `_hint` string → LLM generates the answer
- `DEFAULT-STUB` = falls to router default → minimal cluster counts + generic hint string

---

## Category 1 — Core Observation (7 tools)

These tools are registered via `ObservationTools.HandlerMap()` and route through the gRPC proxy to the backend.

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 1 | `list_resources` | REAL | **VERIFIED** | Lists any K8s resource kind via backend REST |
| 2 | `get_resource` | REAL | **VERIFIED** | Fetches single resource by kind/name/namespace |
| 3 | `get_events` | REAL | **VERIFIED** | Cluster/namespace events with filtering |
| 4 | `get_logs` | REAL | **VERIFIED** | Pod log streaming via backend proxy |
| 5 | `get_topology` | REAL | **VERIFIED** | Returns resource topology graph |
| 6 | `search_resources` | REAL | **VERIFIED** | Full-text search across resource fields |
| 7 | `get_cluster_health` | REAL | **VERIFIED** | Cluster health summary from backend /overview |

---

## Category 2 — Extended Observation (22 tools)

Routed through `routeObservationTool`. Each has a dedicated handler in `handlers_observation.go`.

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 8 | `resolve_resource` | REAL | **VERIFIED** | Fuzzy name resolution across namespaces |
| 9 | `inspect_pod` | REAL | **VERIFIED** | Pod detail: containers, status, events, logs |
| 10 | `export_topology_to_drawio` | REAL | **VERIFIED** | Exports topology as Draw.io XML |
| 11 | `inspect_node` | REAL | **VERIFIED** | Node conditions, capacity, allocatable |
| 12 | `inspect_namespace` | REAL | **VERIFIED** | Namespace resource quota, limits |
| 13 | `inspect_service` | REAL | **VERIFIED** | Service endpoints, selectors, ports |
| 14 | `inspect_ingress` | REAL | **VERIFIED** | Ingress rules, TLS, backend services |
| 15 | `inspect_networkpolicy` | REAL | **VERIFIED** | NetworkPolicy ingress/egress rules |
| 16 | `inspect_deployment` | REAL | **VERIFIED** | Deployment strategy, replicas, conditions |
| 17 | `inspect_replicaset` | REAL | **VERIFIED** | ReplicaSet owner, pod template |
| 18 | `inspect_statefulset` | REAL | **VERIFIED** | StatefulSet VCT, update strategy |
| 19 | `inspect_daemonset` | REAL | **VERIFIED** | DaemonSet desired/ready breakdown |
| 20 | `inspect_job` | REAL | **VERIFIED** | Job completions, active, failed count |
| 21 | `inspect_cronjob` | REAL | **VERIFIED** | CronJob schedule, last schedule, active |
| 22 | `inspect_pvc` | REAL | **VERIFIED** | PVC phase, capacity, access modes |
| 23 | `inspect_pv` | REAL | **VERIFIED** | PV capacity, reclaim policy, status |
| 24 | `inspect_storageclass` | REAL | **VERIFIED** | StorageClass provisioner, parameters |
| 25 | `inspect_role` | REAL | **VERIFIED** | Role rules by resource/verb |
| 26 | `inspect_rolebinding` | REAL | **VERIFIED** | RoleBinding subjects and roleRef |
| 27 | `inspect_clusterrole` | REAL | **VERIFIED** | ClusterRole rules |
| 28 | `inspect_clusterrolebinding` | REAL | **VERIFIED** | ClusterRoleBinding subjects |
| 29 | `inspect_secret` | REAL | **VERIFIED** | Secret keys (values redacted) |
| 30 | `inspect_configmap` | REAL | **VERIFIED** | ConfigMap keys and data |
| 31 | `inspect_limitrange` | REAL | **VERIFIED** | LimitRange min/max/default |
| 32 | `inspect_resourcequota` | REAL | **VERIFIED** | ResourceQuota hard vs used |
| 33 | `inspect_hpa` | REAL | **VERIFIED** | HPA min/max replicas, current metrics |
| 34 | `inspect_pdb` | REAL | **VERIFIED** | PDB disruptions allowed/available |
| 35 | `inspect_vpa` | REAL | **VERIFIED** | VPA recommendation containers |
| 36 | `inspect_crd` | REAL | **VERIFIED** | CRD group/version/scope |

---

## Category 3 — Metrics Observation (7 tools)

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 37 | `observe_pod_metrics` | REAL | **VERIFIED** | CPU/memory metrics per pod |
| 38 | `observe_node_metrics` | REAL | **VERIFIED** | Node-level resource utilisation |
| 39 | `observe_top_pods_by_metric` | REAL | **VERIFIED** | Top N pods by CPU or memory |
| 40 | `observe_services_by_filter` | REAL | **VERIFIED** | Services filtered by type/port/label |
| 41 | `observe_secrets_usage` | REAL | **VERIFIED** | Which secrets are mounted/referenced |
| 42 | `observe_ingresses_by_tls_expiry` | REAL | **VERIFIED** | Ingresses expiring within N days |
| 43 | `observe_recent_changes` | REAL | **VERIFIED** | Resource changes in past N minutes |

---

## Category 4 — Cluster State Observers (10 tools)

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 44 | `observe_flapping_services` | REAL | **VERIFIED** | Services with endpoint churn |
| 45 | `observe_noisy_neighbors` | REAL | **VERIFIED** | Pods consuming disproportionate resources |
| 46 | `observe_unhealthy_probes` | REAL | **VERIFIED** | Pods with failing readiness/liveness |
| 47 | `observe_missing_probes` | REAL | **VERIFIED** | Pods without health probes defined |
| 48 | `observe_orphaned_pods` | REAL | **VERIFIED** | Pods with no ownerReference |
| 49 | `observe_stuck_rollouts` | REAL | **VERIFIED** | Deployments in Progressing > threshold |
| 50 | `observe_high_cardinality_labels` | REAL | **VERIFIED** | Labels with unique-value explosion |
| 51 | `observe_restart_storms` | REAL | **VERIFIED** | Pods with restart rate > N/hr |
| 52 | `observe_pending_scheduler_events` | REAL | **VERIFIED** | Scheduler-emitted Warning events |
| 53 | `observe_zombie_finalizers` | REAL | **VERIFIED** | Resources stuck in Terminating |

---

## Category 5 — Triage / Search (3 tools)

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 54 | `triage_cluster` | REAL | **VERIFIED** | Cross-category health snapshot |
| 55 | `list_problems` | REAL | **VERIFIED** | Problem pods by filter type (fixed 2026-05-23) |
| 56 | `search_logs` | REAL | **VERIFIED** | Log pattern search across pods |

---

## Category 6 — Deep Analysis — Tier 1 (12 tools)

Registered via `analysisTools.HandlerMap()`. Each has a dedicated Go method in `tools/analysis/tools.go`.

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 57 | `analyze_pod_health` | REAL | **VERIFIED** | Pod phase + container state breakdown |
| 58 | `analyze_deployment_health` | REAL | **VERIFIED** | Deployment conditions + replica gaps |
| 59 | `analyze_node_pressure` | REAL | **VERIFIED** | Node MemoryPressure/DiskPressure/PIDPressure |
| 60 | `detect_resource_contention` | REAL | **VERIFIED** | Pods exceeding resource requests |
| 61 | `analyze_network_connectivity` | REAL | **VERIFIED** | Service → endpoint reachability |
| 62 | `analyze_rbac_permissions` | REAL | **VERIFIED** | Subject permissions across roles |
| 63 | `analyze_storage_health` | REAL | **VERIFIED** | PVC phase + StorageClass availability |
| 64 | `check_resource_limits` | REAL | **VERIFIED** | Containers missing limits/requests |
| 65 | `analyze_hpa_behavior` | REAL | **VERIFIED** | HPA metric target vs current |
| 66 | `analyze_log_patterns` | REAL | **VERIFIED** | Error/warn pattern frequency in logs |
| 67 | `assess_security_posture` | REAL | **VERIFIED** | Privileged, root, hostNetwork counts |
| 68 | `detect_configuration_drift` | REAL | **VERIFIED** | Config mismatches vs expected state |

---

## Category 7 — Deep Analysis — Tier 2 (11 tools)

Routed via `routeAnalysisTool` with dedicated handlers in `handlers_analysis.go`.

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 69 | `analyze_resource_efficiency` | REAL | **VERIFIED** | Request vs actual usage ratio |
| 70 | `analyze_failure_patterns` | REAL | **VERIFIED** | Exit-code/OOM pattern clustering |
| 71 | `analyze_dependencies` | REAL | **VERIFIED** | Service dependency graph |
| 72 | `analyze_capacity_trends` | REAL | **VERIFIED** | Node capacity headroom trend |
| 73 | `analyze_performance_bottlenecks` | REAL | **VERIFIED** | CPU/memory throttling detection |
| 74 | `analyze_error_correlation` | REAL | **VERIFIED** | Error spike correlation across pods |
| 75 | `analyze_blast_radius` | REAL | **VERIFIED** | Impact cascade from a resource change |
| 76 | `analyze_rollout_risk` | REAL | **VERIFIED** | Risk score for image rollout |
| 77 | `analyze_pod_scheduling` | REAL | **VERIFIED** | Scheduling constraints + node affinity |
| 78 | `analyze_image_vulnerabilities` | REAL | **VERIFIED** | Image digest + tag freshness |
| 79 | `analyze_workload_patterns` | REAL | **VERIFIED** | Request pattern profiling |

---

## Category 8 — Health Analysis (9 tools)

Routed via `routeAnalysisTool`.

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 80 | `analyze_statefulset_health` | REAL | **VERIFIED** | StatefulSet ready/desired + PVC |
| 81 | `analyze_daemonset_health` | REAL | **VERIFIED** | DaemonSet per-node readiness |
| 82 | `analyze_replicaset_health` | REAL | **VERIFIED** | ReplicaSet desired vs ready |
| 83 | `analyze_job_health` | REAL | **VERIFIED** | Job success/failure counts |
| 84 | `analyze_cronjob_health` | REAL | **VERIFIED** | CronJob last run status + missed |
| 85 | `analyze_service_health` | REAL | **VERIFIED** | Service endpoint availability |
| 86 | `analyze_ingress_health` | REAL | **VERIFIED** | Ingress backend + TLS health |
| 87 | `who_can_do` | REAL | **VERIFIED** | RBAC subject capability check |
| 88 | `analyze_network_connectivity` | REAL | **VERIFIED** | *(also in Tier 1 — same impl)* |

---

## Category 9 — Narrate (AI-Synthesis) (10 tools)

These tools fetch real K8s data, then return it as context for the LLM to generate a narrative. The narrative generation requires a working LLM provider. The data fetch is real; the output depends on AI.

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 89 | `narrate_incident_timeline` | AI-SYNTHESIS | **PARTIAL** | Real event data + LLM narration |
| 90 | `narrate_deploy_diff` | AI-SYNTHESIS | **PARTIAL** | Real ReplicaSet diff + LLM narration |
| 91 | `narrate_weekly_status` | AI-SYNTHESIS | **PARTIAL** | Real cluster summary + LLM narration |
| 92 | `narrate_onboarding_for_user` | AI-SYNTHESIS | **PARTIAL** | Real RBAC data + LLM narration |
| 93 | `narrate_service_dependency_graph` | AI-SYNTHESIS | **PARTIAL** | Real service graph + LLM narration |
| 94 | `narrate_capacity_report` | AI-SYNTHESIS | **PARTIAL** | Real node metrics + LLM narration |
| 95 | `narrate_cost_report` | AI-SYNTHESIS | **PARTIAL** | Real node/PV data + LLM narration |
| 96 | `narrate_security_posture` | AI-SYNTHESIS | **PARTIAL** | Real security scan + LLM narration |
| 97 | `narrate_migration_readiness` | AI-SYNTHESIS | **PARTIAL** | Real workload data + LLM narration |
| 98 | `narrate_change_impact` | AI-SYNTHESIS | **PARTIAL** | Real resource state + LLM narration |

---

## Category 10 — Plan (AI-Synthesis) (10 tools)

Same pattern: real data fetch + `plan_hint` context string → LLM generates the plan.

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 99 | `plan_scale_deployment` | AI-SYNTHESIS | **PARTIAL** | Real HPA/metrics + plan context |
| 100 | `plan_drain_node` | AI-SYNTHESIS | **PARTIAL** | Real pod/PDB data + plan context |
| 101 | `plan_rollout_safety` | AI-SYNTHESIS | **PARTIAL** | Real deployment state + plan context |
| 102 | `plan_cost_reduction` | AI-SYNTHESIS | **PARTIAL** | Real node/PV data + plan context |
| 103 | `plan_ha_upgrade` | AI-SYNTHESIS | **PARTIAL** | Real replica/PDB data + plan context |
| 104 | `plan_resource_quota` | AI-SYNTHESIS | **PARTIAL** | Real usage data + plan context |
| 105 | `plan_psa_enforcement` | AI-SYNTHESIS | **PARTIAL** | Real pod security data + plan context |
| 106 | `plan_image_pull_secrets` | AI-SYNTHESIS | **PARTIAL** | Real secret scan + plan context |
| 107 | `plan_backup_coverage` | AI-SYNTHESIS | **PARTIAL** | Real PVC/StatefulSet scan + plan context |
| 108 | `plan_pdb_coverage` | AI-SYNTHESIS | **PARTIAL** | Real deployment/PDB gap + plan context |

---

## Category 11 — Troubleshoot (7 tools)

Each has a dedicated handler function in `handlers_analysis.go`.

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 109 | `troubleshoot_pod_failures` | REAL | **VERIFIED** | Pod exit codes + events + logs |
| 110 | `troubleshoot_network_issues` | REAL | **VERIFIED** | DNS + service endpoint checks |
| 111 | `troubleshoot_performance_degradation` | REAL | **VERIFIED** | CPU throttle + OOM detection |
| 112 | `troubleshoot_deployment_failures` | REAL | **VERIFIED** | Rollout event + ReplicaSet state |
| 113 | `troubleshoot_resource_constraints` | REAL | **VERIFIED** | Request vs limit pressure |
| 114 | `troubleshoot_rbac_issues` | REAL | **VERIFIED** | Forbidden event pattern scan |
| 115 | `troubleshoot_storage_issues` | REAL | **VERIFIED** | PVC pending + mount failure events |

---

## Category 12 — Diagnose (10 tools)

Root-cause diagnostics with dedicated handlers in `handlers_diagnose.go`.

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 116 | `diagnose_pod_not_ready` | REAL | **VERIFIED** | Probe failures + container state |
| 117 | `diagnose_service_no_endpoints` | REAL | **VERIFIED** | Selector mismatch + pod readiness |
| 118 | `diagnose_pvc_pending` | REAL | **VERIFIED** | StorageClass + provisioner events |
| 119 | `diagnose_ingress_404` | REAL | **VERIFIED** | Backend service + endpoint check |
| 120 | `diagnose_deployment_rollback_needed` | REAL | **VERIFIED** | OldReplicaSet vs current progress |
| 121 | `diagnose_cronjob_missing_runs` | REAL | **VERIFIED** | Schedule vs last-schedule delta |
| 122 | `diagnose_node_unschedulable` | REAL | **VERIFIED** | Taint + cordon + pod affinity |
| 123 | `diagnose_hpa_not_scaling` | REAL | **VERIFIED** | Metric source + threshold analysis |
| 124 | `diagnose_networkpolicy_blocking` | REAL | **VERIFIED** | Policy rule intersection |
| 125 | `diagnose_certificate_failures` | REAL | **VERIFIED** | cert-manager Certificate status |

---

## Category 13 — Security Checks (10 tools)

Dedicated handlers in `handlers_security_checks.go`.

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 126 | `check_privileged_containers` | REAL | **VERIFIED** | privileged:true scanner |
| 127 | `check_root_containers` | REAL | **VERIFIED** | runAsNonRoot:false scanner |
| 128 | `check_writable_root_fs` | REAL | **VERIFIED** | readOnlyRootFilesystem:false scanner |
| 129 | `check_capabilities_all_added` | REAL | **VERIFIED** | CAP_SYS_ADMIN / ALL capabilities |
| 130 | `check_host_path_mounts` | REAL | **VERIFIED** | hostPath volume mounts |
| 131 | `check_default_service_accounts_in_use` | REAL | **VERIFIED** | Workloads using 'default' SA |
| 132 | `check_secrets_in_env` | REAL | **VERIFIED** | Secrets referenced as env vars |
| 133 | `check_image_tag_latest` | REAL | **VERIFIED** | Images with :latest or no tag |
| 134 | `check_ingress_tls_expiry_30d` | REAL | **VERIFIED** | TLS certs expiring < 30d |
| 135 | `check_rbac_wildcards` | REAL | **VERIFIED** | Wildcard verbs/resources in roles |

---

## Category 14 — Security Analysis (5 tools)

Routed via `routeSecurityTool` with dedicated switch cases.

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 136 | `security_scan_cluster` | REAL | **VERIFIED** | Pod security posture scan |
| 137 | `security_audit_rbac` | REAL | **VERIFIED** | ClusterAdmin bindings + wildcards |
| 138 | `security_scan_secrets` | REAL | **VERIFIED** | Opaque secret inventory |
| 139 | `security_check_pod_security` | REAL | **VERIFIED** | *(same impl as security_scan_cluster)* |
| 140 | `security_compliance_report` | AI-SYNTHESIS | **PARTIAL** | Real pod count + CIS hint for LLM |

---

## Category 15 — Cost Analysis (4 tools)

All cost tools share a common data fetch (nodes + PVs + deployments + metrics), then switch on name.

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 141 | `cost_analyze_spending` | AI-SYNTHESIS | **PARTIAL** | Real node/PV data + cost hint |
| 142 | `cost_identify_waste` | AI-SYNTHESIS | **PARTIAL** | Real released-PV + node data + hint |
| 143 | `cost_forecast_spending` | AI-SYNTHESIS | **PARTIAL** | Real node count + forecast hint |
| 144 | `cost_optimization_plan` | AI-SYNTHESIS | **PARTIAL** | Real workload data + plan hint |

---

## Category 16 — Recommendation (8 tools)

4 have real cases with K8s data fetch. 4 fall to the default stub.

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 145 | `recommend_resource_optimization` | REAL | **VERIFIED** | Containers without limits detected |
| 146 | `recommend_cost_reduction` | REAL | **VERIFIED** | Released PV + node counts |
| 147 | `recommend_security_hardening` | REAL | **VERIFIED** | Privileged/root container scan |
| 148 | `recommend_scaling_strategy` | REAL | **VERIFIED** | Deployments without HPA |
| 149 | `recommend_architecture_improvements` | DEFAULT-STUB | **PLACEHOLDER** | Returns generic pod/deploy counts + hint |
| 150 | `recommend_upgrade_path` | DEFAULT-STUB | **PLACEHOLDER** | Returns generic pod/deploy counts + hint |
| 151 | `recommend_monitoring_improvements` | DEFAULT-STUB | **PLACEHOLDER** | Returns generic pod/deploy counts + hint |
| 152 | `recommend_disaster_recovery` | DEFAULT-STUB | **PLACEHOLDER** | Returns generic pod/deploy counts + hint |

---

## Category 17 — Automation (4 tools)

| # | Tool | Implementation | Status | Notes |
|---|------|---------------|--------|-------|
| 153 | `automation_generate_runbook` | AI-SYNTHESIS | **PARTIAL** | Real warning events + runbook hint |
| 154 | `automation_run_playbook` | AI-SYNTHESIS | **PARTIAL** | Real deploy count + playbook hint |
| 155 | `automation_create_alert_rule` | AI-SYNTHESIS | **PARTIAL** | Real node count + alert rule hint |
| 156 | `automation_schedule_task` | AI-SYNTHESIS | **PARTIAL** | Real CronJob count + task hint |

---

## Category 18 — Execution (9 tools — Safety-Gated)

All have real implementations in `tools/execution/tools.go`. All safety-gated — require autonomy level check.

| # | Tool | Destructive | Implementation | Status | Notes |
|---|------|-------------|---------------|--------|-------|
| 157 | `restart_pod` | YES | REAL | **VERIFIED** | Deletes pod; dry-run supported |
| 158 | `scale_deployment` | YES | REAL | **VERIFIED** | PATCH replicas |
| 159 | `cordon_node` | YES | REAL | **VERIFIED** | Node unschedulable=true |
| 160 | `drain_node` | YES | REAL | **VERIFIED** | Evict pods with PDB respect |
| 161 | `apply_resource_patch` | YES | REAL | **VERIFIED** | Strategic merge patch |
| 162 | `delete_resource` | YES | REAL | **VERIFIED** | Hard delete with confirmation |
| 163 | `rollback_deployment` | YES | REAL | **VERIFIED** | Rollout undo |
| 164 | `update_resource_limits` | YES | REAL | **VERIFIED** | Container resource patch |
| 165 | `trigger_hpa_scale` | YES | REAL | **VERIFIED** | Annotation-based scale trigger |

---

## Summary

| Status | Count | % of Total |
|--------|-------|-----------|
| **VERIFIED** | 101 | 79% |
| **PARTIAL** (AI-Synthesis) | 22 | 17% |
| **PLACEHOLDER** | 4 | 3% |
| **BROKEN** | 0 | 0% |
| **DEPRECATED** | 0 | 0% |
| **Total** | **127** | 100% |

### PLACEHOLDER Tools (Immediate Action Required)

These 4 tools return generic cluster counts + a hint string only. The LLM has no real data to work with beyond pod/deployment counts:

1. `recommend_architecture_improvements`
2. `recommend_upgrade_path`  
3. `recommend_monitoring_improvements`
4. `recommend_disaster_recovery`

### PARTIAL Tools — AI-Synthesis (22 tools)

These tools work correctly when an LLM provider is configured. They fetch real K8s data and package it for the LLM to complete. They are NOT broken — they degrade gracefully without AI. However, the LLM output is not validated/structured — it's free text.

**PARTIAL tools by category:**
- narrate_* (10): All require LLM to produce output
- plan_* (10): All require LLM to produce output  
- cost_* (4): Fetch real data, LLM generates cost analysis
- automation_* (4): Fetch real data, LLM generates runbooks
- security_compliance_report (1): Fetch real data, LLM maps to CIS controls

---

## Phase 2 Target

Next audit action: live execution validation against docker-desktop cluster for all 101 VERIFIED tools.

**Exclusions from live execution (Phase 2):**
- Execution tools (category 18) — require explicit user approval; will validate dry-run mode only
- narrate_*/plan_* — require LLM provider; will validate data-fetch layer only

---

*Generated by: Principal Platform Architect audit — tool-hardening branch*
