/**
 * Fetches cluster summary from GET /api/v1/clusters/{clusterId}/summary.
 * Used by Dashboard for Quick Stats. Gated by circuit so we don't storm the backend when down.
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getClusterSummary } from '@/services/backendApiClient';
import { useBackendCircuitOpen } from '@/hooks/useBackendCircuitOpen';

export function useClusterSummary(clusterId: string | undefined) {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const circuitOpen = useBackendCircuitOpen();

  return useQuery({
    queryKey: ['backend', 'clusterSummary', backendBaseUrl, clusterId],
    queryFn: () => getClusterSummary(backendBaseUrl, clusterId!),
    enabled: isConfigured && !!clusterId && !circuitOpen,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
