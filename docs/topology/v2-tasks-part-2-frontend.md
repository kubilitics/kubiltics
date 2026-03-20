# TOPOLOGY v2.0 — Implementation Tasks Part 2: Frontend Visualization & Interaction

**Scope:** All frontend work — React Flow canvas, node/edge components, layout engine, state management, navigation
**Engineers:** 1-2 frontend engineers (React/TypeScript)
**Estimated Effort:** 28 tasks, ~115 story points
**Calendar Time:** Weeks 2-10 (parallel with backend Phase 1-2)
**Tech Stack:** React 18+, TypeScript, React Flow v12, ELK.js, Zustand, React Query, TailwindCSS

---

## Phase 3A: Frontend Scaffolding & Design System (Weeks 2-3)

### TASK-033: Create frontend v2 directory structure

**Points:** 2 | **Priority:** P0 | **Assignee:** Frontend

```
kubilitics-frontend/src/topology/
├── TopologyPage.tsx                  // Main page — layout container
├── TopologyCanvas.tsx                // React Flow canvas wrapper
├── TopologyToolbar.tsx               // View mode, filters, overlays, export
├── TopologyDetailPanel.tsx           // Right-side resource detail panel
├── TopologyBreadcrumbs.tsx           // Navigation breadcrumbs
├── TopologyMinimap.tsx               // Custom minimap overlay
├── TopologySearch.tsx                // Search/filter overlay
├── TopologyLoadingSkeleton.tsx       // Loading state (NOT a spinner)
├── TopologyErrorState.tsx            // Error states with retry
├── TopologyEmptyState.tsx            // Empty cluster/namespace state
│
├── nodes/
│   ├── BaseNode.tsx                  // Standard node (240x100+)
│   ├── CompactNode.tsx               // Compact for large graphs (160x48)
│   ├── ExpandedNode.tsx              // Focus node in Resource-Centric (320x180+)
│   ├── MinimalNode.tsx               // Colored rectangle at very low zoom
│   ├── GroupNode.tsx                 // Namespace/workload container
│   ├── SummaryNode.tsx               // Cluster view namespace summary
│   ├── nodeConfig.ts                 // Category colors, icons, sizes
│   └── nodeUtils.ts                  // Status helpers, label formatters
│
├── edges/
│   ├── LabeledEdge.tsx               // Custom edge with label pill
│   ├── AnimatedEdge.tsx              // Edge with traffic animation
│   ├── edgeConfig.ts                 // Styles by relationship type
│   └── edgeUtils.ts                  // Label positioning, anti-overlap
│
├── detail/
│   ├── DetailPanel.tsx               // Container for detail panels
│   ├── PodDetail.tsx                 // Pod-specific detail fields
│   ├── DeploymentDetail.tsx          // Deployment-specific fields
│   ├── ServiceDetail.tsx             // Service-specific fields
│   ├── ConfigMapDetail.tsx           // ConfigMap-specific fields
│   ├── SecretDetail.tsx              // Secret-specific fields
│   ├── NodeDetail.tsx                // Cluster Node-specific fields
│   ├── IngressDetail.tsx             // Ingress-specific fields
│   ├── PVCDetail.tsx                 // PVC-specific fields
│   ├── HPADetail.tsx                 // HPA-specific fields
│   ├── GenericDetail.tsx             // Fallback for other resource types
│   └── ConnectionTree.tsx            // Grouped connection list component
│
├── layout/
│   ├── elkLayout.ts                  // ELK layout adapter
│   ├── elkWorker.ts                  // Web Worker for layout computation
│   ├── layerAssignment.ts            // Semantic layer per resource kind
│   └── layoutConfig.ts              // ELK options per view mode
│
├── overlays/
│   ├── HealthOverlay.tsx             // Health coloring
│   ├── CostOverlay.tsx               // Cost badges
│   ├── TrafficOverlay.tsx            // Traffic animation
│   └── SecurityOverlay.tsx           // Security posture
│
├── export/
│   ├── exportPNG.ts
│   ├── exportSVG.ts
│   ├── exportJSON.ts
│   └── exportDrawIO.ts
│
├── store/
│   ├── topologyStore.ts              // Zustand store
│   └── topologyActions.ts            // Store actions
│
├── hooks/
│   ├── useTopologyData.ts            // Data fetching (React Query)
│   ├── useTopologyWebSocket.ts       // Real-time updates
│   ├── useTopologyLayout.ts          // Layout computation
│   ├── useTopologyKeyboard.ts        // Keyboard shortcuts
│   ├── useTopologyExport.ts          // Export functionality
│   ├── useTopologySearch.ts          // Search/filter logic
│   └── useTopologyNavigation.ts      // View mode navigation + URL sync
│
├── types/
│   ├── topology.ts                   // TypeScript interfaces matching API schema
│   ├── viewModes.ts                  // View mode enums and configs
│   └── relationships.ts              // Relationship type definitions
│
└── __tests__/
    ├── unit/
    │   ├── BaseNode.test.tsx
    │   ├── LabeledEdge.test.tsx
    │   ├── elkLayout.test.ts
    │   ├── topologyStore.test.ts
    │   ├── layerAssignment.test.ts
    │   └── edgeUtils.test.ts
    └── e2e/
        ├── topology-cluster-view.spec.ts
        ├── topology-namespace-view.spec.ts
        ├── topology-resource-centric.spec.ts
        ├── topology-interactions.spec.ts
        ├── topology-viewport.spec.ts
        ├── topology-navigation.spec.ts
        ├── topology-search.spec.ts
        └── topology-export.spec.ts
```

