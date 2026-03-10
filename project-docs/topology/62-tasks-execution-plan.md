# Topology v2 — 62-Task Execution Plan

**Purpose:** Complete all tasks from `development-tasks.md` one by one, phase by phase.  
**Reference:** `development-tasks.md` (full descriptions, acceptance criteria, story points).  
**Total:** 62 tasks, ~204 story points, 6 phases.

---

## How to Use This Plan

1. Work **strictly in order** within each phase (e.g. P0-01 → P0-02 → … → P0-05).
2. Complete **all acceptance criteria** for a task before marking it done.
3. Mark completed tasks with `[x]`; leave pending as `[ ]`.
4. **Phase 0 and Phase 1** are prerequisites for Phase 2. **Phase 2** unblocks Phase 4. **Phase 3** can run in parallel with Phase 1/2 (frontend vs backend).
5. **Critical path:** P0 → P1 → P2 → P4 (backend + integration), and P3 (frontend) merges at P4.

---

## Phase 0: Preparation & Scaffolding (Week 1)

| # | Task ID   | Task | Assignee | Pts | Done |
|---|----------|------|----------|-----|------|
| 1 | **P0-01** | Create backend v2 topology package structure (`internal/topology/v2/`, interfaces: TopologyServiceV2, ResourceCollector, RelationshipMatcher, GraphBuilder) | Backend | 2 | [ ] |
| 2 | **P0-02** | Create frontend v2 topology directory structure (`src/topology/`, React Flow v12, ELK.js, placeholder components) | Frontend | 2 | [ ] |
| 3 | **P0-03** | Add feature flag `VITE_FEATURE_TOPOLOGY_V2`; route `/topology` to new TopologyPage when true | Frontend | 1 | [ ] |
| 4 | **P0-04** | Register `GET /api/v1/clusters/{id}/topology/v2`; return mock TopologyResponse (5 nodes, 4 edges, 1 group) | Backend | 2 | [ ] |
| 5 | **P0-05** | Create test fixture: ResourceBundle with 2 NS, 3 Deploy, 3 RS, 9 Pods, 3 Svcs, Ingress, ConfigMaps, Secrets, PVC/PV/SC, RBAC, HPA, PDB, NP, Nodes, Endpoints, EndpointSlice; correct cross-refs | Backend | 3 | [ ] |

**Phase 0 exit:** Backend and frontend v2 skeletons exist; mock API returns valid JSON; fixture used by later tests.

---

## Phase 1: Backend — Relationship Engine (Weeks 2–4)

| # | Task ID   | Task | Assignee | Pts | Done |
|---|----------|------|----------|-----|------|
| 6 | **P1-01** | RelationshipRegistry + matcher interface; ResourceBundle with all fields; MatchAll concurrent, non-fatal errors, &lt;100ms on fixture | Backend | 3 | [ ] |
| 7 | **P1-02** | OwnerReferenceMatcher: Pod→RS, RS→Deployment, Pod→StatefulSet/DaemonSet/Job, Job→CronJob; 6+ unit tests; category "ownership" | Backend | 5 | [ ] |
| 8 | **P1-03** | SelectorMatcher: Service→Pod, PDB→Pod, NetworkPolicy→Pod; matchLabels + matchExpressions; no false positives; unit tests | Backend | 5 | [ ] |
| 9 | **P1-04** | VolumeMountMatcher: Pod→ConfigMap/Secret/PVC; mount path in label; init containers; 9 unit tests | Backend | 5 | [ ] |
| 10 | **P1-05** | EnvRefMatcher: envFrom + valueFrom for ConfigMap/Secret; dedupe with volume edges; unit tests per pattern | Backend | 5 | [ ] |
| 11 | **P1-06** | IngressMatcher: Ingress→Service, IngressClass, Secret (TLS); default backend; unit tests | Backend | 3 | [ ] |
| 12 | **P1-07** | EndpointMatcher: Service→Endpoints/EndpointSlice, Endpoints/EndpointSlice→Pod; IP in label; unit tests | Backend | 3 | [ ] |
| 13 | **P1-08** | RBACMatcher: SA→RoleBinding→Role, SA→ClusterRoleBinding→ClusterRole; subjects by name+namespace; Group/User; unit tests | Backend | 5 | [ ] |
| 14 | **P1-09** | SchedulingMatcher: Pod→Node, ServiceAccount, PriorityClass, RuntimeClass; graceful missing refs; unit tests | Backend | 3 | [ ] |
| 15 | **P1-10** | ScalingMatcher: HPA→Deployment/StatefulSet; metric+threshold in label; unit tests | Backend | 2 | [ ] |
| 16 | **P1-11** | StorageMatcher: PVC→PV, PV→StorageClass, PVC→StorageClass; static + dynamic; unit tests | Backend | 3 | [ ] |
| 17 | **P1-12** | WebhookMatcher: Mutating/ValidatingWebhook→Service (clientConfig.service only); unit tests | Backend | 2 | [ ] |
| 18 | **P1-13** | NamespaceContainmentMatcher: namespaced resources → namespace group; cluster-scoped → root; group member list; unit test | Backend | 2 | [ ] |
| 19 | **P1-14** | Integration test: fixture → MatchAll; assert node count 35+, edge count 50+, key edges present, no duplicates, deterministic | Backend | 5 | [ ] |

