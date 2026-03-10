# TOPOLOGY v2.0 — Implementation Tasks Part 3: Exports, Testing & Launch

**Scope:** Export functionality, dark mode, performance optimization, comprehensive testing, and production launch
**Engineers:** Both backend + frontend
**Estimated Effort:** 22 tasks, ~75 story points
**Calendar Time:** Weeks 10-16

---

## Phase 4: Export System (Weeks 10-11)

### TASK-061: Implement PNG export (high-res)

**Points:** 3 | **Priority:** P0 | **Assignee:** Frontend

Export current topology view as high-resolution PNG image.

**Implementation:**
- Use React Flow's `toObject()` to get current viewport state
- Use `html-to-image` or canvas-based approach for rasterization
- Render at 2x DPI for retina quality
- Include all visible nodes, edges, and labels
- Optional: include legend showing category colors and health indicators

**Export options dialog:**
- Background: White / Transparent / Dark
- Include legend: Yes / No
- Include metrics: Yes / No
- Scope: Visible viewport / Full graph / Selected only
- DPI: 1x / 2x / 3x

**Filename:** `kubilitics-topology-{cluster}-{viewmode}-{date}.png`

**Acceptance Criteria:**
- [ ] PNG captures all visible nodes and edges with correct colors
- [ ] 2x DPI produces sharp image on retina displays
- [ ] Transparent background option works
- [ ] Legend included when selected
- [ ] Full graph export (not just viewport) captures all nodes
- [ ] Selected-only export captures only highlighted subgraph
- [ ] File downloads with correct filename
- [ ] Also copies to clipboard (for quick paste to Slack/Jira)
- [ ] Works in Chrome, Firefox, Safari
- [ ] Large graph export (500+ nodes) completes without timeout

---

### TASK-062: Implement SVG export

**Points:** 2 | **Priority:** P1 | **Assignee:** Frontend

Export as editable SVG for design tools.

**Implementation:**
- Convert React Flow canvas to SVG with proper viewBox
- All nodes rendered as SVG groups with text elements
- All edges rendered as SVG paths
- Labels as actual SVG text (not rasterized)
- Inline styles (not CSS classes) for portability

**Acceptance Criteria:**
- [ ] Opens correctly in Figma, Illustrator, Inkscape
- [ ] Text is selectable and editable
- [ ] Colors correct in both light and dark themes
- [ ] Node groupings preserved as SVG groups
- [ ] Edge labels positioned correctly

---

### TASK-063: Implement JSON export

**Points:** 1 | **Priority:** P1 | **Assignee:** Frontend

Export raw TopologyResponse JSON for programmatic use.

**Acceptance Criteria:**
- [ ] Downloads complete TopologyResponse JSON
- [ ] Pretty-printed with 2-space indentation
- [ ] Includes metadata, all nodes, all edges, all groups
- [ ] Valid JSON (parseable by any JSON parser)
- [ ] Filename: `kubilitics-topology-{cluster}-{date}.json`

---

### TASK-064: Implement DrawIO export

**Points:** 3 | **Priority:** P2 | **Assignee:** Frontend

Convert topology to Draw.io (diagrams.net) XML format.

**Implementation:**
- Convert each node to a Draw.io `mxCell` with geometry (position, size)
- Convert each edge to a Draw.io edge `mxCell` with source/target
- Convert groups to Draw.io containers (swimlanes)
- Map category colors to Draw.io fill colors
- Include edge labels as edge label cells

**Acceptance Criteria:**
- [ ] Opens correctly in diagrams.net (web and desktop)
- [ ] Nodes positioned at correct coordinates
- [ ] Edges connected between correct nodes
- [ ] Labels visible on edges
- [ ] Groups rendered as containers/swimlanes
- [ ] Colors approximate the topology design system

---

### TASK-065: Implement PDF export

**Points:** 2 | **Priority:** P2 | **Assignee:** Frontend

Export as PDF for formal reports and documentation.

**Implementation:**
- Generate SVG first, then convert to PDF using `jspdf` or similar
- Add header: "Kubilitics Topology — {cluster} — {date}"
- Add footer: page number
- Support landscape orientation for wide graphs
- Include legend on separate page if enabled

**Acceptance Criteria:**
- [ ] PDF renders all nodes and edges clearly
- [ ] Header and footer present
- [ ] Landscape orientation for wide topologies
- [ ] Optional legend page
- [ ] Text remains selectable in PDF

