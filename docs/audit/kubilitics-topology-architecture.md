# Kubilitics OS — Topology Engine Architecture Deep Dive

**Version:** 1.0
**Date:** 2026-03-16
**Scope:** Complete analysis of the topology visualization system across backend and frontend

---

## Executive Summary

The Kubilitics topology engine is the platform's **primary technical differentiator**. It builds a deterministic relationship graph across 30+ Kubernetes resource types using 12 inference methods, renders it via React Flow with semantic zoom (4 detail levels), and supports 5 view modes. The architecture is well-designed with clear separation between data fetching, relationship inference, layout computation, and rendering.

**Topology Engine Score: 8/10** — Best-in-class for Kubernetes visualization; gaps in historical comparison, cross-cluster topology, and performance at scale.

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                         │
│                                                                │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│  │ TopologyPage │  │ TopologyCanvas│  │ TopologyDetailPanel │  │
│  │ (838 lines) │──│ (React Flow) │──│ (right-side drawer) │  │
│  │ Orchestrator│  │ + Semantic   │  │ Resource metadata,  │  │
│  │             │  │   Zoom       │  │ events, logs        │  │
│  └──────┬──────┘  └──────┬───────┘  └─────────────────────┘  │
│         │                │                                     │
│  ┌──────┴──────┐  ┌──────┴───────┐  ┌─────────────────────┐  │
│  │ useTopology │  │ useElkLayout │  │ Node Components     │  │
│  │ Data        │  │ (ELK.js)    │  │ Base/Compact/       │  │
│  │ + Filtering │  │ Hierarchical │  │ Minimal/Expanded/   │  │
│  │ + View Mode │  │ Layout       │  │ Group/Summary       │  │
│  └──────┬──────┘  └──────────────┘  └─────────────────────┘  │
│         │                                                      │
├─────────┼──────────────────────────────────────────────────────┤
│         │            NETWORK LAYER                              │
│  ┌──────┴──────┐  ┌──────────────┐                             │
│  │ REST API    │  │ WebSocket    │                             │
│  │ GET topology│  │ Real-time    │                             │
│  │             │  │ updates      │                             │
│  └──────┬──────┘  └──────┬───────┘                             │
│         │                │                                      │
├─────────┼────────────────┼──────────────────────────────────────┤
│         │                │       BACKEND (Go)                    │
│  ┌──────┴────────────────┴──────┐                               │
│  │        Topology Service       │                               │
│  │  ┌─────────────────────────┐ │                               │
│  │  │   ResourceBundle        │ │  Phase 1: Resource Discovery  │
│  │  │   (fetch all resources) │ │  Concurrent API calls         │
│  │  └────────┬────────────────┘ │                               │
│  │  ┌────────┴────────────────┐ │                               │
│  │  │   Relationship Registry │ │  Phase 2: Inference           │
│  │  │   (12 matchers)        │ │  OwnerRef, Selector, Volume,  │
│  │  │                        │ │  Ingress, RBAC, etc.          │
│  │  └────────┬────────────────┘ │                               │
│  │  ┌────────┴────────────────┐ │                               │
│  │  │   Graph Builder         │ │  Phase 3: Graph Construction  │
│  │  │   (nodes + edges)      │ │  Deterministic layout seed    │
│  │  └────────┬────────────────┘ │                               │
│  │  ┌────────┴────────────────┐ │                               │
│  │  │   Validation            │ │  Phase 4: Quality Checks     │
│  │  │   (orphans, cycles)    │ │                               │
│  │  └────────┬────────────────┘ │                               │
│  │  ┌────────┴────────────────┐ │                               │
│  │  │   Cache (in-memory)     │ │  TTL-based caching           │
│  │  │   + Snapshot storage   │ │                               │
│  │  └─────────────────────────┘ │                               │
│  └──────────────────────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Backend: Topology Engine

### 2.1 Resource Discovery (Phase 1)

The `ResourceBundle` collector fetches all relevant resources concurrently:

**Resources Collected (30+ types):**

| Category | Resources |
|----------|-----------|
| Workloads | Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs |
| Networking | Services, Endpoints, EndpointSlices, Ingresses, IngressClasses |
| Storage | PVCs, PVs, StorageClasses |
| Configuration | ConfigMaps, Secrets |
| RBAC | ServiceAccounts, Roles, RoleBindings, ClusterRoles, ClusterRoleBindings |
| Scaling | HPAs, PDBs |
| Advanced | NetworkPolicies, PriorityClasses, RuntimeClasses |
| Webhooks | MutatingWebhookConfigurations, ValidatingWebhookConfigurations |
| Cluster | Nodes, Namespaces |

