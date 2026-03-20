# TOPOLOGY ENGINE v2.0 — Technical Design Document

**Document:** design-doc.md  
**Purpose:** Backend and frontend architecture for the topology engine rewrite  
**Audience:** Backend engineers (Go), frontend engineers (React/TypeScript), tech leads  
**Status:** Approved for implementation

---

## 1. Architecture Overview

### 1.1 Current Architecture (What's Wrong)

```
Current flow:
1. Frontend requests GET /topology
2. Backend lists resources sequentially per type
3. Backend builds edges by checking ownerReferences only (incomplete)
4. Backend returns flat JSON with nodes/edges
5. Frontend feeds JSON to Cytoscape.js with random layout algorithm choice
6. Layout is non-deterministic, edges unlabeled, many connections missing
```

Problems:
- Edge inference is incomplete (only ownerReferences, no selector matching, no volume mounts, no envFrom)
- Layout algorithm varies (FCose, Cola, Dagre, ELK randomly applied)
- No concept of view modes — one-size-fits-all rendering
- No grouping (namespaces not represented as containers)
- No real-time incremental updates — full re-render on any change
- Frontend rendering library (Cytoscape.js) limits custom node rendering

### 1.2 New Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (React + TypeScript)                                   │
│                                                                   │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ TopologyCanvas   │  │ TopologyToolbar   │  │ DetailPanel    │  │
│  │ (React Flow v12) │  │ (View/Filter/Exp) │  │ (Resource Info)│  │
│  └────────┬────────┘  └──────────────────┘  └───────────────┘  │
│           │                                                      │
│  ┌────────▼────────────────────────────────────────────────────┐│
│  │ TopologyStateManager (Zustand store)                        ││
│  │ - viewMode, selectedNode, filters, overlays, zoom, pan     ││
│  │ - incrementalUpdate(event) — handles WebSocket events       ││
│  └────────┬────────────────────────────────────────────────────┘│
│           │                                                      │
│  ┌────────▼────────────────────────────────────────────────────┐│
│  │ LayoutEngine (ELK.js via Web Worker)                        ││
│  │ - Receives nodes/edges/groups                               ││
│  │ - Computes layout in background thread                      ││
│  │ - Returns positioned nodes (x, y, width, height)            ││
│  │ - Deterministic: same input → same output (seed=42)         ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                   │
│  REST: GET /api/v1/clusters/{id}/topology/v2                     │
│  WS:   /api/v1/ws/topology/{id}                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  BACKEND (Go)                                                    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ TopologyHandler (REST + WebSocket)                        │   │
│  │ - Parses query params (mode, namespace, resource, depth)  │   │
│  │ - Returns TopologyResponse JSON                           │   │
│  └────────┬─────────────────────────────────────────────────┘   │
│           │                                                      │
│  ┌────────▼─────────────────────────────────────────────────┐   │
│  │ TopologyService v2                                        │   │
│  │                                                           │   │
│  │  ┌─────────────────┐  ┌────────────────────────────────┐ │   │
│  │  │ ResourceCollector│  │ RelationshipEngine             │ │   │
│  │  │ (concurrent list │  │ (39 relationship type matchers)│ │   │
│  │  │  all K8s types)  │  │ - OwnerRefMatcher              │ │   │
│  │  └────────┬────────┘  │ - SelectorMatcher               │ │   │
│  │           │            │ - VolumeMountMatcher            │ │   │
│  │           │            │ - EnvRefMatcher                 │ │   │
│  │           │            │ - IngressBackendMatcher         │ │   │
│  │           │            │ - RBACMatcher                   │ │   │
│  │           │            │ - SchedulingMatcher             │ │   │
│  │           │            │ - ScalingMatcher                │ │   │
│  │           │            │ - PolicyMatcher                 │ │   │
│  │           │            │ - WebhookMatcher                │ │   │
│  │           │            └────────────────────────────────┘ │   │
│  │           │                                               │   │
│  │  ┌────────▼────────────────────────────────────────────┐ │   │
│  │  │ GraphBuilder                                         │ │   │
│  │  │ - Builds nodes from collected resources              │ │   │
│  │  │ - Runs all RelationshipMatchers to build edges       │ │   │
│  │  │ - Assigns layers, groups, categories                 │ │   │
│  │  │ - Attaches metrics (from MetricsService)             │ │   │
│  │  │ - Attaches health status                             │ │   │
│  │  │ - Applies view mode filtering + depth limiting       │ │   │
│  │  └────────────────────────────────────────────────────┘ │   │
│  │                                                           │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │ TopologyCache (per-cluster, per-mode, TTL: 30s)    │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ InformerHub (existing) → TopologyEventStream             │   │
│  │ - Watches all resource types via informers               │   │
│  │ - On add/update/delete: pushes TopologyEvent to WS hub   │   │
│  │ - Invalidates TopologyCache for affected cluster          │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Backend Design

