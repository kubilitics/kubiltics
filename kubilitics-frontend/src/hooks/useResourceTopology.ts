/**
 * Hook for fetching resource-scoped topology from backend
 * Uses react-query for caching and error handling
 */
import { useQuery } from '@tanstack/react-query';
import { getResourceTopology } from '@/services/backendApiClient';
import { useActiveClusterId } from './useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import type { TopologyGraph } from '@/topology-engine';

export interface UseResourceTopologyOptions {
  kind: string;
  namespace?: string | null;
  name?: string | null;
  enabled?: boolean;
}

export interface UseResourceTopologyResult {
  graph: TopologyGraph | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetches resource-scoped topology from backend API.
 * Follows the same enabled-check pattern as useClustersFromBackend, useBackendHealth, etc.:
 * relies on isBackendConfigured() (which handles '' proxy URL in dev) and does NOT
 * check !!effectiveBaseUrl (which is '' in dev and would be falsy).
 */
export function useResourceTopology({
  kind,
  namespace,
  name,
  enabled = true,
}: UseResourceTopologyOptions): UseResourceTopologyResult {
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  const normalizedKind = normalizeKindForTopology(kind);
  const normalizedNamespace = namespace ?? '';
  const normalizedName = name ?? '';

  // Match the pattern used by every other hook: isBackendConfigured() handles the
  // dev-proxy case where effectiveBaseUrl is '' (empty string, which is valid).
  const queryEnabled =
    enabled &&
    !!clusterId &&
    isBackendConfigured() &&
    !!normalizedKind &&
    !!normalizedName;

  const {
    data: graph,
    isLoading,
    error,
    refetch,
  } = useQuery<TopologyGraph, Error>({
    queryKey: ['resource-topology', clusterId, normalizedKind, normalizedNamespace, normalizedName],
    queryFn: async () => {
      if (!clusterId) {
        throw new Error('Cluster not selected');
      }
      if (!normalizedName) {
        throw new Error('Resource name is required');
      }
      const workloadKinds = ['Pod', 'Deployment', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'Service', 'ConfigMap', 'Secret', 'PersistentVolumeClaim'];
      if (workloadKinds.includes(normalizedKind) && !normalizedNamespace) {
        throw new Error(`${normalizedKind} requires a namespace`);
      }

      const result = await getResourceTopology(
        effectiveBaseUrl,
        clusterId,
        normalizedKind,
        normalizedNamespace,
        normalizedName
      );

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
    staleTime: 30_000,
    retry: 2,
    retryDelay: 1000,
  });

  return {
    graph,
    isLoading,
    error: error || null,
    refetch: () => { refetch(); },
  };
}
