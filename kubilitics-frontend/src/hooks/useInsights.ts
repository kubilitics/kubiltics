/**
 * Client-derived insights for the Intelligence Panel: what changed, what's risky,
 * what might break. From events, pods, and nodes.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useK8sResourceList } from './useKubernetes';
import { getEvents } from '@/services/backendApiClient';

export type InsightSeverity = 'info' | 'warning' | 'critical';

export interface Insight {
  id: string;
  severity: InsightSeverity;
  kind: string;
  name: string;
  namespace: string;
  message: string;
  link: string;
  timestamp?: string;
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

function getRestartCount(pod: { status?: { containerStatuses?: Array<{ restartCount?: number }> } }): number {
  const statuses = pod?.status?.containerStatuses ?? [];
  return statuses.reduce((sum, s) => sum + (s.restartCount ?? 0), 0);
}

const ROUTE_BY_KIND: Record<string, string> = {
  Pod: 'pods',
  Deployment: 'deployments',
  Node: 'nodes',
  ReplicaSet: 'replicasets',
  StatefulSet: 'statefulsets',
  DaemonSet: 'daemonsets',
  Service: 'services',
  Job: 'jobs',
  CronJob: 'cronjobs',
};

function linkFor(kind: string, namespace: string, name: string): string {
  const route = ROUTE_BY_KIND[kind] ?? 'pods';
  if (namespace) return `/${route}/${namespace}/${name}`;
  return `/${route}/${name}`;
}

export function useInsights(): { insights: Insight[]; isLoading: boolean } {
  const { activeCluster } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  const podsList = useK8sResourceList('pods', undefined, {
    enabled: !!activeCluster,
    limit: 2000,
    refetchInterval: 30000,
  });
  const nodesList = useK8sResourceList('nodes', undefined, {
    enabled: !!activeCluster,
    refetchInterval: 60000,
  });
  const eventsQuery = useQuery({
    queryKey: ['backend', 'events', currentClusterId, 'insights'],
    queryFn: () => getEvents(backendBaseUrl, currentClusterId!, { namespace: 'default', limit: 100 }),
    enabled: !!currentClusterId && isBackendConfigured(),
    staleTime: 15000,
  });

  const insights = useMemo(() => {
    const list: Insight[] = [];
    const seen = new Set<string>();

    const add = (insight: Omit<Insight, 'id'>) => {
      const id = `${insight.kind}/${insight.namespace || '-'}/${insight.name}-${insight.message.slice(0, 30)}`;
      if (seen.has(id)) return;
      seen.add(id);
      list.push({ ...insight, id });
    };

    const pods = podsList.data?.items ?? [];
    for (const pod of pods) {
      const p = pod as {
        metadata?: { name?: string; namespace?: string };
        status?: { phase?: string; containerStatuses?: Array<{ restartCount?: number }> };
      };
      const name = p.metadata?.name ?? '';
      const ns = p.metadata?.namespace ?? 'default';
      const phase = (p?.status?.phase ?? '').trim();

      if (phase === 'Failed' || phase === 'Unknown') {
        add({
          severity: 'critical',
          kind: 'Pod',
          name,
          namespace: ns,
          message: `Pod ${name} is ${phase}. Check logs and events.`,
          link: linkFor('Pod', ns, name),
        });
      } else if (phase === 'Pending') {
        add({
          severity: 'warning',
          kind: 'Pod',
          name,
          namespace: ns,
          message: `Pod ${name} is pending — possible resource constraints or scheduling issues.`,
          link: linkFor('Pod', ns, name),
        });
      }
      const restarts = getRestartCount(p as Parameters<typeof getRestartCount>[0]);
      if (restarts > 5) {
        add({
          severity: 'warning',
          kind: 'Pod',
          name,
          namespace: ns,
          message: `Pod ${name} restarted ${restarts} times — likely config or resource pressure.`,
          link: linkFor('Pod', ns, name),
        });
      }
    }

    const nodeItems = nodesList.data?.items ?? [];
    for (const node of nodeItems) {
      const n = node as { metadata?: { name?: string }; status?: { conditions?: Array<{ type: string; status: string }> } };
      const name = n.metadata?.name ?? '';
      const ready = isNodeReady(n as Parameters<typeof isNodeReady>[0]);
      const pressure = hasNodePressure(n as Parameters<typeof hasNodePressure>[0]);
      if (!ready) {
        add({
          severity: 'critical',
          kind: 'Node',
          name,
          namespace: '',
          message: `Node ${name} is not Ready.`,
          link: linkFor('Node', '', name),
        });
      } else if (pressure) {
        add({
          severity: 'warning',
          kind: 'Node',
          name,
          namespace: '',
          message: `Node ${name} is under memory or disk pressure.`,
          link: linkFor('Node', '', name),
        });
      }
    }

    const events = eventsQuery.data ?? [];
    for (const e of events) {
      const type = (e as { type?: string }).type ?? 'Normal';
      if (type === 'Normal') continue;
      const reason = (e as { reason?: string }).reason ?? '';
      const message = (e as { message?: string }).message ?? '';
      const resourceKind = (e as { resource_kind?: string }).resource_kind ?? 'Pod';
      const resourceName = (e as { resource_name?: string }).resource_name ?? '';
      const namespace = (e as { namespace?: string }).namespace ?? 'default';
      const route = ROUTE_BY_KIND[resourceKind];
      const link = route ? (namespace ? `/${route}/${namespace}/${resourceName}` : `/${route}/${resourceName}`) : '/events';

      add({
        severity: type === 'Warning' ? 'warning' : 'critical',
        kind: resourceKind,
        name: resourceName,
        namespace,
        message: message || reason || `${resourceKind} ${resourceName}: ${type}`,
        link,
        timestamp: (e as { last_timestamp?: string }).last_timestamp,
      });
    }

    list.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    });
    return list.slice(0, 15);
  }, [podsList.data?.items, nodesList.data?.items, eventsQuery.data]);

  const isLoading = podsList.isLoading || nodesList.isLoading || eventsQuery.isLoading;

  return { insights, isLoading };
}
