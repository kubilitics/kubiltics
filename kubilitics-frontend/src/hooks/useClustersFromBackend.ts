/**
 * Fetches cluster list from Kubilitics backend (GET /api/v1/clusters).
 * 
 * Performance optimization: Removed gateOnHealth - use circuit breaker instead.
 * This allows clusters query to run in parallel with health check, reducing startup time.
 * Circuit breaker prevents request storms when backend is down.
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getClusters } from '@/services/backendApiClient';
import { useBackendCircuitOpen } from '@/hooks/useBackendCircuitOpen';

export interface UseClustersFromBackendOptions {
  /** @deprecated Use circuit breaker instead - removed health gating for parallel execution */
  gateOnHealth?: boolean;
}

export function useClustersFromBackend(options?: UseClustersFromBackendOptions) {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const circuitOpen = useBackendCircuitOpen();

  // Removed gateOnHealth - circuit breaker handles backend down scenarios
  // This allows clusters query to run in parallel with health check
  const enabled = isConfigured && !circuitOpen;

  return useQuery({
    queryKey: ['backend', 'clusters', backendBaseUrl],
    queryFn: () => getClusters(backendBaseUrl),
    enabled,
    staleTime: 60_000, // Allow showing stale data immediately
    // Use placeholderData to show cached clusters immediately while fresh data loads
    placeholderData: (previousData) => previousData,
    // Retry with exponential backoff - circuit breaker will prevent storms
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
  });
}
