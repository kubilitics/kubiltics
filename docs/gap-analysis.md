# Kubilitics Topology -- Gap Analysis

Date: 2026-03-26
Branch: `feat/topology-v2-enhanced-engine`
Auditor: Automated code review (Claude)

---

## 1. Backend Matchers -- Coverage Assessment

**24 matchers registered in `NewDefaultRegistry()`. Here is the status of each:**

| # | Matcher | File | Unit Tests | Integration Test | Edge Cases / Issues |
|---|---------|------|-----------|-----------------|---------------------|
| 1 | `OwnerRefMatcher` | `owner_ref.go` | None dedicated | Covered via `integration_test.go` | Linear scan (`hasDeployment`, `hasReplicaSet`, etc.) is O(N) per pod -- will not scale beyond ~5K resources. Does not handle non-controller ownerRefs (e.g. user-set ownerRef without Controller=true). |
| 2 | `SelectorMatcher` | `selector.go` | None dedicated | Covered via integration | O(Services * Pods) for Service->Pod. No support for set-based selectors on Services (only `SelectorFromSet`). PDB and NetworkPolicy correctly use `LabelSelectorAsSelector`. |
| 3 | `VolumeMountMatcher` | `volume_mount.go` | None dedicated | Covered via integration | `allContainers` append mutates the pod's `Containers` slice header (line 27: `append(pod.Spec.Containers, pod.Spec.InitContainers...)`). **This is a data-corruption bug** -- if two matchers run concurrently on the same bundle, the slice backing array can be stomped. Does not handle `emptyDir`, `hostPath`, `downwardAPI`, `csi` volume types (intentional but undocumented). |
| 4 | `EnvRefMatcher` | `env_ref.go` | None dedicated | Covered via integration | Good: handles containers, initContainers, AND ephemeralContainers. Edge case: `configMapKeyRef.Optional=true` is ignored -- edge still created even if the ConfigMap may not exist. |
| 5 | `IngressMatcher` | `ingress.go` | None dedicated | Covered via integration | Handles IngressClass, rules, defaultBackend, TLS secrets. Does not handle `IngressClass` referenced via annotation (`kubernetes.io/ingress.class`) -- only `spec.ingressClassName`. |
| 6 | `EndpointMatcher` | `endpoint.go` | None dedicated | Covered via integration | Handles both `Endpoints` and `EndpointSlice`. Does not track not-ready addresses (only `sub.Addresses`, not `sub.NotReadyAddresses`), losing visibility into failing backends. |
| 7 | `RBACMatcher` | `rbac.go` | None dedicated | Covered via integration | Creates edges for User and Group subjects, but these are **phantom nodes** -- `NodesFromBundle` does not create User/Group topology nodes, so these edges point to non-existent targets. Frontend silently drops them. |
| 8 | `SchedulingMatcher` | `scheduling.go` | None dedicated | Covered via integration | Handles Pod->Node, Pod->ServiceAccount, Pod->PriorityClass, Pod->RuntimeClass. **Duplicate edge risk**: Pod->SA created here AND by `WorkloadRBACMatcher` at the workload level -- overlapping semantics. |
| 9 | `ScalingMatcher` | `scaling.go` | None dedicated | Covered via integration | Only supports HPA targeting Deployment and StatefulSet. Does not handle HPA targeting ReplicaSet (valid but rare), custom resources, or ReplicationController. |
| 10 | `StorageMatcher` | `storage.go` | None dedicated | Covered via integration | Handles PVC->StorageClass, PV->StorageClass, PVC->PV (via claimRef). Complete for standard storage. Does not handle CSI volume snapshots. |
| 11 | `WebhookMatcher` | `webhook.go` | None dedicated | Covered via integration | Handles MutatingWebhookConfiguration and ValidatingWebhookConfiguration -> Service. Does not detect webhooks using `url` instead of `service` (external webhooks). |
| 12 | `NamespaceMatcher` | `namespace.go` | None dedicated | Covered via integration | Creates Resource->Namespace containment edges for 18 namespaced resource types. **Missing**: Endpoints, EndpointSlice, LimitRange, ResourceQuota containment edges. |
| 13 | `AffinityMatcher` | `affinity.go` | None dedicated | Not tested | Handles node affinity (required + preferred), pod affinity/anti-affinity (required + preferred). O(Pods * Pods) for pod affinity -- quadratic scaling. No deduplication of edges. |
| 14 | `WorkloadRBACMatcher` | `workload_rbac.go` | None dedicated | Not tested | Creates Deployment/StatefulSet/DaemonSet/Job/CronJob -> ServiceAccount edges from pod template. Overlaps with `SchedulingMatcher` Pod->SA edges. |
| 15 | `ProjectedVolumeMatcher` | `projected_volume.go` | None dedicated | Not tested | Handles configMap, secret, and serviceAccountToken projections. Same `allContainers` append bug as `VolumeMountMatcher` (line 29-31). `DownwardAPI` projections ignored. |
| 16 | `NetworkPolicyRuleMatcher` | `network_policy_rules.go` | None dedicated | Not tested | Handles ingress/egress podSelector and namespaceSelector rules. Does not handle `ipBlock` CIDR rules (no corresponding node type). |
| 17 | `StatefulSetServiceMatcher` | `statefulset_service_matcher.go` | None dedicated | Not tested | Correctly links StatefulSet -> headless Service via `spec.serviceName`. Validates service existence before creating edge. |
| 18 | `StatefulSetPVCMatcher` | `statefulset_pvc_matcher.go` | None dedicated | Not tested | Uses naming convention heuristic (`{template}-{sts}-{ordinal}`). **Fragile**: breaks if PVC names are customized or if the StatefulSet was renamed. |
| 19 | `ServiceAccountSecretMatcher` | `sa_secret_matcher.go` | None dedicated | Not tested | Handles SA token secrets and imagePullSecrets. Validates secret existence. Note: SA `.secrets[]` is deprecated in K8s 1.24+ (auto-generated token secrets removed). |
| 20 | `EventMatcher` | `event_matcher.go` | None dedicated | Not tested | Links Events to involvedObject. Does not create Event topology nodes (no Event in `NodesFromBundle`), so **all EventMatcher edges are orphaned** -- source node ("Event/ns/name") does not exist in the graph. |
| 21 | `ResourceQuotaMatcher` | `resource_quota_matcher.go` | None dedicated | Not tested | Links ResourceQuota/LimitRange -> Namespace. Creates ResourceQuota/LimitRange edges but **does not create ResourceQuota/LimitRange topology nodes** in `NodesFromBundle` -- edges are partially orphaned (source does not exist). |
| 22 | `ImagePullSecretMatcher` | `image_pull_secret.go` | None dedicated | Not tested | Creates Pod -> Secret edges for imagePullSecrets. Does not validate that the Secret exists in the bundle. |
| 23 | `TaintTolerationMatcher` | `taint_toleration_matcher.go` | None dedicated | Not tested | Only considers pods already scheduled (spec.nodeName set). Well-implemented toleration matching including wildcard operator. Can produce multiple edges per Pod-Node pair (one per tolerated taint). |
| 24 | `WebhookTargetMatcher` | `webhook_target_matcher.go` | None dedicated | Not tested | Links MutatingWebhookConfiguration -> Namespace based on namespaceSelector. **Does not handle ValidatingWebhookConfiguration** -- only mutating. Uses simple `matchesLabels` that does not support `matchExpressions` (only `matchLabels`). |