**Acceptance Criteria:**
- [ ] Directory structure matches above exactly
- [ ] `@xyflow/react` (React Flow v12), `elkjs`, `zustand`, `@tanstack/react-query` added to package.json
- [ ] All component files created with minimal placeholder exports
- [ ] TypeScript interfaces defined in `types/` matching the TopologyResponse API schema
- [ ] No existing code broken — clean build

---

### TASK-034: Add frontend feature flag and routing

**Points:** 1 | **Priority:** P0 | **Assignee:** Frontend

**Acceptance Criteria:**
- [ ] `VITE_FEATURE_TOPOLOGY_V2` environment variable
- [ ] When true: `/topology` routes to new `TopologyPage.tsx`
- [ ] When false: `/topology` routes to existing topology
- [ ] Deep-link URL patterns registered:
  - `/topology/:clusterId`
  - `/topology/:clusterId/namespace/:ns`
  - `/topology/:clusterId/workload/:kind/:ns/:name`
  - `/topology/:clusterId/resource/:kind/:ns/:name`
  - `/topology/:clusterId/rbac/:ns`
- [ ] URL params available to TopologyPage via route hooks
- [ ] No regression in existing topology

---

### TASK-035: Implement design system tokens and config

**Points:** 3 | **Priority:** P0 | **Assignee:** Frontend

Create the design system configuration that every component references.

**nodeConfig.ts — Category colors and icons:**
```typescript
export const categoryConfig = {
  workload: {
    headerBg: { light: '#2563EB', dark: '#3B82F6' },
    nodeBg: { light: '#EFF6FF', dark: '#1E3A5F' },
    borderColor: { light: '#BFDBFE', dark: '#1E40AF' },
  },
  networking: { headerBg: { light: '#7C3AED', dark: '#8B5CF6' }, ... },
  config: { headerBg: { light: '#0D9488', dark: '#14B8A6' }, ... },
  storage: { headerBg: { light: '#EA580C', dark: '#F97316' }, ... },
  rbac: { headerBg: { light: '#D97706', dark: '#F59E0B' }, ... },
  scaling: { headerBg: { light: '#16A34A', dark: '#22C55E' }, ... },
  cluster: { headerBg: { light: '#475569', dark: '#94A3B8' }, ... },
  extensions: { headerBg: { light: '#DB2777', dark: '#EC4899' }, ... },
};

export const healthColors = {
  healthy: '#16A34A',
  warning: '#EAB308',
  error: '#DC2626',
  unknown: '#9CA3AF',
};

export const resourceIcons: Record<string, LucideIcon> = {
  Pod: Box, Deployment: Layers, StatefulSet: Database,
  DaemonSet: Copy, ReplicaSet: CopyPlus, Job: Play,
  CronJob: Clock, Service: Globe, Ingress: ArrowRightCircle,
  Endpoints: Target, EndpointSlice: Split, ConfigMap: FileText,
  Secret: Key, Namespace: Folder, PVC: HardDrive,
  PV: Server, StorageClass: Archive, Node: Cpu,
  ServiceAccount: User, Role: Shield, ClusterRole: Shield,
  RoleBinding: Link, ClusterRoleBinding: Link,
  HPA: TrendingUp, PDB: ShieldCheck, NetworkPolicy: Lock,
  IngressClass: Settings, MutatingWebhook: Zap,
  ValidatingWebhook: CheckCircle,
};
```

**edgeConfig.ts — Edge styles by relationship category:**
```typescript
export const edgeStyles = {
  ownership: { color: { light: '#1E40AF', dark: '#60A5FA' }, style: 'solid', width: 2, arrow: 'filled-triangle' },
  selection: { color: { light: '#6D28D9', dark: '#A78BFA' }, style: 'dashed', width: 2, arrow: 'open-triangle' },
  mount: { color: { light: '#0F766E', dark: '#5EEAD4' }, style: 'dotted', width: 1.5, arrow: 'diamond' },
  routing: { color: { light: '#7C3AED', dark: '#8B5CF6' }, style: 'solid', width: 2.5, arrow: 'filled-triangle' },
  rbac: { color: { light: '#B45309', dark: '#FCD34D' }, style: 'dashed', width: 1.5, arrow: 'open-triangle' },
  scheduling: { color: { light: '#475569', dark: '#94A3B8' }, style: 'dotted', width: 1, arrow: 'circle' },
  scaling: { color: { light: '#15803D', dark: '#86EFAC' }, style: 'dashed', width: 1.5, arrow: 'double-triangle' },
  policy: { color: { light: '#B91C1C', dark: '#FCA5A5' }, style: 'dashed', width: 1.5, arrow: 'open-triangle' },
};
```

**Acceptance Criteria:**
- [ ] All 8 category color configs defined (light + dark)
- [ ] All 4 health status colors defined
- [ ] All resource icons mapped (30+ resource types)
- [ ] All 8 edge style configs defined (light + dark)
- [ ] Semantic layer assignments defined per resource kind
- [ ] Theme-aware: respects system dark/light mode
- [ ] All colors verified against WCAG AA (4.5:1 contrast minimum)

---

## Phase 3B: Core Components (Weeks 3-5)

### TASK-036: Implement BaseNode component

**Points:** 5 | **Priority:** P0 | **Assignee:** Frontend

The standard topology node component — the most important visual element.

**Structure (240px wide, 100px+ height):**
```
┌─ Health border (4px left)
│ ┌────────────────────────────────────┐
│ │ [Icon] ResourceKind          [●]  │ ← Header (28px, category color)
│ ├────────────────────────────────────┤
│ │ resource-name-here                 │ ← Name (14px, bold, truncate w/ tooltip)
│ │ namespace                          │ ← Namespace (12px, secondary color)
│ ├────────────────────────────────────┤
│ │ ● Running      Restarts: 0        │ ← Status + restart count
│ │ CPU: ████░░ 24%  Mem: ██████░ 50% │ ← Metric micro-bars
│ └────────────────────────────────────┘
```

