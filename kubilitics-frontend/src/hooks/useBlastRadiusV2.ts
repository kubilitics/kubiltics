/**
 * Hook for fetching cluster-wide blast radius analysis (V2).
 * Polls graph-status until the graph is ready, then fetches the blast radius result.
 */
import { useQuery } from '@tanstack/react-query';
import { getBlastRadius, getGraphStatus } from '@/services/api/blastRadius';
import { useActiveClusterId } from './useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import type { BlastRadiusResult, GraphStatus } from '@/services/api/types';

export interface UseBlastRadiusV2Options {
  kind: string;
  namespace?: string | null;
  name?: string | null;
  enabled?: boolean;
}

export interface UseBlastRadiusV2Return {
  data: BlastRadiusResult | undefined;
  graphStatus: GraphStatus | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  /** True while the cluster dependency graph is still being built. */
  isGraphBuilding: boolean;
}

/**
 * Fetches blast radius analysis for a specific resource (V2 — cluster-wide graph).
 *
 * Strategy:
 *  1. Poll graph-status every 2 s until the graph reports ready.
 *  2. Once the graph is ready, issue the blast-radius query for the target resource.
 */
export function useBlastRadiusV2({
  kind,
  namespace,
  name,
  enabled = true,
}: UseBlastRadiusV2Options): UseBlastRadiusV2Return {
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  const normalizedNamespace = namespace ?? '';
  const normalizedName = name ?? '';

  const baseEnabled = enabled && !!clusterId && isBackendConfigured;

  // --- Step 1: poll graph-status until graph is ready ---
  const {
    data: graphStatus,
    isLoading: isGraphStatusLoading,
    error: graphStatusError,
  } = useQuery<GraphStatus, Error>({
    queryKey: ['blast-radius-graph-status', clusterId],
    queryFn: async () => {
      if (!clusterId) throw new Error('Cluster not selected');
      return getGraphStatus(effectiveBaseUrl, clusterId);
    },
    enabled: baseEnabled,
    // Poll every 2 s while the graph is not yet ready; stop polling once ready.
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.ready ? false : 2_000;
    },
    staleTime: 0,
    retry: 2,
    retryDelay: 1_000,
  });

  const graphReady = graphStatus?.ready === true;
  const isGraphBuilding = baseEnabled && !graphReady && !graphStatusError;

  // --- Step 2: fetch blast radius once graph is ready ---
  const blastEnabled =
    baseEnabled &&
    graphReady &&
    !!kind &&
    !!normalizedName;

  const {
    data,
    isLoading: isBlastLoading,
    isFetching,
    error: blastError,
  } = useQuery<BlastRadiusResult, Error>({
    queryKey: ['blast-radius-v2', clusterId, kind, normalizedNamespace, normalizedName],
    queryFn: async () => {
      if (!clusterId) throw new Error('Cluster not selected');
      if (!normalizedName) throw new Error('Resource name is required');
      return getBlastRadius(
        effectiveBaseUrl,
        clusterId,
        normalizedNamespace,
        kind,
        normalizedName,
      );
    },
    enabled: blastEnabled,
    staleTime: 60_000,
    retry: (failureCount, err) => {
      // Don't retry on 404 — endpoint does not exist
      if (err && 'status' in err && (err as { status: number }).status === 404) return false;
      return failureCount < 2;
    },
    retryDelay: 1_000,
  });

  const isLoading = isGraphStatusLoading || (graphReady && isBlastLoading);
  const error = (blastError ?? graphStatusError) ?? null;

  return {
    data,
    graphStatus,
    isLoading,
    isFetching,
    error,
    isGraphBuilding,
  };
}