### 2.1 File Structure

```
kubilitics-backend/internal/topology/v2/
├── service.go              // TopologyServiceV2 — main entry point
├── collector.go            // ResourceCollector — concurrent resource listing
├── graph.go                // GraphBuilder — node/edge/group construction
├── cache.go                // TopologyCache — per-cluster TTL cache
├── node.go                 // TopologyNode model and builder
├── edge.go                 // TopologyEdge model and builder
├── group.go                // TopologyGroup model and builder
├── filter.go               // View mode filtering and depth limiting
├── metrics_enricher.go     // Attach metrics to nodes
├── health_enricher.go      // Compute health status for each node
├── relationships/
│   ├── registry.go         // RelationshipRegistry — registers all matchers
│   ├── matcher.go          // RelationshipMatcher interface
│   ├── owner_ref.go        // OwnerReferenceMatcher (rel 1-4, 14-18)
│   ├── selector.go         // SelectorMatcher (rel 19, 36-37)
│   ├── volume_mount.go     // VolumeMountMatcher (rel 5-7)
│   ├── env_ref.go          // EnvRefMatcher (rel 8-11)
│   ├── ingress.go          // IngressMatcher (rel 24-26)
│   ├── endpoint.go         // EndpointMatcher (rel 20-23)
│   ├── rbac.go             // RBACMatcher (rel 30-34)
│   ├── scheduling.go       // SchedulingMatcher (rel 2, 12-13)
│   ├── scaling.go          // ScalingMatcher (rel 35)
│   ├── service_identity.go // ServiceAccountMatcher (rel 4)
│   ├── storage.go          // StorageMatcher (rel 27-29)
│   ├── webhook.go          // WebhookMatcher (rel 38-39)
│   └── namespace.go        // NamespaceContainmentMatcher (rel 3)
└── relationships_test/
    ├── owner_ref_test.go
    ├── selector_test.go
    ├── volume_mount_test.go
    ├── env_ref_test.go
    ├── ingress_test.go
    ├── endpoint_test.go
    ├── rbac_test.go
    ├── scheduling_test.go
    ├── scaling_test.go
    ├── storage_test.go
    ├── webhook_test.go
    └── integration_test.go
```

### 2.2 RelationshipMatcher Interface

