/**
 * useTopologyData — Bridges the existing useClusterTopology hook to v2 TopologyResponse format.
 *
 * Provides three layers of filtering:
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

/**
 * Maximum nodes rendered on the canvas before truncation kicks in.
 * Beyond this, React Flow + ELK layout cause noticeable jank / UI freeze.
 * The limit is generous — ELK hybrid layout handles ~250 nodes smoothly.
 */
export const MAX_VISIBLE_NODES = 250;

export interface UseTopologyDataParams {
  clusterId: string | null;
  viewMode?: ViewMode;
  selectedNamespaces?: Set<string>;
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
  resource: null, // Resource view (per-resource detail tab) — show all via BFS
};

/** Category-based filtering as fallback */
const VIEW_MODE_CATEGORIES: Record<ViewMode, string[] | null> = {
  namespace: null,
  cluster: ["scheduling", "storage"],
  rbac: ["security"],
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
  selectedNamespaces = new Set(),
  resource = "",
  enabled = true,
}: UseTopologyDataParams) {
  const { graph, isLoading, error, refetch } = useClusterTopology({
    clusterId,
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
  const NS_FILTERABLE_VIEWS = new Set<ViewMode>(["namespace"]);

  // Stable key for the namespace Set so React's useMemo dependency comparison
  // always detects changes. Set objects are compared by reference, which can
  // cause missed updates when React batches renders or in concurrent mode.
  const namespacesKey = Array.from(selectedNamespaces).sort().join(",");

  // Transform to v2 format and apply both filters
  const result = useMemo<{ response: TopologyResponse; wasTruncated: boolean; totalBeforeCap: number } | null>(() => {
    if (!graph) return null;
    const response = transformGraph(graph, clusterId ?? undefined);

    // Layer 1: View mode filtering
    const afterViewMode = filterByViewMode(response.nodes, response.edges, viewMode);

    // Layer 2: Namespace filtering — only for namespace-aware views
    const effectiveNs = NS_FILTERABLE_VIEWS.has(viewMode) ? selectedNamespaces : new Set<string>();
    const afterNamespace = filterByNamespaces(
      afterViewMode.nodes,
      afterViewMode.edges,
      effectiveNs
    );

    // Layer 3: Client-side node cap — prevent UI freeze from too many nodes.
    // Truncate AFTER namespace filtering so the cap applies to the visible set.
    let finalNodes = afterNamespace.nodes;
    let finalEdges = afterNamespace.edges;
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

    return { response, wasTruncated, totalBeforeCap };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, viewMode, namespacesKey, resource]);

  const topology = result?.response ?? null;
  const truncated = result?.wasTruncated ?? false;
  const truncatedTotal = result?.totalBeforeCap ?? 0;

  return {
    topology,
    allNamespaces,
    isLoading,
    isError: !!error,
    error,
    refetch,
    /** true when the node count exceeded MAX_VISIBLE_NODES and was capped */
    truncated,
    /** total node count before truncation (for the warning banner) */
    truncatedTotal,
  };
}