**Discovery Pattern:**
- Concurrent goroutines per resource type
- Circuit breaker per cluster prevents cascading failures
- Partial graph on partial failure (some resources may fail to list)
- Per-kind truncation tracking for large clusters

### 2.2 Relationship Inference (Phase 2)

**12 Relationship Matchers:**

| # | Matcher | Source → Target | Detection | Priority |
|---|---------|----------------|-----------|----------|
| 1 | **OwnerRefMatcher** | Parent → Child | `metadata.ownerReferences` | Highest |
| 2 | **SelectorMatcher** | Controller → Pod | `spec.selector` label matching | High |
| 3 | **VolumeMountMatcher** | Pod → PVC/ConfigMap/Secret | `spec.volumes[]` references | High |
| 4 | **EnvRefMatcher** | Pod → ConfigMap/Secret | `spec.containers[].envFrom` | Medium |
| 5 | **IngressMatcher** | Ingress → Service | `spec.rules[].http.paths[].backend` | High |
| 6 | **EndpointMatcher** | Service → Pod | Endpoints/EndpointSlice addresses | High |
| 7 | **RBACMatcher** | ServiceAccount → Role | RoleBinding `subjects[]` + `roleRef` | Medium |
| 8 | **SchedulingMatcher** | Pod → Node | `spec.nodeName`, node affinity | Medium |
| 9 | **ScalingMatcher** | HPA → Deployment/SS | `spec.scaleTargetRef` | Medium |
| 10 | **StorageMatcher** | PVC → StorageClass/PV | `spec.storageClassName`, `spec.volumeName` | Medium |
| 11 | **WebhookMatcher** | Webhook → API group | `webhooks[].rules[].apiGroups` | Low |
| 12 | **NamespaceMatcher** | Resource → Namespace | `metadata.namespace` | Low |

**Relationship Type Taxonomy:**

```
Ownership (OwnerRefMatcher):
  Deployment → ReplicaSet → Pod
  StatefulSet → Pod
  DaemonSet → Pod
  Job → Pod
  CronJob → Job → Pod
  ReplicaSet → Pod

Selection (SelectorMatcher):
  Service → Pod (via label selector)
  Deployment → Pod (via template labels)
  NetworkPolicy → Pod (via podSelector)

Configuration (VolumeMountMatcher + EnvRefMatcher):
  Pod → ConfigMap (volume or envFrom)
  Pod → Secret (volume or envFrom)
  Pod → PVC (volume mount)

Routing (IngressMatcher + EndpointMatcher):
  Ingress → Service → Pod
  Service → Endpoints → Pod

Authorization (RBACMatcher):
  ServiceAccount → RoleBinding → Role
  ServiceAccount → ClusterRoleBinding → ClusterRole

Infrastructure (SchedulingMatcher + StorageMatcher):
  Pod → Node (scheduling)
  PVC → StorageClass → PV (provisioning)

Scaling (ScalingMatcher):
  HPA → Deployment/StatefulSet
  PDB → Deployment/StatefulSet
```

### 2.3 Graph Construction (Phase 3)

**Node Properties:**
```
TopologyNode {
  id:        string    // unique identifier (kind/namespace/name)
  kind:      string    // Kubernetes resource kind
  name:      string    // resource name
  namespace: string    // resource namespace (empty for cluster-scoped)
  status:    string    // health status (healthy/warning/error/unknown)
  metrics:   object    // CPU/memory if available
  category:  string    // compute/networking/storage/security/config/scheduling
  labels:    map       // Kubernetes labels
  createdAt: timestamp // creation time
}
```

**Edge Properties:**
```
TopologyEdge {
  id:       string  // source-target-type
  source:   string  // source node ID
  target:   string  // target node ID
  label:    string  // relationship description
  category: string  // ownership/selection/routing/config/rbac/infra/scaling
}
```

**Deterministic Layout Seed:**
- SHA256 hash of sorted node IDs + edge pairs
- Same graph always produces same visual layout
- Enables reproducible topology snapshots

### 2.4 Caching & Performance

**Cache Strategy:**
- In-memory cache with configurable TTL (`topology_cache_ttl_sec`, default 300s)
- WebSocket events trigger cache invalidation on resource changes
- Per-cluster cache isolation

