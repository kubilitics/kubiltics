/**
 * Fetches CPU/Memory metrics for multiple workload resources (current page) from the unified
 * backend GET .../metrics/summary. Used by list pages to show real metrics per row.
 * Runs for the current page items (up to 50); same pattern as Pods list.
 */

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getMetricsSummary, type BackendMetricsQueryResult } from '@/services/backendApiClient';

export type WorkloadMetricsMapResourceType =
  | 'deployment'
  | 'replicaset'
  | 'statefulset'
  | 'daemonset'
  | 'job'
  | 'cronjob';

export interface WorkloadMetricsEntry {
  namespace: string;
  name: string;
}

export interface WorkloadMetricsMapResult {
  cpu: string;
  memory: string;
}

const MAX_ENTRIES = 50;

export function useWorkloadMetricsMap(
  resourceType: WorkloadMetricsMapResourceType,
  entries: WorkloadMetricsEntry[],
  options?: { enabled?: boolean }
) {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;

  const boundedEntries = useMemo(
    () => (entries.length > MAX_ENTRIES ? entries.slice(0, MAX_ENTRIES) : entries),
    [entries]
  );

  const baseEnabled =
    (options?.enabled !== false) &&
    !!isBackendConfigured() &&
    !!clusterId &&
    boundedEntries.length > 0;

  const queries = useQueries({
    queries: boundedEntries.map((entry) => ({
      queryKey: ['backend', 'metrics-summary', resourceType, clusterId, entry.namespace, entry.name],
      queryFn: (): Promise<BackendMetricsQueryResult> =>
        getMetricsSummary(backendBaseUrl!, clusterId!, {
          namespace: entry.namespace,
          resource_type: resourceType,
          resource_name: entry.name,
        }),
      enabled: baseEnabled,
      staleTime: 60_000,
      refetchInterval: 60_000,
    })),
  });

  const map = useMemo(() => {
    const result: Record<string, WorkloadMetricsMapResult> = {};
    boundedEntries.forEach((entry, i) => {
      const key = `${entry.namespace}/${entry.name}`;
      const queryResult = queries[i]?.data;
      const summary = queryResult?.summary;
      if (summary?.total_cpu != null && summary?.total_memory != null) {
        result[key] = { cpu: summary.total_cpu, memory: summary.total_memory };
      }
    });
    return result;
  }, [boundedEntries, queries]);

  const isLoading = queries.some((q) => q.isLoading);
  return { metricsMap: map, isLoading };
}

/** Consistent fallback for list table cells when metrics are missing. */
export function formatMetricsCell(
  cpu: string | undefined,
  memory: string | undefined
): { cpu: string; memory: string } {
  return { cpu: cpu ?? '-', memory: memory ?? '-' };
}
