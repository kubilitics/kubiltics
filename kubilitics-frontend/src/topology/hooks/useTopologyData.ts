/**
 * useTopologyData — Bridges the existing useClusterTopology hook to v2 TopologyResponse format.
 *
 * Provides three layers of filtering:
 * 1. View mode filtering (Cluster/Namespace/Workload/Resource/RBAC)
 * 2. Namespace selection (filter to specific namespaces)
 * 3. Both filters compose: e.g., "Workload" view + "default" namespace
 *
 * Also extracts the full namespace list from the unfiltered data
 * so the namespace picker always has the complete set.
 */
import { useMemo } from "react";
import { useClusterTopology } from "@/hooks/useClusterTopology";
import { transformGraph } from "../utils/transformGraph";
import type { TopologyResponse, TopologyNode, TopologyEdge, ViewMode } from "../types/topology";

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
    // Only include resources that belong to one of the selected namespaces.
    // Cluster-scoped resources (no namespace) are EXCLUDED — when the user
    // picks a specific namespace they want to see only that namespace's resources.
    if (!n.namespace) return false;
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
  const topology = useMemo<TopologyResponse | null>(() => {
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

    response.nodes = afterNamespace.nodes;
    response.edges = afterNamespace.edges;
    response.metadata.resourceCount = afterNamespace.nodes.length;
    response.metadata.edgeCount = afterNamespace.edges.length;
    response.metadata.mode = viewMode;

    if (selectedNamespaces.size === 1) {
      response.metadata.namespace = Array.from(selectedNamespaces)[0];
    }
    if (resource) response.metadata.focusResource = resource;

    return response;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, viewMode, namespacesKey, resource]);

  return {
    topology,
    allNamespaces,
    isLoading,
    isError: !!error,
    error,
    refetch,
  };
}
