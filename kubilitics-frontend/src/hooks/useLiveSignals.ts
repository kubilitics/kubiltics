/**
 * Aggregates live signals for the dashboard strip: restarts, failed/pending pods,
 * node pressure, warning/error events.
 *
 * Strategy:
 * - When backend is configured: use clusterOverview + clusterSummary (already fetched
 *   by Dashboard) to derive all metrics. Zero extra requests needed.
 * - When only direct K8s is connected: fall back to small-limit list queries.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useK8sResourceList } from './useKubernetes';
import { getEvents } from '@/services/backendApiClient';
import { useClusterSummary } from './useClusterSummary';
import { useClusterOverview } from './useClusterOverview';

function getRestartCount(pod: { status?: { containerStatuses?: Array<{ restartCount?: number }> } }): number {
  const statuses = pod?.status?.containerStatuses ?? [];
  return statuses.reduce((sum, s) => sum + (s.restartCount ?? 0), 0);
}

function isNodeReady(node: { status?: { conditions?: Array<{ type: string; status: string }> } }): boolean {
  const conditions = node?.status?.conditions ?? [];
  const ready = conditions.find((c) => c.type === 'Ready');
  return ready?.status === 'True';
}

function hasNodePressure(node: { status?: { conditions?: Array<{ type: string; status: string }> } }): boolean {
  const conditions = node?.status?.conditions ?? [];
  const memoryPressure = conditions.find((c) => c.type === 'MemoryPressure');
  const diskPressure = conditions.find((c) => c.type === 'DiskPressure');
  return (memoryPressure?.status === 'True') || (diskPressure?.status === 'True') || false;
}

export interface LiveSignals {
  totalClusters: number;
  totalNodes: number;
  runningPods: number;
  failedPods: number;
  activeAlerts: number;
  podRestarts: number;
  pendingPods: number;
  nodePressureCount: number;
  warningEvents: number;
  errorEvents: number;
  isLoading: boolean; // Only true on initial load when no cached data exists
  isFetching: boolean; // True during background refresh
  isError: boolean; // True if any query failed
  error: Error | null; // Error details if queries failed
}

export function useLiveSignals(): LiveSignals {
  const { activeCluster, clusters } = useClusterStore();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;

  // Backend path: reuse existing cluster summary + overview queries (already cached from Dashboard)
  const summaryQuery = useClusterSummary(clusterId ?? undefined);
  const overviewQuery = useClusterOverview(clusterId ?? undefined);

  // Pod + Node lists: needed in ALL modes for restart counts and node pressure
  const anyClusterConnected = !!activeCluster || (isBackendConfigured && !!clusterId);

  const podsList = useK8sResourceList('pods', undefined, {
    enabled: anyClusterConnected,
    limit: 5000,
    staleTime: 30_000,
  });
  const nodesList = useK8sResourceList('nodes', undefined, {
    enabled: anyClusterConnected,
    limit: 500,
    staleTime: 60_000,
  });

  // Events query: only fires when backend is configured (direct K8s mode has no backend events)
  const eventsQuery = useQuery({
    queryKey: ['backend', 'events', currentClusterId, 'dashboard'],
    queryFn: () => getEvents(backendBaseUrl, currentClusterId!, { limit: 100 }),
    enabled: !!currentClusterId && isBackendConfigured,
    staleTime: 60_000,
  });

  const signals = useMemo(() => {
    const totalClusters = Array.isArray(clusters) ? clusters.length : activeCluster ? 1 : 0;

    if (isBackendConfigured && overviewQuery.data) {
      // Prefer backend overview for pod status counts
      const ps = overviewQuery.data.pod_status;
      const totalNodes = summaryQuery.data?.node_count ?? overviewQuery.data.counts.nodes ?? 0;

      const eventsValue = eventsQuery.data;
      const events = Array.isArray(eventsValue) ? eventsValue : [];
      let warningEvents = overviewQuery.data.alerts?.warnings ?? 0;
      let errorEvents = overviewQuery.data.alerts?.critical ?? 0;
      for (const e of events) {
        const type = (e as { type?: string }).type ?? 'Normal';
        if (type === 'Warning') warningEvents++;
        else if (type !== 'Normal') errorEvents++;
      }
      const activeAlerts = warningEvents + errorEvents;

      // Compute real restart counts from pod list (fetched for all modes)
      const podItems = podsList.data?.items ?? [];
      let podRestarts = 0;
      for (const pod of podItems) {
        podRestarts += getRestartCount(pod as Parameters<typeof getRestartCount>[0]);
      }

      // Compute real node pressure from node list
      const nodeItems = nodesList.data?.items ?? [];
      const nodePressureCount = nodeItems.filter((n) => {
        const ready = isNodeReady(n as Parameters<typeof isNodeReady>[0]);
        const pressure = hasNodePressure(n as Parameters<typeof hasNodePressure>[0]);
        return !ready || pressure;
      }).length;

      return {
        totalClusters,
        totalNodes,
        runningPods: ps?.running ?? 0,
        failedPods: ps?.failed ?? 0,
        pendingPods: ps?.pending ?? 0,
        podRestarts,
        nodePressureCount,
        activeAlerts,
        warningEvents,
        errorEvents,
      };
    }

    // Direct K8s fallback
    const items = podsList.data?.items ?? [];
    let podRestarts = 0;
    let failedPods = 0;
    let pendingPods = 0;
    let runningPods = 0;
    for (const pod of items) {
      const p = pod as { status?: { phase?: string; containerStatuses?: Array<{ restartCount?: number }> } };
      podRestarts += getRestartCount(p);
      const phase = (p?.status?.phase ?? '').trim();
      if (phase === 'Running') runningPods++;
      else if (phase === 'Failed' || phase === 'Unknown') failedPods++;
      else if (phase === 'Pending') pendingPods++;
    }

    const nodeItems = nodesList.data?.items ?? [];
    const totalNodes = nodeItems.length;
    const nodePressureCount = nodeItems.filter((n) => {
      const ready = isNodeReady(n as Parameters<typeof isNodeReady>[0]);
      const pressure = hasNodePressure(n as Parameters<typeof hasNodePressure>[0]);
      return !ready || pressure;
    }).length;

    return {
      totalClusters,
      totalNodes,
      runningPods,
      failedPods,
      pendingPods,
      podRestarts,
      nodePressureCount,
      activeAlerts: 0,
      warningEvents: 0,
      errorEvents: 0,
    };
  }, [
    isBackendConfigured,
    overviewQuery.data,
    summaryQuery.data?.node_count,
    eventsQuery.data,
    podsList.data?.items,
    nodesList.data?.items,
    clusters,
    activeCluster,
  ]);

  const hasCachedData =
    summaryQuery.data !== undefined ||
    overviewQuery.data !== undefined ||
    (podsList.data?.items && podsList.data.items.length > 0) ||
    (eventsQuery.data && eventsQuery.data.length > 0);

  const isLoading =
    !hasCachedData && (
      (isBackendConfigured ? (summaryQuery.isLoading || overviewQuery.isLoading) : (podsList.isLoading || nodesList.isLoading)) ||
      eventsQuery.isLoading
    );

  const isFetching =
    summaryQuery.isFetching ||
    overviewQuery.isFetching ||
    podsList.isFetching ||
    nodesList.isFetching ||
    eventsQuery.isFetching;

  const isError =
    (isBackendConfigured ? (summaryQuery.isError || overviewQuery.isError) : (podsList.isError || nodesList.isError)) ||
    eventsQuery.isError;

  const error =
    summaryQuery.error ||
    overviewQuery.error ||
    podsList.error ||
    nodesList.error ||
    eventsQuery.error ||
    null;

  return {
    ...signals,
    isLoading,
    isFetching,
    isError,
    error: error instanceof Error ? error : null,
  };
}