### Test Coverage Summary

- **Individual matcher unit tests**: 0 out of 24 matchers have dedicated unit tests
- **Integration test** (`integration_test.go`): Only tests 8 edge types explicitly; verifies >= 30 edges total
- **Builder test** (`graph_builder_test.go`): Single test, asserts >= 20 nodes and >= 30 edges
- **Benchmark tests**: Present (`benchmark_test.go`, `builder/benchmark_test.go`)
- **Pod aggregation test**: Present (`pod_aggregation_test.go`)
- **Other tests**: `cache_test.go`, `filter_test.go`, `deeplink_test.go`, `health_enricher_test.go`, `resilience_test.go`

**Verdict**: Matchers 1-12 get some indirect coverage from the integration test, but 12 matchers (13-24) have ZERO test coverage. No matcher has tests for edge cases, error paths, or boundary conditions.

---

## 2. Data Collection Gaps

### Resources Collected (34 types)
Pods, Deployments, ReplicaSets, StatefulSets, DaemonSets, Jobs, CronJobs, Services, Endpoints, EndpointSlices, Ingresses, IngressClasses, ConfigMaps, Secrets, PVCs, PVs, StorageClasses, Nodes, Namespaces, ServiceAccounts, Roles, RoleBindings, ClusterRoles, ClusterRoleBindings, HPAs, PDBs, NetworkPolicies, PriorityClasses, RuntimeClasses, MutatingWebhookConfigurations, ValidatingWebhookConfigurations, Events, ResourceQuotas, LimitRanges.