**Phase 1 exit:** All 39 relationship types covered by matchers; fixture-driven unit + integration tests pass.

---

## Phase 2: Backend — Graph Building & API (Weeks 4–5)

| # | Task ID   | Task | Assignee | Pts | Done |
|---|----------|------|----------|-----|------|
| 20 | **P2-01** | ResourceCollector: concurrent list (errgroup), namespace filter, cluster-scoped always; per-type errors non-fatal; benchmark &lt;500ms @ 1000 resources | Backend | 3 | [ ] |
| 21 | **P2-02** | GraphBuilder: collect → nodes → matchers → layers → categories → groups → TopologyResponse; schema-compliant; unique edge IDs; node ID format kind/ns/name | Backend | 5 | [ ] |
| 22 | **P2-03** | HealthEnricher: Pod/Deployment/Service/Node/PVC status + statusReason; every node non-null | Backend | 3 | [ ] |
| 23 | **P2-04** | MetricsEnricher: CPU/memory on Pod/Node; workload aggregates; graceful when metrics-server unavailable | Backend | 3 | [ ] |
| 24 | **P2-05** | ViewFilter: cluster / namespace / workload / resource (BFS) / rbac; each mode tested with fixture | Backend | 5 | [ ] |
| 25 | **P2-06** | TopologyCache: per cluster/mode/namespace/resource; TTL; informer invalidation; thread-safe | Backend | 2 | [ ] |
| 26 | **P2-07** | TopologyHandler v2: parse mode, namespace, resource, depth, includeMetrics/Health/Cost; 400/404; buildTimeMs; OpenAPI updated | Backend | 3 | [ ] |
| 27 | **P2-08** | TopologyWebSocket v2: `/api/v1/ws/topology/{id}`; informer events → TopologyEvent; 100ms batching; cleanup on disconnect | Backend | 3 | [ ] |

**Phase 2 exit:** Full topology build from cluster; REST and WebSocket v2 working; view modes and cache in place.

---

## Phase 3: Frontend — Rendering Engine (Weeks 5–8)