**States:**
- Default: standard rendering
- Selected (isSelected): 2px blue ring, elevated shadow
- Dimmed (isDimmed): 30% opacity, no interaction
- Focused (keyboard Tab): 3px blue outline, 2px offset
- Hovered: subtle shadow increase, 0.5px border increase (100ms)
- Error health: subtle red pulse animation (2s loop, 5% opacity)

**Acceptance Criteria:**
- [ ] Matches design system specification pixel-perfectly
- [ ] All 8 category header colors correct
- [ ] All 4 health status left borders correct (green/yellow/red/gray)
- [ ] Health status uses color + shape + text (never color alone)
- [ ] Name truncated with tooltip for long names (>25 chars)
- [ ] Metric bars show correct percentages
- [ ] Restart count shown in red when > 0
- [ ] Dark mode: correct colors per design system color mapping
- [ ] isDimmed: 30% opacity
- [ ] isSelected: 2px blue ring, shadow elevation
- [ ] Hover: shadow increase (100ms transition)
- [ ] Error pulse: subtle opacity animation, respects prefers-reduced-motion
- [ ] React Flow Handles: top, bottom, left, right for edge connections
- [ ] Accessible: aria-label with kind, name, namespace, status, metrics
- [ ] Memoized (React.memo) to prevent unnecessary re-renders

---

### TASK-037: Implement CompactNode component

**Points:** 2 | **Priority:** P0 | **Assignee:** Frontend

Used when nodeCount > 200 or zoom < 0.6x.

**Structure (160px wide, 48px height):**
```
┌─ Health (3px left)
│ ┌───────────────────────────┐
│ │ [Icon] resource-name [●]  │ ← Single line, 12px, ellipsis
│ │ Kind • namespace          │ ← Sub-line, 10px, secondary
│ └───────────────────────────┘
```

**Acceptance Criteria:**
- [ ] 160x48px size, 6px border radius
- [ ] Single line with icon + name + health dot
- [ ] Sub-line with kind + namespace
- [ ] Ellipsis overflow for names > 15 chars
- [ ] Same selection/dimming/focus states as BaseNode
- [ ] Smooth transition when switching from BaseNode (no flicker)

---

### TASK-038: Implement ExpandedNode component

**Points:** 3 | **Priority:** P0 | **Assignee:** Frontend

Focus node in Resource-Centric mode.

**Structure (320px wide, 180px+ height):**
```
┌─ Health (6px left)
│ ┌──────────────────────────────────────────┐
│ │ [Icon] ResourceKind                 [●]  │ ← Header (32px)
│ ├──────────────────────────────────────────┤
│ │ resource-name-here                       │ ← Name (16px, bold)
│ │ namespace                                │ ← Namespace (13px)
│ ├──────────────────────────────────────────┤
│ │ Status: ● Running     Age: 3d 14h       │
│ │ IP: 10.244.1.45       Node: ip-10-0-1-11│
│ ├──────────────────────────────────────────┤
│ │ CPU:    ████████░░  120m / 500m (24%)    │ ← Progress bar
│ │ Memory: ██████████░ 256Mi / 512Mi (50%)  │ ← Progress bar
│ ├──────────────────────────────────────────┤
│ │ Labels: [app=payment] [version=v2]       │ ← Label chips
│ │ Connections: 14 resources                │
│ └──────────────────────────────────────────┘
```

**Acceptance Criteria:**
- [ ] 320px wide, 2px primary border, elevated shadow
- [ ] Progress bars with correct fill percentages and colors
- [ ] Label chips as rounded pills
- [ ] Connection count badge
- [ ] All states (selected, dimmed, focused) work

---

### TASK-039: Implement GroupNode component

**Points:** 3 | **Priority:** P0 | **Assignee:** Frontend

Namespace/workload group container for compound graph rendering.

**Acceptance Criteria:**
- [ ] Dashed border (1.5px), category-tinted semi-transparent background
- [ ] Header with: icon, group name, resource count badge, health dot
- [ ] Collapsible: click header to collapse (smooth 300ms animation)
- [ ] When collapsed: shows summary badge only (icon + name + count)
- [ ] Children laid out inside group bounds by ELK
- [ ] Group health = aggregate of children (>90% healthy = green, etc.)
- [ ] Dark mode colors correct

---

### TASK-040: Implement MinimalNode component

**Points:** 1 | **Priority:** P1 | **Assignee:** Frontend

Used at zoom < 0.3x. Maximum performance, minimum DOM.

**Structure:** Colored rectangle (16x10px) with no text, no border details. Just category color + health color as a thin border.

**Acceptance Criteria:**
- [ ] Renders as simple `<div>` with background color
- [ ] No text, no icons, no React component overhead
- [ ] Category color as background
- [ ] Health color as 2px border
- [ ] Smooth transition from CompactNode when zooming out

---

### TASK-041: Implement LabeledEdge component

**Points:** 5 | **Priority:** P0 | **Assignee:** Frontend

Custom edge with midpoint label pill. The most complex rendering component.

**Edge rendering:**
- SVG `<path>` with configurable style (solid, dashed `8 4`, dotted `3 3`)
- Color by relationship category (8 categories)
- Width by category (1px to 2.5px)
- Arrow markers: filled triangle, open triangle, diamond, circle, double triangle

**Label rendering:**
- Positioned at edge midpoint using React Flow's EdgeLabelRenderer
- White/dark background pill with 4px padding, 4px border-radius
- Font: 12px (NOT 10px — resolved from PRD contradiction)
- Max width: 180px with ellipsis truncation
- Full text in tooltip on hover
- Z-index: above edges, below nodes