### Resources NOT Collected
| Resource | Impact |
|----------|--------|
| **VolumeSnapshot / VolumeSnapshotClass** | No storage snapshot visibility |
| **CSIDriver / CSINode** | No CSI driver topology |
| **Lease** | No leader election visibility |
| **CustomResourceDefinitions (CRDs)** | No visibility into Istio VirtualService, Cert-Manager Certificate, ArgoCD Application, etc. |
| **APIService** | No aggregated API server visibility |
| **ValidatingAdmissionPolicy (v1beta1)** | New admission control resources |
| **FlowSchema / PriorityLevelConfiguration** | No API priority and fairness visibility |
| **ResourceClass / ResourceClaim** | No DRA (Dynamic Resource Allocation) visibility |
| **EndpointSlice (events.k8s.io/v1)** | EventList uses core/v1, not events.k8s.io/v1 which has richer fields |
| **Pod metrics (metrics.k8s.io)** | No actual CPU/memory usage -- only requests/limits from spec |
| **ReplicationController** | Legacy, but still exists in older clusters |

### Fields Missing from Collected Resources
| Field | Impact |
|-------|--------|
| **Pod `status.containerStatuses[].lastState`** | Cannot detect CrashLoopBackOff from last terminated state |
| **Pod `status.initContainerStatuses`** | Init container failures invisible |
| **Deployment `status.conditions`** | Cannot show "ReplicaFailure", "Progressing" conditions |
| **Node `status.images`** | No image cache visibility |
| **Secret `.type`** | Cannot distinguish TLS, Opaque, docker-registry secrets in UI |
| **Ingress `status.loadBalancer`** | Cannot show assigned LB IP/hostname |
| **HPA `status.currentMetrics`** | Cannot show current scaling state |
| **HPA `status.currentReplicas`** | Cannot show actual vs desired replicas |
| **PDB `status.disruptionsAllowed`** | Cannot show disruption budget headroom |

### Critical Architecture Issue: No Pagination / ListOptions Filtering
- `collector_k8s.go` uses `metav1.ListOptions{}` (empty) for ALL resources
- On large clusters (10K+ pods, 500+ namespaces), this will fetch EVERYTHING into memory
- No `Continue` token handling for paginated list responses
- No `ResourceVersion`-based watch/cache -- every request re-lists everything
- No `FieldSelector` to limit events to last N minutes

---

## 3. API Endpoint Status

### Registered in `handler.go` (main router)
| Endpoint | Handler | Status | Notes |
|----------|---------|--------|-------|
| `GET /clusters/{id}/topology/v2` | `GetTopologyV2` | **Working** | Builds from live cluster. Falls back to mock when client is nil. |
| `GET /clusters/{id}/topology/v2/traffic` | `GetTopologyV2Traffic` | **Working** | Returns traffic inference + criticality scores. Calls `CollectFromClient` a SECOND time (redundant API call). |

### Registered in `handler/topology_handler.go` (standalone)
| Endpoint | Handler | Status | Notes |
|----------|---------|--------|-------|
| `GET /clusters/{id}/topology/v2` | `HandleGetTopology` | **NOT WIRED** to main router | Uses Go 1.22 `r.PathValue()`, but main router uses gorilla/mux `mux.Vars()`. This handler is a dead code path -- the main handler.go endpoint takes precedence. |
| `GET /clusters/{id}/topology/v2/resource/{kind}/{ns}/{name}` | `HandleGetResource` | **NOT WIRED** | Resource-detail endpoint exists but is not registered in main router. |
| `GET /clusters/{id}/topology/v2/impact/{kind}/{ns}/{name}` | `HandleGetImpact` | **NOT WIRED** | Impact analysis endpoint exists but is not registered. |
| `GET /clusters/{id}/topology/v2/export/{format}` | `HandleExport` | **NOT WIRED** | Export endpoint (JSON/DrawIO) exists in both `topology_handler.go` and `export_handler.go` but neither is registered in the main router. |
| `WS /ws/topology/{id}/v2` | `TopologyWSHandler` | **NOT WIRED** | WebSocket handler exists but is not registered in the main router. Frontend tries to connect to this endpoint. |