**Performance Targets (from PRD):**
| Cluster Size | Target | Implementation |
|-------------|--------|----------------|
| 1K resources | <3 seconds | Concurrent fetch + cache |
| 5K resources | <10 seconds | Partial graph, truncation |
| 10K+ resources | <20 seconds | Aggressive truncation, per-kind caps |

---

## 3. Frontend: Topology Visualization

### 3.1 Component Architecture

```
TopologyPage.tsx (838 lines — orchestrator)
├── TopologyToolbar.tsx
│   ├── View mode selector (5 modes)
│   ├── Namespace multi-select
│   ├── Search bar
│   └── Export/fit/screenshot buttons
├── TopologyBreadcrumbs.tsx
│   └── Cluster > Namespace > Workload > Resource
├── TopologyCanvas.tsx (React Flow)
│   ├── Node types (semantic zoom):
│   │   ├── MinimalNode.tsx   (zoom < 0.25)
│   │   ├── CompactNode.tsx   (zoom < 0.50)
│   │   ├── BaseNode.tsx      (zoom 0.50-1.50)
│   │   ├── ExpandedNode.tsx  (zoom > 1.50)
│   │   ├── GroupNode.tsx     (namespace containers)
│   │   └── SummaryNode.tsx   (aggregated counters)
│   └── Edge types:
│       ├── AnimatedEdge.tsx  (dashed flow animation)
│       └── LabeledEdge.tsx   (relationship labels)
├── TopologyDetailPanel.tsx
│   └── Resource metadata, events, logs, YAML
└── Overlays:
    ├── Health overlay (status colors)
    ├── Cost overlay (resource cost)
    ├── Traffic overlay (animated edges)
    └── Security overlay (RBAC visualization)
```

### 3.2 Semantic Zoom System

The topology renders different node detail levels based on zoom:

| Zoom Level | Node Type | Content | Size |
|-----------|-----------|---------|------|
| < 0.25 | MinimalNode | Dot + label | ~20px |
| 0.25-0.50 | CompactNode | Icon + name + status badge | ~100px |
| 0.50-1.50 | BaseNode | Category header, name, namespace, status, basic metrics | 230-320px |
| > 1.50 | ExpandedNode | Full details: all metrics, labels, annotations, events | 400px+ |

**Zoom Thresholds (from designTokens.ts):**
```typescript
SEMANTIC_ZOOM = {
  minimal:  0.25,  // far zoom-out
  compact:  0.50,  // medium zoom-out
  base:     1.00,  // default
  expanded: 1.50,  // zoom-in
}
```

### 3.3 View Modes

| Mode | Filter Logic | Use Case |
|------|-------------|----------|
| **Cluster** | Cluster-scoped resources (Nodes, Namespaces, PVs, StorageClasses, ClusterRoles, IngressClasses) | Infrastructure overview |
| **Namespace** | All resources in selected namespace(s) | Namespace exploration |
| **Workload** | Workload resources (Deployments, Pods, Services, ConfigMaps, etc.) | Application debugging |
| **Resource** | Single resource + BFS 1-hop neighbors | Impact analysis |
| **RBAC** | ServiceAccounts, Roles, Bindings | Permission audit |

### 3.4 Layout Engine (ELK.js)

**Algorithm:** ELK Layered (Sugiyama-style hierarchical layout)

**Configuration:**
- Direction: Top-to-bottom (TB)
- Node spacing: Configurable via useElkLayout hook
- Edge routing: Orthogonal with bend points
- Group handling: Namespace groups as compound nodes
- Deterministic: Same input → same layout (via sorted node/edge IDs)

**Layout Performance:**
- Computed in web worker (off main thread)
- Incremental layout for small changes (planned)
- Layout caching for unchanged graphs

### 3.5 Interaction Patterns

**Keyboard Shortcuts:**
| Key | Action |
|-----|--------|
| 1-5 | Switch view mode (Cluster/Namespace/Workload/Resource/RBAC) |
| / | Focus search bar |
| Esc | Clear selection / close detail panel |
| Space | Fit view (zoom to fit all nodes) |
| ? | Show keyboard shortcut help |
| S | Take screenshot |

**Mouse Interactions:**
| Action | Behavior |
|--------|----------|
| Click node | Select → show detail panel |
| Double-click node | Navigate to resource detail page |
| Drag canvas | Pan |
| Scroll | Zoom (triggers semantic zoom transitions) |
| Click edge | Highlight relationship |
| Right-click node | Context menu (planned) |

**Search:**
- Full-text search across node names and namespaces
- Real-time highlighting of matching nodes
- Search results list with click-to-navigate