```go
// matcher.go
package relationships

type RelationshipMatcher interface {
    // Name returns a unique identifier for this matcher
    Name() string
    
    // Match examines all resources and returns edges
    Match(ctx context.Context, resources *ResourceBundle) ([]TopologyEdge, error)
}

// ResourceBundle contains all collected resources for a cluster (or namespace)
type ResourceBundle struct {
    Pods                  []corev1.Pod
    Deployments           []appsv1.Deployment
    StatefulSets          []appsv1.StatefulSet
    DaemonSets            []appsv1.DaemonSet
    ReplicaSets           []appsv1.ReplicaSet
    Jobs                  []batchv1.Job
    CronJobs              []batchv1.CronJob
    Services              []corev1.Service
    Endpoints             []corev1.Endpoints
    EndpointSlices        []discoveryv1.EndpointSlice
    Ingresses             []networkingv1.Ingress
    IngressClasses        []networkingv1.IngressClass
    ConfigMaps            []corev1.ConfigMap
    Secrets               []corev1.Secret
    PVCs                  []corev1.PersistentVolumeClaim
    PVs                   []corev1.PersistentVolume
    StorageClasses        []storagev1.StorageClass
    Nodes                 []corev1.Node
    Namespaces            []corev1.Namespace
    ServiceAccounts       []corev1.ServiceAccount
    Roles                 []rbacv1.Role
    RoleBindings          []rbacv1.RoleBinding
    ClusterRoles          []rbacv1.ClusterRole
    ClusterRoleBindings   []rbacv1.ClusterRoleBinding
    HPAs                  []autoscalingv2.HorizontalPodAutoscaler
    PDBs                  []policyv1.PodDisruptionBudget
    NetworkPolicies       []networkingv1.NetworkPolicy
    PriorityClasses       []schedulingv1.PriorityClass
    RuntimeClasses        []nodev1.RuntimeClass
    MutatingWebhooks      []admissionv1.MutatingWebhookConfiguration
    ValidatingWebhooks    []admissionv1.ValidatingWebhookConfiguration
}
```

### 2.3 Example Matcher: VolumeMountMatcher

```go
// volume_mount.go
package relationships

type VolumeMountMatcher struct{}

func (m *VolumeMountMatcher) Name() string { return "volume_mount" }

func (m *VolumeMountMatcher) Match(ctx context.Context, res *ResourceBundle) ([]TopologyEdge, error) {
    var edges []TopologyEdge
    
    for _, pod := range res.Pods {
        for _, vol := range pod.Spec.Volumes {
            // ConfigMap volume mounts
            if vol.ConfigMap != nil {
                cm := findConfigMap(res.ConfigMaps, pod.Namespace, vol.ConfigMap.Name)
                if cm != nil {
                    mountPath := findMountPath(pod, vol.Name)
                    edges = append(edges, TopologyEdge{
                        ID:                   edgeID("Pod", pod, "ConfigMap", cm),
                        Source:               nodeID("Pod", pod.Namespace, pod.Name),
                        Target:               nodeID("ConfigMap", cm.Namespace, cm.Name),
                        RelationshipType:     "volumeMount",
                        RelationshipCategory: "config",
                        Label:                fmt.Sprintf("mounts → %s", mountPath),
                        Detail:               fmt.Sprintf("Volume '%s' mounts ConfigMap '%s' at '%s'", vol.Name, cm.Name, mountPath),
                        Style:                "dotted",
                        Animated:             false,
                        Healthy:              true,
                    })
                }
            }
            
            // Secret volume mounts
            if vol.Secret != nil {
                sec := findSecret(res.Secrets, pod.Namespace, vol.Secret.SecretName)
                if sec != nil {
                    mountPath := findMountPath(pod, vol.Name)
                    edges = append(edges, TopologyEdge{
                        ID:                   edgeID("Pod", pod, "Secret", sec),
                        Source:               nodeID("Pod", pod.Namespace, pod.Name),
                        Target:               nodeID("Secret", sec.Namespace, sec.Name),
                        RelationshipType:     "volumeMount",
                        RelationshipCategory: "config",
                        Label:                fmt.Sprintf("mounts → %s", mountPath),
                        Detail:               fmt.Sprintf("Volume '%s' mounts Secret '%s' at '%s'", vol.Name, sec.Name, mountPath),
                        Style:                "dotted",
                        Animated:             false,
                        Healthy:              true,
                    })
                }
            }
            
            // PVC volume mounts
            if vol.PersistentVolumeClaim != nil {
                pvc := findPVC(res.PVCs, pod.Namespace, vol.PersistentVolumeClaim.ClaimName)
                if pvc != nil {
                    mountPath := findMountPath(pod, vol.Name)
                    edges = append(edges, TopologyEdge{
                        ID:                   edgeID("Pod", pod, "PVC", pvc),
                        Source:               nodeID("Pod", pod.Namespace, pod.Name),
                        Target:               nodeID("PVC", pvc.Namespace, pvc.Name),
                        RelationshipType:     "volumeMount",
                        RelationshipCategory: "storage",
                        Label:                fmt.Sprintf("mounts → %s", mountPath),
                        Detail:               fmt.Sprintf("Volume '%s' mounts PVC '%s' at '%s'", vol.Name, pvc.Name, mountPath),
                        Style:                "dotted",
                        Animated:             false,
                        Healthy:              pvc.Status.Phase == corev1.ClaimBound,
                        HealthReason:         pvcHealthReason(pvc),
                    })
                }
            }
        }
    }
    
    return edges, nil
}
```

