/**
 * Fetches deployment metrics from backend (GET .../metrics/{namespace}/deployment/{name}).
 * Returns aggregated CPU/Memory and per-pod breakdown when backend is configured.
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveCluster, useClusterPresenceStore } from '@/stores/clusterPresenceStore';
import { getDeploymentMetrics, type BackendDeploymentMetrics } from '@/services/backendApiClient';

import { useActiveClusterId } from '@/hooks/useActiveClusterId';
export function useDeploymentMetrics(
  namespace: string | undefined,
  deploymentName: string | undefined,
  options?: { enabled?: boolean }
) {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const activeCluster = useActiveCluster();
  const currentClusterId = useActiveClusterId();
  const clusters = useClusterPresenceStore((s) => s.availableClusters());
  const clusterId = currentClusterId ?? undefined;

  const enabled =
    (options?.enabled !== false) &&
    !!isBackendConfigured &&
    !!clusterId &&
    !!namespace &&
    !!deploymentName;

  return useQuery<BackendDeploymentMetrics, Error>({
    queryKey: ['backend', 'deployment-metrics', clusterId, namespace, deploymentName],
    queryFn: () => getDeploymentMetrics(backendBaseUrl, clusterId!, namespace!, deploymentName!),
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
