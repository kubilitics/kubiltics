# Kubilitics AI — MCP Tool Reference

**157 tools · 8 categories · Generated 2026-05-26**

---

## Testing & Validation Summary

| Check | Status | Detail |
|---|---|---|
| **Schema contracts** | ✅ 157/157 PASS | `TestContract_AllToolsHaveRequiredFields` — name, description, category, inputSchema present |
| **Registration** | ✅ 157/157 PASS | `TestRegisterAllTools_AllToolsRegistered` — all tools reachable via `ExecuteTool` |
| **Functional unit tests** | ✅ 216 cases PASS | Per-tool handler tests (server package) with fake backend |
| **Parallel load (non-destructive)** | ✅ 148/148 PASS | All read-only tools callable concurrently under `-race` detector |
| **Race detector** | ✅ 0 races | `go test -tags load -race` clean |
| **Lint** | ✅ 0 issues | `golangci-lint` clean (brain + backend) |
| **Certification grade** | ⏳ Provisional | Report generated; no live CI signals injected yet |
| **Destructive tools** | 🔒 9 Blocked | Gated until `certify-tools` runs with live K8s signal |
| **Benchmarks** | ✅ 20/20 | All safety layers measured; cert gate at 4 ns |

### What "Provisional" means

The certification engine grades every tool across four signals:
- **Contract** — schema + required fields (all 157 pass)
- **Live validation** — real cluster round-trip (requires `certify-tools` CLI against a live cluster)
- **Statement coverage** — go test coverage >60% threshold
- **Chaos resilience** — recovers from nil/timeout backend responses

All 157 tools are Provisional because live signals have not been injected into the report yet. Run `./certify-tools --backend http://localhost:8190` against a running cluster to graduate tools to Certified.

---

## Tool Categories at a Glance

