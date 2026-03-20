/**
 * Fetches discovered clusters from Kubilitics backend (GET /api/v1/clusters/discover).
 * 
 * Performance optimization: Removed health gating - use circuit breaker instead.
 * This allows discovered clusters query to run in parallel with health check.
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { discoverClusters } from '@/services/backendApiClient';
import { useBackendCircuitOpen } from '@/hooks/useBackendCircuitOpen';

export function useDiscoverClusters() {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const circuitOpen = useBackendCircuitOpen();

  return useQuery({
    queryKey: ['backend', 'clusters', 'discover', backendBaseUrl],
    queryFn: () => discoverClusters(backendBaseUrl),
    enabled: isConfigured && !circuitOpen, // Removed health.isSuccess gating
    staleTime: 60_000, // Allow showing stale data immediately
    placeholderData: (previousData) => previousData, // Optimistic UI with cached data
    retry: 2, // Retry with exponential backoff - circuit breaker prevents storms
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
  });
}
