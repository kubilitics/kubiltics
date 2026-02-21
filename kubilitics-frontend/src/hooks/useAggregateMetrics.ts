/**
 * Unified hook for metrics of workload controllers that own pods.
 * One hook for Deployment, ReplicaSet, StatefulSet, DaemonSet, Job, and CronJob.
 * Uses only currentClusterId from backend config so we never send an ID the backend doesn't know.
 */

import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import {
  getDeploymentMetrics,
  getReplicaSetMetrics,
  getStatefulSetMetrics,
  getDaemonSetMetrics,
  getJobMetrics,
  getCronJobMetrics,
  type BackendDeploymentMetrics,
} from '@/services/backendApiClient';

/** Resource kinds that have aggregate metrics (controller → pods). */
export type AggregateMetricsKind =
  | 'deployment'
  | 'replicaset'
  | 'statefulset'
  | 'daemonset'
  | 'job'
  | 'cronjob';

const API_GETTERS: Record<
  AggregateMetricsKind,
  (baseUrl: string, clusterId: string, ns: string, name: string) => Promise<BackendDeploymentMetrics>
> = {
  deployment: getDeploymentMetrics,
  replicaset: getReplicaSetMetrics,
  statefulset: getStatefulSetMetrics,
  daemonset: getDaemonSetMetrics,
  job: getJobMetrics,
  cronjob: getCronJobMetrics,
};

/**
 * Fetches aggregate metrics for a workload. Uses only currentClusterId so metrics
 * work consistently for all resource types (Deployment, ReplicaSet, StatefulSet, etc.).
 */
export function useAggregateMetrics(
  kind: AggregateMetricsKind,
  namespace: string | undefined,
  name: string | undefined,
  options?: { enabled?: boolean; clusterIdOverride?: string | null }
) {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;

  const enabled =
    (options?.enabled !== false) &&
    !!isBackendConfigured() &&
    !!clusterId &&
    !!namespace &&
    !!name;

  const getter = API_GETTERS[kind];

  return useQuery<BackendDeploymentMetrics, Error>({
    queryKey: ['backend', 'aggregate-metrics', kind, clusterId, namespace, name],
    queryFn: () => getter(backendBaseUrl, clusterId!, namespace!, name!),
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
