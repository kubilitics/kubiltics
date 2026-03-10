# TOPOLOGY v2.0 — Implementation Tasks Part 1: Backend Foundation

**Scope:** All backend work — scaffolding, relationship engine, graph builder, API, WebSocket, caching
**Engineers:** 1-2 backend engineers (Go)
**Estimated Effort:** 32 tasks, ~130 story points
**Calendar Time:** Weeks 1-7

---

## Phase 0: Scaffolding & Infrastructure (Week 1)

### TASK-001: Create backend v2 package structure

**Points:** 2 | **Priority:** P0 | **Assignee:** Backend

Create the complete directory structure for the v2 topology engine. This is the foundation everything else builds on.

```
kubilitics-backend/internal/topology/v2/
├── service.go              // TopologyServiceV2 — main orchestrator
├── collector.go            // ResourceCollector — concurrent K8s API calls
├── graph.go                // GraphBuilder — assembles TopologyResponse
├── cache.go                // TopologyCache — per-cluster TTL cache
├── node.go                 // TopologyNode model + builder
├── edge.go                 // TopologyEdge model + builder
├── group.go                // TopologyGroup model + builder
├── filter.go               // ViewFilter — mode-specific graph filtering
├── metrics_enricher.go     // Attach CPU/memory metrics to nodes
├── health_enricher.go      // Compute health status per node
├── deeplink.go             // URL pattern parsing for deep-link routing
├── relationships/
│   ├── registry.go         // RelationshipRegistry — stores all matchers
│   ├── matcher.go          // RelationshipMatcher interface definition
│   ├── owner_ref.go        // OwnerReferenceMatcher (rel 1, 14-18)
│   ├── selector.go         // SelectorMatcher (rel 19, 36-37)
│   ├── volume_mount.go     // VolumeMountMatcher (rel 5-7)
│   ├── env_ref.go          // EnvRefMatcher (rel 8-11)
│   ├── ingress.go          // IngressMatcher (rel 24-26)
│   ├── endpoint.go         // EndpointMatcher (rel 20-23)
│   ├── rbac.go             // RBACMatcher (rel 30-34)
│   ├── scheduling.go       // SchedulingMatcher (rel 2, 4, 12-13)
│   ├── scaling.go          // ScalingMatcher (rel 35)
│   ├── storage.go          // StorageMatcher (rel 27-29)
│   ├── webhook.go          // WebhookMatcher (rel 38-39)
│   └── namespace.go        // NamespaceContainment (rel 3)
├── handler/
│   ├── topology_handler.go // REST endpoint handler
│   ├── websocket_handler.go// WebSocket endpoint handler
│   └── export_handler.go   // Export endpoint handler
└── testdata/
    ├── fixture.go          // Test cluster ResourceBundle
    ├── fixture_large.go    // 500+ resource fixture for benchmarks
    └── golden/             // Golden file test data
```

**Acceptance Criteria:**
- [ ] Directory structure exists with all files listed above
- [ ] All interfaces defined with correct method signatures
- [ ] Package compiles: `go build ./internal/topology/v2/...` succeeds
- [ ] Zero imports from v1 topology package
- [ ] README.md in the v2 directory explaining the architecture

---

### TASK-002: Register v2 API routes alongside v1

**Points:** 2 | **Priority:** P0 | **Assignee:** Backend

Register the v2 topology endpoints in the router. Return mock JSON matching the TopologyResponse schema.

**Endpoints to register:**
```
GET  /api/v1/clusters/{id}/topology/v2
GET  /api/v1/clusters/{id}/topology/v2/resource/{kind}/{ns}/{name}
GET  /api/v1/clusters/{id}/topology/v2/export/{format}
WS   /api/v1/ws/topology/{id}/v2
```

**Acceptance Criteria:**
- [ ] `GET /api/v1/clusters/{id}/topology/v2` returns 200 with mock data
- [ ] Mock data: 5 nodes (Pod, Deployment, Service, ConfigMap, Node), 4 edges, 1 group
- [ ] All fields match TopologyResponse TypeScript interface from PRD
- [ ] Query params parsed: mode, namespace, resource, depth, includeMetrics, includeHealth, includeCost
- [ ] Invalid mode returns 400 with descriptive error
- [ ] Cluster not found returns 404
- [ ] Existing v1 endpoints completely unaffected
- [ ] OpenAPI spec updated with v2 endpoints

---

### TASK-003: Create standard test fixture (realistic cluster)

**Points:** 3 | **Priority:** P0 | **Assignee:** Backend

Create a Go test fixture generating a realistic `ResourceBundle` with properly cross-referenced resources. This fixture is used by EVERY subsequent test.

**Fixture contents:**