| Category | Count | Purpose |
|---|---|---|
| [Observation](#observation-49-tools) | 49 | Read-only cluster state — inspect any resource |
| [Analysis](#analysis-41-tools) | 41 | Deep insights, health scoring, root-cause reasoning |
| [Recommendation](#recommendation-18-tools) | 18 | Planning, optimisation, upgrade paths |
| [Troubleshooting](#troubleshooting-17-tools) | 17 | Specific failure diagnosis |
| [Security](#security-15-tools) | 15 | CIS checks, RBAC audit, compliance |
| [Execution](#execution-9-tools--safety-gated) | 9 | Cluster mutations — safety-gated |
| [Cost](#cost-4-tools) | 4 | Spend analysis, waste detection, forecasting |
| [Automation](#automation-4-tools) | 4 | Playbooks, schedules, alert rules, runbooks |

---

## Observation (49 tools)

*All read-only. Autonomy level 1. Never blocked.*

---

### `triage_cluster`
**Purpose:** Single-turn cluster triage — the first tool to call when paged at 3am. Returns a ranked narrative of top pod problems, node pressure, and recent critical events in one response.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID (defaults to active cluster) |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```

**Test coverage:** `TestHandleTriageCluster_ComposesAndRanks`, `TestLoad_Concurrent20x10` (200 parallel calls)

---

### `resolve_resource`
**Purpose:** Fuzzy-find a resource by kind + name hint across the whole cluster. Call this first when you know the kind but not the namespace.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `kind` | string | Yes | Resource kind e.g. `Deployment`, `Service`, `ConfigMap` |
| `name_hint` | string | Yes | Name or fuzzy substring |
| `cluster_id` | string | No | Cluster ID |
| `cluster_wide` | boolean | No | Search all namespaces (default true) |

**Example:**
```json
{ "kind": "Deployment", "name_hint": "payment-api" }
```

**Test coverage:** `TestResolveResource_ExactMatchAcrossNamespaces`, `TestResolveResource_NoMatchGivesSuggestions`, `TestResolveResource_RequiresArgs`

---

### `inspect_pod`
**Purpose:** Deep dive into a Pod — spec, status, recent events, ownership chain (RS → Deployment), containers and their states.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Pod name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j" }
```

**Test coverage:** `TestHandleInspectPodValidation`, `TestHandlePodDetailed_FullResponse`, `TestPrivacy_Pod_EnvSecretsNeverLeak`

---

### `inspect_deployment`
**Purpose:** Deep dive into a Deployment — spec, status, rollout history, recent events, child ReplicaSets.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api" }
```

**Test coverage:** `TestHandleDeploymentDetailed_FullResponse`

---

### `inspect_replicaset`
**Purpose:** Deep dive into a ReplicaSet — spec, status, events, ownership chain (parent Deployment → child Pods).

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | ReplicaSet name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api-7d9c8b" }
```

**Test coverage:** Contract test + registration test

---

### `inspect_statefulset`
**Purpose:** Deep dive into a StatefulSet — spec, update strategy, ordinal readiness, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | StatefulSet name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "database", "name": "postgres-primary" }
```

**Test coverage:** Contract + `TestAnalyzeStatefulSetHealth_DegradedReplicas`

---

### `inspect_daemonset`
**Purpose:** Deep dive into a DaemonSet — spec, node coverage, rolling update progress, events, child Pods.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | DaemonSet name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "monitoring", "name": "node-exporter" }
```

**Test coverage:** Contract + `TestAnalyzeDaemonSetHealth_DegradedCount`

---

### `inspect_job`
**Purpose:** Deep dive into a Job — spec, completion state, failed count, backoff limit, events, parent CronJob and child Pods.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Job name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "batch", "name": "nightly-report-28497520" }
```

**Test coverage:** Contract + `TestAnalyzeJobHealth_FailedJob`

---

### `inspect_cronjob`
**Purpose:** Deep dive into a CronJob — schedule, suspend flag, last run, events, child Jobs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | CronJob name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "batch", "name": "nightly-report" }
```

**Test coverage:** Contract + `TestAnalyzeCronJobHealth_Suspended`

---

### `inspect_node`
**Purpose:** Deep dive into a Node — capacity, taints, conditions (Ready/MemoryPressure/DiskPressure), events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Node name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "ip-10-0-1-42.us-east-1.compute.internal" }
```

**Test coverage:** `TestHandleNodeDetailed_FullResponse`

---

### `inspect_namespace`
**Purpose:** Deep dive into a Namespace — metadata, phase, pod count, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Namespace name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "production" }
```

**Test coverage:** Contract + registration

---

### `inspect_service`
**Purpose:** Deep dive into a Service — type, ports, selector, endpoints, pods selected, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Service name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api-svc" }
```

**Test coverage:** `TestHandleServiceDetailed_ClusterIP`

---

### `inspect_ingress`
**Purpose:** Deep dive into an Ingress — rules, TLS, ingressClassName, backend services, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Ingress name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-gateway" }
```

**Test coverage:** Contract + `TestAnalyzeIngressHealth_NoBackend`

---

### `inspect_networkpolicy`
**Purpose:** Deep dive into a NetworkPolicy — podSelector, policyTypes, ingress/egress rules, pods selected, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | NetworkPolicy name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "deny-all-ingress" }
```

**Test coverage:** Contract + `TestDiagnoseNetworkPolicyBlocking_DefaultDeny`

---

### `inspect_pvc`
**Purpose:** Deep dive into a PVC — accessModes, storage, storageClassName, phase, bound volume, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | PVC name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "database", "name": "data-postgres-primary-0" }
```

**Test coverage:** Contract + `TestDiagnosePVCPending_NoStorageClass`

---

### `inspect_pv`
**Purpose:** Deep dive into a PersistentVolume — capacity, accessModes, reclaimPolicy, claimRef, status, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | PV name (cluster-scoped) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "pvc-a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
```

**Test coverage:** Contract + registration

---

### `inspect_storageclass`
**Purpose:** Deep dive into a StorageClass — provisioner, parameters, volumeBindingMode, PV count, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | StorageClass name (cluster-scoped) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "gp3-encrypted" }
```

**Test coverage:** Contract + registration

---

### `inspect_configmap`
**Purpose:** Deep dive into a ConfigMap — metadata, data keys, consumers, events. Data values are not returned to protect sensitive configs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | ConfigMap name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "app-config" }
```

**Test coverage:** `TestPrivacy_ConfigMap_DataValuesNeverLeak`, `TestSummarizeItem_ConfigMap_Active`

---

### `inspect_secret`
**Purpose:** Deep dive into a Secret — metadata, type, data keys (values always redacted), TLS info, events. Never returns secret values.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Secret name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "db-credentials" }
```

**Test coverage:** `TestPrivacy_Secret_DataValuesNeverLeak`, `TestSummarizeItem_Secret_Active`

---

### `inspect_role`
**Purpose:** Deep dive into a Role — rules, referencing RoleBindings, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Role name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "pod-reader" }
```

**Test coverage:** Contract + `TestSummarizeItem_Role_Active`

---

### `inspect_rolebinding`
**Purpose:** Deep dive into a RoleBinding — roleRef, subjects, resolved Role summary, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | RoleBinding name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "pod-reader-binding" }
```

**Test coverage:** Contract + registration

---

### `inspect_clusterrole`
**Purpose:** Deep dive into a ClusterRole — rules, referencing ClusterRoleBindings, events. Cluster-scoped.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | ClusterRole name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "system:node" }
```

**Test coverage:** Contract + registration

---

### `inspect_clusterrolebinding`
**Purpose:** Deep dive into a ClusterRoleBinding — roleRef, subjects, resolved ClusterRole, events. Cluster-scoped.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | ClusterRoleBinding name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "cluster-admin-binding" }
```

**Test coverage:** Contract + registration

---

### `inspect_hpa`
**Purpose:** Deep dive into an HPA — minReplicas, maxReplicas, scaleTargetRef, current/desired replicas, conditions, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | HPA name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-hpa" }
```

**Test coverage:** Contract + `TestDiagnoseHPANotScaling_MinEqualsMax`

---

### `inspect_pdb`
**Purpose:** Deep dive into a PodDisruptionBudget — minAvailable/maxUnavailable, selector, currentHealthy, disruptionsAllowed, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | PDB name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-pdb" }
```

**Test coverage:** Contract + registration

---

### `inspect_vpa`
**Purpose:** Deep dive into a VerticalPodAutoscaler — targetRef, updatePolicy, resource recommendations, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | VPA name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-vpa" }
```

**Test coverage:** Contract + registration

---

### `inspect_limitrange`
**Purpose:** Deep dive into a LimitRange — limits (type, default, defaultRequest, max, min), events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | LimitRange name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "default-limits" }
```

**Test coverage:** Contract + registration

---

### `inspect_resourcequota`
**Purpose:** Deep dive into a ResourceQuota — hard limits and current usage (CPU, memory, pods, services, etc.), events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | ResourceQuota name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "compute-quota" }
```

**Test coverage:** Contract + registration

---

### `inspect_crd`
**Purpose:** Deep dive into a CustomResourceDefinition — group, names, scope, versions, validation schema, instance count.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | CRD name e.g. `certificates.cert-manager.io` |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "certificates.cert-manager.io" }
```

**Test coverage:** `TestHandleCRDDetailed`

---

### `list_problems`
**Purpose:** Find BROKEN or UNHEALTHY pods only. Use for incident triage, not general pod listing. Returns pods in the specified problem state.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `filter` | string | Yes | One of: `crashlooping`, `oom`, `pending`, `evicted`, `image_pull_error`, `unhealthy` |
| `namespace` | string | No | Namespace scope (all if omitted) |
| `since` | string | No | Go duration e.g. `15m`, `1h` |
| `limit` | integer | No | Max results (default 50, max 200) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "filter": "crashlooping", "namespace": "production", "since": "30m" }
```

**Test coverage:** `TestHandleListProblems_CompileGuard`, `TestHandleListProblems_UnknownFilter`

---

### `search_logs`
**Purpose:** Pattern-clustered log search across pods in a namespace. Returns grouped error templates with counts — not raw log dumps.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `regex` | string | Yes | Pattern to search for e.g. `"error\|panic\|FATAL"` |
| `workload` | string | No | Filter to a specific workload name |
| `since` | string | No | Go duration |
| `max_pods` | integer | No | Pod cap (default 10) |
| `max_lines_per_pod` | integer | No | Line cap (default 1000) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "regex": "connection refused|timeout", "since": "1h" }
```

**Test coverage:** `TestHandleSearchLogs_CompileGuard`, `TestHandleSearchLogs_RequiresNamespaceAndRegex`, `TestHandleSearchLogsValidation`

