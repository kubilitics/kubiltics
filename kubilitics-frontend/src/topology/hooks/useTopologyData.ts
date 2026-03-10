import { useQuery } from "@tanstack/react-query";
import { getEffectiveBackendBaseUrl } from "@/stores/backendConfigStore";
import { getTopologyV2 } from "@/services/backendApiClient";
import type { ViewMode } from "../types/topology";

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
  const baseUrl = getEffectiveBackendBaseUrl();
  const query = useQuery({
    queryKey: ["topology-v2", clusterId ?? "", viewMode, namespace, resource],
    queryFn: () =>
      getTopologyV2(baseUrl!, clusterId!, {
        mode: viewMode,
        namespace: namespace || undefined,
        resource: resource || undefined,
      }),
    enabled: !!(enabled && baseUrl && clusterId),
    staleTime: 30 * 1000,
  });
  return {
    topology: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
