/**
 * Fetches node metrics from backend (GET /api/v1/clusters/{clusterId}/metrics/nodes/{nodeName}).
 * Uses only currentClusterId from backend config so we never send an ID the backend doesn't know.
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getNodeMetrics, type BackendNodeMetrics } from '@/services/backendApiClient';

export function useNodeMetrics(
  nodeName: string | undefined,
  options?: { enabled?: boolean; clusterIdOverride?: string | null }
) {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;

  const enabled =
    (options?.enabled !== false) &&
    !!isBackendConfigured() &&
    !!clusterId &&
    !!nodeName;

  return useQuery<BackendNodeMetrics, Error>({
    queryKey: ['backend', 'node-metrics', clusterId, nodeName],
    queryFn: () => getNodeMetrics(backendBaseUrl, clusterId!, nodeName!),
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