**Anti-overlap algorithm:**
1. Calculate label positions at midpoints
2. Detect overlapping bounding boxes (5px margin)
3. Shift along edge path (up to 30% of edge length)
4. If still overlapping: stack vertically with 6px gap
5. If > 3 would stack: show labels on hover only (dot indicator visible)
6. NEVER collapse to opaque "[3 connections]" badge

**States:**
- Default: 70% opacity
- Hover: 100% opacity, width +1px, source/target nodes glow, other edges dim to 30%
- Selected: primary color, width +2px, full label visible
- Unhealthy: red color, dashed regardless of category

**Acceptance Criteria:**
- [ ] All 8 edge styles render correctly (color, dash pattern, width)
- [ ] All 5 arrow marker types render
- [ ] Label pill at midpoint with correct styling
- [ ] Truncation at 180px with tooltip
- [ ] Anti-overlap works for 3+ close labels
- [ ] Hover: width increase, glow on connected nodes, dim others
- [ ] Selected: primary color, full label
- [ ] Unhealthy: red override
- [ ] Dark mode: all colors per design system mapping
- [ ] Edge accessible: aria-label with relationship description
- [ ] Labels at 12px font size (WCAG compliant)

---

### TASK-042: Implement SummaryNode for Cluster View

**Points:** 2 | **Priority:** P1 | **Assignee:** Frontend

Namespace summary node for the Cluster Overview mode.

**Structure (220px wide, 120px height):**
```
┌──────────────────────────────────┐
│ [📁] production             [●]  │
├──────────────────────────────────┤
│ Deployments: 5    Pods: 15       │
│ Services: 5       Jobs: 2        │
├──────────────────────────────────┤
│ ● 14 healthy  ▲ 1 warning       │
│ Cost: $142.50/mo                 │
└──────────────────────────────────┘
```

**Acceptance Criteria:**
- [ ] Shows aggregated counts per resource type
- [ ] Health summary with colored dot counts
- [ ] Optional cost badge
- [ ] Click → navigate to Namespace View

---

## Phase 3C: Layout Engine & Canvas (Weeks 5-7)

### TASK-043: Implement ELK layout engine in Web Worker

**Points:** 8 | **Priority:** P0 | **Assignee:** Frontend

This is the most technically complex frontend task. ELK layout runs in a Web Worker to never block the main thread.

**elkWorker.ts implementation:**
- Import `elkjs/lib/elk.bundled`
- Receive: nodes (with dimensions), edges, groups, viewMode, direction
- Convert to ELK graph format with compound nodes (groups as parents)
- Configure ELK per view mode
- Run layout
- Convert positions back to React Flow format
- Post positions back to main thread

**ELK configuration per view mode:**

| View Mode | Direction | Node Spacing | Layer Spacing | Edge Routing |
|-----------|-----------|-------------|--------------|-------------|
| Cluster | DOWN | 60px | 100px | ORTHOGONAL |
| Namespace | RIGHT | 40px | 80px | ORTHOGONAL |
| Workload | DOWN | 40px | 80px | ORTHOGONAL |
| Resource-Centric | DOWN | 50px | 90px | ORTHOGONAL |
| RBAC | RIGHT | 40px | 80px | ORTHOGONAL |

**Semantic layer assignment (layerAssignment.ts):**

| Layer | Resources |
|-------|-----------|
| 0 — Entry | Ingress, IngressClass |
| 1 — Routing | Service, Endpoints, EndpointSlice |
| 2 — Orchestration | Deployment, StatefulSet, DaemonSet, CronJob |
| 3 — Replication | ReplicaSet, Job |
| 4 — Execution | Pod |
| 5 — Infrastructure | Node, PriorityClass, RuntimeClass |
| Sidebar Left | ConfigMap, Secret |
| Sidebar Right | PVC, PV, StorageClass |
| Below | ServiceAccount, RoleBinding, Role, ClusterRoleBinding, ClusterRole |
| Below | HPA, VPA, PDB, NetworkPolicy |

**Acceptance Criteria:**
- [ ] Layout runs entirely in Web Worker (verify: no main thread blocking via Performance API)
- [ ] Same input produces same output every time (seed=42)
- [ ] Layout direction correct per view mode
- [ ] Groups respected as compound nodes (children inside parent bounds)
- [ ] Layer assignments applied (resource types in correct vertical positions)
- [ ] Sidebar resources placed to sides (not inline with main hierarchy)
- [ ] Performance: < 500ms for 100 nodes, < 1.5s for 500 nodes, < 3s for 1000 nodes
- [ ] Layout positions correctly converted to React Flow format
- [ ] Error handling: layout failure → fallback to simple grid layout
- [ ] Progress reporting for large graphs (postMessage with percentage)

---

### TASK-044: Implement TopologyCanvas (React Flow integration)

**Points:** 5 | **Priority:** P0 | **Assignee:** Frontend

The main canvas wrapping React Flow with all custom configuration.

**Configuration:**
```tsx
<ReactFlow
  nodes={nodes}
  edges={edges}
  nodeTypes={{ base: BaseNode, compact: CompactNode, expanded: ExpandedNode,
               minimal: MinimalNode, group: GroupNode, summary: SummaryNode }}
  edgeTypes={{ labeled: LabeledEdge, animated: AnimatedEdge }}
  onlyRenderVisibleElements={true}
  elevateEdgesOnSelect={true}
  maxZoom={4}
  minZoom={0.1}
  fitView
  fitViewOptions={{ padding: 0.1 }}
  connectionMode="loose"
  // Event handlers
  onNodeClick={handleNodeClick}
  onNodeDoubleClick={handleNodeDoubleClick}
  onEdgeClick={handleEdgeClick}
  onPaneClick={handlePaneClick}
>
  <Background variant="dots" gap={20} />
  <MiniMap pannable zoomable position="bottom-right" />
  <Controls position="bottom-left" />
</ReactFlow>
```

