/**
 * Fetches single-pod metrics from backend (GET /api/v1/clusters/{clusterId}/metrics/{namespace}/{pod}).
 * Uses only currentClusterId from backend config so we never send an ID the backend doesn't know.
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getPodMetrics, type BackendPodMetrics } from '@/services/backendApiClient';

export function usePodMetrics(
  namespace: string | undefined,
  podName: string | undefined,
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
    !!namespace &&
    !!podName;

  return useQuery<BackendPodMetrics, Error>({
    queryKey: ['backend', 'pod-metrics', clusterId, namespace, podName],
    queryFn: () => getPodMetrics(backendBaseUrl, clusterId!, namespace!, podName!),
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