---

### `export_topology_to_drawio`
**Purpose:** Export cluster topology as an editable draw.io diagram. Returns a URL that opens the architecture diagram.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |
| `namespace` | string | No | Scope to namespace (all if omitted) |

**Example:**
```json
{ "cluster_id": "prod-us-east-1", "namespace": "production" }
```

**Test coverage:** `TestHandleExportTopologyToDrawio_MermaidFallback`

---

### `observe_pod_metrics`
**Purpose:** Live CPU/memory usage for a pod or namespace aggregate from the metrics server.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | No | Pod name (aggregate if omitted) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j" }
```

**Test coverage:** `TestObservePodMetrics_SinglePod`, `TestObservePodMetrics_FallbackWhenUnavailable`

---

### `observe_node_metrics`
**Purpose:** Live CPU/memory/disk metrics for one or all nodes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | Node name (all nodes if omitted) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "ip-10-0-1-42.us-east-1.compute.internal" }
```

**Test coverage:** `TestHandleMetrics_NodeScope`

---

### `observe_top_pods_by_metric`
**Purpose:** Top-N pods sorted by CPU or memory usage. Use for identifying resource hogs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `metric` | string | Yes | One of: `cpu`, `memory` |
| `namespace` | string | No | Namespace scope |
| `limit` | integer | No | Top N results (default 10) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "metric": "memory", "namespace": "production", "limit": 5 }
```

**Test coverage:** `TestObserveTopPodsByMetric_SortsByCPU`, `TestObserveTopPodsByMetric_InvalidType`, `TestObserveTopPodsByMetric_EmptyFallback`

---

### `observe_services_by_filter`
**Purpose:** Find services with health issues — no endpoints, flapping, or other anomalies.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `flapping` | boolean | No | Return services with churning endpoints |
| `no_endpoints` | boolean | No | Return services with zero endpoints |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "no_endpoints": true, "namespace": "production" }
```

**Test coverage:** `TestServicesByFilter_NoEndpoints`, `TestServicesByFilter_EmptyResults_HasExplanatoryMessage`, `TestServicesByFilter_ImpliedFiltersWhenNoneGiven`

---

### `observe_secrets_usage`
**Purpose:** Every Secret with a reference graph showing which pods mount it, reference it as env vars, or leave it unused.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestSecretsUsage_MarksUnused`, `TestSecretsUsage_CatchesTrulyUnused`, `TestPrivacy_Secret_DataValuesNeverLeak`

---

### `observe_ingresses_by_tls_expiry`
**Purpose:** Ingresses whose TLS certificates expire within N days. Use for proactive cert rotation alerting.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `days` | integer | No | Expiry window in days (default 30) |
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "days": 14, "namespace": "production" }
```

**Test coverage:** `TestIngressesByTLSExpiry_FlagsExpiring`, `TestIngressesByTLSExpiry_UnavailableFallback`

---

### `observe_recent_changes`
**Purpose:** All meaningful changes in a time window — rollouts, pod create/delete, config updates. Use for "what changed recently?" questions.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `since` | string | No | Go duration (default `15m`) |
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "since": "1h", "namespace": "production" }
```

**Test coverage:** `TestRecentChanges_FiltersByWindow`, `TestRecentChanges_EmptyWindow`

---

### `observe_flapping_services`
**Purpose:** Services whose endpoint set changed more than a threshold number of times, indicating instability.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `threshold` | integer | No | Churn count threshold (default 3) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "threshold": 5 }
```

**Test coverage:** `TestObserveFlappingServices_CountsChurn`

---

### `observe_noisy_neighbors`
**Purpose:** Pods using more than a CPU or memory threshold of their node's total capacity. Identifies resource hogs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cpu_threshold` | number | No | Fraction of node CPU (default 0.5) |
| `memory_threshold` | number | No | Fraction of node memory (default 0.5) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cpu_threshold": 0.7, "namespace": "production" }
```

**Test coverage:** `TestObserveNoisyNeighbors_ThresholdFilter`, `TestObserveNoisyNeighbors_MetricsMissing_GracefulNote`

---

### `observe_unhealthy_probes`
**Purpose:** Pods with unhealthy liveness or readiness probe events in the event stream.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestObserveUnhealthyProbes_FiltersByReason`

---

### `observe_missing_probes`
**Purpose:** Workloads (Deployments, StatefulSets, DaemonSets) without liveness OR readiness probes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestObserveMissingProbes_FlagsContainer`

---

### `observe_stuck_rollouts`
**Purpose:** Deployments with a stalled Progressing condition where ready replicas is less than desired.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `threshold` | string | No | Stuck duration (default `5m`) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "threshold": "10m" }
```

**Test coverage:** `TestObserveStuckRollouts_TransitionOlderThanCutoff`

---

### `observe_high_cardinality_labels`
**Purpose:** Label keys exceeding a cardinality threshold — a common cause of Prometheus performance issues.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `threshold` | integer | No | Unique value count (default 100) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "threshold": 50 }
```

**Test coverage:** `TestObserveHighCardinalityLabels_GracefulDegrade`

---

### `observe_restart_storms`
**Purpose:** Containers with restart count above a threshold — identifies crashlooping or flapping pods.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `threshold` | integer | No | Restart count (default 5) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "threshold": 10, "namespace": "production" }
```

**Test coverage:** `TestObserveRestartStorms_FlagsAboveThreshold`

---

### `observe_pending_scheduler_events`
**Purpose:** Pending pods with FailedScheduling events. Shows why pods cannot be placed on nodes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestObservePendingSchedulerEvents_FilterByReason`

---

### `observe_zombie_finalizers`
**Purpose:** Resources stuck in Terminating state for longer than a threshold — indicates finalizer deadlocks.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `threshold` | string | No | Stuck duration (default `5m`) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "threshold": "15m", "namespace": "production" }
```

**Test coverage:** `TestObserveZombieFinalizers_DeletionOlderThanCutoff`

---

### `observe_orphaned_pods`
**Purpose:** Pods whose ownerReference points to a non-existent ReplicaSet or Job — leaked pods that consume resources.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestObserveOrphanedPods_OwnerMissing`

---

## Analysis (41 tools)

*Read-only with AI-synthesised insights. Autonomy level 1–2.*

---

### `analyze_pod_health`
**Purpose:** Deep health analysis of a pod — OOMKills, restart loops, eviction patterns, stuck-pending root causes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Pod name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j" }
```