| Resource Type | Count | Details |
|--------------|-------|---------|
| Namespace | 2 | `production`, `monitoring` |
| Deployment | 3 | `payment-api`, `checkout-api`, `prometheus` |
| ReplicaSet | 3 | One per deployment (current revision) |
| Pod | 9 | 3 per deployment |
| Service | 3 | One per deployment (ClusterIP) |
| Ingress | 1 | Routes to payment-api Service |
| IngressClass | 1 | nginx |
| Endpoints | 3 | One per Service |
| EndpointSlice | 3 | One per Service |
| ConfigMap | 2 | `payment-config`, `checkout-config` |
| Secret | 3 | `payment-db-creds`, `payment-tls`, `checkout-db-creds` |
| PVC | 1 | `payment-data` |
| PV | 1 | `pv-abc123` |
| StorageClass | 1 | `gp3-encrypted` |
| ServiceAccount | 3 | One per deployment |
| Role | 3 | One per ServiceAccount |
| RoleBinding | 3 | One per Role/ServiceAccount pair |
| HPA | 1 | Targets `payment-api` Deployment |
| PDB | 1 | Selects `payment-api` pods |
| NetworkPolicy | 1 | Applies to `payment-api` pods |
| Node | 3 | `ip-10-0-1-11`, `ip-10-0-1-12`, `ip-10-0-1-13` |
| PriorityClass | 1 | `high-priority` |

**Cross-references that MUST be correct:**
- Pod ownerRef → ReplicaSet → Deployment (3-level chain)
- Service selector matches pod labels
- Endpoints subsets reference pod IPs
- EndpointSlice has `kubernetes.io/service-name` label matching Service
- ConfigMaps mounted as volumes in pod specs
- Secrets mounted as volumes AND referenced in envFrom
- PVC mounted in payment-api pods, bound to PV, PV references StorageClass
- ServiceAccount specified in pod spec, referenced in RoleBinding subjects
- HPA scaleTargetRef points to payment-api Deployment
- PDB selector matches payment-api pod labels
- NetworkPolicy podSelector matches payment-api pod labels
- Ingress backend references payment-api Service
- Ingress TLS references payment-tls Secret
- Ingress ingressClassName references IngressClass
- Pods scheduled on specific Nodes (spec.nodeName)
- Pods reference PriorityClass (spec.priorityClassName)

**Acceptance Criteria:**
- [ ] Fixture at `internal/topology/v2/testdata/fixture.go`
- [ ] Function: `NewTestFixture() *ResourceBundle`
- [ ] All resources have valid metadata (names, namespaces, UIDs, labels)
- [ ] ALL cross-references listed above are correct
- [ ] Fixture is deterministic (same output every time)
- [ ] Includes a validation function that checks cross-reference integrity
- [ ] Used by all subsequent relationship matcher tests

---

### TASK-004: Create large test fixture for benchmarks

**Points:** 2 | **Priority:** P1 | **Assignee:** Backend

Create a parameterized fixture generator for performance benchmarks.

```go
func NewLargeFixture(opts FixtureOptions) *ResourceBundle
type FixtureOptions struct {
    Namespaces   int  // default: 5
    Deployments  int  // default: 50
    PodsPerDeploy int // default: 3
    Services     int  // default: 50
    ConfigMaps   int  // default: 20
    Secrets      int  // default: 20
    Nodes        int  // default: 10
}
```

**Acceptance Criteria:**
- [ ] Generates 100, 500, 1000, 2000 resource bundles correctly
- [ ] All cross-references valid at any scale
- [ ] Generation time < 100ms for 2000 resources
- [ ] Used by benchmark tests

---

### TASK-005: Add feature flag for topology v2

**Points:** 1 | **Priority:** P0 | **Assignee:** Backend

Add server-side feature flag `TOPOLOGY_V2_ENABLED` that enables the v2 endpoints. When disabled, v2 endpoints return 404.

**Acceptance Criteria:**
- [ ] Environment variable `TOPOLOGY_V2_ENABLED` (default: false)
- [ ] When true: v2 endpoints active
- [ ] When false: v2 endpoints return 404
- [ ] Flag readable via admin API for frontend feature detection
- [ ] No impact on v1 endpoints regardless of flag state

---

## Phase 1: Relationship Engine (Weeks 2-4)

This is the CORE of the topology engine. Each matcher detects one category of Kubernetes resource relationships.

### TASK-006: Implement RelationshipRegistry and matcher interface

**Points:** 3 | **Priority:** P0 | **Assignee:** Backend

```go
type RelationshipMatcher interface {
    Name() string
    Match(ctx context.Context, resources *ResourceBundle) ([]TopologyEdge, error)
}

type RelationshipRegistry struct {
    matchers []RelationshipMatcher
}

func (r *Registry) Register(m RelationshipMatcher)
func (r *Registry) MatchAll(ctx context.Context, bundle *ResourceBundle) ([]TopologyEdge, error)
```

**MatchAll behavior:**
- Run all registered matchers concurrently (errgroup)
- Individual matcher errors logged but non-fatal (partial results OK)
- Collect all edges, deduplicate by edge ID
- Return sorted edges (deterministic order)

**Acceptance Criteria:**
- [ ] Interface defined and documented
- [ ] Registry supports Register() and MatchAll()
- [ ] MatchAll runs matchers concurrently
- [ ] Individual errors don't crash the whole operation
- [ ] Performance: MatchAll < 100ms for standard fixture
- [ ] Deduplication by edge ID
- [ ] Sorted output for determinism

---

### TASK-007: Implement OwnerReferenceMatcher (relationships 1, 14-18)