### 2.4 ResourceCollector (Concurrent)

```go
// collector.go
package topology

func (c *ResourceCollector) Collect(ctx context.Context, clusterID string, namespace string) (*ResourceBundle, error) {
    bundle := &ResourceBundle{}
    g, ctx := errgroup.WithContext(ctx)
    
    // All resource types collected concurrently
    g.Go(func() error {
        pods, err := c.k8s.ListPods(ctx, clusterID, namespace)
        bundle.Pods = pods
        return err
    })
    g.Go(func() error {
        deps, err := c.k8s.ListDeployments(ctx, clusterID, namespace)
        bundle.Deployments = deps
        return err
    })
    g.Go(func() error {
        svcs, err := c.k8s.ListServices(ctx, clusterID, namespace)
        bundle.Services = svcs
        return err
    })
    // ... all other resource types ...
    
    // Cluster-scoped resources (always fetched, not namespace-filtered)
    g.Go(func() error {
        nodes, err := c.k8s.ListNodes(ctx, clusterID)
        bundle.Nodes = nodes
        return err
    })
    g.Go(func() error {
        pvs, err := c.k8s.ListPersistentVolumes(ctx, clusterID)
        bundle.PVs = pvs
        return err
    })
    // ... other cluster-scoped types ...
    
    if err := g.Wait(); err != nil {
        return nil, fmt.Errorf("resource collection failed: %w", err)
    }
    
    return bundle, nil
}
```

### 2.5 GraphBuilder — View Mode Filtering

```go
// filter.go
package topology

func (f *ViewFilter) Apply(mode ViewMode, focusResource string, depth int, graph *TopologyGraph) *TopologyGraph {
    switch mode {
    case ViewModeCluster:
        return f.clusterView(graph)
    case ViewModeNamespace:
        return f.namespaceView(graph)
    case ViewModeWorkload:
        return f.workloadView(focusResource, graph)
    case ViewModeResource:
        return f.resourceCentricView(focusResource, depth, graph)
    case ViewModeRBAC:
        return f.rbacView(graph)
    }
    return graph
}

func (f *ViewFilter) resourceCentricView(focusResource string, depth int, graph *TopologyGraph) *TopologyGraph {
    // BFS from the focus resource to find all connected resources up to `depth` hops
    visited := map[string]bool{focusResource: true}
    queue := []string{focusResource}
    
    for d := 0; d < depth; d++ {
        nextQueue := []string{}
        for _, nodeID := range queue {
            // Find all edges where this node is source or target
            for _, edge := range graph.Edges {
                var neighbor string
                if edge.Source == nodeID {
                    neighbor = edge.Target
                } else if edge.Target == nodeID {
                    neighbor = edge.Source
                } else {
                    continue
                }
                if !visited[neighbor] {
                    visited[neighbor] = true
                    nextQueue = append(nextQueue, neighbor)
                }
            }
        }
        queue = nextQueue
    }
    
    // Filter graph to only visited nodes and edges between visited nodes
    filtered := &TopologyGraph{
        Metadata: graph.Metadata,
    }
    for _, node := range graph.Nodes {
        if visited[node.ID] {
            filtered.Nodes = append(filtered.Nodes, node)
        }
    }
    for _, edge := range graph.Edges {
        if visited[edge.Source] && visited[edge.Target] {
            filtered.Edges = append(filtered.Edges, edge)
        }
    }
    // Groups contain only nodes that are in the filtered set
    for _, group := range graph.Groups {
        filteredMembers := []string{}
        for _, m := range group.Members {
            if visited[m] {
                filteredMembers = append(filteredMembers, m)
            }
        }
        if len(filteredMembers) > 0 {
            g := group
            g.Members = filteredMembers
            filtered.Groups = append(filtered.Groups, g)
        }
    }
    
    return filtered
}
```

