/**
 * useDashboardResourceHealth — per-resource-type health breakdowns for dashboard tiles.
 *
 * Derives health segments from:
 *   - Backend overview (pod_status) when available
 *   - Direct K8s list queries (status/spec fields) for all 9 tile types
 *
 * Returns segmented data for health bars + status labels.
 */
import { useMemo } from 'react';
import { useK8sResourceList, type KubernetesResource } from './useKubernetes';
import { useClusterOverview } from './useClusterOverview';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useConnectionStatus } from './useConnectionStatus';

export interface HealthSegment {
  label: string;
  count: number;
  color: string;    // tailwind bg class for the status dot
  barColor: string;  // hex color for the health bar segment
}

export interface ResourceHealthSummary {
  total: number;
  segments: HealthSegment[];
}

const QUERY_OPTS = {
  refetchInterval: false as const,
  staleTime: 30_000,
  placeholderData: (prev: any) => prev,
  limit: 500,
};

export function useDashboardResourceHealth() {
  const { isConnected } = useConnectionStatus();
  const clusterId = useBackendConfigStore((s) => s.currentClusterId);
  const overview = useClusterOverview(clusterId ?? undefined);

  const enabled = isConnected;
  const nodes = useK8sResourceList<KubernetesResource>('nodes', undefined, { ...QUERY_OPTS, enabled });
  const pods = useK8sResourceList<KubernetesResource>('pods', undefined, { ...QUERY_OPTS, enabled });
  const deployments = useK8sResourceList<KubernetesResource>('deployments', undefined, { ...QUERY_OPTS, enabled });
  const services = useK8sResourceList<KubernetesResource>('services', undefined, { ...QUERY_OPTS, enabled });
  const daemonsets = useK8sResourceList<KubernetesResource>('daemonsets', undefined, { ...QUERY_OPTS, enabled });
  const namespaces = useK8sResourceList<KubernetesResource>('namespaces', undefined, { ...QUERY_OPTS, enabled });
  const configmaps = useK8sResourceList<KubernetesResource>('configmaps', undefined, { ...QUERY_OPTS, enabled });
  const secrets = useK8sResourceList<KubernetesResource>('secrets', undefined, { ...QUERY_OPTS, enabled });
  const cronjobs = useK8sResourceList<KubernetesResource>('cronjobs', undefined, { ...QUERY_OPTS, enabled });

  const health = useMemo(() => {
    const result: Record<string, ResourceHealthSummary> = {};

    // Helper to build segments, filtering out zero counts
    const seg = (label: string, count: number, color: string, barColor: string): HealthSegment | null =>
      count > 0 ? { label, count, color, barColor } : null;
    const compact = (segs: (HealthSegment | null)[]): HealthSegment[] =>
      segs.filter(Boolean) as HealthSegment[];

    // ── Nodes ────────────────────────────────────────
    if (nodes.data?.items) {
      const items = nodes.data.items;
      const ready = items.filter((n) => {
        const conditions = (n.status as any)?.conditions as any[] | undefined;
        return conditions?.some((c: any) => c.type === 'Ready' && c.status === 'True');
      }).length;
      result.nodes = {
        total: items.length,
        segments: compact([
          seg('Ready', ready, 'bg-emerald-500', '#22c55e'),
          seg('NotReady', items.length - ready, 'bg-red-500', '#ef4444'),
        ]),
      };
    }

    // ── Pods — prefer backend overview, fall back to direct K8s ──
    const ps = overview.data?.pod_status;
    if (ps) {
      result.pods = {
        total: ps.running + ps.pending + ps.failed + ps.succeeded,
        segments: compact([
          seg('Running', ps.running, 'bg-emerald-500', '#22c55e'),
          seg('Succeeded', ps.succeeded, 'bg-blue-500', '#3b82f6'),
          seg('Pending', ps.pending, 'bg-amber-500', '#f59e0b'),
          seg('Failed', ps.failed, 'bg-red-500', '#ef4444'),
        ]),
      };
    } else if (pods.data?.items) {
      const items = pods.data.items;
      const phase = (p: string) => items.filter((i) => (i.status as any)?.phase === p).length;
      const running = phase('Running'), succeeded = phase('Succeeded'), pending = phase('Pending');
      result.pods = {
        total: items.length,
        segments: compact([
          seg('Running', running, 'bg-emerald-500', '#22c55e'),
          seg('Succeeded', succeeded, 'bg-blue-500', '#3b82f6'),
          seg('Pending', pending, 'bg-amber-500', '#f59e0b'),
          seg('Failed', items.length - running - succeeded - pending, 'bg-red-500', '#ef4444'),
        ]),
      };
    }

    // ── Deployments ──────────────────────────────────
    if (deployments.data?.items) {
      const items = deployments.data.items;
      const available = items.filter((d) => {
        const s = d.status as any;
        return s?.availableReplicas > 0 && s?.availableReplicas >= (s?.replicas ?? 0);
      }).length;
      const progressing = items.filter((d) => {
        const s = d.status as any;
        return s?.availableReplicas > 0 && s?.availableReplicas < (s?.replicas ?? 0);
      }).length;
      result.deployments = {
        total: items.length,
        segments: compact([
          seg('Available', available, 'bg-emerald-500', '#22c55e'),
          seg('Progressing', progressing, 'bg-amber-500', '#f59e0b'),
          seg('Unavailable', items.length - available - progressing, 'bg-red-500', '#ef4444'),
        ]),
      };
    }

    // ── Services ─────────────────────────────────────
    if (services.data?.items) {
      const items = services.data.items;
      const byType = (t: string) => items.filter((s) => (s.spec as any)?.type === t).length;
      const cip = byType('ClusterIP'), np = byType('NodePort'), lb = byType('LoadBalancer');
      result.services = {
        total: items.length,
        segments: compact([
          seg('ClusterIP', cip, 'bg-blue-500', '#3b82f6'),
          seg('NodePort', np, 'bg-violet-500', '#8b5cf6'),
          seg('LoadBalancer', lb, 'bg-amber-500', '#f59e0b'),
          seg('ExternalName', items.length - cip - np - lb, 'bg-slate-400', '#94a3b8'),
        ]),
      };
    }

    // ── DaemonSets ───────────────────────────────────
    if (daemonsets.data?.items) {
      const items = daemonsets.data.items;
      const ready = items.filter((d) => {
        const s = d.status as any;
        return (s?.numberReady ?? 0) >= (s?.desiredNumberScheduled ?? 0) && (s?.desiredNumberScheduled ?? 0) > 0;
      }).length;
      result.daemonsets = {
        total: items.length,
        segments: compact([
          seg('Ready', ready, 'bg-emerald-500', '#22c55e'),
          seg('Partial', items.length - ready, 'bg-amber-500', '#f59e0b'),
        ]),
      };
    }

    // ── Namespaces ───────────────────────────────────
    if (namespaces.data?.items) {
      const items = namespaces.data.items;
      const active = items.filter((n) => (n.status as any)?.phase === 'Active').length;
      result.namespaces = {
        total: items.length,
        segments: compact([
          seg('Active', active, 'bg-emerald-500', '#22c55e'),
          seg('Terminating', items.length - active, 'bg-slate-400', '#94a3b8'),
        ]),
      };
    }

    // ── ConfigMaps — top namespaces distribution ─────
    if (configmaps.data?.items) {
      const items = configmaps.data.items;
      const nsMap = new Map<string, number>();
      items.forEach((cm) => nsMap.set(cm.metadata?.namespace ?? 'cluster', (nsMap.get(cm.metadata?.namespace ?? 'cluster') ?? 0) + 1));
      const sorted = [...nsMap.entries()].sort((a, b) => b[1] - a[1]);
      const barColors = [['bg-blue-500', '#3b82f6'], ['bg-violet-500', '#8b5cf6'], ['bg-slate-400', '#94a3b8']];
      const segments: HealthSegment[] = sorted.slice(0, 2).map(([ns, count], i) => ({
        label: ns, count, color: barColors[i][0], barColor: barColors[i][1],
      }));
      const rest = sorted.slice(2).reduce((sum, [, c]) => sum + c, 0);
      if (rest > 0) segments.push({ label: 'Others', count: rest, color: barColors[2][0], barColor: barColors[2][1] });
      result.configmaps = { total: items.length, segments };
    }

    // ── Secrets — type distribution ──────────────────
    if (secrets.data?.items) {
      const items = secrets.data.items;
      const byType = (t: string) => items.filter((s) => (s as any).type === t).length;
      const opaque = byType('Opaque');
      const tls = byType('kubernetes.io/tls');
      const sa = byType('kubernetes.io/service-account-token');
      const dockercfg = items.filter((s) => ((s as any).type ?? '').includes('dockerc')).length;
      result.secrets = {
        total: items.length,
        segments: compact([
          seg('Opaque', opaque, 'bg-blue-500', '#3b82f6'),
          seg('TLS', tls, 'bg-amber-500', '#f59e0b'),
          seg('SA Token', sa, 'bg-violet-500', '#8b5cf6'),
          seg('Docker', dockercfg, 'bg-cyan-500', '#06b6d4'),
          seg('Other', items.length - opaque - tls - sa - dockercfg, 'bg-slate-400', '#94a3b8'),
        ]),
      };
    }

    // ── CronJobs ─────────────────────────────────────
    if (cronjobs.data?.items) {
      const items = cronjobs.data.items;
      const suspended = items.filter((cj) => (cj.spec as any)?.suspend === true).length;
      result.cronjobs = {
        total: items.length,
        segments: compact([
          seg('Active', items.length - suspended, 'bg-emerald-500', '#22c55e'),
          seg('Suspended', suspended, 'bg-amber-500', '#f59e0b'),
        ]),
      };
    }

    return result;
  }, [
    overview.data, nodes.data, pods.data, deployments.data, services.data,
    daemonsets.data, namespaces.data, configmaps.data, secrets.data, cronjobs.data,
  ]);

  return { health, isLoading: nodes.isLoading || pods.isLoading };
}