**Points:** 5 | **Priority:** P0 | **Assignee:** Backend

Traverse `metadata.ownerReferences` for all resource types. Build complete ownership chains.

**Relationships covered:**

| # | Source | Target | Label |
|---|--------|--------|-------|
| 1 | Pod | ReplicaSet | "owned by" |
| 14 | ReplicaSet | Deployment | "owned by" |
| 15 | Pod | StatefulSet | "owned by" |
| 16 | Pod | DaemonSet | "owned by" |
| 17 | Pod | Job | "owned by" |
| 18 | Job | CronJob | "owned by" |

**Implementation details:**
- Scan ownerReferences on: Pods, ReplicaSets, Jobs
- Match by ownerReference UID to target resource UID
- Handle multi-level chains (Pod → RS → Deployment) as separate edges
- Edge `relationshipCategory` = "ownership"
- Edge `style` = "solid"
- Edge color = Blue-800 (`#1E40AF`)
- Arrow = filled triangle

**Unit tests (minimum 8):**
- [ ] Pod → ReplicaSet (standard Deployment pod)
- [ ] ReplicaSet → Deployment
- [ ] Pod → StatefulSet (direct owner)
- [ ] Pod → DaemonSet (via RS intermediary)
- [ ] Pod → Job
- [ ] Job → CronJob
- [ ] Pod with no ownerRef (standalone pod) — no edges produced
- [ ] Pod with ownerRef to non-existent resource — graceful handling, no crash

---

### TASK-008: Implement SelectorMatcher (relationships 19, 36, 37)

**Points:** 5 | **Priority:** P0 | **Assignee:** Backend

Match `spec.selector` labels against `pod.metadata.labels` for Services, PDBs, and NetworkPolicies.

**Relationships covered:**

| # | Source | Target | Label | Detail |
|---|--------|--------|-------|--------|
| 19 | Service | Pod | "selects" | "selects (app=payment)" |
| 36 | PDB | Pod | "protects" | "protects (minAvailable: 2)" |
| 37 | NetworkPolicy | Pod | "applies to" | "applies to (ingress from app=gateway)" |

**Implementation details:**
- Support both `matchLabels` AND `matchExpressions`
- For matchExpressions: handle In, NotIn, Exists, DoesNotExist operators
- Service selector: `spec.selector` (simple map, not LabelSelector)
- PDB selector: `spec.selector` (LabelSelector with matchLabels + matchExpressions)
- NetworkPolicy: `spec.podSelector` (LabelSelector)
- Label text includes the actual selector for debugging visibility

**Unit tests (minimum 8):**
- [ ] Service with matchLabels selects correct pods
- [ ] Service selector doesn't match pods in different namespace
- [ ] Service selector with multiple labels (AND logic)
- [ ] PDB with matchLabels selects correct pods
- [ ] PDB with matchExpressions (In operator)
- [ ] NetworkPolicy podSelector selects correct pods
- [ ] Empty selector (matches all pods in namespace)
- [ ] No matching pods — no false positive edges

---

### TASK-009: Implement VolumeMountMatcher (relationships 5-7)

**Points:** 5 | **Priority:** P0 | **Assignee:** Backend

Scan pod specs for ConfigMap, Secret, and PVC volume references. Extract mount paths.

**Relationships covered:**

| # | Source | Target | Label Example |
|---|--------|--------|--------------|
| 5 | Pod | ConfigMap | "mounts → /etc/config" |
| 6 | Pod | Secret | "mounts → /etc/secrets" |
| 7 | Pod | PVC | "mounts → /data" |

**Implementation details:**
- Scan `spec.volumes[]` for configMap, secret, persistentVolumeClaim references
- Cross-reference with `spec.containers[].volumeMounts[]` to find mount paths
- ALSO scan `spec.initContainers[].volumeMounts[]`
- ALSO scan `spec.ephemeralContainers[].volumeMounts[]`
- Handle pods with multiple volumes of the same type
- Edge detail includes: volume name, mount path, readOnly flag

**Unit tests (minimum 10):**
- [ ] Pod with ConfigMap volume → correct mount path in label
- [ ] Pod with Secret volume → correct mount path
- [ ] Pod with PVC volume → correct mount path
- [ ] Pod with multiple ConfigMap volumes → separate edge per volume
- [ ] Pod with volume in initContainer → detected
- [ ] Pod with no volumes → no edges
- [ ] Volume references non-existent ConfigMap → graceful handling
- [ ] Volume with subPath → subPath included in detail
- [ ] ReadOnly volume → "readOnly" noted in detail
- [ ] Same ConfigMap mounted in two containers → one edge (not duplicated)

---

### TASK-010: Implement EnvRefMatcher (relationships 8-11)

**Points:** 5 | **Priority:** P0 | **Assignee:** Backend

Scan pod container specs for `envFrom` and individual `env[].valueFrom` ConfigMap/Secret references.

**Relationships covered:**

| # | Source | Target | Label Example |
|---|--------|--------|--------------|
| 8 | Pod | ConfigMap | "env from" |
| 9 | Pod | Secret | "env from" |
| 10 | Pod | ConfigMap | "env: DB_HOST" |
| 11 | Pod | Secret | "env: DB_PASSWORD" |

