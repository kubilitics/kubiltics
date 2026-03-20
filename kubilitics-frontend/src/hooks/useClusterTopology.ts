/**
 * Hook for fetching cluster-wide topology from backend
 * Uses react-query for caching and error handling
 */
import { useQuery } from '@tanstack/react-query';
import { getTopology } from '@/services/backendApiClient';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import type { TopologyGraph } from '@/topology-engine';

export interface UseClusterTopologyOptions {
  clusterId?: string | null;
  namespace?: string | null;
  enabled?: boolean;
}

export interface UseClusterTopologyResult {
  graph: TopologyGraph | undefined;
  isLoading: boolean;
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
  enabled = true,
}: UseClusterTopologyOptions): UseClusterTopologyResult {
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
    error,
    refetch,
  } = useQuery<TopologyGraph, Error>({
    // Task 8.1: queryKey per PRD Section 12.3
    queryKey: ['topology', clusterId, namespaceParam],
    queryFn: async () => {
      if (!clusterId) {
        throw new Error('Cluster not selected');
      }
      const result = await getTopology(effectiveBaseUrl, clusterId, {
        namespace: namespaceParam,
      });

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
    // Retry uses global defaults (3 retries with exponential backoff)
  });

  return {
    graph,
    isLoading,
    error: error || null,
    refetch: () => { refetch(); },
  };
}
