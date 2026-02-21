/**
 * Fetches workloads overview from GET /api/v1/clusters/{clusterId}/workloads.
 * When backend is not configured, aggregates from useK8sResourceList (deployments, statefulsets, etc.).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { getWorkloadsOverview, type WorkloadsOverview } from '@/services/backendApiClient';
import { useK8sResourceList } from './useKubernetes';
import { useClusterOverview } from './useClusterOverview';

function aggregateFromK8s(
  deployments: Record<string, unknown>[],
  statefulsets: Record<string, unknown>[],
  daemonsets: Record<string, unknown>[],
  jobs: Record<string, unknown>[],
  cronjobs: Record<string, unknown>[],
  podStatus: { running: number; pending: number; failed: number; succeeded: number },
  alerts: { warnings: number; critical: number }
): WorkloadsOverview {
  const workloads: WorkloadsOverview['workloads'] = [];

  const parseDeployment = (d: Record<string, unknown>) => {
    const status = (d.status as Record<string, unknown>) ?? {};
    const spec = (d.spec as Record<string, unknown>) ?? {};
    const meta = (d.metadata as Record<string, unknown>) ?? {};
    const ready = (status.readyReplicas as number) ?? 0;
    const desired = (spec.replicas as number) ?? 1;
    let statusStr = 'Running';
    if (ready < desired && desired > 0) statusStr = 'Pending';
    else if (desired === 0) statusStr = 'Scaled to Zero';
    return {
      kind: 'Deployment',
      name: (meta.name as string) ?? '',
      namespace: (meta.namespace as string) ?? 'default',
      status: statusStr,
      ready,
      desired,
      pressure: ready < desired && desired > 0 ? 'Medium' : 'Low',
    };
  };

  const parseStatefulSet = (d: Record<string, unknown>) => {
    const status = (d.status as Record<string, unknown>) ?? {};
    const spec = (d.spec as Record<string, unknown>) ?? {};
    const meta = (d.metadata as Record<string, unknown>) ?? {};
    const ready = (status.readyReplicas as number) ?? 0;
    const desired = (spec.replicas as number) ?? 1;
    return {
      kind: 'StatefulSet',
      name: (meta.name as string) ?? '',
      namespace: (meta.namespace as string) ?? 'default',
      status: ready >= desired ? 'Healthy' : 'Pending',
      ready,
      desired,
      pressure: ready < desired && desired > 0 ? 'Medium' : 'Low',
    };
  };

  const parseDaemonSet = (d: Record<string, unknown>) => {
    const status = (d.status as Record<string, unknown>) ?? {};
    const meta = (d.metadata as Record<string, unknown>) ?? {};
    const ready = (status.numberReady as number) ?? 0;
    const desired = (status.desiredNumberScheduled as number) ?? 0;
    return {
      kind: 'DaemonSet',
      name: (meta.name as string) ?? '',
      namespace: (meta.namespace as string) ?? 'default',
      status: ready >= desired ? 'Optimal' : 'Pending',
      ready,
      desired,
      pressure: ready < desired && desired > 0 ? 'Medium' : 'Low',
    };
  };

  const parseJob = (d: Record<string, unknown>) => {
    const status = (d.status as Record<string, unknown>) ?? {};
    const spec = (d.spec as Record<string, unknown>) ?? {};
    const meta = (d.metadata as Record<string, unknown>) ?? {};
    const succeeded = (status.succeeded as number) ?? 0;
    const failed = (status.failed as number) ?? 0;
    const active = (status.active as number) ?? 0;
    const completions = (spec.completions as number) ?? 1;
    let statusStr = 'Running';
    if (succeeded >= completions) statusStr = 'Completed';
    else if (failed > 0) statusStr = 'Failed';
    return {
      kind: 'Job',
      name: (meta.name as string) ?? '',
      namespace: (meta.namespace as string) ?? 'default',
      status: statusStr,
      ready: succeeded,
      desired: completions,
      pressure: failed > 0 ? 'High' : active > 0 ? 'Low' : 'Zero',
    };
  };

  const parseCronJob = (d: Record<string, unknown>) => {
    const status = (d.status as Record<string, unknown>) ?? {};
    const meta = (d.metadata as Record<string, unknown>) ?? {};
    const active = Array.isArray(status.active) ? (status.active as unknown[]).length : 0;
    return {
      kind: 'CronJob',
      name: (meta.name as string) ?? '',
      namespace: (meta.namespace as string) ?? 'default',
      status: active > 0 ? 'Running' : 'Scheduled',
      ready: active,
      desired: 0,
      pressure: active > 0 ? 'Low' : 'Zero',
    };
  };

  for (const d of deployments ?? []) {
    const item = d as Record<string, unknown>;
    if (item.metadata) workloads.push(parseDeployment(item));
  }
  for (const d of statefulsets ?? []) {
    const item = d as Record<string, unknown>;
    if (item.metadata) workloads.push(parseStatefulSet(item));
  }
  for (const d of daemonsets ?? []) {
    const item = d as Record<string, unknown>;
    if (item.metadata) workloads.push(parseDaemonSet(item));
  }
  for (const d of jobs ?? []) {
    const item = d as Record<string, unknown>;
    if (item.metadata) workloads.push(parseJob(item));
  }
  for (const d of cronjobs ?? []) {
    const item = d as Record<string, unknown>;
    if (item.metadata) workloads.push(parseCronJob(item));
  }

  const ps = podStatus;

  let healthy = 0;
  let warning = 0;
  let crit = 0;
  for (const w of workloads) {
    if (['Running', 'Healthy', 'Optimal', 'Completed', 'Scheduled', 'Scaled to Zero'].includes(w.status)) healthy++;
    else if (w.status === 'Pending') warning++;
    else if (w.status === 'Failed') crit++;
    else healthy++;
  }

  const total = workloads.length + ps.running + ps.pending + ps.failed + ps.succeeded;
  const totalHealthy = healthy + ps.running + ps.succeeded;
  const totalWarning = warning + ps.pending + alerts.warnings;
  const totalCrit = crit + ps.failed + alerts.critical;
  const _alerts = alerts;

  const optimalPct = total > 0 ? (totalHealthy / total) * 100 : 100;

  return {
    pulse: {
      total: total || 1,
      healthy: totalHealthy,
      warning: totalWarning,
      critical: totalCrit,
      optimal_percent: Math.min(100, optimalPct),
    },
    workloads,
    alerts: {
      warnings: _alerts.warnings,
      critical: _alerts.critical,
      top_3: [],
    },
  };
}

export function useWorkloadsOverview() {
  const { activeCluster } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const clusterId = currentClusterId ?? undefined;

  const backendQuery = useQuery({
    queryKey: ['backend', 'workloads', backendBaseUrl, clusterId],
    queryFn: () => getWorkloadsOverview(backendBaseUrl, clusterId!),
    enabled: isBackendConfigured() && !!clusterId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  // Fallback resource list queries: only fire when backend is NOT configured (direct K8s mode).
  // When backend is configured, the backendQuery handles data — avoid 6 × limit:5000 requests.
  const fallbackEnabled = !isBackendConfigured() && !!(activeCluster || clusterId);
  const deployments = useK8sResourceList('deployments', undefined, {
    enabled: fallbackEnabled,
    limit: 500,
    refetchInterval: false,
    staleTime: 60_000,
  });
  const statefulsets = useK8sResourceList('statefulsets', undefined, {
    enabled: fallbackEnabled,
    limit: 500,
    refetchInterval: false,
    staleTime: 60_000,
  });
  const daemonsets = useK8sResourceList('daemonsets', undefined, {
    enabled: fallbackEnabled,
    limit: 500,
    refetchInterval: false,
    staleTime: 60_000,
  });
  const jobs = useK8sResourceList('jobs', undefined, {
    enabled: fallbackEnabled,
    limit: 500,
    refetchInterval: false,
    staleTime: 60_000,
  });
  const cronjobs = useK8sResourceList('cronjobs', undefined, {
    enabled: fallbackEnabled,
    limit: 500,
    refetchInterval: false,
    staleTime: 60_000,
  });
  const pods = useK8sResourceList('pods', undefined, {
    enabled: fallbackEnabled,
    limit: 500,
    refetchInterval: false,
    staleTime: 30_000,
  });
  const overview = useClusterOverview(clusterId);
  const fallback = useMemo(() => {
    const depItems = (deployments.data?.items ?? []) as Record<string, unknown>[];
    const ssItems = (statefulsets.data?.items ?? []) as Record<string, unknown>[];
    const dsItems = (daemonsets.data?.items ?? []) as Record<string, unknown>[];
    const jobItems = (jobs.data?.items ?? []) as Record<string, unknown>[];
    const cjItems = (cronjobs.data?.items ?? []) as Record<string, unknown>[];

    const podStatus = { running: 0, pending: 0, failed: 0, succeeded: 0 };
    const podItems = (pods.data?.items ?? []) as Array<{ status?: { phase?: string } }>;
    for (const p of podItems) {
      const phase = p?.status?.phase ?? '';
      if (phase === 'Running') podStatus.running++;
      else if (phase === 'Pending') podStatus.pending++;
      else if (phase === 'Failed' || phase === 'Unknown') podStatus.failed++;
      else if (phase === 'Succeeded') podStatus.succeeded++;
    }

    const alerts = overview.data?.alerts
      ? { warnings: overview.data.alerts.warnings, critical: overview.data.alerts.critical }
      : { warnings: 0, critical: 0 };

    return aggregateFromK8s(
      depItems,
      ssItems,
      dsItems,
      jobItems,
      cjItems,
      podStatus,
      alerts
    );
  }, [
    deployments.data?.items,
    statefulsets.data?.items,
    daemonsets.data?.items,
    jobs.data?.items,
    cronjobs.data?.items,
    pods.data?.items,
    overview.data,
  ]);

  const isLoading =
    (isBackendConfigured() && backendQuery.isLoading) ||
    (!isBackendConfigured() &&
      (deployments.isLoading ||
        statefulsets.isLoading ||
        daemonsets.isLoading ||
        jobs.isLoading ||
        cronjobs.isLoading ||
        pods.isLoading));

  // Prefer backend when available; otherwise use aggregated fallback from resource lists
  const data = isBackendConfigured() && backendQuery.data
    ? backendQuery.data
    : fallback ?? undefined;

  return {
    data,
    isLoading,
    isError: isBackendConfigured() ? backendQuery.isError : false,
    refetch: isBackendConfigured() ? backendQuery.refetch : () => {},
  };
}
