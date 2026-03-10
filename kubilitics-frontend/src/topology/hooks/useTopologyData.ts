/**
 * useTopologyData — Bridges the existing useClusterTopology hook to v2 TopologyResponse format.
 *
 * The v2 backend API doesn't exist yet, so we transform the existing
 * TopologyGraph (from useClusterTopology) into TopologyResponse format
 * that the v2 components expect.
 *
 * View mode filtering:
 * - cluster:   Only cluster-scoped resources (Nodes, Namespaces, PVs, StorageClasses, ClusterRoles, etc.)
 * - namespace:  ALL resources (default full view)
 * - workload:   Only workload resources (Deployments, StatefulSets, DaemonSets, Pods, etc.) + networking
 * - resource:   BFS from a specific resource (handled by resource-specific topology)
 * - rbac:       Only RBAC resources (ServiceAccounts, Roles, RoleBindings, etc.)
 */
import { useMemo } from "react";
import { useClusterTopology } from "@/hooks/useClusterTopology";
import { transformGraph } from "../utils/transformGraph";
import type { TopologyResponse, TopologyNode, TopologyEdge, ViewMode } from "../types/topology";

export interface UseTopologyDataParams {
  clusterId: string | null;
  viewMode?: ViewMode;
  namespace?: string;
  resource?: string;
  enabled?: boolean;
}

/** Kinds visible per view mode */
const VIEW_MODE_KINDS: Record<ViewMode, string[] | null> = {
  // null = show all
  namespace: null,
  cluster: [
    "Node", "Namespace", "PersistentVolume", "StorageClass",
    "ClusterRole", "ClusterRoleBinding", "IngressClass",
    "PriorityClass", "RuntimeClass",
    "MutatingWebhookConfiguration", "ValidatingWebhookConfiguration",
  ],
  workload: [
    "Deployment", "StatefulSet", "DaemonSet", "ReplicaSet",
    "Pod", "Job", "CronJob", "ReplicationController",
    "Service", "Ingress", "Endpoints", "EndpointSlice",
    "ConfigMap", "Secret",
    "HorizontalPodAutoscaler", "PodDisruptionBudget",
  ],
  resource: null, // Resource mode uses BFS from a focus resource — show all
  rbac: [
    "ServiceAccount", "Role", "ClusterRole",
    "RoleBinding", "ClusterRoleBinding", "Namespace",
  ],
};

/** Category-based filtering as a fallback when kind doesn't match exactly */
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

  // null means show everything
  if (!allowedKinds && !allowedCategories) {
    return { nodes, edges };
  }

  const filteredNodes = nodes.filter((n) => {
    if (allowedKinds && allowedKinds.includes(n.kind)) return true;
    if (allowedCategories && allowedCategories.includes(n.category)) return true;
    return false;
  });

  // Only keep edges where both source and target are in filtered set
  const nodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  return { nodes: filteredNodes, edges: filteredEdges };
}

export function useTopologyData({
  clusterId,
  viewMode = "namespace",
  namespace = "",
  resource = "",
  enabled = true,
}: UseTopologyDataParams) {
  // Use the existing working hook that talks to the real backend API
  const { graph, isLoading, error, refetch } = useClusterTopology({
    clusterId,
    namespace: namespace || undefined,
    enabled: enabled && !!clusterId,
  });

  // Transform to v2 format and apply view mode filtering
  const topology = useMemo<TopologyResponse | null>(() => {
    if (!graph) return null;
    const response = transformGraph(graph);

    // Apply view mode filtering
    const filtered = filterByViewMode(response.nodes, response.edges, viewMode);
    response.nodes = filtered.nodes;
    response.edges = filtered.edges;
    response.metadata.resourceCount = filtered.nodes.length;
    response.metadata.edgeCount = filtered.edges.length;

    response.metadata.mode = viewMode;
    if (namespace) response.metadata.namespace = namespace;
    if (resource) response.metadata.focusResource = resource;
    return response;
  }, [graph, viewMode, namespace, resource]);

  return {
    topology,
    isLoading,
    isError: !!error,
    error,
    refetch,
  };
}
