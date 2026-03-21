/**
 * Hook for fetching time-series metrics history from the backend ring buffer.
 * Calls GET /api/v1/clusters/{clusterId}/metrics/history.
 * Refetches every 30 seconds to accumulate live history.
 */

import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getMetricsHistory, type MetricsHistoryResponse } from '@/services/backendApiClient';
import type { MetricsSummaryResourceType } from './useMetricsSummary';

export function useMetricsHistory(
  resourceType: MetricsSummaryResourceType,
  namespace: string | undefined,
  resourceName: string | undefined,
  options?: { enabled?: boolean; duration?: string }
) {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;

  const needsNamespace = resourceType !== 'node';
  const enabled =
    (options?.enabled !== false) &&
    !!isBackendConfigured() &&
    !!clusterId &&
    !!resourceName &&
    (!needsNamespace || !!namespace);

  return useQuery<MetricsHistoryResponse, Error>({
    queryKey: ['backend', 'metrics-history', resourceType, clusterId, namespace, resourceName, options?.duration ?? '1h'],
    queryFn: () =>
      getMetricsHistory(backendBaseUrl, clusterId!, {
        namespace: needsNamespace ? namespace! : undefined,
        resource_type: resourceType,
        resource_name: resourceName!,
        duration: options?.duration ?? '1h',
      }),
    enabled,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}
