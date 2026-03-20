# TOPOLOGY ENGINE v2.0 — Development Tasks

**Document:** development-tasks.md  
**Purpose:** Complete task breakdown for topology engine rewrite  
**Estimation:** Story points (1=trivial, 2=small, 3=medium, 5=large, 8=complex, 13=epic)  
**Total Estimated Effort:** ~240 story points across 6 phases  
**Estimated Calendar Time:** 10-14 weeks with 2 engineers (1 backend, 1 frontend)

---

## Phase 0: Preparation & Scaffolding (Week 1)

> **Goal:** Set up the v2 directory structure, feature flags, and migration path. Zero user-visible changes.

### P0-01: Create backend v2 topology package structure
**Assignee:** Backend  
**Points:** 2  
**Description:** Create `kubilitics-backend/internal/topology/v2/` with all directories and empty files per design-doc.md section 2.1. Create interfaces for `TopologyServiceV2`, `ResourceCollector`, `RelationshipMatcher`, `GraphBuilder`.  
**Acceptance Criteria:**
- [ ] Directory structure matches design-doc.md exactly
- [ ] All interfaces defined with correct method signatures
- [ ] Package compiles with `go build ./...`
- [ ] No import from v1 topology package

### P0-02: Create frontend v2 topology directory structure
**Assignee:** Frontend  
**Points:** 2  
**Description:** Create `kubilitics-frontend/src/topology/` with all directories and empty component files per design-doc.md section 3.2. Install React Flow v12 and ELK.js dependencies.  
**Acceptance Criteria:**
- [ ] Directory structure matches design-doc.md exactly
- [ ] `react-flow-renderer@12`, `elkjs` added to package.json
- [ ] All component files created with minimal placeholder exports
- [ ] No existing code broken

### P0-03: Add feature flag for topology v2
**Assignee:** Frontend  
**Points:** 1  
**Description:** Add `FEATURE_TOPOLOGY_V2` feature flag. When enabled, route `/topology` to new `TopologyPage.tsx`. When disabled, route to existing topology component.  
**Acceptance Criteria:**
- [ ] Feature flag configurable via env variable `VITE_FEATURE_TOPOLOGY_V2`
- [ ] Default: `false` (existing topology)
- [ ] Setting `true` shows new TopologyPage (placeholder content)
- [ ] No regression in existing topology

### P0-04: Register v2 API routes alongside v1
**Assignee:** Backend  
**Points:** 2  
**Description:** Register `/api/v1/clusters/{id}/topology/v2` endpoint in the router. Return mock JSON response matching the `TopologyResponse` schema from topology-prd.md section 11.2.  
**Acceptance Criteria:**
- [ ] `GET /api/v1/clusters/{id}/topology/v2` returns 200 with mock data
- [ ] Mock data includes 5 nodes, 4 edges, 1 group
- [ ] All fields match TypeScript interface in PRD
- [ ] Existing v1 `/topology` endpoints unaffected

### P0-05: Create test fixture cluster data
**Assignee:** Backend  
**Points:** 3  
**Description:** Create a Go test fixture that generates a realistic Kubernetes `ResourceBundle` with: 2 Namespaces, 3 Deployments, 3 ReplicaSets, 9 Pods, 3 Services, 1 Ingress, 2 ConfigMaps, 2 Secrets, 1 PVC, 1 PV, 1 StorageClass, 3 ServiceAccounts, 3 RoleBindings, 3 Roles, 1 HPA, 1 PDB, 1 NetworkPolicy, 3 Nodes, 1 IngressClass, 1 Endpoints, 1 EndpointSlice. All resources properly cross-referenced (ownerRefs, selectors, volume mounts, etc.).  
**Acceptance Criteria:**
- [ ] Fixture in `internal/topology/v2/testdata/fixture.go`
- [ ] All resources have valid metadata (names, namespaces, UIDs)
- [ ] Cross-references are correct (Pod ownerRef → RS → Deployment)
- [ ] Selectors match labels correctly
- [ ] Volume mounts reference correct ConfigMaps/Secrets/PVCs
- [ ] Used by all subsequent relationship matcher tests

---

## Phase 1: Backend — Relationship Engine (Weeks 2-4)

> **Goal:** Build and test all 39 relationship matchers. This is the core of the topology engine.

### P1-01: Implement RelationshipRegistry and matcher interface
**Assignee:** Backend  
**Points:** 3  
**Description:** Implement `RelationshipRegistry` that stores all matchers, `RelationshipMatcher` interface per design-doc.md section 2.2, and `ResourceBundle` struct with all fields.  
**Acceptance Criteria:**
- [ ] `RelationshipRegistry.Register(matcher)` and `Registry.MatchAll(bundle)` work
- [ ] `MatchAll` runs all registered matchers concurrently
- [ ] Errors from individual matchers are collected (not fatal)
- [ ] Performance: MatchAll completes in <100ms for fixture data

