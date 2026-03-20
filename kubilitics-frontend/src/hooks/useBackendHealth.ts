/**
 * Backend health check. When backend is configured, optionally verify reachability.
 * Per A3.5: support error states and recovery (backend unreachable).
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getHealth } from '@/services/backendApiClient';

/** P1-4 / P2-17: Options for gate-on-health (ClusterConnect) vs periodic banner check. */
export function useBackendHealth(options?: {
  refetchInterval?: number;
  enabled?: boolean;
  /** When true (Connect page): no cache, no retry — backend down detected immediately. */
  gateOnHealth?: boolean;
  /** Override retry count. Default: 3 with exponential backoff. */
  retry?: number;
}) {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const gateOnHealth = options?.gateOnHealth === true;

  return useQuery({
    queryKey: ['backend', 'health', backendBaseUrl],
    queryFn: () => getHealth(backendBaseUrl),
    enabled: isConfigured() && (options?.enabled !== false),
    refetchInterval: options?.refetchInterval ?? false,
    // Use exponential backoff retry: 3 retries with 1s, 2s, 4s delays
    retry: options?.retry ?? (gateOnHealth ? 0 : 3),
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    // Allow stale data for 60 seconds (show cached health status immediately)
    staleTime: gateOnHealth ? 0 : 60_000,
    // Optimistic UI: show cached health status immediately
    placeholderData: (previousData) => previousData,
  });
}
