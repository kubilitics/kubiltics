/**
 * useTopologyData — Bridges the existing useClusterTopology hook to v2 TopologyResponse format.
 *
 * The v2 backend API doesn't exist yet, so we transform the existing
 * TopologyGraph (from useClusterTopology) into TopologyResponse format
 * that the v2 components expect.
 */
import { useMemo } from "react";
import { useClusterTopology } from "@/hooks/useClusterTopology";
import { transformGraph } from "../utils/transformGraph";
import type { TopologyResponse, ViewMode } from "../types/topology";

export interface UseTopologyDataParams {
  clusterId: string | null;
  viewMode?: ViewMode;
  namespace?: string;
  resource?: string;
  enabled?: boolean;
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

  // Transform to v2 format
  const topology = useMemo<TopologyResponse | null>(() => {
    if (!graph) return null;
    const response = transformGraph(graph);
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
