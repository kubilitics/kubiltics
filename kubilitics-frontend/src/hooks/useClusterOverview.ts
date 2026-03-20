/**
 * Fetches cluster overview from GET /api/v1/clusters/{clusterId}/overview.
 * Used by Dashboard for health gauge, pulse, alerts, and utilization.
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getClusterOverview } from '@/services/backendApiClient';

export function useClusterOverview(clusterId: string | undefined) {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  return useQuery({
    queryKey: ['backend', 'clusterOverview', backendBaseUrl, clusterId],
    queryFn: () => getClusterOverview(backendBaseUrl, clusterId!),
    enabled: isConfigured && !!clusterId,
    // staleTime=Infinity: useOverviewStream pushes live updates via
    // queryClient.setQueryData — no REST polling needed. The initial
    // queryFn fires once to pre-populate cache before the WS connects.
    staleTime: Infinity,
    refetchInterval: false,
  });
}