### 3.6 Export Capabilities

| Format | Method | Content |
|--------|--------|---------|
| PNG | html-to-image | Raster screenshot of current view |
| SVG | html-to-image | Vector export of current view |
| PDF | jspdf | PDF with topology visualization |
| JSON | API response | Raw topology data (nodes, edges, metadata) |
| Draw.io | Backend endpoint | Draw.io-compatible XML for editing |

**Export Filename Template:**
`kubilitics-topology-{view_mode}-{cluster}-{namespace}-{timestamp}.{format}`

### 3.7 Real-Time Updates (WebSocket)

**Flow:**
1. WebSocket connects to `/ws/resources`
2. Backend watches Kubernetes resource changes
3. On change: broadcast update to connected clients
4. Frontend: invalidate topology cache → re-fetch
5. React Flow: animate node position/status changes

**Disconnect Handling:**
- `TopologyWsDisconnectBanner` shows warning when WebSocket disconnects
- Automatic reconnection with exponential backoff
- Stale data indicator when disconnected

---

## 4. Design Token System (Topology-Specific)

### 4.1 Category Colors

| Category | Color | Used For |
|----------|-------|----------|
| Compute | Blue (#3B82F6) | Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs |
| Networking | Cyan (#06B6D4) | Services, Ingresses, Endpoints, NetworkPolicies |
| Storage | Purple (#8B5CF6) | PVs, PVCs, StorageClasses, VolumeAttachments |
| Security | Red (#EF4444) | Roles, ClusterRoles, Bindings, ServiceAccounts |
| Config | Orange (#F97316) | ConfigMaps, Secrets |
| Scheduling | Yellow (#EAB308) | HPAs, PDBs, PriorityClasses, RuntimeClasses |

### 4.2 Status Colors

| Status | Color | Icon |
|--------|-------|------|
| Healthy | Green (#22C55E) | Checkmark circle |
| Warning | Amber (#F59E0B) | Warning triangle |
| Error | Red (#EF4444) | X circle |
| Unknown | Gray (#6B7280) | Question mark |
| Pending | Blue (#3B82F6) | Clock |

### 4.3 Node Styling

| Property | BaseNode | CompactNode | MinimalNode | ExpandedNode |
|----------|----------|-------------|-------------|-------------|
| Width | 230-320px | ~100px | ~20px | 400px+ |
| Border | 1px category color | 1px solid | None | 2px category color |
| Header | Category name + color | Icon only | Dot | Category + description |
| Status | Badge | Dot | Color | Badge + text |
| Metrics | Basic (CPU/mem %) | None | None | Full (CPU/mem/network) |

---

## 5. Strengths

1. **Unique Differentiator:** No competitor offers this level of Kubernetes relationship visualization
2. **12 Inference Methods:** Comprehensive relationship detection covering ownership, selection, configuration, routing, RBAC, scheduling, and scaling
3. **Semantic Zoom:** Elegant solution to the information density problem — show more as you zoom in
4. **5 View Modes:** Purpose-driven filtering that surfaces the right information for each task
5. **Deterministic Layout:** Same graph → same visual positions, enabling reproducible snapshots
6. **Export Quality:** Multiple formats including Draw.io for team sharing and editing
7. **Keyboard-First:** Full keyboard navigation for power users
8. **Real-Time Updates:** WebSocket-driven cache invalidation keeps topology fresh

---

## 6. Gaps & Recommendations

### 6.1 P0 — Critical Gaps

**TOPO-01: No Cross-Cluster Topology**
Currently limited to single-cluster views. Platform engineers managing 5-50 clusters need to see cross-cluster relationships (e.g., DNS routing between clusters, shared storage).

*Recommendation:* Add a "Fleet" view mode that shows clusters as top-level nodes with inter-cluster relationships.

**TOPO-02: No Historical Topology**
Can't compare "now" vs "1 hour ago." When investigating incidents, understanding what changed is critical.

*Recommendation:* Store topology snapshots (hourly, daily, on-change). Add a "Compare" mode with diff highlighting: green=added, red=removed, amber=changed.

**TOPO-03: Performance at Scale (>1000 nodes)**
MAX_VISIBLE_NODES = 250 is a hard cap. Large production clusters with 500+ pods hit this limit immediately.

*Recommendation:* Implement progressive disclosure: show top-level groups (namespaces) first, expand on click. Use virtual rendering for large graphs. Consider WebGL renderer (e.g., Sigma.js) for 5000+ node graphs.

### 6.2 P1 — Important Gaps

**TOPO-04: Relationship Data Not Surfaced Outside Topology Page**
Resource detail pages don't show "what depends on this / what this depends on." Users must navigate to Topology to see relationships.

*Recommendation:* Add a "Relationships" tab to every resource detail page showing a mini-topology (1-hop neighbors). This surfaces the topology engine's power on every page.

**TOPO-05: No Topology Annotations**
Engineers can't annotate nodes with notes for team collaboration.

*Recommendation:* Right-click → "Add Note" with server-side storage. Show noted nodes with a badge indicator.

**TOPO-06: No CRD Relationships in Topology**
Custom resources (Istio VirtualServices, ArgoCD Applications, etc.) don't appear in topology even when they have relationships to core resources.

*Recommendation:* Use CRD schema introspection to detect references to core resources (e.g., VirtualService → Service). Add a generic CRDRelationshipMatcher.

### 6.3 P2 — Enhancement Opportunities

**TOPO-07: Export Lacks Polish**
Exported images don't include title, legend, timestamp, or branding.

*Recommendation:* Pre-export dialog with configurable header/footer, legend inclusion, and format options.

**TOPO-08: No 3D Topology View**
Three.js is in dependencies but not used for topology. 3D could enable visualizing very large clusters with z-axis for namespace depth.

*Recommendation:* Evaluate whether Three.js 3D view adds value for large clusters or if it's complexity without benefit. If not used, remove Three.js from dependencies.

**TOPO-09: No Topology Sharing (URL)**
Can't share a topology view state via URL. The current view mode, zoom level, selected node, and namespace filter should be URL-encoded.

*Recommendation:* Encode view state in URL query parameters: `?view=workload&ns=production&zoom=0.75&selected=deploy/nginx`. Already partial with namespace in URL.

---

## 7. Performance Analysis

### 7.1 Current Performance Characteristics

| Operation | Estimated Time | Bottleneck |
|-----------|---------------|------------|
| Resource fetch (100 resources) | 500ms-1s | K8s API round-trips |
| Resource fetch (1000 resources) | 2-5s | Concurrent goroutines limited by K8s API rate |
| Relationship inference | <100ms | In-memory, O(n*m) for selector matching |
| ELK layout (100 nodes) | 200-500ms | ELK algorithm complexity |
| ELK layout (250 nodes) | 1-3s | Web worker, but still blocks layout |
| React Flow render (100 nodes) | <100ms | React reconciliation |
| React Flow render (250 nodes) | 200-500ms | DOM node count |

### 7.2 Optimization Opportunities

1. **SharedInformerFactory:** Replace polling with watch-based resource tracking. Reduces API server load and provides instant updates.
2. **Incremental Layout:** When 1 node changes, don't re-layout the entire graph. ELK supports incremental layout.
3. **Virtual Rendering:** Only render nodes visible in viewport. React Flow supports this but may not be configured optimally.
4. **Web Worker for Inference:** Move relationship matching to a web worker to avoid blocking the main thread.
5. **GraphQL for Topology:** Instead of REST (fetch everything), use a GraphQL-like query that specifies exactly which resources and relationships to include.

---

## 8. Comparison with Alternatives

| Feature | Kubilitics | Weave Scope (archived) | Kubernetes Dashboard | Headlamp | Octant (archived) |
|---------|-----------|----------------------|---------------------|----------|-------------------|
| Resource types | 30+ | 15 | 10 | 8 | 12 |
| Relationship inference | 12 methods | Container-level | None | None | Owner refs only |
| Semantic zoom | 4 levels | None | None | None | None |
| View modes | 5 | 1 | None | None | 1 |
| Keyboard shortcuts | Full set | None | None | None | None |
| Real-time updates | WebSocket | WebSocket | Polling | Polling | WebSocket |
| Export | PNG/SVG/PDF/JSON/DrawIO | None | None | None | PNG |
| Layout algorithm | ELK (hierarchical) | Force-directed | None | None | Force-directed |
| Deterministic layout | Yes | No | N/A | N/A | No |
| Historical comparison | No | No | No | No | No |
| Cross-cluster | No | No | No | No | No |

**Kubilitics has the most advanced Kubernetes topology visualization in the ecosystem.** The combination of 12 relationship matchers, semantic zoom, 5 view modes, and multiple export formats is unmatched.

---

*End of Topology Engine Architecture Deep Dive — Kubilitics OS v1.0*