### P1-02: Implement OwnerReferenceMatcher
**Assignee:** Backend  
**Points:** 5  
**Description:** Implement relationships 1, 14-18 from the PRD. Traverse `metadata.ownerReferences` for all resource types. Produce edges with correct labels: "owned by". Handle multi-level ownership chains (Pod → RS → Deployment).  
**Acceptance Criteria:**
- [ ] Pod → ReplicaSet edges detected with label "owned by"
- [ ] ReplicaSet → Deployment edges detected
- [ ] Pod → StatefulSet edges detected (direct owner)
- [ ] Pod → DaemonSet edges detected (direct owner via RS)
- [ ] Pod → Job edges detected
- [ ] Job → CronJob edges detected
- [ ] Unit test per relationship type (6 tests minimum)
- [ ] Edge `relationshipCategory` = "ownership" for all

### P1-03: Implement SelectorMatcher
**Assignee:** Backend  
**Points:** 5  
**Description:** Implement relationship 19 (Service → Pod selection) and 36-37 (PDB/NetworkPolicy → Pod). Match `spec.selector` labels against `pod.metadata.labels`. Handle matchLabels and matchExpressions.  
**Acceptance Criteria:**
- [ ] Service → Pod edges with label "selects (app=X)"
- [ ] PDB → Pod edges with label "protects"
- [ ] NetworkPolicy → Pod edges with label "applies to"
- [ ] Correctly handles matchLabels AND matchExpressions
- [ ] No false positives (non-matching labels don't produce edges)
- [ ] Unit tests with matching and non-matching scenarios

### P1-04: Implement VolumeMountMatcher
**Assignee:** Backend  
**Points:** 5  
**Description:** Implement relationships 5-7. Scan `pod.spec.volumes[]` and `pod.spec.containers[].volumeMounts[]` for ConfigMap, Secret, and PVC references. Produce edges with mount path in label.  
**Acceptance Criteria:**
- [ ] Pod → ConfigMap edges with label "mounts → /path"
- [ ] Pod → Secret edges with label "mounts → /path"
- [ ] Pod → PVC edges with label "mounts → /path"
- [ ] Mount path extracted from matching volumeMount entry
- [ ] Multiple volumes per pod all detected
- [ ] Init containers scanned as well as regular containers
- [ ] Unit tests: 3 per relationship type (9 total)

### P1-05: Implement EnvRefMatcher
**Assignee:** Backend  
**Points:** 5  
**Description:** Implement relationships 8-11. Scan `envFrom` and individual `env[].valueFrom` for ConfigMap and Secret references.  
**Acceptance Criteria:**
- [ ] Pod → ConfigMap (envFrom) with label "env from"
- [ ] Pod → Secret (envFrom) with label "env from"
- [ ] Pod → ConfigMap (valueFrom) with label "env: KEY_NAME"
- [ ] Pod → Secret (valueFrom) with label "env: KEY_NAME"
- [ ] Multiple containers scanned
- [ ] Deduplication: if same ConfigMap is both volume mount and envFrom, two separate edges produced (different relationship types)
- [ ] Unit tests for each pattern

### P1-06: Implement IngressMatcher
**Assignee:** Backend  
**Points:** 3  
**Description:** Implement relationships 24-26. Parse Ingress rules for backend service references, IngressClass, and TLS secret references.  
**Acceptance Criteria:**
- [ ] Ingress → Service edges with label "routes /path → :port"
- [ ] Ingress → IngressClass edge with label "class"
- [ ] Ingress → Secret (TLS) edge with label "TLS cert"
- [ ] Multiple rules produce multiple edges
- [ ] Default backend handled
- [ ] Unit tests per relationship

### P1-07: Implement EndpointMatcher
**Assignee:** Backend  
**Points:** 3  
**Description:** Implement relationships 20-23. Link Services to Endpoints (same-name), EndpointSlices (label match), and both to target Pods.  
**Acceptance Criteria:**
- [ ] Service → Endpoints edge with label "auto-created"
- [ ] Service → EndpointSlice edge with label "manages"
- [ ] Endpoints → Pod edges with label "target (IP:port)"
- [ ] EndpointSlice → Pod edges with label "target (IP:port)"
- [ ] IP addresses extracted from subsets/endpoints
- [ ] Unit tests per relationship

### P1-08: Implement RBACMatcher
**Assignee:** Backend  
**Points:** 5  
**Description:** Implement relationships 30-34. Trace the full RBAC chain: ServiceAccount → RoleBinding → Role, and ServiceAccount → ClusterRoleBinding → ClusterRole.  
**Acceptance Criteria:**
- [ ] ServiceAccount → RoleBinding edge with label "bound by"
- [ ] RoleBinding → Role edge with label "binds"
- [ ] ServiceAccount → ClusterRoleBinding edge with label "bound by"
- [ ] ClusterRoleBinding → ClusterRole edge with label "binds"
- [ ] Correctly matches subjects by name AND namespace
- [ ] Handles Group and User subjects (not just ServiceAccount)
- [ ] Unit tests for namespace-scoped and cluster-scoped chains

### P1-09: Implement SchedulingMatcher
**Assignee:** Backend  
**Points:** 3  
**Description:** Implement relationships 2, 4, 12-13. Link pods to Nodes (spec.nodeName), ServiceAccounts (spec.serviceAccountName), PriorityClass, RuntimeClass.  
**Acceptance Criteria:**
- [ ] Pod → Node edge with label "runs on"
- [ ] Pod → ServiceAccount edge with label "identity"
- [ ] Pod → PriorityClass edge with label "priority"
- [ ] Pod → RuntimeClass edge with label "runtime"
- [ ] Missing references handled gracefully (no crash)
- [ ] Unit tests per relationship

### P1-10: Implement ScalingMatcher
**Assignee:** Backend  
**Points:** 2  
**Description:** Implement relationship 35. Link HPAs to their scale targets (Deployment, StatefulSet).  
**Acceptance Criteria:**
- [ ] HPA → Deployment edge with label "scales (CPU 70%)"
- [ ] HPA → StatefulSet edge with label "scales (memory 80%)"
- [ ] Target metric and threshold in label
- [ ] Unit test per workload type

### P1-11: Implement StorageMatcher
**Assignee:** Backend  
**Points:** 3  
**Description:** Implement relationships 27-29. Link PVC → PV (spec.volumeName or claimRef), PV → StorageClass, PVC → StorageClass.  
**Acceptance Criteria:**
- [ ] PVC → PV edge with label "bound to"
- [ ] PV → StorageClass edge with label "provisioned by"
- [ ] PVC → StorageClass edge with label "requests from"
- [ ] Handles both static and dynamic provisioning
- [ ] Unit tests

### P1-12: Implement WebhookMatcher
**Assignee:** Backend  
**Points:** 2  
**Description:** Implement relationships 38-39. Link MutatingWebhookConfiguration and ValidatingWebhookConfiguration to the Services they call.  
**Acceptance Criteria:**
- [ ] MutatingWebhook → Service edge with label "calls"
- [ ] ValidatingWebhook → Service edge with label "calls"
- [ ] Only matches webhooks with clientConfig.service (not URL)
- [ ] Unit tests

### P1-13: Implement NamespaceContainmentMatcher
**Assignee:** Backend  
**Points:** 2  
**Description:** Implement relationship 3 — creating group associations, not edges. Every namespaced resource belongs to a namespace group.  
**Acceptance Criteria:**
- [ ] All namespaced resources assigned to their namespace group
- [ ] Cluster-scoped resources (Nodes, PVs, ClusterRoles) in root group
- [ ] Group model includes member list
- [ ] Unit test verifying correct grouping

### P1-14: Integration test — all matchers combined
**Assignee:** Backend  
**Points:** 5  
**Description:** Using the test fixture from P0-05, run ALL matchers together and verify the complete graph has the expected node count, edge count, and specific key edges.  
**Acceptance Criteria:**
- [ ] Test creates full ResourceBundle from fixture
- [ ] Runs RelationshipRegistry.MatchAll()
- [ ] Assert: node count = 35+ (all fixture resources)
- [ ] Assert: edge count = 50+ (all relationship types present)
- [ ] Assert: specific edges exist (Pod → ConfigMap mount, Service → Pod selector, Ingress → Service route, Pod → Node scheduling, ServiceAccount → RoleBinding → Role chain)
- [ ] Assert: no duplicate edges
- [ ] Assert: all edges have non-empty labels
- [ ] Assert: deterministic (two runs produce identical output)

---

## Phase 2: Backend — Graph Building & API (Weeks 4-5)

> **Goal:** Build the complete topology service: collect resources, build graph, apply view modes, serve API.

### P2-01: Implement ResourceCollector (concurrent)
**Assignee:** Backend  
**Points:** 3  
**Description:** Implement concurrent resource collection using errgroup per design-doc.md section 2.4. Support namespace-scoped and cluster-wide collection.  
**Acceptance Criteria:**
- [ ] All resource types listed concurrently
- [ ] Namespace filter applied correctly
- [ ] Cluster-scoped resources always fetched
- [ ] Errors per resource type logged but non-fatal (partial results OK)
- [ ] Benchmark: <500ms for a cluster with 1000 resources

### P2-02: Implement GraphBuilder
**Assignee:** Backend  
**Points:** 5  
**Description:** Orchestrate: collect resources → build nodes → run matchers → assign layers → assign categories → build groups → construct TopologyResponse.  
**Acceptance Criteria:**
- [ ] Produces valid TopologyResponse matching schema
- [ ] Nodes have correct `category`, `layer`, `status`
- [ ] Groups are correctly built from namespace containment
- [ ] Edge IDs are unique
- [ ] Node IDs follow "kind/namespace/name" format

### P2-03: Implement HealthEnricher
**Assignee:** Backend  
**Points:** 3  
**Description:** Compute health status for every node. Pods: use phase + conditions. Deployments: ready/total. Services: have matching endpoints? Nodes: conditions. PVCs: bound status.  
**Acceptance Criteria:**
- [ ] Pod: Running→healthy, Pending→warning, Failed/CrashLoopBackOff→error
- [ ] Deployment: availableReplicas==replicas→healthy, else warning/error
- [ ] Service: has matching pods→healthy, no endpoints→error
- [ ] Node: Ready condition→healthy, NotReady→error
- [ ] PVC: Bound→healthy, Pending→warning, Lost→error
- [ ] Every node has non-null status and statusReason

### P2-04: Implement MetricsEnricher
**Assignee:** Backend  
**Points:** 3  
**Description:** Attach CPU/memory metrics to Pods and Nodes from metrics-server. Aggregate metrics for workloads (total CPU/memory across pods).  
**Acceptance Criteria:**
- [ ] Pod nodes include cpuUsage, memoryUsage, cpuRequest/Limit, memRequest/Limit
- [ ] Node nodes include CPU and memory utilization
- [ ] Deployment nodes include podCount, readyCount
- [ ] Graceful handling when metrics-server unavailable (metrics fields null)

### P2-05: Implement ViewFilter — all 5 view modes
**Assignee:** Backend  
**Points:** 5  
**Description:** Implement view mode filtering per design-doc.md section 2.5. Cluster view shows only namespace groups with summaries. Namespace view shows workloads + services + ingress. Resource-centric view uses BFS traversal from focus resource.  
**Acceptance Criteria:**
- [ ] `mode=cluster`: Returns namespace groups with health/count summaries, no individual pods
- [ ] `mode=namespace`: Returns workloads, services, ingress, storage for one namespace
- [ ] `mode=workload`: Returns specific workload with RS, pods, connected resources
- [ ] `mode=resource`: Returns BFS traversal from focus resource up to `depth` hops
- [ ] `mode=rbac`: Returns ServiceAccounts → RoleBindings → Roles chain
- [ ] Each mode tested with fixture data

### P2-06: Implement TopologyCache
**Assignee:** Backend  
**Points:** 2  
**Description:** Per-cluster, per-cache-key TTL cache. Cache key = "clusterID:mode:namespace:resource". Invalidated on informer events.  
**Acceptance Criteria:**
- [ ] Cache hit returns data in <1ms
- [ ] Cache miss triggers full build
- [ ] TTL configurable per view mode
- [ ] Informer event invalidates relevant cache entries
- [ ] Thread-safe (concurrent reads + writes)

### P2-07: Implement TopologyHandler v2 (REST endpoint)
**Assignee:** Backend  
**Points:** 3  
**Description:** HTTP handler for `GET /api/v1/clusters/{id}/topology/v2`. Parse query parameters, call TopologyServiceV2, return JSON response.  
**Acceptance Criteria:**
- [ ] All query params parsed: mode, namespace, resource, depth, includeMetrics, includeHealth, includeCost
- [ ] Validation: invalid mode returns 400
- [ ] Cluster not found returns 404
- [ ] Successful response matches TopologyResponse schema
- [ ] `buildTimeMs` correctly measured and included
- [ ] OpenAPI docs updated

### P2-08: Implement TopologyWebSocket v2
**Assignee:** Backend  
**Points:** 3  
**Description:** WebSocket endpoint at `/api/v1/ws/topology/{id}`. Subscribe to informer events for the cluster. Push TopologyEvent messages.  
**Acceptance Criteria:**
- [ ] WebSocket upgrade successful
- [ ] Events pushed on resource add/update/delete
- [ ] Events batched in 100ms windows (no flooding)
- [ ] Event includes full updated node/edge data
- [ ] Connection cleanup on client disconnect
- [ ] Works with existing WebSocket hub infrastructure

---

## Phase 3: Frontend — Rendering Engine (Weeks 5-8)

> **Goal:** Build the React Flow-based topology renderer with all node types, edge types, and the design system.

### P3-01: Implement TopologyPage layout
**Assignee:** Frontend  
**Points:** 3  
**Description:** Main page with Toolbar (top), Canvas (center), DetailPanel (right, collapsible), Breadcrumbs (above canvas), Minimap (overlay).  
**Acceptance Criteria:**
- [ ] Responsive layout per design-system.md section 7
- [ ] Detail panel slides in/out smoothly (250ms)
- [ ] Toolbar always visible
- [ ] Breadcrumbs update on navigation

### P3-02: Implement BaseNode component
**Assignee:** Frontend  
**Points:** 5  
**Description:** Standard topology node per design-system.md section 3.1. Category-colored header, health border, name, namespace, status, metrics bars.  
**Acceptance Criteria:**
- [ ] Matches design-system.md specification exactly
- [ ] All 8 resource category colors implemented
- [ ] All 4 health status indicators (color + dot)
- [ ] Metrics bars with correct percentages
- [ ] Truncation with tooltip for long names
- [ ] Dark mode variant matches spec
- [ ] Dimming (30% opacity) when isDimmed=true
- [ ] Selection ring when isSelected=true

### P3-03: Implement CompactNode component
**Assignee:** Frontend  
**Points:** 2  
**Description:** Compact node per design-system.md section 3.2. Used when nodeCount > 200 or zoom < 0.6x.  
**Acceptance Criteria:**
- [ ] 160x48px size
- [ ] Single line: icon + name + health dot
- [ ] Sub-line: kind + namespace
- [ ] Ellipsis overflow for long names

### P3-04: Implement ExpandedNode component
**Assignee:** Frontend  
**Points:** 3  
**Description:** Expanded node for focus resource in Resource-Centric mode per design-system.md section 3.3.  
**Acceptance Criteria:**
- [ ] 320px wide, larger fonts
- [ ] CPU/memory progress bars
- [ ] Label chips
- [ ] Connection count badge
- [ ] Prominent selection border

### P3-05: Implement GroupNode component
**Assignee:** Frontend  
**Points:** 3  
**Description:** Namespace/workload group container per design-system.md section 3.5.  
**Acceptance Criteria:**
- [ ] Dashed border, transparent category-tinted background
- [ ] Header with icon, name, pod count, health dot
- [ ] Collapsible (click header to collapse)
- [ ] Children laid out inside group bounds

### P3-06: Implement LabeledEdge component
**Assignee:** Frontend  
**Points:** 5  
**Description:** Custom edge with midpoint label per design-system.md section 4. Different styles per relationship category.  
**Acceptance Criteria:**
- [ ] All 8 edge styles implemented (solid/dashed/dotted, correct colors)
- [ ] Label pill at midpoint with white/dark background
- [ ] Truncation at 180px with full text tooltip
- [ ] No overlapping labels (anti-overlap algorithm)
- [ ] Arrow markers: filled triangle, open triangle, diamond, circle, double triangle
- [ ] Hover: width increase, glow effect, dim other edges
- [ ] Dark mode variants

### P3-07: Implement ELK layout engine (Web Worker)
**Assignee:** Frontend  
**Points:** 8  
**Description:** ELK layout computation in a Web Worker per design-doc.md section 3.5. Deterministic layout with semantic layers.  
**Acceptance Criteria:**
- [ ] Layout runs in Web Worker (never blocks main thread)
- [ ] Same input produces same output (seed=42)
- [ ] Layout direction configurable per view mode
- [ ] Groups (namespace containers) respected as compound nodes
- [ ] Layer assignments from `layerAssignment.ts` applied
- [ ] Performance: <500ms for 100 nodes, <3s for 1000 nodes
- [ ] Layout positions converted back to React Flow format

### P3-08: Implement TopologyCanvas (React Flow integration)
**Assignee:** Frontend  
**Points:** 5  
**Description:** Main canvas component wrapping React Flow with custom node/edge types, viewport controls, and minimap.  
**Acceptance Criteria:**
- [ ] React Flow configured with all custom node and edge types
- [ ] Pan with mouse drag, zoom with scroll wheel
- [ ] Minimap always visible (bottom-right)
- [ ] Fit-to-screen button works correctly
- [ ] Selection: click node → highlight connected, dim unconnected
- [ ] Double-click → enter Resource-Centric view
- [ ] Background grid visible at appropriate zoom levels
- [ ] Smooth zoom transitions (200ms)

### P3-09: Implement TopologyToolbar
**Assignee:** Frontend  
**Points:** 3  
**Description:** Toolbar with view mode selector, namespace filter, layout direction, overlay toggles, zoom controls, export dropdown.  
**Acceptance Criteria:**
- [ ] View mode dropdown: Cluster, Namespace, Workload, Resource, RBAC
- [ ] Namespace selector populated from cluster data
- [ ] Layout direction toggle (Down/Right)
- [ ] Overlay toggles: Health (default on), Cost, Traffic, Security
- [ ] Zoom controls: Fit, +, -
- [ ] Export dropdown: PNG, SVG, JSON, DrawIO
- [ ] Search button opening filter overlay

### P3-10: Implement TopologyDetailPanel
**Assignee:** Frontend  
**Points:** 5  
**Description:** Right-side panel showing selected resource info with connection tree per topology-prd.md section 8.4.  
**Acceptance Criteria:**
- [ ] Slides in from right on node selection (250ms)
- [ ] Shows: kind, name, namespace, status, metrics
- [ ] Connection tree grouped by category (Ownership, Networking, Config, Storage, Identity, Scaling, Disruption)
- [ ] Each connection clickable (navigates to that node in topology)
- [ ] Action buttons: View YAML, View Logs (pods), Open Detail Page, AI Investigate
- [ ] Close button (or Escape key)

### P3-11: Implement semantic zoom behavior
**Assignee:** Frontend  
**Points:** 3  
**Description:** Switch node types based on zoom level per design-doc.md section 5.2.  
**Acceptance Criteria:**
- [ ] < 0.3x zoom: minimal nodes (colored rectangles)
- [ ] 0.3-0.6x: compact nodes
- [ ] 0.6-1.5x: standard nodes
- [ ] > 1.5x: expanded details
- [ ] Transitions are smooth (no flicker)
- [ ] Edge labels hidden below 0.4x zoom

### P3-12: Implement keyboard shortcuts
**Assignee:** Frontend  
**Points:** 2  
**Description:** All keyboard shortcuts per topology-prd.md section 8.2.  
**Acceptance Criteria:**
- [ ] F = fit to screen
- [ ] 1-5 = view mode switch
- [ ] +/- = zoom
- [ ] Escape = back/deselect
- [ ] Tab = cycle nodes
- [ ] / = search
- [ ] E = toggle edge labels
- [ ] M = toggle minimap
- [ ] S = export screenshot

---

## Phase 4: Frontend — Data Integration & Real-Time (Weeks 8-10)

> **Goal:** Connect the rendering engine to real backend data and WebSocket updates.

### P4-01: Implement useTopologyData hook
**Assignee:** Frontend  
**Points:** 3  
**Description:** React Query hook fetching from `/api/v1/clusters/{id}/topology/v2` with view mode, namespace, and filter parameters.  
**Acceptance Criteria:**
- [ ] Fetches on mount and on parameter change
- [ ] Loading state shown as skeleton layout
- [ ] Error state shows retry button
- [ ] Refetch on window focus (configurable)
- [ ] Stale-while-revalidate for smooth transitions

### P4-02: Implement useTopologyWebSocket hook
**Assignee:** Frontend  
**Points:** 5  
**Description:** WebSocket connection for real-time updates. Apply incremental changes to topology store.  
**Acceptance Criteria:**
- [ ] Connects to `/api/v1/ws/topology/{id}`
- [ ] Reconnects on disconnect (exponential backoff)
- [ ] `node_added`: adds node + triggers partial layout
- [ ] `node_updated`: updates node data in place (no layout)
- [ ] `node_removed`: removes node + triggers partial layout
- [ ] `edge_added`/`edge_removed`: updates edges (no layout)
- [ ] Flash animation on updated nodes (400ms blue border)
- [ ] Events batched (100ms window)

### P4-03: Implement topologyStore (Zustand)
**Assignee:** Frontend  
**Points:** 3  
**Description:** Central state for topology: nodes, edges, groups, viewMode, selectedNode, zoom, overlays, filters.  
**Acceptance Criteria:**
- [ ] All state fields defined with correct types
- [ ] Actions: setViewMode, selectNode, deselectAll, toggleOverlay, setNamespaceFilter, addNode, updateNode, removeNode
- [ ] Derived state: dimmedNodes (based on selection), visibleNodes (based on filters)
- [ ] Persistence: viewMode and overlays saved to localStorage

### P4-04: Implement view mode navigation flow
**Assignee:** Frontend  
**Points:** 5  
**Description:** Full navigation: Cluster → click namespace → Namespace view → click workload → Workload view → double-click pod → Resource-Centric view. Breadcrumbs update. Escape goes back.  
**Acceptance Criteria:**
- [ ] Click namespace group in Cluster view → fetch Namespace view for that namespace
- [ ] Click workload in Namespace view → fetch Workload view for that workload
- [ ] Double-click any node → fetch Resource-Centric view for that resource
- [ ] Breadcrumbs show: Cluster > production > payment-api > pod/payment-api-xyz
- [ ] Each breadcrumb segment clickable (navigates back)
- [ ] Escape key navigates back one level
- [ ] URL updates with view mode and parameters (bookmarkable)

### P4-05: Implement health overlay
**Assignee:** Frontend  
**Points:** 2  
**Description:** Apply health colors from backend data to node borders and backgrounds.  
**Acceptance Criteria:**
- [ ] All nodes colored by health status (green/yellow/red/gray)
- [ ] Errored nodes have subtle pulse animation
- [ ] Edges to errored nodes highlighted
- [ ] Namespace groups show aggregate health badge

### P4-06: Implement cost overlay
**Assignee:** Frontend  
**Points:** 2  
**Description:** When cost overlay enabled, show cost badges on workload nodes and namespace groups.  
**Acceptance Criteria:**
- [ ] Cost badge: "$12.40/mo" on workload nodes
- [ ] Namespace group shows total cost
- [ ] Node size optionally scaled by cost
- [ ] Toggle on/off from toolbar

---

## Phase 5: Export, Polish & Edge Cases (Weeks 10-12)

> **Goal:** Export functionality, dark mode, responsive design, edge case handling, performance optimization.

### P5-01: Implement PNG export
**Assignee:** Frontend  
**Points:** 3  
**Description:** Export current viewport as high-res PNG (2x DPI).  
**Acceptance Criteria:**
- [ ] Captures all visible nodes and edges
- [ ] 2x DPI for retina quality
- [ ] Includes legend (optional toggle)
- [ ] White or transparent background option
- [ ] Downloads as `kubilitics-topology-{cluster}-{date}.png`

### P5-02: Implement SVG export
**Assignee:** Frontend  
**Points:** 2  
**Description:** Export topology as editable SVG.  
**Acceptance Criteria:**
- [ ] All nodes and edges rendered as SVG elements
- [ ] Text is actual SVG text (not rasterized)
- [ ] Editable in Figma, Illustrator, Inkscape

### P5-03: Implement JSON export
**Assignee:** Frontend  
**Points:** 1  
**Description:** Export the raw TopologyResponse JSON data.  
**Acceptance Criteria:**
- [ ] Downloads complete JSON with nodes, edges, groups, metadata
- [ ] Valid JSON, pretty-printed

### P5-04: Implement DrawIO export
**Assignee:** Frontend  
**Points:** 3  
**Description:** Convert topology to DrawIO XML format for diagrams.net.  
**Acceptance Criteria:**
- [ ] Output opens correctly in diagrams.net
- [ ] Nodes positioned correctly
- [ ] Edges connected with labels
- [ ] Groups represented as DrawIO containers

### P5-05: Dark mode implementation
**Assignee:** Frontend  
**Points:** 3  
**Description:** Full dark mode per design-system.md section 6.  
**Acceptance Criteria:**
- [ ] All color mappings from section 6.1 applied
- [ ] Canvas background: `#0F172A`
- [ ] Node backgrounds: `#1E293B`
- [ ] All text meets WCAG AA contrast (4.5:1)
- [ ] Edge labels readable on dark backgrounds
- [ ] Toggles with existing theme switch
- [ ] No "flash of wrong theme" on load

### P5-06: Responsive design implementation
**Assignee:** Frontend  
**Points:** 3  
**Description:** Responsive behavior per design-system.md section 7.  
**Acceptance Criteria:**
- [ ] > 1440px: topology + detail panel side by side
- [ ] 1024-1440px: detail panel as overlay drawer
- [ ] 768-1024px: compact nodes, bottom sheet detail
- [ ] < 768px: simplified for mobile

### P5-07: Performance optimization
**Assignee:** Frontend  
**Points:** 5  
**Description:** Optimize for large graphs: virtualization, debounced updates, memoization.  
**Acceptance Criteria:**
- [ ] 500-node graph renders at 60fps during pan/zoom
- [ ] 1000-node graph renders at 30fps+ during pan/zoom
- [ ] Memory usage < 200MB for 1000-node graph
- [ ] Layout computation < 3s for 1000 nodes (in worker)
- [ ] DOM node count < 500 even for 2000-node graph (virtualization)

### P5-08: Edge case handling
**Assignee:** Both  
**Points:** 3  
**Description:** Handle: empty cluster (0 resources), namespace with no pods, orphaned resources (ownerRef to deleted parent), resources with very long names, special characters in names, CRDs with unknown types.  
**Acceptance Criteria:**
- [ ] Empty cluster: "No resources found" message, not blank canvas
- [ ] Orphaned resources: shown with broken-link indicator
- [ ] Long names: truncated with tooltip, no layout overflow
- [ ] CRDs: shown as "Extensions" category with puzzle icon
- [ ] No JavaScript errors in console for any edge case

---

## Phase 6: Testing & Launch (Weeks 12-14)

> **Goal:** Comprehensive testing, visual regression baselines, documentation, and feature flag flip.

### P6-01: Write Playwright E2E tests — Cluster view
**Assignee:** Frontend  
**Points:** 3  
**Description:** Test cluster overview with namespace groups, health badges, drill-down.  

### P6-02: Write Playwright E2E tests — Namespace view
**Assignee:** Frontend  
**Points:** 3  
**Description:** Test namespace view with workloads, services, correct connections.  

### P6-03: Write Playwright E2E tests — Resource-Centric view
**Assignee:** Frontend  
**Points:** 5  
**Description:** Test resource-centric view for a Pod with ALL expected connections (minimum 10). Assert no missing connections.  

### P6-04: Write Playwright E2E tests — Viewport
**Assignee:** Frontend  
**Points:** 3  
**Description:** Test: fit-to-screen, pan, zoom, no cut-off nodes, minimap accuracy.  

### P6-05: Write Playwright E2E tests — Interactions
**Assignee:** Frontend  
**Points:** 3  
**Description:** Test: click → select, double-click → drill-down, right-click menu, keyboard shortcuts.  

### P6-06: Visual regression baseline
**Assignee:** Frontend  
**Points:** 2  
**Description:** Screenshot all 5 view modes with test cluster. Store as baseline for future regression detection.  

### P6-07: Backend performance benchmark suite
**Assignee:** Backend  
**Points:** 3  
**Description:** Go benchmarks for topology build at 100, 500, 1000, 2000 resources. Assert performance targets from PRD section 3, Principle 7.  

### P6-08: Documentation update
**Assignee:** Both  
**Points:** 2  
**Description:** Update API docs (OpenAPI), user docs (topology usage guide), contributor docs (adding new relationship matchers).  

### P6-09: Feature flag flip & v1 deprecation
**Assignee:** Both  
**Points:** 2  
**Description:** Set `FEATURE_TOPOLOGY_V2=true` as default. Add deprecation notice to v1 endpoints. Remove v1 code after 2 release cycles.  
**Acceptance Criteria:**
- [ ] v2 is the default topology
- [ ] v1 still accessible via direct URL (deprecated)
- [ ] Migration guide for any users with v1-specific bookmarks

---

## Summary

| Phase | Tasks | Total Points | Calendar Weeks |
|-------|-------|-------------|----------------|
| Phase 0: Preparation | 5 tasks | 10 | Week 1 |
| Phase 1: Relationship Engine | 14 tasks | 51 | Weeks 2-4 |
| Phase 2: Graph Building & API | 8 tasks | 27 | Weeks 4-5 |
| Phase 3: Rendering Engine | 12 tasks | 47 | Weeks 5-8 |
| Phase 4: Data Integration | 6 tasks | 20 | Weeks 8-10 |
| Phase 5: Export & Polish | 8 tasks | 23 | Weeks 10-12 |
| Phase 6: Testing & Launch | 9 tasks | 26 | Weeks 12-14 |
| **TOTAL** | **62 tasks** | **~204 points** | **14 weeks** |

### Critical Path

```
P0 (scaffold) → P1 (matchers) → P2 (graph builder + API) → P4 (data integration)
                                                           ↗
               P3 (rendering) ────────────────────────────
                                                           ↘
                                                            P5 (polish) → P6 (test & launch)
```

**P1 (relationship engine) and P3 (rendering) can be done in parallel** by backend and frontend engineers respectively. They converge at P4 (data integration) where the real API replaces mock data.

### Definition of Done (Entire Rewrite)

The topology v2 rewrite is shipped when:
- [ ] All 62 tasks completed and merged
- [ ] All 39 relationship types implemented with unit tests
- [ ] All 5 view modes working end-to-end
- [ ] Resource-Centric view for a Pod shows ALL connected resources
- [ ] Every edge has a visible, readable label
- [ ] No cut-off nodes, no overlapping labels
- [ ] 60fps pan/zoom for 500-node graphs
- [ ] Dark mode meets WCAG AA
- [ ] All Playwright E2E tests pass
- [ ] Visual regression baselines established
- [ ] Feature flag flipped to v2 as default
- [ ] v1 code deprecated
