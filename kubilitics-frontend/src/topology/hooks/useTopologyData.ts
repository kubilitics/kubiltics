/**
 * useTopologyData — Bridges the existing useClusterTopology hook to v2 TopologyResponse format.
 *
 * Provides progressive disclosure via depth levels:
 * - L0 (Overview): Namespaces, Nodes, top-level workloads, Services, Ingress (~10-20 nodes)
 * - L1 (Workloads): + ReplicaSets, Endpoints, PVCs, ServiceAccounts
 * - L2 (Configuration): + ConfigMaps, Secrets, PVs, RBAC resources
 * - L3 (Full Graph): Everything — no filtering
 *
 * Plus existing filtering layers:
 * 1. View mode filtering (Cluster/Namespace/Workload/Resource/RBAC)
 * 2. Namespace selection (filter to specific namespaces)
 * 3. Client-side node cap (MAX_VISIBLE_NODES) to prevent UI freeze
 *
 * Also extracts the full namespace list from the unfiltered data
 * so the namespace picker always has the complete set.
 */
import { useMemo } from "react";
import { useClusterTopology } from "@/hooks/useClusterTopology";
import { transformGraph } from "../utils/transformGraph";
import type { TopologyResponse, TopologyNode, TopologyEdge, ViewMode } from "../types/topology";

/** Depth levels for progressive disclosure */
export type DepthLevel = 0 | 1 | 2 | 3;

export const DEPTH_LABELS: Record<DepthLevel, { label: string; description: string }> = {
  0: { label: "Overview", description: "Top-level resources" },
  1: { label: "Workloads", description: "Workload internals" },
  2: { label: "Configuration", description: "Config & RBAC" },
  3: { label: "Full Graph", description: "All resources" },
};

/**
 * Maximum nodes rendered on the canvas before truncation kicks in.
 * Backend pod aggregation (>3 pods collapse to 1 node) keeps real node counts
 * well below this limit. ELK hybrid layout handles ~1000 nodes smoothly.
 */
export const MAX_VISIBLE_NODES = 1000;

export interface UseTopologyDataParams {
  clusterId: string | null;
  viewMode?: ViewMode;
  depth?: DepthLevel;
  selectedNamespaces?: Set<string>;
  selectedKinds?: Set<string>;
  hiddenEdgeCategories?: Set<string>;
  resource?: string;
  enabled?: boolean;
}

/** Kinds visible per view mode */
const VIEW_MODE_KINDS: Record<ViewMode, string[] | null> = {
  namespace: null, // Show all namespace-scoped + connected cluster-scoped (smart filter below)
  cluster: [
    "Node", "Namespace", "PersistentVolume", "StorageClass",
    "IngressClass", "PriorityClass", "RuntimeClass",
    "MutatingWebhookConfiguration", "ValidatingWebhookConfiguration",
    "ResourceQuota", "LimitRange",
  ],
  rbac: [
    "ServiceAccount", "Role", "ClusterRole",
    "RoleBinding", "ClusterRoleBinding",
    "Namespace",
  ],
  traffic: [
    "Service", "Ingress", "Pod", "Endpoints", "EndpointSlice",
    "Node", "Namespace",
  ],
  resource: null, // Resource view (per-resource detail tab) — show all via BFS
};

/** Category-based filtering as fallback */
const VIEW_MODE_CATEGORIES: Record<ViewMode, string[] | null> = {
  namespace: null,
  cluster: ["scheduling", "storage"],
  rbac: ["security"],
  traffic: ["networking"],
  resource: null,
};

function filterByViewMode(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  viewMode: ViewMode
): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  const allowedKinds = VIEW_MODE_KINDS[viewMode];
  const allowedCategories = VIEW_MODE_CATEGORIES[viewMode];

  if (!allowedKinds && !allowedCategories) {
    return { nodes, edges };
  }

  const filteredNodes = nodes.filter((n) => {
    if (allowedKinds && allowedKinds.includes(n.kind)) return true;
    if (allowedCategories && allowedCategories.includes(n.category)) return true;
    return false;
  });

  const nodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  return { nodes: filteredNodes, edges: filteredEdges };
}

