/**
 * Aggregates live signals for the dashboard strip: restarts, failed/pending pods,
 * node pressure, warning/error events. Prefers backend cluster summary for node count when available.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useK8sResourceList } from './useKubernetes';
import { getEvents } from '@/services/backendApiClient';
import { useClusterSummary } from './useClusterSummary';

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
  isLoading: boolean;
}

export function useLiveSignals(): LiveSignals {
  const { activeCluster, clusters } = useClusterStore();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;
  const summaryQuery = useClusterSummary(clusterId ?? undefined);

  const podsList = useK8sResourceList('pods', undefined, {
    enabled: !!activeCluster,
    limit: 5000,
    refetchInterval: 20000,
  });
  const nodesList = useK8sResourceList('nodes', undefined, {
    enabled: !!activeCluster,
    limit: 5000,
    refetchInterval: 30000,
  });
  const eventsQuery = useQuery({
    queryKey: ['backend', 'events', currentClusterId, 'dashboard'],
    queryFn: () => getEvents(backendBaseUrl, currentClusterId!, { limit: 100 }),
    enabled: !!currentClusterId && isBackendConfigured,
    staleTime: 10000,
    refetchInterval: 20000,
  });

  const signals = useMemo(() => {
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
    // Prefer backend cluster summary for node count (authoritative); fallback to list length
    const totalNodes =
      typeof summaryQuery.data?.node_count === 'number'
        ? summaryQuery.data.node_count
        : nodeItems.length;
    const nodePressureCount = nodeItems.filter((n) => {
      const ready = isNodeReady(n as Parameters<typeof isNodeReady>[0]);
      const pressure = hasNodePressure(n as Parameters<typeof hasNodePressure>[0]);
      return !ready || pressure;
    }).length;

    const eventsValue = eventsQuery.data;
    const events = Array.isArray(eventsValue) ? eventsValue : [];
    let warningEvents = 0;
    let errorEvents = 0;
    for (const e of events) {
      const type = (e as { type?: string }).type ?? 'Normal';
      if (type === 'Warning') warningEvents++;
      else if (type !== 'Normal') errorEvents++;
    }
    const activeAlerts = warningEvents + errorEvents;

    const totalClusters = Array.isArray(clusters) ? clusters.length : activeCluster ? 1 : 0;

    return {
      totalClusters,
      totalNodes,
      runningPods,
      failedPods,
      activeAlerts,
      podRestarts,
      pendingPods,
      nodePressureCount,
      warningEvents,
      errorEvents,
    };
  }, [podsList.data?.items, nodesList.data?.items, eventsQuery.data, clusters, activeCluster, summaryQuery.data?.node_count]);

  const isLoading = podsList.isLoading || nodesList.isLoading || eventsQuery.isLoading || summaryQuery.isLoading;

  return {
    ...signals,
    isLoading,
  };
}