**Viewport behavior:**
- Pan: mouse drag on empty canvas (cursor: grab → grabbing)
- Zoom: scroll wheel centered on cursor, pinch on touch
- Fit-to-screen: `F` key or toolbar button, 300ms animation with 40px padding
- No cut-off: pan limits 500px beyond content in all directions
- Smooth zoom transitions: 200ms ease-out

**Selection behavior:**
- Click node → select, highlight connected edges/nodes, dim unconnected to 30%
- Click edge → select, show detail
- Click empty space → deselect all
- Double-click node → navigate to Resource-Centric view for that resource

**Acceptance Criteria:**
- [ ] React Flow renders with all custom node/edge types
- [ ] Pan works (mouse drag on canvas)
- [ ] Zoom works (scroll wheel, pinch, +/- buttons)
- [ ] Fit-to-screen works (F key, button) — all nodes visible with padding
- [ ] Minimap visible at bottom-right, draggable viewport indicator
- [ ] Background grid dots visible at zoom > 0.5x
- [ ] Node selection: click → highlight connected, dim unconnected (30%)
- [ ] Double-click → Resource-Centric navigation
- [ ] Click empty space → deselect
- [ ] NO cut-off nodes at any zoom level
- [ ] Smooth zoom transitions (200ms)
- [ ] Dark mode: canvas bg #0F172A, grid dots #334155

---

### TASK-045: Implement semantic zoom behavior

**Points:** 3 | **Priority:** P0 | **Assignee:** Frontend

Dynamically switch node types based on zoom level for performance.

**Zoom levels:**
| Zoom | Node Type | Edge Labels | Grid |
|------|-----------|-------------|------|
| < 0.3x | MinimalNode | Hidden | Hidden |
| 0.3x - 0.6x | CompactNode | Hidden | Hidden |
| 0.6x - 1.5x | BaseNode | Visible | Visible |
| > 1.5x | BaseNode (detailed) | Full detail | Visible |

**In Resource-Centric mode:**
- Focus node always uses ExpandedNode regardless of zoom
- Connected nodes use BaseNode down to 0.4x zoom

**Transition behavior:**
- Node type switches on zoom change (debounced at 100ms)
- No flicker during transition (opacity crossfade 150ms)
- React Flow handles virtualization (only visible nodes in DOM)

**Acceptance Criteria:**
- [ ] Correct node type at each zoom level
- [ ] No flicker during transitions
- [ ] Edge labels hidden below 0.4x zoom
- [ ] Focus node in Resource-Centric always expanded
- [ ] DOM node count stays manageable (< 500 even for 2000-node graph)
- [ ] prefers-reduced-motion: instant transitions, no crossfade

---

### TASK-046: Implement topologyStore (Zustand)

**Points:** 3 | **Priority:** P0 | **Assignee:** Frontend

Central state management for the entire topology.

**State shape:**
```typescript
interface TopologyState {
  // Data
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  groups: TopologyGroup[];
  metadata: TopologyMetadata | null;

  // View
  viewMode: ViewMode;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  focusResourceId: string | null;

  // Navigation
  breadcrumbs: BreadcrumbItem[];
  navigationStack: NavigationEntry[];

  // Filters
  namespaceFilter: string | null;
  kindFilter: string[];
  statusFilter: string[];
  searchQuery: string;

  // Overlays
  healthOverlay: boolean;    // default: true
  costOverlay: boolean;      // default: false
  trafficOverlay: boolean;   // default: false
  securityOverlay: boolean;  // default: false

  // Viewport
  zoom: number;
  position: { x: number; y: number };

  // Loading
  isLoading: boolean;
  error: string | null;
  warnings: string[];        // partial load warnings

  // WebSocket
  wsConnected: boolean;
  lastUpdateTime: string | null;
}
```

**Actions:**
- `setViewMode(mode, params?)` — change view, trigger data fetch
- `selectNode(id)` — select, compute dimmed nodes, open detail panel
- `deselectAll()` — clear selection, restore opacity
- `navigateToResource(kind, ns, name)` — "Go to Resource" navigation
- `navigateBack()` — pop navigation stack
- `addNode(node)` — incremental update from WebSocket
- `updateNode(node)` — update in place (no layout change)
- `removeNode(id)` — remove + trigger partial layout
- `setSearch(query)` — filter visible nodes
- `toggleOverlay(name)` — toggle health/cost/traffic/security

**Derived state:**
- `dimmedNodeIds` — computed from selection (all nodes not connected to selected)
- `visibleNodes` — computed from filters (kind, status, search)
- `connectionCount` — for selected node

**Acceptance Criteria:**
- [ ] All state fields typed correctly
- [ ] All actions implemented and tested
- [ ] Derived state recomputes correctly on dependency changes
- [ ] viewMode and overlay preferences persisted to localStorage
- [ ] Navigation stack supports back/forward
- [ ] Search filters nodes in real-time (debounced 200ms)

---

### TASK-047: Implement useTopologyData hook (React Query)

**Points:** 3 | **Priority:** P0 | **Assignee:** Frontend

Data fetching with React Query for caching, refetching, and stale-while-revalidate.

**Query key:** `['topology', clusterId, viewMode, namespace, resource, depth]`

**Behavior:**
- Fetch on mount and on parameter change
- Stale time: 10s (allows fast tab switching)
- Refetch on window focus (configurable)
- Loading state → TopologyLoadingSkeleton
- Error state → TopologyErrorState with retry button
- On success: update topologyStore, trigger layout computation