### 2.6 Cache Strategy

```go
// cache.go
package topology

type TopologyCache struct {
    mu    sync.RWMutex
    store map[string]*cacheEntry  // key: "clusterID:mode:namespace:resource"
}

type cacheEntry struct {
    graph     *TopologyGraph
    createdAt time.Time
    ttl       time.Duration
}

const (
    DefaultTTL       = 30 * time.Second   // Short TTL — topology changes frequently
    ClusterViewTTL   = 60 * time.Second   // Cluster view changes less often
    ResourceViewTTL  = 15 * time.Second   // Resource-centric needs freshness
)
```

Cache is invalidated immediately when an informer event fires for the affected cluster. This ensures that real-time updates don't serve stale data.

---

## 3. Frontend Design

### 3.1 Technology Choice: React Flow v12

**Why React Flow instead of Cytoscape.js:**

| Feature | Cytoscape.js | React Flow v12 |
|---------|-------------|----------------|
| Custom node rendering | Limited (HTML labels) | Full React components |
| Custom edge rendering | SVG only | Full React components |
| React integration | Wrapper (not native) | Native React library |
| Compound nodes (groups) | Basic | First-class support |
| Performance (1000+ nodes) | Good | Good (virtualization) |
| Accessibility | Poor | ARIA support built-in |
| TypeScript | Types available | Built in TypeScript |
| Layout integration | Built-in (limited) | External (ELK, Dagre) |
| Minimap | Plugin | Built-in component |
| Theming | CSS only | React context + CSS |

React Flow provides full React component rendering for nodes and edges, which enables our custom design system to be implemented natively (not as Cytoscape HTML labels that fight the library).

### 3.2 File Structure

```
kubilitics-frontend/src/topology/
├── TopologyPage.tsx                  // Main page component
├── TopologyCanvas.tsx                // React Flow canvas wrapper
├── TopologyToolbar.tsx               // View mode, filters, overlays, export
├── TopologyDetailPanel.tsx           // Right-side resource detail panel
├── TopologyBreadcrumbs.tsx           // Navigation breadcrumbs
├── TopologyMinimap.tsx               // Custom minimap overlay
├── TopologySearch.tsx                // Node search/filter overlay
│
├── nodes/
│   ├── BaseNode.tsx                  // Standard node component
│   ├── CompactNode.tsx               // Compact node for large graphs
│   ├── ExpandedNode.tsx              // Expanded focus node
│   ├── GroupNode.tsx                 // Namespace/workload group container
│   ├── nodeConfig.ts                 // Category colors, icons, sizes
│   └── nodeUtils.ts                  // Status computation, label formatting
│
├── edges/
│   ├── LabeledEdge.tsx               // Custom edge with label pill
│   ├── edgeConfig.ts                 // Edge styles by relationship type
│   └── edgeUtils.ts                  // Label positioning, anti-overlap
│
├── layout/
│   ├── elkLayout.ts                  // ELK layout adapter (Web Worker)
│   ├── elkWorker.ts                  // Web Worker for layout computation
│   ├── layerAssignment.ts            // Semantic layer assignment per resource
│   └── layoutConfig.ts              // ELK options per view mode
│
├── overlays/
│   ├── HealthOverlay.tsx             // Health status overlay
│   ├── CostOverlay.tsx               // Cost annotation overlay
│   ├── TrafficOverlay.tsx            // Traffic/latency overlay
│   └── SecurityOverlay.tsx           // Security posture overlay
│
├── export/
│   ├── exportPNG.ts                  // Canvas to PNG export
│   ├── exportSVG.ts                  // SVG export
│   ├── exportJSON.ts                 // JSON data export
│   └── exportDrawIO.ts              // DrawIO XML export
│
├── store/
│   ├── topologyStore.ts              // Zustand store for topology state
│   └── topologyActions.ts            // Actions: changeView, selectNode, etc.
│
├── hooks/
│   ├── useTopologyData.ts            // React Query hook for fetching topology
│   ├── useTopologyWebSocket.ts       // WebSocket hook for real-time updates
│   ├── useTopologyLayout.ts          // Layout computation hook
│   ├── useTopologyKeyboard.ts        // Keyboard shortcuts hook
│   └── useTopologyExport.ts          // Export functionality hook
│
└── __tests__/
    ├── TopologyCanvas.test.tsx
    ├── BaseNode.test.tsx
    ├── LabeledEdge.test.tsx
    ├── elkLayout.test.ts
    ├── topologyStore.test.ts
    └── e2e/
        ├── topology-cluster-view.spec.ts
        ├── topology-namespace-view.spec.ts
        ├── topology-resource-centric.spec.ts
        ├── topology-interactions.spec.ts
        ├── topology-viewport.spec.ts
        └── topology-export.spec.ts
```