### Missing Endpoints (referenced in frontend but don't exist)
| Frontend Reference | Expected Endpoint | Status |
|-------------------|-------------------|--------|
| `useTopologyWebSocket` | `WS /api/v1/ws/topology/{clusterId}/v2` | **Does not exist** -- frontend silently retries 3 times then gives up |
| Impact analysis | `GET /clusters/{id}/topology/v2/impact/...` | Handler exists, not wired |
| Criticality scores per-resource | None | `ScoreNodes` is computed but only returned in bulk via `/traffic` |

### Duplicate / Conflicting Handlers
The v2 topology has TWO parallel handler implementations:
1. `internal/api/rest/handler.go` (`GetTopologyV2`, `GetTopologyV2Traffic`) -- **active, wired**
2. `internal/topology/v2/handler/topology_handler.go` (`HandleGetTopology`, `HandleGetResource`, `HandleGetImpact`, `HandleExport`) -- **dead code**

The standalone handler has more features (caching, view filtering, health/metrics enrichment, pod aggregation, impact analysis) but NONE of it is reachable. The wired handler in `handler.go` calls `BuildTopology` directly without any of these pipeline stages.

**This means the main handler is missing**: view filtering, caching, health enrichment, metrics enrichment, pod aggregation. The frontend does its own client-side filtering to compensate.

---

## 4. Frontend Integration Gaps

### Backend capabilities with NO frontend UI

| Backend Capability | Frontend Status |
|-------------------|----------------|
| **Traffic inference** (`InferTraffic`) | No UI. `/v2/traffic` endpoint exists but frontend never calls it. |
| **Criticality scoring** (`ScoreNodes`) | No UI. PageRank scores computed server-side but never displayed. |
| **Impact analysis** (`GetImpactDetailed`) | No UI. "What breaks if I delete this?" -- handler exists but is dead code. |
| **Pod aggregation** (`AggregatePods`) | Partially handled. Backend does it in standalone handler (dead code). Frontend has `SummaryNode.tsx` ready but pipeline never produces PodGroup nodes via the active handler. |
| **Health propagation** (`PropagateHealth`) | Only called in standalone handler (dead code). Active handler returns raw status without propagation. |
| **Metrics enrichment** (`MetricsEnricher`) | Active handler does not call it. Frontend shows no CPU/memory metrics on nodes. |
| **Export (DrawIO/JSON)** | Frontend has `exportTopology.ts` and `exportPDF.ts` for client-side export. Server-side export handler exists but is dead code. |
| **WebSocket real-time updates** | Frontend has `useTopologyWebSocket.ts` hook. Backend has `websocket_handler.go`. **Neither is wired** -- frontend connects, fails, retries 3x, gives up. WS disconnect banner shows permanently. |
| **Rate limiting** (`RateLimiter`) | Fully implemented with semaphore, per-cluster limits, and circuit breaker. **Never instantiated or used anywhere.** |
| **Feature flags** (`FeatureFlags`) | Implemented. **Never checked anywhere in the request path.** |
| **Prometheus metrics** (`TopologyMetrics`) | Fully implemented with counters, histograms, hit ratios. **Never instantiated or called.** |
| **View modes (resource, rbac, workload)** | Frontend supports all 5 view modes. Backend standalone handler supports them. Active handler passes mode but does not filter -- all filtering happens client-side. |
| **Cache** | Full cache implementation with TTL, per-cluster invalidation, cleanup. **Only used by standalone handler (dead code).** |
| **Namespace groups** | Backend generates `TopologyGroup` objects. Frontend has `GroupNode.tsx`. Groups are passed through but ELK layout does not use them -- nodes are not visually grouped by namespace. |
| **Cost data** (`NodeCost`) | Struct defined in `node.go`. Never populated anywhere. |
| **Deep links** | `deeplink.go` / `deeplink_test.go` exist. Never used. |
| **OpenAPI spec** | `handler/openapi.go` exists. Never served. |

### Frontend capabilities that work well
- ELK-based auto-layout (`useElkLayout.ts`)
- Multi-namespace filtering with smart cluster-scoped node inclusion
- Kind filtering and edge category filtering
- Node search with fuzzy matching
- Detail panel with labels, annotations, conditions
- Health overlay legend
- Presentation mode
- Keyboard shortcuts
- Client-side node cap (1000 nodes)
- Export to PNG (via ReactFlow)
- Breadcrumb navigation
- URL-persisted namespace selection