**Acceptance Criteria:**
- [ ] Fetches from `/api/v1/clusters/{id}/topology/v2` with correct params
- [ ] Loading shows skeleton (NOT a spinner)
- [ ] Error shows retry button with error message
- [ ] Stale-while-revalidate for smooth view mode transitions
- [ ] Refetches on window focus
- [ ] Query cancellation on parameter change (prevents stale data)

---

### TASK-048: Implement useTopologyWebSocket hook

**Points:** 5 | **Priority:** P0 | **Assignee:** Frontend

Real-time topology updates with auto-reconnect.

**Behavior:**
- Connect to `/api/v1/ws/topology/{clusterId}/v2`
- On `node_added`: add to store, trigger partial layout for neighborhood
- On `node_updated`: update in store (no layout), flash blue border 400ms
- On `node_removed`: remove from store, trigger partial layout
- On `edge_added`/`edge_removed`: update edges (no layout)
- On disconnect: show orange banner, reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s)
- Events batched in 100ms window

**Acceptance Criteria:**
- [ ] WebSocket connects and receives events
- [ ] node_added → new node appears with fade-in animation
- [ ] node_updated → in-place update, 400ms blue flash
- [ ] node_removed → fade-out animation, partial re-layout
- [ ] Reconnect on disconnect with exponential backoff
- [ ] Orange banner shown during disconnect: "Live updates paused. Reconnecting..."
- [ ] Event batching (100ms) prevents render flooding
- [ ] Flash animation respects prefers-reduced-motion

---

## Phase 3D: Navigation & Interaction (Weeks 7-8)

### TASK-049: Implement view mode navigation flow

**Points:** 5 | **Priority:** P0 | **Assignee:** Frontend

The complete navigation system: progressive disclosure with breadcrumbs and URL sync.

**Navigation flow:**
```
Cluster View → click namespace → Namespace View
  → click workload → Workload View
    → double-click any node → Resource-Centric View
      → click connection in detail panel → navigate to that resource

Any view → "Go to Resource" in detail panel → Resource-Centric for that resource
```

**Breadcrumb behavior:**
- Format: `Cluster > production > payment-api (Deployment) > payment-api-xyz (Pod)`
- Each segment clickable → navigates to that level
- Current level is bold, non-clickable
- Overflow: if > 4 segments, first segments collapse to "..." with tooltip

**URL sync:**
- Every navigation updates the URL
- Browser back/forward works correctly
- URLs are bookmarkable and shareable
- Deep links from external sources (PagerDuty, Slack) work on first load

**Acceptance Criteria:**
- [ ] Cluster → Namespace navigation on click
- [ ] Namespace → Workload navigation on click
- [ ] Any node → Resource-Centric on double-click
- [ ] "Go to Resource" in detail panel navigates correctly
- [ ] Breadcrumbs update at every level
- [ ] Each breadcrumb segment clickable
- [ ] Escape key navigates back one level
- [ ] Browser back/forward works
- [ ] URL updates with every navigation (bookmarkable)
- [ ] Deep-link URL loads correct view on fresh page load
- [ ] View mode transitions animate (500ms layout morph, respects reduced-motion)

---

### TASK-050: Implement TopologyDetailPanel with resource-specific views

**Points:** 5 | **Priority:** P0 | **Assignee:** Frontend

Right-side panel showing resource details and connection tree.

**Panel behavior:**
- Slides in from right on node selection (250ms ease-out)
- Width: 380px (desktop), full-screen bottom sheet (mobile)
- Closes on: click X, press Escape, click empty canvas
- Scroll independently from canvas

**Resource-specific detail views (see PRD Section 6):**
- PodDetail: status, containers, images, restarts, CPU/memory bars, IP, node
- DeploymentDetail: replicas, strategy, selector, revision history
- ServiceDetail: type, ClusterIP, ports, endpoint count
- ConfigMapDetail: data keys, size, mounted by
- SecretDetail: data keys (NOT values), type, mounted by
- NodeDetail: conditions, capacity, allocatable, pod count, kubelet version
- IngressDetail: rules list, TLS, IngressClass, LB IPs
- HPADetail: current/min/max replicas, metrics, last scale time
- PVCDetail: status, capacity, access modes, storage class
- GenericDetail: labels, annotations, age, raw metadata

**Connection Tree (grouped by category):**
- Categories: Ownership, Networking, Configuration, Storage, Identity, Scheduling, Scaling, Disruption
- Each category collapsible (default: expanded)
- Each connection clickable → selects and centers on that node
- Connection count in category header

**Action buttons:**
- "Go to Resource" → Resource-Centric view for selected resource
- "View YAML" → opens YAML viewer
- "View Logs" → opens log viewer (pods only)
- "Copy Name" → copies `kind/namespace/name` to clipboard
- "Investigate with AI" → opens AI assistant with resource context

**Acceptance Criteria:**
- [ ] Panel slides in 250ms, slides out 200ms
- [ ] Resource-specific detail views for: Pod, Deployment, Service, ConfigMap, Secret, Node, Ingress, HPA, PVC
- [ ] GenericDetail fallback for all other resource types
- [ ] Connection tree grouped by category with counts
- [ ] Each connection clickable → navigates to that node
- [ ] "Go to Resource" triggers Resource-Centric navigation
- [ ] "View YAML" opens YAML viewer
- [ ] "View Logs" works for pods
- [ ] "Copy Name" copies to clipboard with visual confirmation
- [ ] Panel scrollable when content exceeds height
- [ ] Escape closes panel
- [ ] Mobile: full-screen bottom sheet (swipe up/down)

---

### TASK-051: Implement TopologyToolbar

**Points:** 3 | **Priority:** P0 | **Assignee:** Frontend

Top toolbar with all controls.