### 3.3 Core Component: BaseNode

```tsx
// nodes/BaseNode.tsx
import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { nodeConfig } from './nodeConfig';

interface BaseNodeData {
  kind: string;
  name: string;
  namespace: string;
  category: string;
  status: 'healthy' | 'warning' | 'error' | 'unknown';
  statusReason: string;
  metrics?: {
    cpuUsage?: number;
    cpuLimit?: number;
    memoryUsage?: number;
    memoryLimit?: number;
    restartCount?: number;
  };
  isSelected: boolean;
  isFocused: boolean;
  isDimmed: boolean;
}

export const BaseNode = memo(({ data }: NodeProps<BaseNodeData>) => {
  const config = nodeConfig[data.category];
  const healthColor = statusColors[data.status];
  const Icon = resourceIcons[data.kind];
  
  return (
    <div
      className={cn(
        'relative rounded-lg border shadow-sm transition-all duration-200',
        'w-[240px] min-h-[100px]',
        data.isDimmed && 'opacity-30',
        data.isSelected && 'ring-2 ring-blue-500 shadow-md',
      )}
      style={{
        borderLeftWidth: '4px',
        borderLeftColor: healthColor,
        borderColor: config.borderColor,
        backgroundColor: config.nodeBg,
      }}
    >
      {/* Header Bar */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-t-lg"
        style={{ backgroundColor: config.headerBg }}
      >
        <Icon className="w-4 h-4 text-white" />
        <span className="text-xs font-medium text-white truncate">
          {data.kind}
        </span>
        <div
          className="ml-auto w-2 h-2 rounded-full"
          style={{ backgroundColor: healthColor }}
        />
      </div>
      
      {/* Body */}
      <div className="px-3 py-2">
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate" title={data.name}>
          {data.name}
        </div>
        {data.namespace && (
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {data.namespace}
          </div>
        )}
        
        {/* Status Row */}
        <div className="flex items-center gap-1.5 mt-1.5 text-xs">
          <StatusDot status={data.status} />
          <span className="text-slate-600 dark:text-slate-300">
            {data.statusReason}
          </span>
          {data.metrics?.restartCount > 0 && (
            <span className="text-red-600 ml-auto">
              {data.metrics.restartCount} restarts
            </span>
          )}
        </div>
        
        {/* Metrics (when available) */}
        {data.metrics?.cpuUsage !== undefined && (
          <div className="mt-1.5 space-y-1">
            <MetricBar
              label="CPU"
              value={data.metrics.cpuUsage}
              max={data.metrics.cpuLimit || data.metrics.cpuUsage * 2}
            />
            <MetricBar
              label="Mem"
              value={data.metrics.memoryUsage}
              max={data.metrics.memoryLimit || data.metrics.memoryUsage * 2}
            />
          </div>
        )}
      </div>
      
      {/* Connection handles */}
      <Handle type="target" position={Position.Top} className="!bg-slate-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400 !w-2 !h-2" />
      <Handle type="target" position={Position.Left} className="!bg-slate-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-slate-400 !w-2 !h-2" />
    </div>
  );
});
```