---

## 5. Performance Concerns

### Measured Risks (from code analysis)
| Area | Issue | Severity |
|------|-------|----------|
| **Collector** | Lists ALL resources with no pagination. On a 500-pod cluster with 2000 ConfigMaps, this is ~34 concurrent unbounded API calls. | HIGH |
| **Collector** | No `ListOptions.Limit` -- single API call returns entire resource list. K8s API server may OOM or timeout for large responses. | HIGH |
| **Matcher O(N^2)** | `SelectorMatcher`: O(Services * Pods). `AffinityMatcher`: O(Pods * Pods). For 500 pods and 50 services, this is 25K + 250K comparisons per build. | MEDIUM |
| **OwnerRef linear scans** | `hasDeployment`, `hasReplicaSet`, etc. are O(N) linear scans called for every ownerRef. No index/map lookups. | MEDIUM |
| **No caching in active handler** | Every GET request rebuilds the entire topology from scratch (34 API calls + matching). The cache in `cache.go` exists but is unused. | HIGH |
| **Dangling node handling in PageRank** | `ScoreNodes` distributes dangling node rank to ALL nodes: O(N) per dangling node per iteration. With many dangling nodes, this is O(danglingNodes * N * iterations). | LOW |
| **Concurrent bundle access** | `MatchAll` runs all 24 matchers concurrently on the shared `*ResourceBundle`. The `allContainers` append bug in `VolumeMountMatcher` and `ProjectedVolumeMatcher` can cause data races. | HIGH |
| **Frontend** | MAX_VISIBLE_NODES = 1000. ELK layout for 1000 nodes takes 2-5 seconds. No virtualization for large graphs. | MEDIUM |

### Untested at Scale
- No load testing for clusters with >100 namespaces
- No benchmarks for >1000 pods
- Existing benchmarks (`benchmark_test.go`) use the fixture bundle (~30 resources), not realistic scale
- No memory profiling for large bundles

---

## 6. Error Handling Gaps

### Errors Swallowed Silently
| Location | Issue |
|----------|-------|
| `collector_k8s.go` lines 29-333 | Every collection error is logged as `slog.Warn` then returns `nil`. **Partial collection failures are invisible to the caller.** If Pods fail to list but Deployments succeed, the graph shows Deployments with no Pods and no error indication. |
| `registry.go` line 81 | Matcher errors are logged as `slog.Warn` then return `nil`. A panicking matcher would be caught by errgroup but individual matcher failures are silently swallowed. |
| `topology_handler.go` line 66 | `BuildGraph` error falls through, but the mock fallback on nil bundle (line 21 of `graph_builder.go`) means a failed collection returns mock data with no error. |
| `websocket_handler.go` line 16 | `CheckOrigin: func(r *http.Request) bool { return true }` -- **accepts WebSocket connections from any origin**, bypassing CSRF protection. The main handler's `wsCheckOrigin` is not used. |
| `handler.go` line 879 | `CollectFromClient` error in `GetTopologyV2Traffic` is silently discarded (`bundle, _ := ...`). Traffic inference runs on nil bundle. |
| `export_handler.go` line 34 | `json.NewEncoder(w)` error discarded. Partial JSON write on error could corrupt client. |
| `metrics.go` lines 216-252 | Hand-rolled `itoa`/`ftoa` functions instead of `strconv`. `ftoa` silently truncates to 3 decimal places. |

### Missing Error Paths
| Area | Issue |
|------|-------|
| **No timeout on collection** | `CollectFromClient` uses `errgroup.WithContext` but the parent context has no timeout. A slow API server blocks indefinitely. |
| **No retry on collection** | Single-shot list calls. If transient network error occurs, entire resource type is missing. |
| **No health endpoint** | No `/healthz` or readiness probe that validates topology engine is functional. |
| **No partial result indication** | When some resource types fail to collect, the response gives no indication which types are missing. |

---

## 7. Technical Debt

### Critical

1. **Two parallel handler implementations**: `handler.go` (active) and `handler/topology_handler.go` (dead code). The dead handler has all the features (caching, filtering, enrichment, aggregation). The active handler has none of them. This must be reconciled.