**Layout:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│ [🔍 Search...]  │ View: [Cluster ▾]  │ Layout: [↓ Down ▾] │ Overlays: │
│                  │ Namespace: [All ▾] │                      │ [●Health] │
│                  │                     │                      │ [○Cost]   │
│─── Left ─────────┤─── Center ──────────┤─── Right ────────────┤──────────│
│ [⊞ Fit] [+ −]   │ Breadcrumbs         │ [📷 Export ▾]        │ [⚙ Opts]│
│ [📐 Minimap]     │ cluster > ns > dep  │ [PNG][SVG][JSON]     │ [? Help] │
└─────────────────────────────────────────────────────────────────────────┘
```

**Acceptance Criteria:**
- [ ] View mode dropdown: Cluster, Namespace, Workload, Resource, RBAC
- [ ] Namespace selector populated from API
- [ ] Layout direction toggle (Down/Right)
- [ ] Overlay toggles: Health (default on), Cost, Traffic, Security
- [ ] Zoom: Fit button, +/- buttons
- [ ] Minimap toggle
- [ ] Export dropdown: PNG, SVG, JSON, DrawIO
- [ ] Search button (opens search overlay)
- [ ] Help button (shows keyboard shortcuts overlay)
- [ ] Responsive: collapses to hamburger on mobile

---

### TASK-052: Implement TopologySearch

**Points:** 3 | **Priority:** P0 | **Assignee:** Frontend

Search overlay for finding and filtering resources.

**Search syntax:**
- Plain text: fuzzy match on resource name
- `kind:Pod` — filter by resource kind
- `ns:production` — filter by namespace
- `label:app=payment` — filter by label
- `status:error` — filter by health status
- Combinable: `kind:Pod status:error ns:production`

**Behavior:**
- Opens with `/` key or toolbar search button
- Results appear in dropdown as you type (debounced 200ms)
- Each result: kind icon + name + namespace + status badge
- Click result → select and center viewport on that node
- Non-matching nodes dim to 10% opacity
- Escape or clear → restore all nodes
- Persistent filter mode: results stay filtered until cleared

**Acceptance Criteria:**
- [ ] Opens with `/` key
- [ ] Fuzzy name search works
- [ ] kind:, ns:, label:, status: prefix filters work
- [ ] Combined filters with AND logic
- [ ] Dropdown results with icon, name, namespace, status
- [ ] Click result → center viewport on node
- [ ] Non-matching dim to 10%
- [ ] Escape clears search
- [ ] 200ms debounce on input

---

### TASK-053: Implement keyboard shortcuts

**Points:** 2 | **Priority:** P0 | **Assignee:** Frontend

All keyboard shortcuts per PRD Section 8.2.

**Acceptance Criteria:**
- [ ] F = fit to screen
- [ ] 1 = Cluster view, 2 = Namespace, 3 = Workload, 4 = Resource, 5 = RBAC
- [ ] +/- = zoom in/out
- [ ] Escape = back/deselect/close panel
- [ ] Tab/Shift+Tab = cycle through nodes (left-to-right, top-to-bottom)
- [ ] / = open search
- [ ] E = toggle edge labels
- [ ] M = toggle minimap
- [ ] H = toggle health overlay
- [ ] C = toggle cost overlay
- [ ] S = export screenshot (PNG to clipboard)
- [ ] ? = show shortcuts overlay
- [ ] Shortcuts only active when topology canvas is focused (not in search input)
- [ ] Shortcuts overlay as modal listing all shortcuts

---

### TASK-054: Implement TopologyLoadingSkeleton

**Points:** 2 | **Priority:** P1 | **Assignee:** Frontend

Loading state that feels intentional, not lazy.

**Design:**
- Gray placeholder rectangles in expected node positions (matching view mode layout)
- Rectangles have subtle pulse animation (1.5s loop, 60%→100% opacity)
- Edge placeholders as thin gray lines between rectangles
- Toolbar is interactive during loading (can switch view modes)
- Text: "Building topology..." at bottom-left

**For large graphs (>500 nodes):**
- Progress indicator: "Computing layout... 67%"
- Skeleton evolves as data loads (nodes appear before layout completes)

**Acceptance Criteria:**
- [ ] Skeleton matches expected layout (not random placement)
- [ ] Pulse animation (respects prefers-reduced-motion)
- [ ] View mode specific (different skeleton for cluster vs namespace)
- [ ] Progress percentage for large graphs
- [ ] Smooth transition from skeleton to real topology (300ms crossfade)

---

### TASK-055: Implement error and empty states

**Points:** 2 | **Priority:** P1 | **Assignee:** Frontend

**Error state:**
- Full API failure: centered message with retry button, last successful time
- Partial failure: orange banner at top: "Unable to load Secrets — some connections may be missing. [Retry] [Dismiss]"
- WebSocket disconnect: subtle orange bottom banner: "Live updates paused. Reconnecting... (5s)"

**Empty state:**
- Empty cluster: illustration + "No resources found in this cluster"
- Empty namespace: "No workloads in the production namespace"
- No search results: "No resources match your search"

**Acceptance Criteria:**
- [ ] Full error: centered with retry
- [ ] Partial error: banner with specifics
- [ ] WebSocket disconnect: bottom banner with countdown
- [ ] Empty states: helpful message, not blank canvas
- [ ] All states match design system colors/typography

---

### TASK-056: Implement health overlay

**Points:** 2 | **Priority:** P0 | **Assignee:** Frontend

**Acceptance Criteria:**
- [ ] Node left border + background tint colored by health
- [ ] Error nodes: subtle red pulse (2s, 5% opacity, respects reduced-motion)
- [ ] Edges to unhealthy nodes: red color override
- [ ] Group health: aggregate badge (green/yellow/red)
- [ ] Toggle via toolbar or H key

---

### TASK-057: Implement cost overlay

**Points:** 2 | **Priority:** P2 | **Assignee:** Frontend

**Acceptance Criteria:**
- [ ] Cost badge on workload nodes: "$12.40/mo"
- [ ] Namespace groups show total cost
- [ ] Optional: node size scaled by relative cost
- [ ] Toggle via toolbar or C key

---

## Phase 3E: Accessibility & Animation (Weeks 8-9)

### TASK-058: Implement full accessibility support

**Points:** 5 | **Priority:** P0 | **Assignee:** Frontend

**Keyboard navigation:**
- Tab cycles through nodes (layout order: left-to-right, top-to-bottom per layer)
- Focus ring: 3px solid #2563EB, 2px offset, clearly visible on all backgrounds
- Enter on focused node = select (opens detail panel)
- Escape = deselect / close panel / navigate back
- Space on group = toggle expand/collapse
- Arrow keys = pan canvas (50px per press, 200px with Shift)

**Screen readers:**
- Every node: `aria-label` = "Pod payment-api in namespace production, status Running, CPU 24%"
- Every edge: `aria-label` = "Pod payment-api owned by ReplicaSet payment-api-7d8b9c"
- Groups: `role="group"`, `aria-label` = "Namespace production, 14 pods, healthy"
- View mode changes: aria-live announcement
- Detail panel: proper heading hierarchy, focus trap when open

**Reduced motion:**
- All animations disabled when `prefers-reduced-motion: reduce`
- Layout transitions: instant (no morph animation)
- No pulse animations, no flash effects
- Zoom: instant (no smooth transition)

**Acceptance Criteria:**
- [ ] Tab cycle through all nodes in correct order
- [ ] Focus ring visible on all backgrounds (light + dark)
- [ ] Enter/Escape/Space keyboard actions work
- [ ] All nodes have descriptive aria-labels
- [ ] All edges have descriptive aria-labels
- [ ] Groups have role=group with aria-labels
- [ ] View mode changes announced via aria-live
- [ ] Detail panel has focus trap and proper heading hierarchy
- [ ] prefers-reduced-motion disables all animations
- [ ] High contrast mode doesn't break layout
- [ ] VoiceOver/NVDA tested and functional

---

### TASK-059: Implement animation system

**Points:** 3 | **Priority:** P1 | **Assignee:** Frontend

**Animation timings (from design system):**

| Action | Duration | Easing |
|--------|----------|--------|
| Node appear | 300ms | ease-out |
| Node remove | 200ms | ease-in |
| Node health change | 500ms | ease-in-out |
| Edge appear | 300ms | ease-out (path draw) |
| Group expand | 400ms | ease-in-out |
| Group collapse | 300ms | ease-in-out |
| View mode change | 500ms | ease-in-out (layout morph) |
| Zoom to fit | 300ms | ease-in-out |
| Detail panel open | 250ms | ease-out |
| Detail panel close | 200ms | ease-in |
| Selection dim | 200ms | ease-out |
| Node hover | 100ms | ease-out |
| Edge hover | 150ms | ease-out |
| Health pulse | 2s loop | ease-in-out (5% opacity) |
| WebSocket update flash | 400ms | ease-out (blue border) |

**Acceptance Criteria:**
- [ ] All animations match timing table
- [ ] Layout morph: nodes animate from old to new positions on view change
- [ ] Node appear/disappear: scale + opacity
- [ ] All animations use CSS transitions or requestAnimationFrame (not setTimeout)
- [ ] All animations disabled when prefers-reduced-motion
- [ ] No jank during animations (60fps)

---

### TASK-060: Implement responsive layout

**Points:** 3 | **Priority:** P1 | **Assignee:** Frontend

| Screen Width | Layout |
|-------------|--------|
| > 1440px | Topology + detail panel side by side |
| 1024-1440px | Topology full width, detail panel as overlay drawer |
| 768-1024px | Compact nodes default, detail as bottom sheet |
| < 768px | Simplified, tap-to-expand, full-screen detail |

**Mobile adaptations:**
- Nodes use CompactNode by default
- Edge labels hidden (shown on edge tap)
- Minimap hidden (full-screen fit button instead)
- Toolbar as hamburger menu
- Detail panel as full-screen bottom sheet (swipe gesture)
- Double-tap to zoom, pinch to zoom
- Long-press for context menu

**Acceptance Criteria:**
- [ ] All 4 breakpoints implemented correctly
- [ ] Detail panel transitions between sidebar, drawer, bottom sheet
- [ ] Mobile: compact nodes, hidden edge labels, hamburger toolbar
- [ ] Touch gestures work (pinch zoom, pan, tap, long-press)
- [ ] No horizontal scroll at any breakpoint
- [ ] Tested on: Chrome, Firefox, Safari, Mobile Safari, Chrome Android

---

## Summary

| Phase | Task Range | Count | Points | Weeks |
|-------|-----------|-------|--------|-------|
| Phase 3A: Scaffolding | TASK-033 to TASK-035 | 3 | 6 | Weeks 2-3 |
| Phase 3B: Core Components | TASK-036 to TASK-042 | 7 | 21 | Weeks 3-5 |
| Phase 3C: Layout & Canvas | TASK-043 to TASK-048 | 6 | 27 | Weeks 5-7 |
| Phase 3D: Navigation & Interaction | TASK-049 to TASK-057 | 9 | 26 | Weeks 7-8 |
| Phase 3E: Accessibility & Animation | TASK-058 to TASK-060 | 3 | 11 | Weeks 8-9 |
| **Frontend Total** | **TASK-033 to TASK-060** | **28** | **~91** | **8 weeks** |
