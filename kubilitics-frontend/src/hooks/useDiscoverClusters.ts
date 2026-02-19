/**
 * Fetches discovered clusters from Kubilitics backend (GET /api/v1/clusters/discover).
 * Only used on Connect page; gated on health + circuit so we don't storm when backend is down.
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { discoverClusters } from '@/services/backendApiClient';
import { useBackendCircuitOpen } from '@/hooks/useBackendCircuitOpen';
import { useBackendHealth } from '@/hooks/useBackendHealth';

export function useDiscoverClusters() {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const circuitOpen = useBackendCircuitOpen();
  const health = useBackendHealth({ enabled: true });

  return useQuery({
    queryKey: ['backend', 'clusters', 'discover', backendBaseUrl],
    queryFn: () => discoverClusters(backendBaseUrl),
    enabled: isConfigured && !circuitOpen && health.isSuccess,
    staleTime: 60_000,
  });
}