/**
 * Smart namespace filter — two-pass algorithm:
 * Pass 1: Keep all namespace-scoped resources in selected namespaces
 * Pass 2: Keep cluster-scoped resources ONLY if they have an edge to a Pass 1 node
 * This prevents dumping all ClusterRoles into namespace view while keeping
 * Nodes/PVs that are actually connected to namespace resources.
 */
function filterByNamespaces(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  selectedNamespaces: Set<string>
): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  if (selectedNamespaces.size === 0) return { nodes, edges };

  // Pass 1: Keep namespace-scoped resources in selected namespaces
  const namespacedNodeIds = new Set<string>();
  const namespacedNodes: TopologyNode[] = [];
  const clusterScopedNodes: TopologyNode[] = [];

  for (const n of nodes) {
    if (n.namespace) {
      if (selectedNamespaces.has(n.namespace)) {
        namespacedNodes.push(n);
        namespacedNodeIds.add(n.id);
      }
    } else {
      clusterScopedNodes.push(n);
    }
  }

  // Pass 2: Keep cluster-scoped nodes ONLY if they have an edge to a namespace-scoped node
  const connectedClusterNodeIds = new Set<string>();
  for (const e of edges) {
    if (namespacedNodeIds.has(e.source) && !namespacedNodeIds.has(e.target)) {
      connectedClusterNodeIds.add(e.target);
    }
    if (namespacedNodeIds.has(e.target) && !namespacedNodeIds.has(e.source)) {
      connectedClusterNodeIds.add(e.source);
    }
  }

  const connectedClusterNodes = clusterScopedNodes.filter((n) => connectedClusterNodeIds.has(n.id));
  const finalNodes = [...namespacedNodes, ...connectedClusterNodes];
  const finalNodeIds = new Set(finalNodes.map((n) => n.id));
  const finalEdges = edges.filter(
    (e) => finalNodeIds.has(e.source) && finalNodeIds.has(e.target)
  );

  return { nodes: finalNodes, edges: finalEdges };
}