| # | Task ID   | Task | Assignee | Pts | Done |
|---|----------|------|----------|-----|------|
| 28 | **P3-01** | TopologyPage layout: Toolbar, Canvas, DetailPanel (collapsible), Breadcrumbs, Minimap; responsive per design-system §7 | Frontend | 3 | [ ] |
| 29 | **P3-02** | BaseNode: category colors, health border, name/namespace/status, metrics bars, truncation+tooltip, dark mode, isDimmed, isSelected | Frontend | 5 | [ ] |
| 30 | **P3-03** | CompactNode: 160×48px; icon+name+health; kind+namespace; used when nodeCount&gt;200 or zoom&lt;0.6 | Frontend | 2 | [ ] |
| 31 | **P3-04** | ExpandedNode: 320px, progress bars, label chips, connection count, focus in Resource-Centric | Frontend | 3 | [ ] |
| 32 | **P3-05** | GroupNode: dashed border, category tint, header with pod count/health, collapsible, children inside bounds | Frontend | 3 | [ ] |
| 33 | **P3-06** | LabeledEdge: 8 styles by category, midpoint label pill, truncation 180px+tooltip, anti-overlap, arrow markers, hover/dark mode | Frontend | 5 | [ ] |
| 34 | **P3-07** | ELK layout in Web Worker: deterministic (seed 42), direction by view mode, compound groups, layerAssignment; &lt;500ms @ 100 nodes, &lt;3s @ 1000 | Frontend | 8 | [ ] |
| 35 | **P3-08** | TopologyCanvas: React Flow + custom types, pan/zoom, minimap, fit-view, selection+dim, double-click→Resource-Centric, grid, smooth zoom | Frontend | 5 | [ ] |
| 36 | **P3-09** | TopologyToolbar: view mode, namespace selector, layout direction, overlays (Health/Cost/Traffic/Security), zoom, export (PNG/SVG/JSON/DrawIO), search | Frontend | 3 | [ ] |
| 37 | **P3-10** | TopologyDetailPanel: slide-in, kind/name/namespace/status/metrics, connection tree by category, clickable connections, actions (YAML, Logs, Detail, AI), Escape | Frontend | 5 | [ ] |
| 38 | **P3-11** | Semantic zoom: &lt;0.3 minimal, 0.3–0.6 compact, 0.6–1.5 standard, &gt;1.5 expanded; edge labels hidden &lt;0.4x; no flicker | Frontend | 3 | [ ] |
| 39 | **P3-12** | Keyboard shortcuts: F, 1–5, +/-, Escape, Tab, /, E, M, S per PRD §8.2 | Frontend | 2 | [ ] |

**Phase 3 exit:** All node/edge types and layout implemented; canvas, toolbar, detail panel, zoom and shortcuts working.

---

## Phase 4: Frontend — Data Integration & Real-Time (Weeks 8–10)

| # | Task ID   | Task | Assignee | Pts | Done |
|---|----------|------|----------|-----|------|
| 40 | **P4-01** | useTopologyData: fetch v2 API with mode/namespace/filters; loading skeleton, error+retry, refetch on focus, stale-while-revalidate | Frontend | 3 | [ ] |
| 41 | **P4-02** | useTopologyWebSocket: connect, reconnect (backoff); node_added/updated/removed, edge_added/removed; partial layout; flash on update; 100ms batch | Frontend | 5 | [ ] |
| 42 | **P4-03** | topologyStore (Zustand): nodes, edges, groups, viewMode, selectedNode, zoom, overlays, filters; actions; derived dimmed/visible; persist viewMode+overlays | Frontend | 3 | [ ] |
| 43 | **P4-04** | View mode navigation: Cluster→Namespace→Workload→Resource-Centric; breadcrumbs clickable; Escape back; URL bookmarkable | Frontend | 5 | [ ] |
| 44 | **P4-05** | Health overlay: node borders/backgrounds by health; pulse on error; aggregate health on groups | Frontend | 2 | [ ] |
| 45 | **P4-06** | Cost overlay: cost badge on workloads and groups; optional size-by-cost; toolbar toggle | Frontend | 2 | [ ] |

**Phase 4 exit:** UI driven by real API; WebSocket updates; navigation and overlays working.

---

## Phase 5: Export, Polish & Edge Cases (Weeks 10–12)