**Test coverage:** Contract + functional

---

### `analyze_deployment_health`
**Purpose:** Deployment health analysis — rollout stalls, replica availability gaps, image drift between ReplicaSets.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api" }
```

**Test coverage:** Contract + functional

---

### `analyze_replicaset_health`
**Purpose:** ReplicaSet health — desired vs available replicas, failed pod conditions.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | ReplicaSet name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api-7d9c8b" }
```

**Test coverage:** `TestAnalyzeReplicaSetHealth_OrphanedRS`

---

### `analyze_statefulset_health`
**Purpose:** StatefulSet health — ordinal readiness, volume provisioning issues, update strategy problems.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | StatefulSet name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "database", "name": "postgres-primary" }
```

**Test coverage:** `TestAnalyzeStatefulSetHealth_DegradedReplicas`

---

### `analyze_daemonset_health`
**Purpose:** DaemonSet health — node coverage gaps, scheduling failures, rolling update progress.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | DaemonSet name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "monitoring", "name": "node-exporter" }
```

**Test coverage:** `TestAnalyzeDaemonSetHealth_DegradedCount`

---

### `analyze_job_health`
**Purpose:** Job health — completion status, failed count vs backoffLimit, duration analysis.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Job name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "batch", "name": "nightly-report-28497520" }
```

**Test coverage:** `TestAnalyzeJobHealth_FailedJob`

---

### `analyze_cronjob_health`
**Purpose:** CronJob health — suspended state, last schedule time, failed child job patterns.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | CronJob name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "batch", "name": "nightly-report" }
```

**Test coverage:** `TestAnalyzeCronJobHealth_Suspended`

---

### `analyze_node_pressure`
**Purpose:** Node pressure analysis — MemoryPressure, DiskPressure, PIDPressure conditions and their causes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | Node name (all nodes if omitted) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "ip-10-0-1-42.us-east-1.compute.internal" }
```

**Test coverage:** Contract + functional

---

### `detect_resource_contention`
**Purpose:** CPU throttling risk and memory overcommit detection across workloads.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** Contract + functional

---

### `analyze_service_health`
**Purpose:** Service health — endpoint readiness, orphan services with no pods, exposure risk assessment.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Service name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api-svc" }
```

**Test coverage:** `TestAnalyzeServiceHealth_NoEndpoints`

---

### `analyze_ingress_health`
**Purpose:** Ingress health — backend services exist, no empty rules, TLS validity.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Ingress name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-gateway" }
```

**Test coverage:** `TestAnalyzeIngressHealth_NoBackend`

---

### `analyze_network_connectivity`
**Purpose:** Network connectivity analysis — endpoint readiness, NetworkPolicy coverage, DNS issues.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** Contract + functional

---

### `analyze_storage_health`
**Purpose:** Storage health — unbound PVCs, failed provisioning, storage class misconfiguration.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "database" }
```

**Test coverage:** `TestHandleStorageStatus`, `TestHandleStorageStatus_AggregatesResources`

---

### `check_resource_limits`
**Purpose:** Find containers missing CPU/memory limits or requests — a common cause of node pressure.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** Contract + functional

---

### `analyze_rbac_permissions`
**Purpose:** RBAC analysis — detect over-privileged service accounts, wildcard permissions, cluster-admin bindings.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** Contract + functional

---

### `analyze_hpa_behavior`
**Purpose:** HPA behavior analysis — flapping, scaling delays, min=max stuck scenarios, inactive HPAs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | HPA name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-hpa" }
```

**Test coverage:** Contract + functional

---

### `analyze_log_patterns`
**Purpose:** Extract and classify error/warning patterns from pod logs using pattern clustering.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Pod name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j" }
```

**Test coverage:** Contract + functional

---

### `assess_security_posture`
**Purpose:** CIS Kubernetes Benchmark checks — hostNetwork, hostPID, privileged containers, runAsRoot.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** Contract + functional

---

### `detect_configuration_drift`
**Purpose:** Configuration drift — compares live state against desired specification to find unmanaged changes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** Contract + functional

---

### `analyze_resource_efficiency`
**Purpose:** Resource requests vs actual usage with rightsizing recommendations. Returns a findings summary, not raw metrics.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestAnalyzeResourceEfficiency_ReturnsFindingsNotRawData`, `TestHandleAnalyzeResourceEfficiency_ReturnsFindingsAndCount`

---

### `analyze_failure_patterns`
**Purpose:** Detect recurring failure patterns across pods, deployments, and nodes over time.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** Contract + functional

---

### `analyze_dependencies`
**Purpose:** Map service dependencies and single points of failure across a namespace.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestSummarizeDependencies`

---

### `analyze_capacity_trends`
**Purpose:** Predict future capacity needs based on historical trends. Returns findings and projections.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```

**Test coverage:** `TestAnalyzeCapacityTrends_ReturnsFindingsNotRawData`

---

### `analyze_performance_bottlenecks`
**Purpose:** Identify bottlenecks across compute, network, and storage using correlated signals.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestAnalyzePerformanceBottlenecks_ReturnsFindingsNotRawData`

---

### `analyze_error_correlation`
**Purpose:** Correlate errors across logs, events, and metrics to find root causes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** Contract + functional

---

### `analyze_blast_radius`
**Purpose:** Assess the potential impact of changes or failures — resource, namespace, or cluster scope. Returns what would break if this resource failed.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `scope` | string | Yes | One of: `resource`, `namespace`, `cluster` |
| `kind` | string | Conditional | Required when scope=resource e.g. `Deployment` |
| `name` | string | Conditional | Required when scope=resource |
| `namespace` | string | No | Kubernetes namespace |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "scope": "resource", "kind": "Deployment", "name": "payment-api", "namespace": "production" }
```

**Test coverage:** `TestBlastRadius_ScopeResource_RequiresKindName`, `TestBlastRadius_ScopeNamespace_NoKindNeeded`, `TestBlastRadius_ScopeCluster_NoArgs`, `TestBlastRadius_InfersScope_WhenOmitted`, `TestBlastRadius_BackwardsCompat_KindAndName`, `TestHandleAnalyzeBlastRadius_ScopeResourceRequiresKindAndName`

---

### `analyze_rollout_risk`
**Purpose:** Assess risk of a planned deployment, update, or configuration change before applying.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api" }
```