export function useTopologyData({
  clusterId,
  viewMode = "namespace",
  depth = 0,
  selectedNamespaces = new Set(),
  selectedKinds = new Set(),
  hiddenEdgeCategories = new Set(),
  resource = "",
  enabled = true,
}: UseTopologyDataParams) {
  const { graph, isLoading, isFetching, error, refetch } = useClusterTopology({
    clusterId,
    depth,
    enabled: enabled && !!clusterId,
  });

  // Extract ALL namespaces from unfiltered graph (for the namespace picker)
  const allNamespaces = useMemo<string[]>(() => {
    if (!graph?.nodes) return [];
    const nsSet = new Set<string>();
    for (const n of graph.nodes) {
      if (n.namespace) nsSet.add(n.namespace);
    }
    return Array.from(nsSet).sort();
  }, [graph]);

  // View modes where namespace filtering makes sense.
  // Cluster and RBAC show cluster-scoped resources (no namespace) so filtering would exclude everything.
  const NS_FILTERABLE_VIEWS = new Set<ViewMode>(["namespace", "traffic"]);

  // Stable keys for Set dependencies so React's useMemo comparison
  // always detects changes. Set objects are compared by reference.
  const namespacesKey = Array.from(selectedNamespaces).sort().join(",");
  const kindsKey = Array.from(selectedKinds).sort().join(",");
  const edgeCategoriesKey = Array.from(hiddenEdgeCategories).sort().join(",");

  // Extract ALL unique kinds from unfiltered graph (for the kind picker)
  const allKinds = useMemo<string[]>(() => {
    if (!graph?.nodes) return [];
    const kindSet = new Set<string>();
    for (const n of graph.nodes) {
      if (n.kind) kindSet.add(n.kind);
    }
    return Array.from(kindSet).sort();
  }, [graph]);

  // Extract ALL unique edge relationship categories (for the edge filter)
  const allEdgeCategories = useMemo<string[]>(() => {
    if (!graph?.edges) return [];
    const catSet = new Set<string>();
    for (const e of graph.edges) {
      if (e.relationshipCategory) catSet.add(e.relationshipCategory);
    }
    return Array.from(catSet).sort();
  }, [graph]);

  // Transform to v2 format and apply all filters
  const result = useMemo<{ response: TopologyResponse; wasTruncated: boolean; totalBeforeCap: number; totalUnfiltered: number } | null>(() => {
    if (!graph) return null;
    let response;
    try {
      response = transformGraph(graph, clusterId ?? undefined);
    } catch (err) {
      console.error('transformGraph failed:', err);
      return null;
    }
    const totalUnfiltered = response.nodes.length;

    // Layer 0: Progressive disclosure — depth filtering is now handled by the backend.
    // The backend returns only the nodes/edges for the requested depth level.

    // Layer 1: View mode filtering
    const afterViewMode = filterByViewMode(response.nodes, response.edges, viewMode);

    // Layer 2: Namespace filtering — only for namespace-aware views
    const effectiveNs = NS_FILTERABLE_VIEWS.has(viewMode) ? selectedNamespaces : new Set<string>();
    const afterNamespace = filterByNamespaces(
      afterViewMode.nodes,
      afterViewMode.edges,
      effectiveNs
    );

    // Layer 3: Kind filtering — when selectedKinds is non-empty, only show those kinds
    let afterKindNodes = afterNamespace.nodes;
    let afterKindEdges = afterNamespace.edges;
    if (selectedKinds.size > 0) {
      afterKindNodes = afterKindNodes.filter((n) => selectedKinds.has(n.kind));
      const keptKindIds = new Set(afterKindNodes.map((n) => n.id));
      afterKindEdges = afterKindEdges.filter(
        (e) => keptKindIds.has(e.source) && keptKindIds.has(e.target)
      );
    }

    // Layer 4: Edge category filtering — hide edges of hidden categories (nodes stay)
    let afterEdgeFilter = afterKindEdges;
    if (hiddenEdgeCategories.size > 0) {
      afterEdgeFilter = afterKindEdges.filter(
        (e) => !hiddenEdgeCategories.has(e.relationshipCategory)
      );
    }

    // Layer 5: Client-side node cap — prevent UI freeze from too many nodes.
    // Truncate AFTER all filtering so the cap applies to the visible set.
    let finalNodes = afterKindNodes;
    let finalEdges = afterEdgeFilter;
    let wasTruncated = false;
    const totalBeforeCap = finalNodes.length;

    if (finalNodes.length > MAX_VISIBLE_NODES) {
      wasTruncated = true;
      // Keep the first MAX_VISIBLE_NODES nodes (they come in a stable order from
      // the backend). Then prune edges to only those connecting kept nodes.
      finalNodes = finalNodes.slice(0, MAX_VISIBLE_NODES);
      const keptIds = new Set(finalNodes.map((n) => n.id));
      finalEdges = finalEdges.filter(
        (e) => keptIds.has(e.source) && keptIds.has(e.target)
      );
    }

    response.nodes = finalNodes;
    response.edges = finalEdges;
    response.metadata.resourceCount = finalNodes.length;
    response.metadata.edgeCount = finalEdges.length;
    response.metadata.mode = viewMode;

    if (selectedNamespaces.size === 1) {
      response.metadata.namespace = Array.from(selectedNamespaces)[0];
    }
    if (resource) response.metadata.focusResource = resource;

    return { response, wasTruncated, totalBeforeCap, totalUnfiltered };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, viewMode, depth, namespacesKey, kindsKey, edgeCategoriesKey, resource]);

  const topology = result?.response ?? null;
  const truncated = result?.wasTruncated ?? false;
  const truncatedTotal = result?.totalBeforeCap ?? 0;
  const totalUnfiltered = result?.totalUnfiltered ?? 0;

  return {
    topology,
    allNamespaces,
    allKinds,
    allEdgeCategories,
    isLoading,
    isFetching,
    isError: !!error,
    error,
    refetch,
    /** true when the node count exceeded MAX_VISIBLE_NODES and was capped */
    truncated,
    /** total node count before truncation (for the warning banner) */
    truncatedTotal,
    /** total node count before any filtering (depth, view mode, etc.) — for "X of Y" display */
    totalUnfiltered,
  };
}