| # | Task ID   | Task | Assignee | Pts | Done |
|---|----------|------|----------|-----|------|
| 46 | **P5-01** | PNG export: viewport, 2x DPI, optional legend, background option, filename with cluster+date | Frontend | 3 | [ ] |
| 47 | **P5-02** | SVG export: nodes/edges as SVG, text as SVG text, editable in Figma/Illustrator | Frontend | 2 | [ ] |
| 48 | **P5-03** | JSON export: full TopologyResponse, pretty-printed | Frontend | 1 | [ ] |
| 49 | **P5-04** | DrawIO export: DrawIO XML for diagrams.net; nodes, edges, groups | Frontend | 3 | [ ] |
| 50 | **P5-05** | Dark mode: design-system §6 colors; canvas #0F172A; WCAG AA; no flash of wrong theme | Frontend | 3 | [ ] |
| 51 | **P5-06** | Responsive: &gt;1440 side-by-side; 1024–1440 overlay drawer; 768–1024 compact+bottom sheet; &lt;768 mobile | Frontend | 3 | [ ] |
| 52 | **P5-07** | Performance: 500 nodes 60fps, 1000 nodes 30fps+, &lt;200MB, layout &lt;3s, DOM &lt;500 (virtualization) | Frontend | 5 | [ ] |
| 53 | **P5-08** | Edge cases: empty cluster message; orphaned broken-link; long names truncate+tooltip; CRDs as Extensions; no console errors | Both | 3 | [ ] |

**Phase 5 exit:** Export options, dark mode, responsive, performance targets, edge cases handled.

---

## Phase 6: Testing & Launch (Weeks 12–14)

| # | Task ID   | Task | Assignee | Pts | Done |
|---|----------|------|----------|-----|------|
| 54 | **P6-01** | Playwright E2E: Cluster view (namespace groups, health, drill-down) | Frontend | 3 | [ ] |
| 55 | **P6-02** | Playwright E2E: Namespace view (workloads, services, connections) | Frontend | 3 | [ ] |
| 56 | **P6-03** | Playwright E2E: Resource-Centric view for Pod (≥10 connections, none missing) | Frontend | 5 | [ ] |
| 57 | **P6-04** | Playwright E2E: Viewport (fit, pan, zoom, no cut-off, minimap) | Frontend | 3 | [ ] |
| 58 | **P6-05** | Playwright E2E: Interactions (select, double-click drill-down, right-click, shortcuts) | Frontend | 3 | [ ] |
| 59 | **P6-06** | Visual regression: screenshot baselines for all 5 view modes | Frontend | 2 | [ ] |
| 60 | **P6-07** | Backend benchmarks: topology build at 100, 500, 1000, 2000 resources; assert PRD targets | Backend | 3 | [ ] |
| 61 | **P6-08** | Documentation: OpenAPI, user topology guide, contributor matcher guide | Both | 2 | [ ] |
| 62 | **P6-09** | Feature flag default = v2; v1 deprecated but reachable; migration guide | Both | 2 | [ ] |

**Phase 6 exit:** E2E and visual regression in place; docs and flag flip done; v1 deprecated.

---

## Summary Table

| Phase | First–Last task | Count | Points |
|-------|-----------------|-------|--------|
| Phase 0 | P0-01 … P0-05 | 5 | 10 |
| Phase 1 | P1-01 … P1-14 | 14 | 51 |
| Phase 2 | P2-01 … P2-08 | 8 | 27 |
| Phase 3 | P3-01 … P3-12 | 12 | 47 |
| Phase 4 | P4-01 … P4-06 | 6 | 20 |
| Phase 5 | P5-01 … P5-08 | 8 | 23 |
| Phase 6 | P6-01 … P6-09 | 9 | 26 |
| **Total** | **62 tasks** | **62** | **~204** |

---

## Execution Order (Single Track)

If one person or one track runs in strict sequence, use this order (task # from above):

1–5 (Phase 0) → 6–19 (Phase 1) → 20–27 (Phase 2) → 28–39 (Phase 3) → 40–45 (Phase 4) → 46–53 (Phase 5) → 54–62 (Phase 6).

**Parallel track (recommended):** Backend does 1–5, 6–19, 20–27. Frontend does 1–5 (P0-02, P0-03), then 28–39. Then both do 40–45, 46–53, 54–62.