**Test coverage:** `TestHandleAnalyzeRolloutRisk_SingleDeployment`

---

### `analyze_pod_scheduling`
**Purpose:** Pod scheduling decisions — affinity rules, taint/toleration issues, placement optimization.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Pod name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j" }
```

**Test coverage:** Contract + functional

---

### `analyze_image_vulnerabilities`
**Purpose:** Scan container images for known CVEs using available cluster scanning data.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** Contract + functional

---

### `analyze_workload_patterns`
**Purpose:** Identify traffic patterns, peak hours, and scaling opportunities from workload metrics.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** Contract + functional

---

### `who_can_do`
**Purpose:** Answer "who can `<verb>` `<resource>` in `<namespace>`?" in one call. Aggregates RBAC across all Roles, ClusterRoles, and their Bindings.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `verb` | string | Yes | RBAC verb e.g. `get`, `list`, `create`, `delete` |
| `resource` | string | Yes | Resource type e.g. `pods`, `secrets`, `deployments` |
| `namespace` | string | No | Namespace scope (cluster-wide if omitted) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "verb": "delete", "resource": "pods", "namespace": "production" }
```

**Test coverage:** `TestWhoCanDo_AggregatesMatchingRolesAndBindings`, `TestWhoCanDo_NoMatches`, `TestWhoCanDo_RequiresArgs`

---

### `narrate_incident_timeline`
**Purpose:** Produces a Slack-ready chronological incident summary from events, pod restarts, and log patterns in a time window.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `since` | string | No | Go duration (default `1h`) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "since": "2h" }
```

**Test coverage:** `TestNarrateIncidentTimeline_ReturnsHint`, `TestNarrate_DispatchRegistered`

---

### `narrate_deploy_diff`
**Purpose:** Plain-English explanation of what changed in the latest deployment and what impact to expect.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api" }
```

**Test coverage:** `TestNarrate_DispatchRegistered`

---

### `narrate_weekly_status`
**Purpose:** Exec-friendly weekly cluster status — highlights, incidents, resource trends, upcoming risks.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```

**Test coverage:** `TestNarrateWeeklyStatus_IncludesClusterData`

---

### `narrate_onboarding_for_user`
**Purpose:** ServiceAccount capabilities and RBAC scope in plain English — for onboarding engineers to a cluster.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `service_account` | string | No | ServiceAccount name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "service_account": "api-server" }
```

**Test coverage:** `TestNarrate_DispatchRegistered`

---

### `narrate_service_dependency_graph`
**Purpose:** Upstream/downstream dependencies for a service with NetworkPolicy traffic flows in human-readable form.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Service name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api-svc" }
```

**Test coverage:** `TestNarrate_DispatchRegistered`

---

### `narrate_capacity_report`
**Purpose:** Cluster-wide capacity narrative — per-node utilization, headroom, usage trend, projected saturation.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```

**Test coverage:** `TestNarrate_DispatchRegistered`

---

### `narrate_cost_report`
**Purpose:** Cost breakdown by namespace and workload with cost drivers and optimisation opportunities.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```

**Test coverage:** `TestNarrate_DispatchRegistered`

---

### `narrate_security_posture`
**Purpose:** CISO-ready security posture report — pod security, NetworkPolicy coverage, RBAC, secret hygiene.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestNarrate_DispatchRegistered`

---

### `narrate_migration_readiness`
**Purpose:** Workloads, data, and config checklist for migrating a namespace to a new cluster or environment.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Namespace to migrate |
| `cluster_id` | string | No | Source cluster ID |

**Example:**
```json
{ "namespace": "staging" }
```

**Test coverage:** `TestNarrate_DispatchRegistered`

---

### `narrate_change_impact`
**Purpose:** What-if textual report showing first and second-order effects of a proposed change.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `kind` | string | Yes | Resource kind |
| `name` | string | Yes | Resource name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "kind": "Deployment", "name": "payment-api" }
```

**Test coverage:** `TestNarrate_DispatchRegistered`

---

## Recommendation (18 tools)

*Planning and optimisation. Autonomy level 2.*

---

### `plan_scale_deployment`
**Purpose:** Plan a replica-count change — accounts for HPA constraints, PDB limits, node capacity.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `target_replicas` | integer | Yes | Desired replica count |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api", "target_replicas": 10 }
```

**Test coverage:** `TestPlanScaleDeployment_ReturnsHint`, `TestPlan_DispatchRegistered`

---

### `plan_drain_node`
**Purpose:** Preview what would happen if a node were drained — lists pod evictions, PDB conflicts, capacity impact.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Node name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "ip-10-0-1-42.us-east-1.compute.internal" }
```

**Test coverage:** `TestPlanDrainNode_IncludesPodList`, `TestPlan_DispatchRegistered`

---

### `plan_rollout_safety`
**Purpose:** Estimate blast radius of a planned rollout, recommend canary percentage and maxSurge/maxUnavailable settings.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api" }
```

**Test coverage:** `TestPlan_DispatchRegistered`

---

### `plan_cost_reduction`
**Purpose:** Identify cost-reduction candidates — over-provisioned pods, idle nodes, unused PVs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "staging" }
```

**Test coverage:** `TestPlan_DispatchRegistered`

---

### `plan_ha_upgrade`
**Purpose:** Find single-replica workloads and recommend zero-downtime HA upgrade path.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestPlan_DispatchRegistered`

---

### `plan_resource_quota`
**Purpose:** Suggest ResourceQuota values per namespace based on 30-day actual usage.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestPlan_DispatchRegistered`

---

### `plan_psa_enforcement`
**Purpose:** Which namespaces can move to `restricted` Pod Security Admission without breaking workloads?

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```

**Test coverage:** `TestPlan_DispatchRegistered`

---

### `plan_image_pull_secrets`
**Purpose:** Find duplicate image pull secrets across namespaces and suggest consolidation patterns.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```

**Test coverage:** `TestPlan_DispatchRegistered`

---

### `plan_backup_coverage`
**Purpose:** Identify stateful workloads (StatefulSets with PVCs) that lack backup annotations or backup jobs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "database" }
```