**Implementation details:**
- Scan all containers (regular + init + ephemeral)
- `envFrom[].configMapRef` → edge with label "env from"
- `envFrom[].secretRef` → edge with label "env from"
- `env[].valueFrom.configMapKeyRef` → edge with label "env: {KEY_NAME}"
- `env[].valueFrom.secretKeyRef` → edge with label "env: {KEY_NAME}"
- If same ConfigMap is both volume mount AND envFrom, produce TWO edges (different relationship types)
- Edge detail includes: container name, key name, optional flag

**Unit tests (minimum 8):**
- [ ] envFrom configMapRef → "env from" edge
- [ ] envFrom secretRef → "env from" edge
- [ ] env valueFrom configMapKeyRef → "env: KEY_NAME" edge
- [ ] env valueFrom secretKeyRef → "env: KEY_NAME" edge
- [ ] Multiple containers with different envFrom → all detected
- [ ] Same ConfigMap in envFrom + volumeMount → two separate edges
- [ ] Optional envFrom (optional: true) → edge with "optional" in detail
- [ ] No env references → no edges

---

### TASK-011: Implement IngressMatcher (relationships 24-26)

**Points:** 3 | **Priority:** P0 | **Assignee:** Backend

Parse Ingress rules for backend service references, IngressClass, and TLS secrets.

**Relationships covered:**

| # | Source | Target | Label Example |
|---|--------|--------|--------------|
| 24 | Ingress | Service | "routes /api → :8080" |
| 25 | Ingress | IngressClass | "class: nginx" |
| 26 | Ingress | Secret | "TLS cert" |

**Implementation details:**
- Parse `spec.rules[].http.paths[].backend.service` for service references
- Include path and port in edge label
- Parse `spec.ingressClassName` for IngressClass reference
- Parse `spec.tls[].secretName` for TLS secret references
- Handle `defaultBackend` (ingress with no rules, just default backend)
- Handle multiple rules (multiple hosts) → multiple edges to same or different services

**Unit tests (minimum 6):**
- [ ] Ingress with single rule → Service edge with path+port
- [ ] Ingress with multiple rules → multiple Service edges
- [ ] Ingress with ingressClassName → IngressClass edge
- [ ] Ingress with TLS → Secret edge with "TLS cert" label
- [ ] Ingress with defaultBackend (no rules) → Service edge
- [ ] Ingress with no matching Service → edge marked unhealthy

---

### TASK-012: Implement EndpointMatcher (relationships 20-23)

**Points:** 3 | **Priority:** P0 | **Assignee:** Backend

Link Services to Endpoints/EndpointSlices, and those to target Pods.

**Relationships covered:**

| # | Source | Target | Label Example |
|---|--------|--------|--------------|
| 20 | Service | Endpoints | "auto-created" |
| 21 | Service | EndpointSlice | "manages" |
| 22 | Endpoints | Pod | "target (10.0.1.5:8080)" |
| 23 | EndpointSlice | Pod | "target (10.0.1.5:8080)" |

**Implementation details:**
- Service → Endpoints: same name in same namespace
- Service → EndpointSlice: label `kubernetes.io/service-name` matches
- Endpoints → Pod: `subsets[].addresses[].targetRef` where kind=Pod
- EndpointSlice → Pod: `endpoints[].targetRef` where kind=Pod
- Include IP and port in edge label for target references

**Unit tests (minimum 6):**
- [ ] Service → Endpoints with same name
- [ ] Service → EndpointSlice with matching label
- [ ] Endpoints → Pod via targetRef (with IP in label)
- [ ] EndpointSlice → Pod via targetRef
- [ ] Endpoints with no targetRef (external service) → no pod edges
- [ ] Multiple addresses → multiple pod edges

---

### TASK-013: Implement RBACMatcher (relationships 30-34)

**Points:** 5 | **Priority:** P0 | **Assignee:** Backend

Trace the full RBAC permission chain: ServiceAccount ↔ RoleBinding ↔ Role (namespace and cluster scope).

**Relationships covered:**

| # | Source | Target | Label |
|---|--------|--------|-------|
| 30 | ServiceAccount | Secret | "token secret" |
| 31 | RoleBinding | Role | "binds" |
| 32 | RoleBinding | ServiceAccount | "grants to" |
| 33 | ClusterRoleBinding | ClusterRole | "binds" |
| 34 | ClusterRoleBinding | ServiceAccount | "grants to" |

**Implementation details:**
- RoleBinding subjects: match by name AND namespace (for ServiceAccount kind)
- Also handle Group and User subject kinds (show as edges but different label)
- ClusterRoleBinding: namespace-less, matches ServiceAccount by name only if namespace in subject
- Detect cluster-admin bindings → mark edge with `healthReason: "cluster-admin access"`
- Detect wildcard permissions (verb: "*", resource: "*") → mark as warning

