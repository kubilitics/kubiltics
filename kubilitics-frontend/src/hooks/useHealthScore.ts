import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useK8sResourceList } from './useKubernetes';
import { useClusterSummary } from './useClusterSummary';
import { useClusterOverview } from './useClusterOverview';
import { getEvents } from '@/services/backendApiClient';

export interface HealthScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  status: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  breakdown: {
    podHealth: number;
    nodeHealth: number;
    stability: number;
    eventHealth: number;
  };
  details: string[];
  insight: string;
}

function isNodeReady(node: { status?: { conditions?: Array<{ type: string; status: string }> } }): boolean {
  const conditions = node?.status?.conditions ?? [];
  const ready = conditions.find((c) => c.type === 'Ready');
  return ready?.status === 'True';
}

function getRestartCount(pod: { status?: { containerStatuses?: Array<{ restartCount?: number }> } }): number {
  const statuses = pod?.status?.containerStatuses ?? [];
  return statuses.reduce((sum, s) => sum + (s.restartCount ?? 0), 0);
}

export function useHealthScore(): HealthScore {
  const { activeCluster } = useClusterStore();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? undefined;

  // Backend path: reuse cached summary + overview queries (no extra requests)
  const summaryQuery = useClusterSummary(clusterId);
  const overviewQuery = useClusterOverview(clusterId);

  // Events query: backend only
  const eventsQuery = useQuery({
    queryKey: ['backend', 'events', currentClusterId, 'health'],
    queryFn: () => getEvents(backendBaseUrl, currentClusterId!, { namespace: 'default', limit: 100 }),
    enabled: !!currentClusterId && isBackendConfigured,
    staleTime: 60_000,
  });

  // Pod + Node list: needed in ALL modes for restart counts, node readiness
  const podsEnabled = !!activeCluster || (isBackendConfigured && !!clusterId);
  const podsList = useK8sResourceList('pods', undefined, {
    enabled: podsEnabled,
    limit: 5000,
    staleTime: 30_000,
  });
  const nodesList = useK8sResourceList('nodes', undefined, {
    enabled: podsEnabled,
    limit: 500,
    staleTime: 60_000,
  });

  return useMemo(() => {
    if (!activeCluster) {
      return {
        score: 0,
        grade: 'F',
        status: 'critical',
        breakdown: { podHealth: 0, nodeHealth: 0, stability: 0, eventHealth: 0 },
        details: ['No cluster connected'],
        insight: 'No cluster connected. Connect a cluster to begin monitoring.',
      };
    }

    if (isBackendConfigured && overviewQuery.data) {
      // Use cluster overview for health score — already cached by Dashboard
      const ov = overviewQuery.data;
      const ps = ov.pod_status;
      const totalPods = summaryQuery.data?.pod_count ?? ov.counts.pods ?? 0;
      const totalNodes = summaryQuery.data?.node_count ?? ov.counts.nodes ?? 0;

      const details: string[] = [];

      // Pod Health (40% weight)
      const podsHealthy = (ps?.running ?? 0) + (ps?.succeeded ?? 0);
      const podsFailed = ps?.failed ?? 0;
      const podsPending = ps?.pending ?? 0;
      const podHealthRatio = totalPods > 0 ? (podsHealthy / totalPods) * 100 : 100;
      const pendingPenalty = totalPods > 0 && podsPending > 0 ? (podsPending / totalPods) * 20 : 0;
      const failedPenalty = totalPods > 0 && podsFailed > 0 ? (podsFailed / totalPods) * 50 : 0;
      const podHealth = Math.max(0, Math.min(100, podHealthRatio - pendingPenalty - failedPenalty));

      if (podsFailed > 0) details.push(`${podsFailed} pod(s) in failed state`);
      if (podsPending > 2) details.push(`${podsPending} pod(s) pending`);

      // Node Health (30% weight) — compute from real node conditions
      const nodeItems = nodesList.data?.items ?? [];
      let nodeHealthPct: number;
      if (nodeItems.length > 0) {
        const readyNodes = nodeItems.filter((n) => isNodeReady(n as Parameters<typeof isNodeReady>[0])).length;
        nodeHealthPct = Math.round((readyNodes / nodeItems.length) * 100);
      } else {
        nodeHealthPct = ov.health?.score ? Math.min(100, ov.health.score) : 100;
      }
      const nodeHealth = totalNodes > 0 ? nodeHealthPct : 100;
      if (totalNodes > 0 && nodeHealth < 100) details.push(`${Math.round((1 - nodeHealth / 100) * totalNodes)} node(s) not ready`);

      // Stability (20% weight) — compute from REAL pod restart counts
      const podItems = podsList.data?.items ?? [];
      let restartCount = 0;
      for (const pod of podItems) {
        restartCount += getRestartCount(pod as Parameters<typeof getRestartCount>[0]);
      }
      let stability = 100;
      if (restartCount > 0) stability = Math.max(0, 100 - restartCount * 2);
      if (restartCount > 10) details.push(`High restart count: ${restartCount} restarts across pods`);

      // Event Health (10% weight)
      const warningEvents = ov.alerts?.warnings ?? 0;
      const errorEvents = ov.alerts?.critical ?? 0;
      let eventHealth = Math.max(0, 100 - warningEvents * 2 - errorEvents * 10);
      if (errorEvents > 0) details.push(`${errorEvents} critical alert(s)`);
      if (warningEvents > 3) details.push(`${warningEvents} warnings in cluster`);

      const score = Math.round(podHealth * 0.4 + nodeHealth * 0.3 + stability * 0.2 + eventHealth * 0.1);

      let grade: HealthScore['grade'];
      let status: HealthScore['status'];
      if (score >= 90) { grade = 'A'; status = 'excellent'; if (details.length === 0) details.push('All systems operating normally'); }
      else if (score >= 80) { grade = 'B'; status = 'good'; }
      else if (score >= 70) { grade = 'C'; status = 'fair'; }
      else if (score >= 60) { grade = 'D'; status = 'poor'; }
      else { grade = 'F'; status = 'critical'; }

      const insight = score >= 90
        ? (details.length > 0 ? details[0] : 'All systems operating normally.')
        : details.slice(0, 2).join('. ') + (score < 70 ? '. Investigate recommended.' : '.');

      return {
        score,
        grade,
        status,
        breakdown: {
          podHealth: Math.round(podHealth),
          nodeHealth: Math.round(nodeHealth),
          stability: Math.round(stability),
          eventHealth: Math.round(eventHealth),
        },
        details,
        insight,
      };
    }

    // Direct K8s fallback
    const items = podsList.data?.items ?? [];
    let podsRunning = 0;
    let podsPending = 0;
    let podsSucceeded = 0;
    let podsFailed = 0;
    let restartCount = 0;
    for (const pod of items) {
      const p = pod as { status?: { phase?: string; containerStatuses?: Array<{ restartCount?: number }> } };
      const phase = (p?.status?.phase ?? '').trim();
      if (phase === 'Running') podsRunning++;
      else if (phase === 'Pending') podsPending++;
      else if (phase === 'Succeeded') podsSucceeded++;
      else if (phase === 'Failed' || phase === 'Unknown') podsFailed++;
      restartCount += getRestartCount(p);
    }
    const totalPods = summaryQuery.data?.pod_count ?? items.length;

    const nodeItems = nodesList.data?.items ?? [];
    const totalNodes = summaryQuery.data?.node_count ?? nodeItems.length;
    const readyNodes = nodeItems.length === 0 ? (totalNodes > 0 ? totalNodes : 0) : nodeItems.filter((n) => isNodeReady(n as Parameters<typeof isNodeReady>[0])).length;
    const nodeHealthPct = totalNodes > 0 ? Math.round((readyNodes / totalNodes) * 100) : 100;

    const events = eventsQuery.data ?? [];
    let warningEvents = 0;
    let errorEvents = 0;
    for (const e of events) {
      const type = (e as { type?: string }).type ?? 'Normal';
      if (type === 'Warning') warningEvents++;
      else if (type !== 'Normal') errorEvents++;
    }

    const details: string[] = [];
    const podsHealthy = podsRunning + podsSucceeded;
    const podHealthRatio = totalPods > 0 ? (podsHealthy / totalPods) * 100 : 100;
    const pendingPenalty = totalPods > 0 && podsPending > 0 ? (podsPending / totalPods) * 20 : 0;
    const failedPenalty = totalPods > 0 && podsFailed > 0 ? (podsFailed / totalPods) * 50 : 0;
    const podHealth = Math.max(0, Math.min(100, podHealthRatio - pendingPenalty - failedPenalty));

    if (podsFailed > 0) details.push(`${podsFailed} pod(s) in failed state`);
    if (podsPending > 2) details.push(`${podsPending} pod(s) pending - possible resource constraints`);

    const nodeHealth = nodeHealthPct;
    if (totalNodes > 0 && nodeHealth < 100) details.push(`${100 - nodeHealth}% of nodes reporting issues`);

    let stability = 100;
    if (restartCount > 0) stability = Math.max(0, 100 - restartCount * 10);
    if (restartCount > 5) details.push(`High restart count: ${restartCount} restarts across pods`);

    let eventHealth = 100;
    eventHealth -= warningEvents * 2;
    eventHealth -= errorEvents * 10;
    eventHealth = Math.max(0, eventHealth);
    if (errorEvents > 0) details.push(`${errorEvents} error event(s) detected`);
    if (warningEvents > 3) details.push(`${warningEvents} warning events in cluster`);

    const score = Math.round(podHealth * 0.4 + nodeHealth * 0.3 + stability * 0.2 + eventHealth * 0.1);

    let grade: HealthScore['grade'];
    let status: HealthScore['status'];
    if (score >= 90) { grade = 'A'; status = 'excellent'; if (details.length === 0) details.push('All systems operating normally'); }
    else if (score >= 80) { grade = 'B'; status = 'good'; }
    else if (score >= 70) { grade = 'C'; status = 'fair'; }
    else if (score >= 60) { grade = 'D'; status = 'poor'; }
    else { grade = 'F'; status = 'critical'; }

    const insight = score >= 90
      ? (details.length > 0 ? details[0] : 'All systems operating normally. No issues detected.')
      : score >= 80
        ? (details.length > 0 ? details.join('. ') + '.' : 'Cluster is healthy with minor items to monitor.')
        : score >= 70
          ? (details.length > 0 ? details.slice(0, 2).join('. ') + '. Investigate before these escalate.' : 'Some components need attention.')
          : (details.length > 0 ? details.slice(0, 2).join('. ') + '. Immediate action recommended.' : 'Cluster health is degraded. Investigate immediately.');

    return {
      score,
      grade,
      status,
      breakdown: {
        podHealth: Math.round(podHealth),
        nodeHealth: Math.round(nodeHealth),
        stability: Math.round(stability),
        eventHealth: Math.round(eventHealth),
      },
      details,
      insight,
    };
  }, [
    activeCluster,
    isBackendConfigured,
    overviewQuery.data,
    summaryQuery.data,
    podsList.data?.items,
    nodesList.data?.items,
    eventsQuery.data,
  ]);
}