**Test coverage:** `TestPlan_DispatchRegistered`

---

### `plan_pdb_coverage`
**Purpose:** Deployments and StatefulSets with 2+ replicas that have no matching PodDisruptionBudget.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestPlan_DispatchRegistered`

---

### `recommend_resource_optimization`
**Purpose:** Resource optimization recommendations — CPU/memory rightsizing with projected savings.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestRecommendResourceOptimization_ReturnsFindingsAndHint`

---

### `recommend_cost_reduction`
**Purpose:** Cost-saving opportunities with projected savings by workload and resource type.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "staging" }
```

**Test coverage:** `TestRecommendCostReduction_ReturnsHint`

---

### `recommend_scaling_strategy`
**Purpose:** Recommended HPA/VPA configurations and scaling strategies based on workload patterns.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestRecommendGenericFallback_ReturnsOverviewAndHint`

---

### `recommend_architecture_improvements`
**Purpose:** Architectural improvements for resilience, performance, and cost based on cluster analysis.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```

**Test coverage:** `TestRecommendGenericFallback_ReturnsOverviewAndHint`

---

### `recommend_security_hardening`
**Purpose:** Security hardening recommendations based on CIS benchmarks and CVE findings.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestRecommendSecurityHardening_ReturnsHint`

---

### `recommend_monitoring_improvements`
**Purpose:** Monitoring, alerting, and observability enhancements — missing metrics, alerts, dashboards.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestRecommendGenericFallback_ReturnsOverviewAndHint`

---

### `recommend_disaster_recovery`
**Purpose:** Disaster recovery and backup strategy recommendations for stateful workloads.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```

**Test coverage:** `TestRecommendGenericFallback_ReturnsOverviewAndHint`

---

### `recommend_upgrade_path`
**Purpose:** Kubernetes and application upgrade paths with risk assessment and prerequisites.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```

**Test coverage:** `TestRecommendGenericFallback_ReturnsOverviewAndHint`

---

## Troubleshooting (17 tools)

*Specific failure diagnosis. Autonomy level 1.*

---

### `diagnose_pod_not_ready`
**Purpose:** Why is a pod not Ready? Detects CrashLoopBackOff, OOMKilled, ImagePullBackOff, probe failures, pending scheduling.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Pod name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j" }
```

**Test coverage:** `TestDiagnosePodNotReady_CrashLoopDetected`, `TestDiagnose_DispatchRegistered`

---

### `diagnose_service_no_endpoints`
**Purpose:** Why does a service have no endpoints? Detects selector mismatches, zero ready pods, headless/external services.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Service name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api-svc" }
```

**Test coverage:** `TestDiagnoseServiceNoEndpoints_SelectorMatchesNone`

---

### `diagnose_pvc_pending`
**Purpose:** Why is a PVC stuck in Pending? Detects missing StorageClass, provisioner failures, capacity limits.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | PVC name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "database", "name": "data-postgres-primary-0" }
```

**Test coverage:** `TestDiagnosePVCPending_NoStorageClass`

---

### `diagnose_ingress_404`
**Purpose:** Why is an ingress returning 404? Walks rules → service → endpoints to find the broken link.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Ingress name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-gateway" }
```

**Test coverage:** `TestDiagnoseIngress404_BackendServiceMissing`

---

### `diagnose_deployment_rollback_needed`
**Purpose:** Is a deployment degraded after the latest revision? Returns whether rollback is recommended.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api" }
```

**Test coverage:** `TestDiagnoseDeploymentRollbackNeeded_DegradedWithHistory`

---

### `diagnose_cronjob_missing_runs`
**Purpose:** Why didn't a CronJob fire? Checks suspend flag, concurrencyPolicy, lastScheduleTime, failed child jobs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | CronJob name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "batch", "name": "nightly-report" }
```

**Test coverage:** `TestDiagnoseCronJobMissingRuns_Suspended`

---

### `diagnose_node_unschedulable`
**Purpose:** Why won't pods land on a node? Checks cordon, taints, conditions, capacity.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Node name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "ip-10-0-1-42.us-east-1.compute.internal" }
```

**Test coverage:** `TestDiagnoseNodeUnschedulable_Cordoned`

---

### `diagnose_hpa_not_scaling`
**Purpose:** Why isn't an HPA scaling? Checks min=max, ScalingActive/AbleToScale conditions, metric availability.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | HPA name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-hpa" }
```

**Test coverage:** `TestDiagnoseHPANotScaling_MinEqualsMax`

---

### `diagnose_networkpolicy_blocking`
**Purpose:** Is a NetworkPolicy blocking traffic between two pods? Evaluates ingress/egress rules and podSelectors.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `from_pod` | string | Yes | Source pod name |
| `to_pod` | string | Yes | Destination pod name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "from_pod": "frontend-pod", "to_pod": "api-server-pod" }
```

**Test coverage:** `TestDiagnoseNetworkPolicyBlocking_DefaultDeny`

---

### `diagnose_certificate_failures`
**Purpose:** cert-manager certificate issuance failures in a time window. Returns failed Certificate objects with reasons.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `since` | string | No | Go duration (default `1h`) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "since": "2h" }
```

**Test coverage:** `TestDiagnoseCertificateFailures_EventBased`

---

### `troubleshoot_pod_failures`
**Purpose:** Full pod failure investigation — multi-step root cause analysis with fix suggestions.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Pod name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j" }
```

**Test coverage:** `TestHandleTroubleshootPodFailures_IncludesHint`

---

### `troubleshoot_network_issues`
**Purpose:** Network connectivity diagnosis — DNS resolution, service discovery, endpoint health aggregated.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestHandleTroubleshootNetworkIssues_AggregatesServices`

---

### `troubleshoot_performance_degradation`
**Purpose:** Performance degradation investigation — correlates CPU throttling, memory pressure, disk I/O, network saturation.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** Contract + functional

---

### `troubleshoot_deployment_failures`
**Purpose:** Failed deployment investigation — rollout history, image changes, config changes, failed pod logs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api" }
```

**Test coverage:** Contract + functional

---

### `troubleshoot_resource_constraints`
**Purpose:** Resource exhaustion investigation — OOM kills, CPU saturation, quota limits reached.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** Contract + functional

