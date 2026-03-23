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
  namespace: null, // Show all
  cluster: [
    "Node", "Namespace", "PersistentVolume", "StorageClass",
    "ClusterRole", "ClusterRoleBinding", "IngressClass",
    "PriorityClass", "RuntimeClass",
    "MutatingWebhookConfiguration", "ValidatingWebhookConfiguration",
    "ResourceQuota", "LimitRange",
  ],
  workload: [
    "Deployment", "StatefulSet", "DaemonSet", "ReplicaSet",
    "Pod", "Job", "CronJob", "ReplicationController",
    "Service", "Ingress", "Endpoints", "EndpointSlice",
    "ConfigMap", "Secret",
    "HorizontalPodAutoscaler", "PodDisruptionBudget",
    "NetworkPolicy",
  ],
  resource: null, // Resource mode uses BFS — show all
  rbac: [
    "ServiceAccount", "Role", "ClusterRole",
    "RoleBinding", "ClusterRoleBinding",
    "Namespace",
  ],
};

/** Category-based filtering as fallback */
const VIEW_MODE_CATEGORIES: Record<ViewMode, string[] | null> = {
  namespace: null,
  cluster: ["scheduling", "storage"],
  workload: ["compute", "networking", "config", "scaling"],
  resource: null,
  rbac: ["security"],
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

function filterByNamespaces(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  selectedNamespaces: Set<string>
): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  if (selectedNamespaces.size === 0) return { nodes, edges };

  const filteredNodes = nodes.filter((n) => {
    // Keep cluster-scoped resources (empty namespace) — PVs, Nodes, StorageClasses,
    // ClusterRoles etc. must remain visible so edges connecting to them aren't severed.
    // Only filter out resources from non-selected namespaces.
    if (!n.namespace) return true;
    return selectedNamespaces.has(n.namespace);
  });

  const nodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  return { nodes: filteredNodes, edges: filteredEdges };
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
  const NS_FILTERABLE_VIEWS = new Set<ViewMode>(["namespace", "workload", "resource"]);

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