2. **Slice mutation bug**: `VolumeMountMatcher` and `ProjectedVolumeMatcher` append to `pod.Spec.Containers` slice, potentially corrupting the shared `ResourceBundle` when matchers run concurrently. Fix: use a local copy (`allContainers := make([]corev1.Container, 0, len(pod.Spec.Containers)+len(pod.Spec.InitContainers))`).

3. **Orphaned edges**: `EventMatcher` creates edges FROM Event nodes, but `NodesFromBundle` does not create Event nodes. `ResourceQuotaMatcher` creates edges FROM ResourceQuota/LimitRange nodes, but `NodesFromBundle` does not create those node types either. These edges point to non-existent sources.

4. **Phantom RBAC nodes**: `RBACMatcher` creates edges to/from `User/` and `Group/` nodes that are never created in `NodesFromBundle`. Frontend drops these silently.

### High

5. **No index-based lookups**: Matchers use linear scans (`hasDeployment`, `hasReplicaSet`, etc.) instead of pre-built maps. Each ownership check is O(N). Should be O(1) with a `map[nsName]bool` index.

6. **Duplicate semantics**: `SchedulingMatcher` creates `Pod -> ServiceAccount` edges AND `WorkloadRBACMatcher` creates `Deployment -> ServiceAccount` edges. Both are valid but can confuse users and inflate edge counts.

7. **Mock fallback masks failures**: When `bundle == nil` (e.g., client connection failed), `BuildGraph` returns `MockTopologyResponse` -- a static 5-node demo graph. The user sees a working topology instead of an error. This actively hides connection failures.

8. **WebSocket origin bypass**: The standalone WebSocket handler accepts all origins. If this handler is ever wired, it bypasses the CSRF protection implemented in the main handler.

### Medium

9. **No `context.Context` propagation in matchers**: Matchers receive context but never check `ctx.Done()`. A cancelled request continues consuming CPU through all 24 matchers.

10. **Global default registry**: `var defaultRegistry = relationships.NewDefaultRegistry()` is a package-level global. Not testable, not configurable, not safe for concurrent tests with different matcher sets.

11. **Hardcoded cache TTL**: `DefaultCacheTTL = 30s` is not configurable. No cache warming. No stale-while-revalidate pattern.

12. **groupsFromBundle only includes Pods, Deployments, Services**: Other namespaced resources (ConfigMaps, Secrets, HPAs, etc.) are not added to namespace groups, making group membership incomplete.

13. **Feature flag exists but is never checked**: `TOPOLOGY_V2_ENABLED` env var is read but the flag is never consulted in any request handler. The v2 endpoint is always available.

---

## 8. Enterprise Readiness Checklist

### Security
- [ ] RBAC-scoped data collection (currently lists ALL resources regardless of user permissions)
- [x] RBAC on API endpoints (auth.RoleViewer / auth.RoleOperator enforced in router)
- [ ] Secret data redaction (Secret `.data` values are collected but not returned; however, Secret names and labels are exposed)
- [ ] Audit logging for topology access
- [ ] WebSocket origin validation (standalone handler accepts all origins)
- [x] Input validation on cluster ID

### Scalability
- [ ] Paginated resource listing (currently unbounded List calls)
- [ ] Watch-based incremental updates (currently full re-list on every request)
- [ ] Sharded/distributed caching (current cache is in-process only)
- [ ] Node count limits enforced server-side (only client-side 1000-node cap)
- [x] Concurrent resource collection (errgroup)
- [x] Concurrent matcher execution (errgroup)

### Reliability
- [ ] Health check endpoint for topology engine
- [ ] Circuit breaker integration (implemented, never wired)
- [ ] Graceful degradation with partial collection failures (currently silent)
- [ ] Rate limiting integration (implemented, never wired)
- [ ] Retry logic for transient API failures
- [x] Context cancellation support in collector
- [ ] Context cancellation support in matchers

### Observability
- [ ] Prometheus metrics integration (implemented, never wired)
- [ ] Structured logging with correlation IDs
- [x] Build time tracking (metadata.buildTimeMs)
- [ ] Per-matcher timing
- [ ] Alert thresholds for slow builds

### Testing
- [ ] Per-matcher unit tests (0/24)
- [x] Integration test (covers ~8 matchers indirectly)
- [x] Benchmark tests (basic, fixture-sized only)
- [ ] Load tests (>1000 resources)
- [ ] Chaos tests (partial API failures)
- [ ] E2E tests (frontend -> backend)
- [x] Cache tests
- [x] Filter tests
- [x] Health enricher tests

