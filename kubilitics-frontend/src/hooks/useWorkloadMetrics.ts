/**
 * Fetches workload metrics (ReplicaSet, StatefulSet, DaemonSet, Job, CronJob) from backend.
 * Returns aggregated CPU/Memory and per-pod breakdown (same shape as deployment metrics).
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import {
  getReplicaSetMetrics,
  getStatefulSetMetrics,
  getDaemonSetMetrics,
  getJobMetrics,
  getCronJobMetrics,
  type BackendDeploymentMetrics,
} from '@/services/backendApiClient';

export type WorkloadMetricsType = 'replicaset' | 'statefulset' | 'daemonset' | 'job' | 'cronjob';

const getters: Record<WorkloadMetricsType, (baseUrl: string, clusterId: string, ns: string, name: string) => Promise<BackendDeploymentMetrics>> = {
  replicaset: getReplicaSetMetrics,
  statefulset: getStatefulSetMetrics,
  daemonset: getDaemonSetMetrics,
  job: getJobMetrics,
  cronjob: getCronJobMetrics,
};

export function useWorkloadMetrics(
  resourceType: WorkloadMetricsType,
  namespace: string | undefined,
  name: string | undefined,
  options?: { enabled?: boolean }
) {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;

  const enabled =
    (options?.enabled !== false) &&
    !!isBackendConfigured() &&
    !!clusterId &&
    !!namespace &&
    !!name;

  const getter = getters[resourceType];

  return useQuery<BackendDeploymentMetrics, Error>({
    queryKey: ['backend', 'workload-metrics', resourceType, clusterId, namespace, name],
    queryFn: () => getter(backendBaseUrl, clusterId!, namespace!, name!),
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
