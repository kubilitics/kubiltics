/**
 * Fetches cluster list from Kubilitics backend (GET /api/v1/clusters).
 * When gateOnHealth is true (Connect page only): run health first, then clusters — avoids request storm when backend is down.
 * When gateOnHealth is false (default): run clusters immediately so HomePage, ProjectDetail, dialogs get clusters without delay.
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getClusters } from '@/services/backendApiClient';
import { useBackendCircuitOpen } from '@/hooks/useBackendCircuitOpen';
import { useBackendHealth } from '@/hooks/useBackendHealth';

export interface UseClustersFromBackendOptions {
  /** When true, clusters fetch only after health succeeds (use only on Connect page to avoid storm). Default false. */
  gateOnHealth?: boolean;
}

export function useClustersFromBackend(options?: UseClustersFromBackendOptions) {
  const gateOnHealth = options?.gateOnHealth === true;
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const circuitOpen = useBackendCircuitOpen();
  const health = useBackendHealth({ enabled: gateOnHealth, gateOnHealth });

  const enabled = gateOnHealth
    ? isConfigured && !circuitOpen && health.isSuccess
    : isConfigured && !circuitOpen;

  return useQuery({
    queryKey: ['backend', 'clusters', backendBaseUrl],
    queryFn: () => getClusters(backendBaseUrl),
    enabled,
    staleTime: 30_000,
  });
}