**Unit tests (minimum 8):**
- [ ] RoleBinding → Role edge
- [ ] RoleBinding → ServiceAccount edge (subject match by name+namespace)
- [ ] ClusterRoleBinding → ClusterRole edge
- [ ] ClusterRoleBinding → ServiceAccount edge
- [ ] ServiceAccount → Secret (legacy token) edge
- [ ] cluster-admin binding → edge marked with warning
- [ ] RoleBinding with Group subject → edge with "group: system:authenticated"
- [ ] No matching subjects → no edges

---

### TASK-014: Implement SchedulingMatcher (relationships 2, 4, 12, 13)

**Points:** 3 | **Priority:** P0 | **Assignee:** Backend

Link Pods to their scheduling-related resources.

**Relationships covered:**

| # | Source | Target | Label |
|---|--------|--------|-------|
| 2 | Pod | Node | "runs on" |
| 4 | Pod | ServiceAccount | "identity" |
| 12 | Pod | PriorityClass | "priority: high-priority" |
| 13 | Pod | RuntimeClass | "runtime: gvisor" |

**Implementation details:**
- `spec.nodeName` → Node edge (only for Running pods)
- `spec.serviceAccountName` → ServiceAccount edge (default "default" SA)
- `spec.priorityClassName` → PriorityClass edge
- `spec.runtimeClassName` → RuntimeClass edge
- Missing references handled gracefully (log warning, don't crash)

**Unit tests (minimum 6):**
- [ ] Pod → Node edge from spec.nodeName
- [ ] Pending pod (no nodeName) → no Node edge
- [ ] Pod → ServiceAccount edge
- [ ] Pod with default SA → still produces edge
- [ ] Pod → PriorityClass edge
- [ ] Pod with no priorityClassName → no edge (graceful)

---

### TASK-015: Implement ScalingMatcher (relationship 35)

**Points:** 2 | **Priority:** P0 | **Assignee:** Backend

Link HPAs to their scale targets.

**Relationships covered:**

| # | Source | Target | Label |
|---|--------|--------|-------|
| 35 | HPA | Deployment/StatefulSet | "scales (CPU 70%, 2-10 replicas)" |

**Implementation details:**
- Parse `spec.scaleTargetRef` (kind, name)
- Include target metrics in label (CPU/memory target utilization)
- Include min/max replicas in label
- Match target by kind + name in same namespace

**Unit tests (minimum 3):**
- [ ] HPA → Deployment edge with metric details
- [ ] HPA → StatefulSet edge
- [ ] HPA with multiple metrics → all metrics in label

---

### TASK-016: Implement StorageMatcher (relationships 27-29)

**Points:** 3 | **Priority:** P0 | **Assignee:** Backend

Link PVCs to PVs and StorageClasses.

**Relationships covered:**

| # | Source | Target | Label |
|---|--------|--------|-------|
| 27 | PVC | PV | "bound to" |
| 28 | PV | StorageClass | "provisioned by" |
| 29 | PVC | StorageClass | "requests from" |

**Implementation details:**
- PVC → PV: `spec.volumeName` on PVC, or `spec.claimRef` on PV
- PV → StorageClass: `spec.storageClassName` on PV
- PVC → StorageClass: `spec.storageClassName` on PVC
- Include capacity in edge detail
- Mark unhealthy if PVC status is not Bound

**Unit tests (minimum 4):**
- [ ] PVC → PV edge (bound)
- [ ] PV → StorageClass edge
- [ ] PVC → StorageClass edge
- [ ] Unbound PVC → edge marked unhealthy

---

### TASK-017: Implement WebhookMatcher (relationships 38-39)

**Points:** 2 | **Priority:** P1 | **Assignee:** Backend

Link webhook configurations to the Services they call.

**Relationships covered:**

| # | Source | Target | Label |
|---|--------|--------|-------|
| 38 | MutatingWebhook | Service | "calls (mutating)" |
| 39 | ValidatingWebhook | Service | "calls (validating)" |

**Implementation details:**
- Only match webhooks with `clientConfig.service` (not URL-based)
- Match service by name and namespace
- Include webhook name in detail

**Unit tests (minimum 3):**
- [ ] MutatingWebhook → Service edge
- [ ] ValidatingWebhook → Service edge
- [ ] URL-based webhook → no Service edge

---

### TASK-018: Implement NamespaceContainmentMatcher (relationship 3)

**Points:** 2 | **Priority:** P0 | **Assignee:** Backend

Create group associations for namespace containment.

**Implementation details:**
- Every namespaced resource → assigned to its namespace group
- Cluster-scoped resources (Nodes, PVs, ClusterRoles) → root group
- Groups include member list for UI rendering
- Groups include metadata: pod count, healthy pod count

**Unit tests (minimum 3):**
- [ ] Namespaced resources grouped correctly
- [ ] Cluster-scoped resources in root group
- [ ] Group metadata (pod counts) accurate

---

### TASK-019: Integration test — all matchers combined

**Points:** 5 | **Priority:** P0 | **Assignee:** Backend

Run ALL matchers against the standard test fixture. Verify completeness.

**Acceptance Criteria:**
- [ ] Full ResourceBundle from TASK-003 fixture
- [ ] Run RelationshipRegistry.MatchAll()
- [ ] Assert: node count >= 35 (all fixture resources present)
- [ ] Assert: edge count >= 50 (all relationship types represented)
- [ ] Assert specific key edges exist:
  - Pod → ConfigMap mount edge with correct path
  - Service → Pod selector edge
  - Ingress → Service route edge
  - Pod → Node scheduling edge
  - ServiceAccount → RoleBinding → Role chain (3 edges)
  - PVC → PV → StorageClass chain (3 edges)
  - HPA → Deployment scaling edge
  - PDB → Pod protection edge
  - NetworkPolicy → Pod policy edge
- [ ] Assert: no duplicate edges (unique IDs)
- [ ] Assert: all edges have non-empty labels
- [ ] Assert: all edges have valid relationship categories
- [ ] Assert: deterministic (two runs produce identical JSON output)
- [ ] Assert: < 200ms for standard fixture

---

## Phase 2: Graph Building & API (Weeks 4-6)

### TASK-020: Implement ResourceCollector (concurrent)

**Points:** 3 | **Priority:** P0 | **Assignee:** Backend

Concurrent resource collection from Kubernetes API using errgroup.

**Implementation details:**
- All 28+ resource types listed concurrently
- Namespace filter applied for namespaced resources
- Cluster-scoped resources always fetched (Nodes, PVs, StorageClasses, ClusterRoles, etc.)
- Semaphore: max 10 concurrent API calls (prevent API server overload)
- Per-type error handling: log error, continue with partial results
- Context cancellation respected (timeout support)

**Acceptance Criteria:**
- [ ] All resource types in ResourceBundle populated concurrently
- [ ] Namespace filter works correctly
- [ ] Semaphore limits concurrent calls to 10
- [ ] Individual resource type failure doesn't crash collector
- [ ] Partial results returned with error list
- [ ] Context cancellation stops all in-flight requests
- [ ] Benchmark: < 500ms for cluster with 1000 resources

---

### TASK-021: Implement GraphBuilder

**Points:** 5 | **Priority:** P0 | **Assignee:** Backend

The main orchestrator that assembles the complete TopologyResponse.

**Pipeline:**
1. ResourceCollector.Collect() → ResourceBundle
2. Build TopologyNode for each resource (assign ID, category, layer)
3. RelationshipRegistry.MatchAll() → edges
4. NamespaceContainmentMatcher → groups
5. HealthEnricher → status/statusReason on each node
6. MetricsEnricher → CPU/memory on pods/nodes
7. ViewFilter.Apply() → filtered graph based on mode
8. Construct TopologyResponse with metadata

**Acceptance Criteria:**
- [ ] Produces valid TopologyResponse matching schema exactly
- [ ] Node IDs follow "kind/namespace/name" format
- [ ] Nodes have correct `category` (workload/networking/config/storage/rbac/scaling/cluster/extensions)
- [ ] Nodes have correct `layer` (semantic layer per resource type)
- [ ] Edge IDs are unique across the graph
- [ ] Groups built from namespace containment
- [ ] Metadata includes resourceCount, edgeCount, buildTimeMs
- [ ] Full pipeline < 1s for standard fixture

---

### TASK-022: Implement HealthEnricher

**Points:** 3 | **Priority:** P0 | **Assignee:** Backend

Compute health status for every node based on Kubernetes-native status fields.

**Health rules:**

| Resource | Healthy | Warning | Error |
|----------|---------|---------|-------|
| Pod | Phase=Running, all conditions True | Phase=Pending, ContainersReady=False | Phase=Failed, CrashLoopBackOff, OOMKilled |
| Deployment | availableReplicas == replicas | availableReplicas < replicas | availableReplicas == 0 |
| StatefulSet | readyReplicas == replicas | readyReplicas < replicas | readyReplicas == 0 |
| DaemonSet | numberReady == desiredNumberScheduled | numberReady < desired | numberReady == 0 |
| Service | has matching endpoints with ready addresses | has endpoints but no ready addresses | no endpoints at all |
| Node | Ready=True | DiskPressure/MemoryPressure/PIDPressure | Ready=False/Unknown |
| PVC | phase=Bound | phase=Pending | phase=Lost |
| PV | phase=Bound/Available | phase=Released | phase=Failed |
| HPA | currentReplicas within min/max | scaling events in last 5m | unable to scale |
| Job | succeeded > 0 | active > 0 | failed > backoffLimit |

**Acceptance Criteria:**
- [ ] Every node has non-null status and statusReason
- [ ] Pod health correctly detects CrashLoopBackOff, OOMKilled
- [ ] Deployment health based on ready vs desired replicas
- [ ] Service health based on endpoint readiness
- [ ] Node health from conditions
- [ ] PVC/PV health from phase
- [ ] Unknown resources default to status "unknown"
- [ ] Edge health computed where applicable (Service with no endpoints → edge unhealthy)

---

### TASK-023: Implement MetricsEnricher

**Points:** 3 | **Priority:** P0 | **Assignee:** Backend

Attach resource metrics from metrics-server/Prometheus.

**Acceptance Criteria:**
- [ ] Pod nodes: cpuUsage, memoryUsage, cpuRequest, cpuLimit, memoryRequest, memoryLimit, restartCount
- [ ] Node nodes: CPU/memory capacity, allocatable, usage
- [ ] Workload nodes: podCount, readyCount (aggregated)
- [ ] Graceful when metrics-server unavailable (metrics fields null, not error)
- [ ] Metrics fetched concurrently with resource collection (not sequentially)

---

### TASK-024: Implement ViewFilter — all 5 view modes

**Points:** 5 | **Priority:** P0 | **Assignee:** Backend

Mode-specific graph filtering. Each mode shows different resource subsets.

**View mode filtering rules:**

| Mode | Nodes Included | Edges Included | Grouping |
|------|---------------|---------------|----------|
| cluster | Namespaces only (as summary nodes) | Cross-namespace service connections | Each namespace = 1 summary node |
| namespace | Workloads, Services, Ingress, PVCs, ConfigMaps, Secrets in one NS | All edges between included nodes | Namespace as container group |
| workload | Target workload + RS + Pods + HPA + PDB + connected Services + Config/Secrets | All edges for included nodes | Workload group |
| resource | BFS from focus resource, depth hops (default 3) | All edges between visited nodes | Category groups |
| rbac | ServiceAccounts + RoleBindings + Roles + ClusterRoleBindings + ClusterRoles | RBAC edges only | RBAC chain groups |

**Resource-centric BFS implementation:**
```
1. Start at focus resource
2. BFS: find all nodes within `depth` edge-hops
3. Include ALL edges between visited nodes
4. Group by relationship category for visual organization
```

**Acceptance Criteria:**
- [ ] Each mode produces correct node/edge subsets (tested with fixture)
- [ ] Resource-centric BFS with depth=3 includes expected resources
- [ ] Cluster mode produces namespace summary nodes (not individual resources)
- [ ] RBAC mode only includes RBAC-relevant resources
- [ ] Filtering preserves edge correctness (no dangling edges)

---

### TASK-025: Implement TopologyCache

**Points:** 2 | **Priority:** P1 | **Assignee:** Backend

Per-cluster, per-mode TTL cache with informer-based invalidation.

**Cache key:** `{clusterID}:{mode}:{namespace}:{resource}:{depth}`

**TTL by mode:**
| Mode | TTL |
|------|-----|
| cluster | 60s |
| namespace | 30s |
| workload | 20s |
| resource | 15s |
| rbac | 60s |

**Acceptance Criteria:**
- [ ] Cache hit returns in < 1ms
- [ ] Cache miss triggers full graph build
- [ ] TTL per mode configurable
- [ ] Informer events invalidate ALL cache entries for affected cluster
- [ ] Thread-safe (RWMutex)
- [ ] LRU eviction when cache exceeds 100 entries
- [ ] Metrics: cache hit/miss rates exposed

---

### TASK-026: Implement TopologyHandler v2 (REST)

**Points:** 3 | **Priority:** P0 | **Assignee:** Backend

HTTP handler for the main topology endpoint.

**Endpoints:**
```
GET /api/v1/clusters/{id}/topology/v2
  ?mode=namespace|cluster|workload|resource|rbac
  &namespace=production
  &resource=Pod/production/payment-api-xyz
  &depth=3
  &includeMetrics=true
  &includeHealth=true
  &includeCost=false

GET /api/v1/clusters/{id}/topology/v2/resource/{kind}/{ns}/{name}
  → shorthand for mode=resource&resource={kind}/{ns}/{name}
```

**Acceptance Criteria:**
- [ ] All query params parsed with validation
- [ ] Invalid mode → 400 with error message
- [ ] Invalid cluster → 404
- [ ] Resource not found → 404 with suggestion
- [ ] Successful response matches TopologyResponse schema
- [ ] `buildTimeMs` accurately measured
- [ ] Response includes CORS headers for frontend
- [ ] Deep-link resource endpoint works (kind/ns/name path params)
- [ ] OpenAPI spec updated

---

### TASK-027: Implement TopologyWebSocket v2

**Points:** 3 | **Priority:** P0 | **Assignee:** Backend

Real-time topology updates via WebSocket.

**Endpoint:** `WS /api/v1/ws/topology/{id}/v2`

**Event types:**
```go
type TopologyEvent struct {
    Type      string          `json:"type"`      // node_added, node_updated, node_removed, edge_added, edge_removed
    Payload   json.RawMessage `json:"payload"`   // TopologyNode or TopologyEdge
    Timestamp string          `json:"timestamp"`
}
```

**Implementation details:**
- Subscribe to informer events for the cluster
- Batch events in 100ms windows (prevent flooding)
- On resource add: push node_added + relevant edge_added events
- On resource update: push node_updated (status/metrics changes)
- On resource delete: push node_removed + relevant edge_removed events
- Clean up connection on client disconnect
- Heartbeat ping every 30s to detect dead connections

**Acceptance Criteria:**
- [ ] WebSocket upgrade successful
- [ ] Events pushed on resource add/update/delete
- [ ] Events batched in 100ms windows
- [ ] Event payload includes complete node/edge data
- [ ] Client disconnect cleaned up properly
- [ ] Reconnection supported (client sends last-seen timestamp)
- [ ] Heartbeat keeps connection alive
- [ ] Works with existing WebSocket hub infrastructure

---

### TASK-028: Implement deep-link URL routing

**Points:** 2 | **Priority:** P0 | **Assignee:** Backend

Parse deep-link URLs and route to correct topology view.

**URL patterns:**
```
/topology/{clusterId}                                    → mode=cluster
/topology/{clusterId}/namespace/{ns}                     → mode=namespace, namespace={ns}
/topology/{clusterId}/workload/{kind}/{ns}/{name}        → mode=workload, resource={kind}/{ns}/{name}
/topology/{clusterId}/resource/{kind}/{ns}/{name}        → mode=resource, resource={kind}/{ns}/{name}
/topology/{clusterId}/rbac/{ns}                          → mode=rbac, namespace={ns}
```

**Acceptance Criteria:**
- [ ] All URL patterns parsed correctly
- [ ] Invalid cluster/resource → 404 with helpful message
- [ ] URLs generated from current topology state (for sharing)
- [ ] Browser back/forward works with URL state

---

## Phase 2.5: Backend Performance & Hardening (Week 6-7)

### TASK-029: Backend performance benchmark suite

**Points:** 3 | **Priority:** P0 | **Assignee:** Backend

Go benchmarks validating PRD performance targets.

**Benchmarks:**
```go
func BenchmarkTopologyBuild_100Resources(b *testing.B)
func BenchmarkTopologyBuild_500Resources(b *testing.B)
func BenchmarkTopologyBuild_1000Resources(b *testing.B)
func BenchmarkTopologyBuild_2000Resources(b *testing.B)
func BenchmarkMatchAll_StandardFixture(b *testing.B)
func BenchmarkResourceCollector_1000Resources(b *testing.B)
func BenchmarkViewFilter_ResourceCentric_Depth3(b *testing.B)
```

**Performance assertions:**
| Benchmark | Target |
|-----------|--------|
| 100 resources full build | < 500ms |
| 500 resources full build | < 1.5s |
| 1000 resources full build | < 3s |
| 2000 resources full build | < 5s |
| MatchAll standard fixture | < 100ms |
| ViewFilter resource-centric | < 50ms |

**Acceptance Criteria:**
- [ ] All benchmarks written and passing
- [ ] CI runs benchmarks on every PR
- [ ] Regression alert if any benchmark exceeds hard limit
- [ ] Benchmark results logged to tracking system

---

### TASK-030: Determinism verification test

**Points:** 2 | **Priority:** P0 | **Assignee:** Backend

Verify that the topology engine produces identical output for identical input.

**Test:**
1. Build topology from standard fixture
2. Serialize to JSON
3. Build topology again from same fixture
4. Serialize to JSON
5. Assert byte-identical JSON

**Acceptance Criteria:**
- [ ] Test passes consistently (not flaky)
- [ ] Covers all view modes
- [ ] Covers node ordering, edge ordering, group ordering
- [ ] Map iteration order doesn't affect output (sorted before serialization)

---

### TASK-031: Partial data resilience test

**Points:** 2 | **Priority:** P1 | **Assignee:** Backend

Test that the topology degrades gracefully when some resource types fail to load.

**Scenarios:**
- Secrets API returns 403 (no permission) → topology builds without Secret nodes/edges, includes warning
- Metrics-server unavailable → topology builds without metrics, all metric fields null
- Nodes API timeout → topology builds without Node edges, includes warning
- All APIs fail → meaningful error response, not 500 with stack trace

**Acceptance Criteria:**
- [ ] Each scenario produces a valid (partial) TopologyResponse
- [ ] Warning messages included in response metadata
- [ ] No panics or stack traces in any failure scenario
- [ ] Log messages are actionable (which API failed, why)

---

### TASK-032: Rate limiting for Kubernetes API calls

**Points:** 2 | **Priority:** P1 | **Assignee:** Backend

Prevent the ResourceCollector from overwhelming the Kubernetes API server.

**Implementation:**
- Semaphore with configurable limit (default: 10 concurrent calls)
- Per-cluster rate limit: max 20 topology builds per minute
- Retry with exponential backoff for 429/503 responses
- Circuit breaker: after 5 consecutive failures, stop calling that resource type for 60s

**Acceptance Criteria:**
- [ ] Semaphore limits concurrent API calls
- [ ] Rate limit prevents excessive builds
- [ ] Retry logic with backoff
- [ ] Circuit breaker activates after consecutive failures
- [ ] Metrics: API call counts, latencies, error rates exposed

---

## Summary

| Phase | Task Range | Count | Points | Weeks |
|-------|-----------|-------|--------|-------|
| Phase 0: Scaffolding | TASK-001 to TASK-005 | 5 | 10 | Week 1 |
| Phase 1: Relationship Engine | TASK-006 to TASK-019 | 14 | 51 | Weeks 2-4 |
| Phase 2: Graph Building & API | TASK-020 to TASK-028 | 9 | 29 | Weeks 4-6 |
| Phase 2.5: Performance & Hardening | TASK-029 to TASK-032 | 4 | 9 | Weeks 6-7 |
| **Backend Total** | **TASK-001 to TASK-032** | **32** | **~99** | **7 weeks** |