---

### `troubleshoot_rbac_issues`
**Purpose:** RBAC permission debugging — find what's blocking a ServiceAccount from accessing a resource.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestHandleTroubleshootRBACIssues_FetchesAllRBACResources`

---

### `troubleshoot_storage_issues`
**Purpose:** PV/PVC issues — mount failures, provisioning errors, capacity problems.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "database" }
```

**Test coverage:** Contract + functional

---

## Security (15 tools)

*CIS benchmarks and compliance. Autonomy level 1.*

---

### `check_privileged_containers`
**Purpose:** Pods with `privileged: true` containers, hostNetwork, or hostPID set. Returns affected workloads.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestCheckPrivilegedContainers_Flags`, `TestSecurityChecks_DispatchRegistered`

---

### `check_root_containers`
**Purpose:** Containers without `runAsNonRoot: true` — containers that may run as UID 0.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestSecurityChecks_DispatchRegistered`

---

### `check_writable_root_fs`
**Purpose:** Containers without `readOnlyRootFilesystem: true` — attack surface for malware persistence.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestSecurityChecks_DispatchRegistered`

---

### `check_capabilities_all_added`
**Purpose:** Containers adding `CAP_SYS_ADMIN` or `ALL` Linux capabilities — highest privilege escalation risk.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestSecurityChecks_DispatchRegistered`

---

### `check_host_path_mounts`
**Purpose:** Pods mounting host filesystem paths — allows escape from container isolation.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestSecurityChecks_DispatchRegistered`

---

### `check_default_service_accounts_in_use`
**Purpose:** Workloads using the `default` ServiceAccount — security best practice is to use dedicated SAs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestSecurityChecks_DispatchRegistered`

---

### `check_secrets_in_env`
**Purpose:** Containers referencing Secret keys via `env` variables instead of volume mounts — env vars can leak in logs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestSecurityChecks_DispatchRegistered`

---

### `check_image_tag_latest`
**Purpose:** Workloads using `:latest` tag or no tag — prevents reproducible deployments.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestCheckImageTagLatest_Flags`

---

### `check_ingress_tls_expiry_30d`
**Purpose:** Ingress TLS certificates expiring within 30 days. Cluster-wide scan for cert-manager and manual certs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```

**Test coverage:** `TestSecurityChecks_DispatchRegistered`

---

### `check_rbac_wildcards`
**Purpose:** Roles or ClusterRoles granting `verbs: ["*"]` or `resources: ["*"]` — overly broad permissions.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** `TestCheckRBACWildcards_Flags`

---

### `security_scan_cluster`
**Purpose:** Comprehensive cluster security scan — CIS benchmarks, privileged pods, network exposure, RBAC gaps.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope (cluster-wide if omitted) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```

**Test coverage:** Contract + functional

---

### `security_scan_secrets`
**Purpose:** Scan for exposed secrets — weak encryption, secrets in ConfigMaps, leaked environment variables.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** Contract + functional

---

### `security_audit_rbac`
**Purpose:** Comprehensive RBAC audit — over-privileged accounts, cluster-admin bindings, orphaned bindings.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```

**Test coverage:** Contract + functional

---

### `security_check_pod_security`
**Purpose:** Validate pod security policies and admission controls against cluster standards.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```

**Test coverage:** Contract + functional

---

### `security_compliance_report`
**Purpose:** Compliance reports for SOC2, HIPAA, or PCI-DSS — maps cluster state to control requirements.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `standard` | string | No | One of: `soc2`, `hipaa`, `pci-dss` |
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "standard": "soc2", "cluster_id": "prod-us-east-1" }
```

**Test coverage:** Contract + functional

---

## Execution (9 tools — safety-gated)

> **All execution tools are currently Blocked** by the certification gate.
> They require a live CI validation run (`./certify-tools --backend <url>`) to graduate to Provisional before execution is allowed.
> All support `dry_run: true` to preview impact without mutation.

---

### `restart_pod`
**Purpose:** Restart a pod by deletion (the owning controller recreates it). Use for hung pods or log-roll scenarios.

**Safety:** Level 2. Requires `approved: true` in args. Rate-limited. Idempotency-guarded (60s dedup window).

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Pod name |
| `approved` | boolean | Yes | Must be `true` — confirms human approval |
| `dry_run` | boolean | No | Preview without deleting |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j", "approved": true, "dry_run": true }
```

**Test coverage:** `TestExecutionToolsStillPresent`, idempotency + timeout tests

---

### `scale_deployment`
**Purpose:** Scale a Deployment to a target replica count.

**Safety:** Level 3. Requires `approved: true`. Records idempotency key to prevent duplicate scales.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `replicas` | integer | Yes | Target replica count |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Preview without scaling |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api", "replicas": 5, "approved": true, "dry_run": true }
```

**Test coverage:** `TestExecutionToolsStillPresent`

---

### `cordon_node`
**Purpose:** Mark a node as unschedulable (cordon). New pods will not be scheduled on it.

**Safety:** Level 3. Requires `approved: true`.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Node name |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Preview without cordoning |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "ip-10-0-1-42.us-east-1.compute.internal", "approved": true, "dry_run": true }
```

**Test coverage:** `TestExecutionToolsStillPresent`

---

### `drain_node`
**Purpose:** Evict all pods from a node for maintenance. Respects PodDisruptionBudgets.

**Safety:** Level 4. Requires `approved: true`. High impact — validate with `plan_drain_node` first.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Node name |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Preview without draining |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "ip-10-0-1-42.us-east-1.compute.internal", "approved": true, "dry_run": true }
```

**Test coverage:** `TestExecutionToolsStillPresent`

---

### `apply_resource_patch`
**Purpose:** Apply a JSON merge or strategic merge patch to any Kubernetes resource.

**Safety:** Level 4. Requires `approved: true`. Validate with `analyze_blast_radius` first.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `kind` | string | Yes | Resource kind |
| `name` | string | Yes | Resource name |
| `patch` | string | Yes | JSON patch body |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Validate without applying |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "kind": "Deployment", "name": "payment-api", "patch": "{\"spec\":{\"replicas\":3}}", "approved": true, "dry_run": true }
```

**Test coverage:** `TestExecutionToolsStillPresent`

---

### `delete_resource`
**Purpose:** Delete a Kubernetes resource. The highest-risk execution tool — always validate impact first.

**Safety:** Level 5 (maximum). Requires `approved: true`. Use `analyze_blast_radius` before calling.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace (omit for cluster-scoped) |
| `kind` | string | Yes | Resource kind |
| `name` | string | Yes | Resource name |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Preview without deleting |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "kind": "Pod", "name": "stuck-pod-xyz", "approved": true, "dry_run": true }
```