---

## Phase 5: Dark Mode & Performance (Weeks 11-12)

### TASK-066: Implement complete dark mode

**Points:** 3 | **Priority:** P0 | **Assignee:** Frontend

Full dark mode implementation per design system color mapping.

**Color mapping:**

| Element | Light | Dark |
|---------|-------|------|
| Canvas background | #FFFFFF | #0F172A |
| Node background | #FFFFFF | #1E293B |
| Node border | #E2E8F0 | #334155 |
| Node header | Category-600 | Category-500 (one shade lighter) |
| Primary text | #1E293B | #F1F5F9 |
| Secondary text | #64748B | #94A3B8 |
| Edge label background | #FFFFFF | #1E293B |
| Edge label border | #E2E8F0 | #475569 |
| Group background | Category-50 at 40% | Category-900 at 20% |
| Grid dots | #E2E8F0 | #334155 |
| Minimap background | #F8FAFC at 90% | #1E293B at 90% |

**Rules:**
- Never pure black (#000000), darkest is #0F172A
- Never pure white text on dark, brightest is #F1F5F9
- Health colors (green/yellow/red/gray) stay the same in both modes
- Category headers shift one shade lighter in dark mode
- Edges reduce opacity by 10% in dark mode

**Acceptance Criteria:**
- [ ] All color mappings from table applied correctly
- [ ] Toggles with existing app theme switch
- [ ] No "flash of wrong theme" on page load (reads system preference)
- [ ] All text meets WCAG AA 4.5:1 contrast in dark mode
- [ ] Edge labels readable on dark pill backgrounds
- [ ] Minimap renders correctly in dark mode
- [ ] Export respects current theme (or allows override)
- [ ] Tested in Chrome, Firefox, Safari

---

### TASK-067: Performance optimization for large graphs

**Points:** 5 | **Priority:** P0 | **Assignee:** Frontend

Ensure smooth performance at scale.

**Optimization targets:**

| Graph Size | Render | Pan/Zoom FPS | Memory |
|-----------|--------|-------------|--------|
| 100 nodes | < 500ms | 60 fps | < 50MB |
| 500 nodes | < 1.5s | 60 fps | < 100MB |
| 1000 nodes | < 3s | 30+ fps | < 150MB |
| 2000 nodes | < 5s | 30+ fps | < 250MB |

**Optimization techniques:**
1. **Virtualization:** React Flow's `onlyRenderVisibleElements` — only nodes in viewport rendered to DOM
2. **Semantic zoom:** MinimalNode at low zoom reduces DOM complexity by 90%
3. **Web Worker layout:** ELK computation never blocks main thread
4. **Memoization:** All node/edge components wrapped in React.memo with proper equality checks
5. **Debounced updates:** WebSocket events batched, zoom-based node type switching debounced
6. **Edge bundling:** For graphs with many parallel edges, consider edge bundling at low zoom
7. **Lazy metrics:** Metrics bars only rendered when node is in viewport AND zoom > 0.6x

**Acceptance Criteria:**
- [ ] 500-node graph: 60fps during pan/zoom (measured with Chrome DevTools Performance)
- [ ] 1000-node graph: 30+fps during pan/zoom
- [ ] Memory: < 150MB for 1000-node graph (measured with Memory tab)
- [ ] Layout: < 3s for 1000 nodes in Web Worker
- [ ] DOM node count: < 500 even for 2000-node graph
- [ ] No janky scroll or zoom at any graph size
- [ ] Performance regression test in CI

---

### TASK-068: Edge case handling

**Points:** 3 | **Priority:** P0 | **Assignee:** Both

Handle all edge cases gracefully.

**Scenarios:**

| Edge Case | Expected Behavior |
|-----------|------------------|
| Empty cluster (0 resources) | "No resources found" with illustration |
| Namespace with no pods | "No workloads in this namespace" |
| Orphaned resource (ownerRef to deleted parent) | Show with dashed border + broken-link icon |
| Very long resource name (>80 chars) | Truncated with full name in tooltip |
| Resource name with special characters | Properly escaped, no rendering errors |
| CRDs and custom resources | "Extensions" category, puzzle icon |
| Pod with no containers | Show as error state |
| Service with no selector | Show with warning badge |
| Namespace with 500+ pods | Automatic CompactNode, no performance degradation |
| Cluster-scoped resources (Nodes, PVs) | Shown without namespace label |
| Resources across multiple namespaces | Cross-namespace edges clearly labeled |

**Acceptance Criteria:**
- [ ] Each scenario renders correctly (no crash, no blank screen)
- [ ] No JavaScript console errors for any edge case
- [ ] Orphaned resources visually distinct (dashed border)
- [ ] Long names truncated everywhere (node, detail panel, breadcrumbs)
- [ ] CRDs categorized as "extensions" with puzzle icon
- [ ] Large namespace degrades gracefully (automatic compact nodes)

---

## Phase 6: Comprehensive Testing (Weeks 13-15)

### TASK-069: Playwright E2E — Cluster View

**Points:** 3 | **Priority:** P0 | **Assignee:** Frontend

**Test scenarios:**
1. Navigate to topology → cluster view loads with namespace groups
2. Each namespace group shows health badge and workload count
3. Click namespace group → navigates to Namespace View
4. Hover namespace → tooltip shows summary
5. Breadcrumb shows "Cluster"
6. Health overlay colors groups correctly
7. Dark mode renders correctly

**Acceptance Criteria:**
- [ ] All 7 scenarios pass
- [ ] Tests run in < 30s
- [ ] Tests work in headed and headless mode
- [ ] Screenshots captured for visual regression

---

### TASK-070: Playwright E2E — Namespace View

**Points:** 3 | **Priority:** P0 | **Assignee:** Frontend

**Test scenarios:**
1. Navigate to namespace view → shows workloads, services, ingress
2. Layout flows left-to-right (Ingress → Service → Workload → Storage)
3. All expected connections present between resources
4. Click workload → navigates to Workload View
5. ConfigMaps/Secrets shown grouped
6. RBAC chain collapsed by default, expandable

**Acceptance Criteria:**
- [ ] All 6 scenarios pass
- [ ] Edge labels visible and readable
- [ ] No overlapping labels
- [ ] Layout direction correct

---

### TASK-071: Playwright E2E — Resource-Centric View (THE CRITICAL TEST)

**Points:** 5 | **Priority:** P0 | **Assignee:** Frontend

This is the most important test. It verifies the core product promise.

**Test with payment-api Pod:**
1. Navigate to resource-centric view for `Pod/production/payment-api-xyz`
2. Assert ALL of these connections are visible:
   - [ ] ReplicaSet (ownership)
   - [ ] Deployment (ownership chain)
   - [ ] Service (selector match)
   - [ ] Endpoints (target)
   - [ ] Ingress (routing chain)
   - [ ] ConfigMap: payment-config (volume mount)
   - [ ] Secret: payment-db-creds (volume mount)
   - [ ] Secret: payment-tls (envFrom)
   - [ ] PVC: payment-data (volume mount)
   - [ ] PV: pv-abc123 (bound)
   - [ ] StorageClass: gp3-encrypted (provisioner)
   - [ ] ServiceAccount: payment-sa (identity)
   - [ ] RoleBinding: payment-rb (RBAC)
   - [ ] Role: payment-role (RBAC)
   - [ ] Node: ip-10-0-1-11 (scheduling)
   - [ ] HPA: payment-hpa (scaling)
   - [ ] PDB: payment-pdb (disruption)
   - [ ] NetworkPolicy: allow-payment (policy)
3. Assert edge count >= 18
4. Assert every edge has a visible, non-empty label
5. Assert no overlapping labels
6. Assert no cut-off nodes (all nodes within scrollable canvas)
7. Assert detail panel shows correct connection count
8. Click "Go to Resource" on Service → navigates to Service topology
9. Service topology shows its own connections correctly
10. Breadcrumbs update correctly through navigation

**Acceptance Criteria:**
- [ ] All 18+ connections present (ZERO missing)
- [ ] All edges labeled correctly
- [ ] No overlapping labels
- [ ] No cut-off nodes
- [ ] "Go to Resource" navigation works
- [ ] This test MUST PASS before v2 can ship

---

### TASK-072: Playwright E2E — Viewport & Scrolling

**Points:** 3 | **Priority:** P0 | **Assignee:** Frontend

**Test scenarios:**
1. Fit-to-screen shows ALL nodes (none outside viewport)
2. After fit-to-screen, all nodes are within visible bounds
3. Pan: drag canvas, viewport moves
4. Zoom in: scroll wheel zooms centered on cursor
5. Zoom out: all nodes remain reachable by panning
6. No cut-off nodes at 0.5x zoom
7. No cut-off nodes at 2x zoom
8. Minimap viewport indicator matches actual viewport
9. Drag minimap viewport → canvas pans to match
10. Resource-centric with 30 connections → scroll reveals all nodes

**Acceptance Criteria:**
- [ ] All 10 scenarios pass
- [ ] Viewport test runs at multiple graph sizes (10, 50, 200 nodes)
- [ ] Cut-off detection: assert all node bounding boxes intersect canvas bounds

---

### TASK-073: Playwright E2E — Interactions

**Points:** 3 | **Priority:** P0 | **Assignee:** Frontend

**Test scenarios:**
1. Click node → detail panel opens with correct info
2. Click node → connected nodes highlighted, unconnected dimmed
3. Double-click node → Resource-Centric view opens
4. Right-click node → context menu appears
5. Click "View YAML" → YAML viewer opens
6. Click "Copy Name" → clipboard contains correct name
7. Click empty space → selection cleared
8. Escape → detail panel closes
9. Keyboard: Tab cycles through nodes
10. Keyboard: Enter selects focused node
11. Keyboard: F fits to screen
12. Keyboard: / opens search

**Acceptance Criteria:**
- [ ] All 12 scenarios pass
- [ ] Interaction response time < 100ms (no perceptible delay)

---

### TASK-074: Playwright E2E — Search

**Points:** 2 | **Priority:** P0 | **Assignee:** Frontend

**Test scenarios:**
1. / opens search overlay
2. Type "payment" → matching nodes highlighted
3. Type "kind:Pod" → only pods shown
4. Type "status:error" → only error nodes shown
5. Click search result → viewport centers on node
6. Escape clears search
7. Combined: "kind:Service ns:production" → correct filtering

**Acceptance Criteria:**
- [ ] All 7 scenarios pass
- [ ] Search responsive (< 200ms after typing stops)

---

### TASK-075: Playwright E2E — Navigation & Deep Links

**Points:** 3 | **Priority:** P0 | **Assignee:** Frontend

**Test scenarios:**
1. Navigate Cluster → Namespace → Workload → Resource (full flow)
2. Breadcrumbs update at each level
3. Each breadcrumb segment clickable
4. Escape navigates back one level
5. Browser back button works
6. URL updates at each navigation
7. Deep-link `/topology/{cluster}/resource/Pod/production/payment-api-xyz` loads Resource-Centric view directly
8. Deep-link `/topology/{cluster}/namespace/production` loads Namespace view
9. Invalid deep-link shows 404 with helpful message
10. "Go to Resource" in detail panel navigates correctly

**Acceptance Criteria:**
- [ ] All 10 scenarios pass
- [ ] Navigation history supports full back/forward
- [ ] Deep links work on fresh page load (no prior navigation required)

---

### TASK-076: Playwright E2E — Export

**Points:** 2 | **Priority:** P1 | **Assignee:** Frontend

**Test scenarios:**
1. Export PNG → file downloads, image has correct node count
2. Export SVG → file downloads, SVG has text elements
3. Export JSON → file downloads, valid JSON with correct structure
4. Export with "selected only" → only selected nodes in output
5. Clipboard export → PNG data in clipboard

**Acceptance Criteria:**
- [ ] All 5 scenarios pass
- [ ] Files have correct filenames
- [ ] PNG image dimensions reasonable (not 1x1 or 100000x100000)

---

### TASK-077: Visual regression baseline

**Points:** 2 | **Priority:** P0 | **Assignee:** Frontend

Screenshot baselines for all views with test cluster data.

**Baselines to capture:**
1. Cluster View (light mode)
2. Cluster View (dark mode)
3. Namespace View — production (light)
4. Namespace View — production (dark)
5. Workload View — payment-api Deployment (light)
6. Resource-Centric View — payment-api Pod (light)
7. Resource-Centric View — payment-api Pod (dark)
8. RBAC View (light)
9. Detail panel open for Pod
10. Search overlay with results

**Acceptance Criteria:**
- [ ] All 10 baselines captured at 1920x1080
- [ ] Pixel diff threshold: 1% (layout changes must be intentional)
- [ ] CI runs visual regression on every PR
- [ ] Baseline update process documented

---

### TASK-078: Backend integration tests

**Points:** 3 | **Priority:** P0 | **Assignee:** Backend

End-to-end backend tests with mock Kubernetes cluster.

**Test scenarios:**
1. Full topology build from fixture → correct node/edge counts per view mode
2. Resource-centric BFS → correct depth traversal
3. Health enricher → all nodes have valid status
4. Metrics enricher → metrics present when available, null when not
5. Cache hit → same response, < 1ms
6. Cache invalidation → fresh build after informer event
7. WebSocket → events pushed on resource change
8. Deep-link resource endpoint → correct resource focused
9. Concurrent builds → no race conditions
10. Large cluster (2000 resources) → builds within performance budget

**Acceptance Criteria:**
- [ ] All 10 scenarios pass
- [ ] Tests run in < 60s total
- [ ] No flaky tests (run 5x to verify)

---

### TASK-079: Backend performance benchmark CI

**Points:** 2 | **Priority:** P0 | **Assignee:** Backend

Automated performance monitoring in CI.

**Benchmarks tracked:**

| Metric | Target | Fail Threshold |
|--------|--------|---------------|
| 100-resource build | < 500ms | 1s |
| 500-resource build | < 1.5s | 3s |
| 1000-resource build | < 3s | 5s |
| MatchAll (standard fixture) | < 100ms | 200ms |
| Cache hit latency | < 1ms | 5ms |
| ViewFilter resource-centric | < 50ms | 100ms |

**Acceptance Criteria:**
- [ ] Benchmarks run in CI on every PR
- [ ] PR blocked if any benchmark exceeds fail threshold
- [ ] Benchmark history tracked (detect gradual regression)
- [ ] Alert on > 20% regression from baseline

---

## Phase 7: Launch (Week 16)

### TASK-080: Feature flag flip to v2 default

**Points:** 2 | **Priority:** P0 | **Assignee:** Both

**Steps:**
1. Set `TOPOLOGY_V2_ENABLED=true` as default
2. Set `VITE_FEATURE_TOPOLOGY_V2=true` as default
3. v1 topology accessible via direct URL with deprecation banner
4. v1 code annotated with deprecation notice

**Acceptance Criteria:**
- [ ] v2 is the default topology experience
- [ ] v1 still accessible via `/topology?v=1` (deprecated)
- [ ] Deprecation banner on v1: "This version is deprecated. [Switch to v2]"
- [ ] Monitoring: error rates, latency, user metrics for v2

---

### TASK-081: Documentation

**Points:** 3 | **Priority:** P0 | **Assignee:** Both

**Documents to create/update:**
1. **OpenAPI spec** — v2 topology endpoints fully documented
2. **User guide** — "Using the Topology" with screenshots of all 5 view modes
3. **Keyboard shortcuts reference** — printable cheat sheet
4. **Contributor guide** — "Adding a new relationship matcher" step-by-step
5. **Architecture decision record** — Why React Flow, why ELK, why Zustand
6. **Performance tuning guide** — cache TTLs, API concurrency limits, graph size recommendations

**Acceptance Criteria:**
- [ ] All 6 documents written and reviewed
- [ ] User guide includes screenshots of all view modes
- [ ] Contributor guide tested by having someone add a mock matcher following only the guide
- [ ] OpenAPI spec validates with Swagger editor

---

### TASK-082: Monitoring and alerting

**Points:** 2 | **Priority:** P0 | **Assignee:** Backend

**Metrics to expose:**
- `topology_build_duration_seconds` (histogram, by mode)
- `topology_node_count` (gauge, by cluster)
- `topology_edge_count` (gauge, by cluster)
- `topology_cache_hit_ratio` (counter)
- `topology_ws_connections` (gauge)
- `topology_api_errors` (counter, by error type)
- `topology_k8s_api_calls` (counter, by resource type)
- `topology_k8s_api_latency` (histogram, by resource type)

**Alerts:**
- Topology build > 5s (P1)
- Cache hit ratio < 50% sustained 10min (P2)
- K8s API error rate > 10% (P1)
- WebSocket disconnects > 100/min (P1)

**Acceptance Criteria:**
- [ ] All metrics exposed via /metrics endpoint (Prometheus format)
- [ ] Grafana dashboard created with all metrics
- [ ] Alerts configured in monitoring system
- [ ] Runbook for each alert documenting diagnosis and remediation

---

## Grand Summary

| Phase | Task Range | Count | Points | Weeks |
|-------|-----------|-------|--------|-------|
| **Part 1: Backend** | | | | |
| Phase 0: Scaffolding | TASK-001 to TASK-005 | 5 | 10 | Week 1 |
| Phase 1: Relationship Engine | TASK-006 to TASK-019 | 14 | 51 | Weeks 2-4 |
| Phase 2: Graph Building & API | TASK-020 to TASK-028 | 9 | 29 | Weeks 4-6 |
| Phase 2.5: Performance | TASK-029 to TASK-032 | 4 | 9 | Weeks 6-7 |
| **Part 2: Frontend** | | | | |
| Phase 3A: Scaffolding | TASK-033 to TASK-035 | 3 | 6 | Weeks 2-3 |
| Phase 3B: Core Components | TASK-036 to TASK-042 | 7 | 21 | Weeks 3-5 |
| Phase 3C: Layout & Canvas | TASK-043 to TASK-048 | 6 | 27 | Weeks 5-7 |
| Phase 3D: Navigation & Interaction | TASK-049 to TASK-057 | 9 | 26 | Weeks 7-9 |
| Phase 3E: Accessibility & Animation | TASK-058 to TASK-060 | 3 | 11 | Weeks 9-10 |
| **Part 3: Export, Testing, Launch** | | | | |
| Phase 4: Export System | TASK-061 to TASK-065 | 5 | 11 | Weeks 10-11 |
| Phase 5: Dark Mode & Performance | TASK-066 to TASK-068 | 3 | 11 | Weeks 11-12 |
| Phase 6: Testing | TASK-069 to TASK-079 | 11 | 31 | Weeks 13-15 |
| Phase 7: Launch | TASK-080 to TASK-082 | 3 | 7 | Week 16 |
| **GRAND TOTAL** | **TASK-001 to TASK-082** | **82** | **~250** | **16 weeks** |

---

## Critical Path

```
                    BACKEND                              FRONTEND
                    ───────                              ────────
Week 1:     [Phase 0: Scaffolding]              [Phase 3A: Scaffolding]
                    │                                    │
Weeks 2-4:  [Phase 1: Relationship Engine]      [Phase 3B: Core Components]
                    │                                    │
Weeks 4-6:  [Phase 2: Graph Building & API]     [Phase 3C: Layout & Canvas]
                    │                                    │
Weeks 6-7:  [Phase 2.5: Performance]            [Phase 3D: Navigation]
                    │                                    │
                    └────────────── MERGE ───────────────┘
                                    │
Weeks 8-9:              [Phase 3E: Accessibility]
                                    │
Weeks 10-11:            [Phase 4: Exports]
                                    │
Weeks 11-12:            [Phase 5: Dark Mode + Perf]
                                    │
Weeks 13-15:            [Phase 6: Testing]
                                    │
Week 16:                [Phase 7: Launch]
```

**Backend and Frontend run in parallel through Week 7.** They merge when the frontend connects to the real API (replacing mock data). From Week 8 onward, both engineers work together on integration, testing, and polish.

---

## Definition of Done (Entire v2 Rewrite)

The topology v2 is shipped when ALL of the following are true:

- [ ] All 82 tasks completed and merged
- [ ] All 39 relationship types implemented with unit tests
- [ ] All 5 view modes working end-to-end
- [ ] Resource-Centric view for a Pod shows ALL 18+ connected resource types
- [ ] Every edge has a visible, readable label at 12px+
- [ ] No cut-off nodes at any zoom level
- [ ] No overlapping labels at any zoom level
- [ ] Scrolling reveals all resources (nothing hidden)
- [ ] "Go to Resource" navigation works between any two resources
- [ ] Detail popup shows resource-specific key fields for all resource types
- [ ] Deep-link URLs work for all view modes
- [ ] Search works by name, kind, namespace, label, status
- [ ] Deterministic layout: same data = same positions
- [ ] 60fps pan/zoom for 500-node graphs
- [ ] < 3s render for 1000-node graphs
- [ ] Dark mode meets WCAG AA
- [ ] All keyboard shortcuts functional
- [ ] Screen readers supported
- [ ] prefers-reduced-motion respected
- [ ] Export: PNG, SVG, JSON, DrawIO, PDF
- [ ] All Playwright E2E tests pass (incl. the critical Resource-Centric test)
- [ ] Visual regression baselines established
- [ ] Real-time WebSocket updates work
- [ ] Error states, loading states, empty states designed and implemented
- [ ] Monitoring and alerting in production
- [ ] Documentation complete
- [ ] Feature flag flipped to v2 as default
