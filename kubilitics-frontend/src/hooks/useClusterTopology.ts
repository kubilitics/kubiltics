/**
 * Hook for fetching cluster-wide topology from backend
 * Uses react-query for caching and error handling
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getTopology } from '@/services/backendApiClient';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import type { TopologyGraph } from '@/topology/graph';

export interface UseClusterTopologyOptions {
  clusterId?: string | null;
  namespace?: string | null;
  depth?: number;
  enabled?: boolean;
}

export interface UseClusterTopologyResult {
  graph: TopologyGraph | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetches cluster-wide topology from backend API.
 * Same pattern as useResourceTopology: enable when isBackendConfigured() and clusterId are set.
 */
export function useClusterTopology({
  clusterId,
  namespace,
  depth,
  enabled = true,
}: UseClusterTopologyOptions): UseClusterTopologyResult {
  const queryClient = useQueryClient();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  const namespaceParam =
    namespace && namespace !== 'all' ? namespace : undefined;

  const queryEnabled =
    enabled &&
    !!clusterId &&
    isBackendConfigured();

  const {
    data: graph,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<TopologyGraph, Error>({
    // Task 8.1: queryKey per PRD Section 12.3 — depth included so each level is cached separately
    queryKey: ['topology', clusterId, namespaceParam, depth ?? 0],
    queryFn: async () => {
      if (!clusterId) {
        throw new Error('Cluster not selected');
      }

      // 8-second timeout — prevents infinite loading spinners
      const FETCH_TIMEOUT_MS = 8_000;
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('Request timed out — the backend took too long to respond')),
          FETCH_TIMEOUT_MS,
        );
      });

      const result = await Promise.race([
        getTopology(effectiveBaseUrl, clusterId, {
          namespace: namespaceParam,
          depth,
        }),
        timeout,
      ]);

      if (!result) {
        throw new Error('Empty response from topology API');
      }
      if (!Array.isArray(result.nodes)) {
        throw new Error('Invalid response: nodes is not an array');
      }
      if (!Array.isArray(result.edges)) {
        throw new Error('Invalid response: edges is not an array');
      }

      return result;
    },
    enabled: queryEnabled,
    // Removed refetchInterval - rely on global defaults (refetchOnWindowFocus/reconnect)
    staleTime: 60_000,       // Increased from 10s to 60s - allow stale data
    retry: 1,                // Only retry once — fail fast, show error state
    retryDelay: 2_000,       // 2s before retry
  });

  const queryKey = ['topology', clusterId, namespaceParam, depth ?? 0];

  return {
    graph,
    isLoading,
    isFetching,
    error: error || null,
    refetch: () => {
      // Invalidate cache first so react-query ignores staleTime and
      // makes a real network request. Without this, refetch() on
      // "fresh" data (within 60s staleTime) is a no-op.
      queryClient.invalidateQueries({ queryKey });
    },
  };
}