**Test coverage:** `TestExecutionToolsStillPresent`

---

### `rollback_deployment`
**Purpose:** Roll back a Deployment to a previous revision.

**Safety:** Level 3. Requires `approved: true`. Uses `diagnose_deployment_rollback_needed` to confirm before calling.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `revision` | integer | No | Target revision (previous if omitted) |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Preview without rolling back |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api", "approved": true, "dry_run": true }
```

**Test coverage:** `TestExecutionToolsStillPresent`

---

### `update_resource_limits`
**Purpose:** Update CPU/memory requests and limits on a Deployment's pod template.

**Safety:** Level 3. Requires `approved: true`. Triggers a rolling restart.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `container` | string | Yes | Container name |
| `cpu_request` | string | No | e.g. `"250m"` |
| `cpu_limit` | string | No | e.g. `"500m"` |
| `memory_request` | string | No | e.g. `"256Mi"` |
| `memory_limit` | string | No | e.g. `"512Mi"` |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Preview without patching |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api", "container": "api", "cpu_request": "250m", "memory_limit": "512Mi", "approved": true, "dry_run": true }
```

**Test coverage:** `TestExecutionToolsStillPresent`

---

### `trigger_hpa_scale`
**Purpose:** Manually override an HPA's desired replica count. Temporary — HPA will resume control after the cooldown period.

**Safety:** Level 4. Requires `approved: true`.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | HPA name |
| `desired_replicas` | integer | Yes | Target replica count |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Preview without scaling |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-hpa", "desired_replicas": 8, "approved": true, "dry_run": true }
```

**Test coverage:** `TestExecutionToolsStillPresent`

---

## Cost (4 tools)

---

### `cost_analyze_spending`
**Purpose:** Analyze cluster costs with breakdown by namespace, workload, and resource type.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```

**Test coverage:** `TestCostAnalyzeSpending_FallsToDefaultHint`

---

### `cost_identify_waste`
**Purpose:** Identify wasted resources — over-provisioned pods, unused PVs, idle nodes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "staging" }
```

**Test coverage:** `TestCostIdentifyWaste_ReturnsHint`

---

### `cost_forecast_spending`
**Purpose:** Forecast future costs based on historical resource usage trends.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `days` | integer | No | Forecast horizon in days (default 30) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "days": 90, "cluster_id": "prod-us-east-1" }
```

**Test coverage:** `TestCostForecastSpending_ReturnsHint`

---

### `cost_optimization_plan`
**Purpose:** Generate a comprehensive cost optimization plan with projected ROI by action.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```

**Test coverage:** Contract + functional

---

## Automation (4 tools)

---

### `automation_run_playbook`
**Purpose:** Run a predefined remediation playbook — `clear-logs`, `restart-deployment`, `cordon-node`, etc.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `playbook` | string | Yes | Playbook name |
| `namespace` | string | No | Namespace scope |
| `target` | string | No | Target resource name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "playbook": "restart-deployment", "namespace": "production", "target": "payment-api" }
```

**Test coverage:** Contract + functional

---

### `automation_schedule_task`
**Purpose:** Schedule recurring tasks — backups, cleanups, health checks — as CronJobs or automation entries.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `task` | string | Yes | Task type |
| `schedule` | string | Yes | Cron expression e.g. `"0 2 * * *"` |
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "task": "cleanup-old-jobs", "schedule": "0 3 * * *", "namespace": "batch" }
```

**Test coverage:** Contract + functional

---

### `automation_create_alert_rule`
**Purpose:** Create intelligent alert rules with auto-remediation triggers for common failure patterns.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Alert rule name |
| `condition` | string | Yes | Condition expression |
| `action` | string | No | Auto-remediation action |
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "high-restart-count", "condition": "restarts > 5", "action": "restart-pod", "namespace": "production" }
```

**Test coverage:** Contract + functional

---

### `automation_generate_runbook`
**Purpose:** Generate runbooks for common operational scenarios — incident response, maintenance windows, scaling events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `scenario` | string | Yes | Scenario type e.g. `"oom-kill"`, `"node-drain"`, `"cert-expiry"` |
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "scenario": "oom-kill", "namespace": "production" }
```

**Test coverage:** Contract + functional

---

## Validation Checklist — Per Tool

To graduate a tool from **Provisional → Certified**, run:

```bash
# From the brain/ directory against a live cluster:
./certify-tools --backend http://localhost:8190 --output reports/certification/tool-certifications.json

# The MCP server auto-reloads the report within 5 minutes.
```

Each tool needs:

| Signal | What passes | Weight |
|---|---|---|
| Contract | name, description, category, inputSchema present | 25 |
| Live validation | Tool returns non-error result against real cluster | 25 |
| Statement coverage | ≥60% go test coverage | 25 |
| Chaos resilience | Tool handles nil/timeout backend without panic | 25 |

Score ≥75 → **Certified**. Score ≥50 → **Provisional**. Score <50 → **Uncertified** (blocked if destructive).

---

## Quick Reference Card

```
TRIAGE              triage_cluster
FIND RESOURCE       resolve_resource kind=Deployment name_hint=payment
INSPECT             inspect_<kind> namespace=X name=Y
FIND PROBLEMS       list_problems filter=crashlooping
SEARCH LOGS         search_logs namespace=X regex="error|panic"
ANALYZE HEALTH      analyze_<kind>_health namespace=X name=Y
DIAGNOSE            diagnose_pod_not_ready / diagnose_service_no_endpoints
WHO CAN DO          who_can_do verb=delete resource=pods
BLAST RADIUS        analyze_blast_radius scope=resource kind=Deployment name=X
SECURITY            check_privileged_containers / check_rbac_wildcards
COSTS               cost_analyze_spending / cost_identify_waste
EXECUTE (DRY RUN)   restart_pod namespace=X name=Y approved=true dry_run=true
```