### 3.4 Core Component: LabeledEdge

```tsx
// edges/LabeledEdge.tsx
import { memo } from 'react';
import { getBezierPath, EdgeLabelRenderer, type EdgeProps } from 'reactflow';
import { edgeConfig } from './edgeConfig';

interface LabeledEdgeData {
  relationshipType: string;
  relationshipCategory: string;
  label: string;
  detail: string;
  style: 'solid' | 'dashed' | 'dotted';
  healthy: boolean;
  healthReason?: string;
}

export const LabeledEdge = memo(({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, selected
}: EdgeProps<LabeledEdgeData>) => {
  const config = edgeConfig[data.relationshipCategory];
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
  });
  
  const strokeDasharray = {
    solid: undefined,
    dashed: '8 4',
    dotted: '3 3',
  }[data.style];
  
  return (
    <>
      {/* Edge Path */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={data.healthy ? config.color : '#DC2626'}
        strokeWidth={selected ? config.width + 1 : config.width}
        strokeDasharray={strokeDasharray}
        opacity={selected ? 1 : 0.7}
        markerEnd={`url(#${config.arrowMarker})`}
        className="transition-all duration-150"
      />
      
      {/* Edge Label */}
      <EdgeLabelRenderer>
        <div
          className={cn(
            'absolute px-2 py-0.5 rounded text-[10px] leading-tight',
            'bg-white dark:bg-slate-800',
            'border border-slate-200 dark:border-slate-600',
            'text-slate-500 dark:text-slate-400',
            'pointer-events-auto cursor-pointer',
            'max-w-[180px] truncate',
            'transform -translate-x-1/2 -translate-y-1/2',
            selected && 'font-medium text-slate-700 dark:text-slate-200 max-w-none'
          )}
          style={{ left: labelX, top: labelY }}
          title={data.detail}
        >
          {data.label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
```

### 3.5 ELK Layout in Web Worker

```typescript
// layout/elkWorker.ts
import ELK from 'elkjs/lib/elk.bundled';

const elk = new ELK();

self.onmessage = async (event) => {
  const { nodes, edges, groups, viewMode, direction } = event.data;
  
  // Convert React Flow nodes/edges to ELK graph
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction || 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.layered.spacing.nodeNode': '40',
      'elk.spacing.componentComponent': '60',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.edgeRouting': 'ORTHOGONAL',
      'elk.randomSeed': '42',  // Deterministic
    },
    children: groups.map(group => ({
      id: group.id,
      layoutOptions: {
        'elk.padding': '[top=40,left=20,bottom=20,right=20]',
      },
      children: group.members.map(memberId => {
        const node = nodes.find(n => n.id === memberId);
        return {
          id: node.id,
          width: node.width || 240,
          height: node.height || 100,
          layoutOptions: {
            'elk.layered.layerConstraint': String(node.data.layer),
          },
        };
      }),
      edges: edges
        .filter(e => group.members.includes(e.source) && group.members.includes(e.target))
        .map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    })),
    // Cross-group edges
    edges: edges
      .filter(e => {
        const srcGroup = groups.find(g => g.members.includes(e.source));
        const tgtGroup = groups.find(g => g.members.includes(e.target));
        return srcGroup?.id !== tgtGroup?.id;
      })
      .map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  
  try {
    const layout = await elk.layout(elkGraph);
    
    // Convert ELK positions back to React Flow format
    const positions = {};
    function extractPositions(node, offsetX = 0, offsetY = 0) {
      if (node.children) {
        for (const child of node.children) {
          if (child.children) {
            // This is a group — record group position and recurse
            positions[child.id] = {
              x: (child.x || 0) + offsetX,
              y: (child.y || 0) + offsetY,
              width: child.width,
              height: child.height,
              isGroup: true,
            };
            extractPositions(child, (child.x || 0) + offsetX, (child.y || 0) + offsetY);
          } else {
            // This is a leaf node
            positions[child.id] = {
              x: (child.x || 0) + offsetX,
              y: (child.y || 0) + offsetY,
              width: child.width,
              height: child.height,
              isGroup: false,
            };
          }
        }
      }
    }
    extractPositions(layout);
    
    self.postMessage({ type: 'layout-complete', positions });
  } catch (error) {
    self.postMessage({ type: 'layout-error', error: error.message });
  }
};
```

---

## 4. Real-Time Update Strategy

### 4.1 Incremental Updates via WebSocket

The frontend maintains a persistent WebSocket connection per cluster. When the backend informer detects a resource change, it:

1. Invalidates the topology cache
2. Pushes a `TopologyEvent` to the WebSocket hub
3. The frontend receives the event and applies it incrementally

```typescript
// hooks/useTopologyWebSocket.ts
function handleTopologyEvent(event: TopologyEvent, store: TopologyStore) {
  switch (event.type) {
    case 'node_added':
      store.addNode(event.payload as TopologyNode);
      // Re-run layout only for the new node's neighborhood (not full graph)
      store.requestPartialLayout(event.payload.id);
      break;
      
    case 'node_updated':
      // Update in place — no layout change, just data refresh
      store.updateNode(event.payload as TopologyNode);
      break;
      
    case 'node_removed':
      store.removeNode(event.payload.id);
      // Re-run layout for affected area
      store.requestPartialLayout(event.payload.id);
      break;
      
    case 'edge_added':
    case 'edge_removed':
      // Edges don't change layout, just re-render
      store.updateEdge(event.payload as TopologyEdge);
      break;
  }
}
```

### 4.2 Partial Layout Re-computation

When a single node is added or removed, we don't re-layout the entire graph. Instead:

1. Identify the **connected component** affected by the change
2. Re-layout only that component using ELK
3. Animate the affected nodes to their new positions (300ms transition)
4. All unaffected nodes remain stationary

This prevents the jarring "everything moves" effect when a single pod restarts.

---

## 5. Performance Optimization

### 5.1 Virtualization

React Flow supports node virtualization — nodes outside the viewport are not rendered to DOM. This is critical for large graphs (500+ nodes).

Configuration:
```tsx
<ReactFlow
  nodes={nodes}
  edges={edges}
  nodeTypes={nodeTypes}
  edgeTypes={edgeTypes}
  // Virtualization
  onlyRenderVisibleElements={true}
  // Performance
  elevateEdgesOnSelect={true}
  maxZoom={4}
  minZoom={0.1}
/>
```

### 5.2 Semantic Zoom

At zoom < 0.3x, switch all nodes to a minimal rendering (colored rectangle, no React component). This dramatically reduces DOM nodes for large graphs.

```typescript
function getNodeType(zoom: number, nodeCount: number): string {
  if (zoom < 0.3 || nodeCount > 500) return 'minimal';
  if (zoom < 0.6 || nodeCount > 200) return 'compact';
  return 'standard';
}
```

### 5.3 Web Worker for Layout

All ELK layout computation runs in a Web Worker. The main thread is never blocked by layout calculation. This ensures 60fps pan/zoom even during re-layout of large graphs.

### 5.4 Debounced Updates

WebSocket events are batched in 100ms windows. If 20 pods restart simultaneously, the frontend receives one batched update instead of 20 individual events, triggering one layout pass instead of 20.

---

## 6. API Contract Summary

### 6.1 Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/clusters/{id}/topology/v2` | Fetch topology graph |
| GET | `/api/v1/clusters/{id}/topology/v2/resource/{kind}/{ns}/{name}` | Resource-centric topology |
| GET | `/api/v1/clusters/{id}/topology/v2/export/{format}` | Export topology (png/svg/json/drawio) |
| WS | `/api/v1/ws/topology/{id}` | Real-time topology events |

### 6.2 Migration from v1

The v2 endpoints coexist with v1. The frontend feature-flags the new topology:
- `FEATURE_TOPOLOGY_V2=true` → use v2 endpoints and React Flow renderer
- `FEATURE_TOPOLOGY_V2=false` → use v1 endpoints and Cytoscape.js (fallback)

Once v2 is validated, v1 endpoints and Cytoscape.js code are removed.