### Operations
- [ ] Configuration documentation
- [ ] Runbook for topology failures
- [ ] Capacity planning guidelines
- [ ] Feature flag gating (flag exists, never enforced)
- [x] Export capability (DrawIO, JSON -- code exists, not wired)

---

## 9. Recommended Next Steps (Prioritized)

### P0 -- Must Fix Before Merge

1. **Fix the slice mutation bug** in `VolumeMountMatcher` (line 27) and `ProjectedVolumeMatcher` (line 29-31). These cause data races under concurrent matcher execution. Replace `append(pod.Spec.Containers, pod.Spec.InitContainers...)` with a new slice copy.

2. **Wire the standalone handler or port its features**. The active `handler.go:GetTopologyV2` lacks caching, view filtering, health enrichment, metrics enrichment, pod aggregation, and impact analysis. Either:
   - Register the standalone handler routes in the main router, OR
   - Port the pipeline stages into `GetTopologyV2`

3. **Add Event and ResourceQuota/LimitRange nodes to `NodesFromBundle`**. The matchers create edges to these node types but the nodes do not exist. Either add them or remove the matchers.

### P1 -- Should Fix Before v1.0

4. **Add per-matcher unit tests** for all 24 matchers. At minimum: happy path, empty input, cross-namespace (should not match), and nil bundle.

5. **Add index-based lookups** in matchers. Replace O(N) linear scans with pre-built `map[nsName]bool` indexes. This is a 10x performance improvement on 1000+ resource clusters.

6. **Wire the WebSocket handler** in the main router. The frontend already expects it and shows a permanent "disconnected" banner.

7. **Wire rate limiting and circuit breaker** in the collection path. The implementations exist and are well-designed but are never called.

8. **Add collection timeouts and partial failure reporting**. Add a per-resource-type timeout (e.g. 10s) and return metadata indicating which resource types failed.

### P2 -- Should Fix Before GA

9. **Add pagination to resource collection** using `ListOptions.Limit` and `Continue` tokens. Without this, clusters with >5K pods will cause OOM or API server throttling.

10. **Implement watch-based caching** instead of full re-list on every request. This reduces API server load from O(all resources) to O(changed resources).

11. **Wire Prometheus metrics**. The `TopologyMetrics` implementation is complete and well-structured. Just needs to be instantiated and called.

12. **Add CRD support**. Allow users to configure CRD types to include in topology (e.g., Istio VirtualService, Cert-Manager Certificate). This requires dynamic discovery and generic resource listing.

13. **Fix WebSocket origin validation** in standalone handler. Either use the main handler's `wsCheckOrigin` or implement equivalent CSRF protection.

14. **Reconcile handler implementations**. Remove the dead standalone handler or make it the single source of truth. Having two parallel implementations that diverge is a maintenance nightmare.

### P3 -- Nice to Have

15. **Frontend for traffic inference and criticality scores**. The backend already computes PageRank-based scores and traffic edges. Add a "traffic flow" view mode and criticality heatmap overlay.

16. **Impact analysis UI**. Add a "delete impact" dialog that calls the impact analysis endpoint and shows the blast radius.

17. **Add CPUUsage/MemoryUsage** from metrics-server API. Currently only requests/limits from pod specs are shown, not actual utilization.

18. **Add `workload` view mode** to VIEW_MODE_KINDS on the frontend. Currently only namespace, cluster, and rbac are wired to keyboard shortcuts 1-3.

---

## Summary

The topology engine has an impressive amount of well-structured code: 24 relationship matchers, traffic inference via PageRank, impact analysis, health propagation, pod aggregation, WebSocket support, caching, rate limiting, circuit breaking, and Prometheus metrics. The frontend is equally mature with ELK layout, multi-namespace filtering, presentation mode, and keyboard navigation.

**The core problem is that most of the backend sophistication is unreachable.** The standalone handler (`topology_handler.go`) contains the full pipeline (collect -> match -> filter -> enrich -> aggregate -> cache), but the actual wired handler (`handler.go:GetTopologyV2`) skips everything except collect and match. The frontend compensates with client-side filtering, but misses server-side health enrichment, metrics enrichment, pod aggregation, caching, and all the advanced features.

Fix the wiring, fix the data race, add node types for orphaned edges, and this engine is genuinely strong.
