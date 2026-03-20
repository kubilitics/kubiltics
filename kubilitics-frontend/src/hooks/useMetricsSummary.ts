/**
 * Single hook for metrics of any resource (pod, node, deployment, replicaset, statefulset, daemonset, job, cronjob).
 * Calls the unified backend GET /api/v1/clusters/{clusterId}/metrics/summary.
 * Uses only currentClusterId when backend is configured so we never send an ID the backend
 * does not know. currentClusterId is set when the user connects via Connect or selects a cluster in the Header.
 */

import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getMetricsSummary, type BackendMetricsQueryResult } from '@/services/backendApiClient';

export type MetricsSummaryResourceType =
  | 'pod'
  | 'node'
  | 'deployment'
  | 'replicaset'
  | 'statefulset'
  | 'daemonset'
  | 'job'
  | 'cronjob';

export function useMetricsSummary(
  resourceType: MetricsSummaryResourceType,
  namespace: string | undefined,
  resourceName: string | undefined,
  options?: { enabled?: boolean }
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

  return useQuery<BackendMetricsQueryResult, Error>({
    queryKey: ['backend', 'metrics-summary', resourceType, clusterId, namespace, resourceName],
    queryFn: () =>
      getMetricsSummary(backendBaseUrl, clusterId!, {
        namespace: needsNamespace ? namespace! : undefined,
        resource_type: resourceType,
        resource_name: resourceName!,
      }),
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
