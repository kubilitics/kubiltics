/**
 * Workload & Capacity Snapshot — workload health distribution, node readiness,
 * namespace usage. Prefers backend cluster summary for counts when available.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useK8sResourceList } from '@/hooks/useKubernetes';
import { useClusterSummary } from '@/hooks/useClusterSummary';
import { useLiveSignals } from '@/hooks/useLiveSignals';
import { cn } from '@/lib/utils';

function isNodeReady(node: { status?: { conditions?: Array<{ type: string; status: string }> } }): boolean {
  const conditions = node?.status?.conditions ?? [];
  const ready = conditions.find((c) => c.type === 'Ready');
  return ready?.status === 'True';
}

const PHASE_COLORS: Record<string, string> = {
  Running: 'bg-[hsl(var(--success))]',
  Pending: 'bg-[hsl(var(--warning))]',
  Failed: 'bg-[hsl(var(--error))]',
  Succeeded: 'bg-teal-500',
  Unknown: 'bg-muted-foreground',
};

export function WorkloadCapacitySnapshot() {
  const { activeCluster } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;
  const summaryQuery = useClusterSummary(clusterId ?? undefined);
  const summary = summaryQuery.data;

  const podsList = useK8sResourceList('pods', undefined, {
    enabled: !!activeCluster,
    limit: 5000,
    refetchInterval: 30000,
  });
  const nodesList = useK8sResourceList('nodes', undefined, {
    enabled: !!activeCluster,
    limit: 5000,
    refetchInterval: 60000,
  });
  const deploymentsList = useK8sResourceList('deployments', undefined, {
    enabled: !!activeCluster,
    limit: 5000,
    refetchInterval: 60000,
  });
  const servicesList = useK8sResourceList('services', undefined, {
    enabled: !!activeCluster,
    limit: 5000,
    refetchInterval: 60000,
  });
  const namespacesList = useK8sResourceList('namespaces', undefined, {
    enabled: !!activeCluster,
    limit: 5000,
    refetchInterval: 60000,
  });
  const signals = useLiveSignals();

  const { phaseCounts, totalPodsFromList } = useMemo(() => {
    const items = podsList.data?.items ?? [];
    const counts: Record<string, number> = { Running: 0, Pending: 0, Failed: 0, Succeeded: 0, Unknown: 0 };
    for (const pod of items) {
      const phase = ((pod as { status?: { phase?: string } })?.status?.phase ?? 'Unknown').trim();
      counts[phase in counts ? phase : 'Unknown'] = (counts[phase in counts ? phase : 'Unknown'] ?? 0) + 1;
    }
    return { phaseCounts: counts, totalPodsFromList: items.length };
  }, [podsList.data?.items]);

  // Prefer backend summary for total pod count; fallback to list length
  const totalPods = typeof summary?.pod_count === 'number' ? summary.pod_count : totalPodsFromList;

  const nodeStats = useMemo(() => {
    const items = nodesList.data?.items ?? [];
    const total = typeof summary?.node_count === 'number' ? summary.node_count : items.length;
    const readyFromList = items.filter((n) => isNodeReady(n as Parameters<typeof isNodeReady>[0])).length;
    const ready = total > 0 ? (items.length > 0 ? readyFromList : total) : 0;
    return { ready, total };
  }, [nodesList.data?.items, summary?.node_count]);

  const topNamespaces = useMemo(() => {
    const items = podsList.data?.items ?? [];
    const byNs: Record<string, number> = {};
    for (const pod of items) {
      const ns = (pod as { metadata?: { namespace?: string } }).metadata?.namespace ?? 'default';
      byNs[ns] = (byNs[ns] ?? 0) + 1;
    }
    return Object.entries(byNs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [podsList.data?.items]);

  const maxNs = Math.max(1, ...topNamespaces.map(([, c]) => c));
  const workloadSegments = useMemo(() => {
    const order = ['Running', 'Succeeded', 'Pending', 'Failed', 'Unknown'] as const;
    return order
      .filter((p) => phaseCounts[p] > 0)
      .map((p) => ({ phase: p, count: phaseCounts[p], color: PHASE_COLORS[p] ?? 'bg-muted' }));
  }, [phaseCounts]);

  const trendLabel =
    signals.failedPods > 0 || signals.nodePressureCount > 0
      ? 'Critical'
      : signals.pendingPods > 2 || signals.podRestarts > 5
        ? 'Elevated'
        : 'Stable';

  return (
    <section
      className={cn(
        'dashboard-panel overflow-hidden',
        'rounded-2xl border border-[hsl(var(--accent)/0.8)]',
        'bg-gradient-to-b from-white/80 to-[hsl(var(--accent)/0.08)]'
      )}
      aria-label="Workload and capacity"
    >
      <div className="px-4 py-3 border-b border-[hsl(var(--accent)/0.5)] flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Workload & capacity</h2>
        <span
          className={cn(
            'text-xs font-medium px-2 py-0.5 rounded-full',
            trendLabel === 'Critical' && 'bg-[hsl(var(--error)/0.12)] text-[hsl(var(--error))]',
            trendLabel === 'Elevated' && 'bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))]',
            trendLabel === 'Stable' && 'bg-[hsl(var(--accent))] text-[hsl(var(--primary))]'
          )}
        >
          {trendLabel}
        </span>
      </div>
      <div className="p-4 space-y-4">
        {/* Summary row: prefer backend cluster summary for counts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Link
            to="/deployments"
            className="dashboard-metric px-3 py-2 flex flex-col gap-0.5 hover:bg-[hsl(var(--accent)/0.4)] transition-colors rounded-lg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Deployments</span>
            <span className="text-lg font-semibold tabular-nums text-foreground">
              {typeof summary?.deployment_count === 'number' ? summary.deployment_count : (deploymentsList.data?.items?.length ?? 0)}
            </span>
          </Link>
          <Link
            to="/services"
            className="dashboard-metric px-3 py-2 flex flex-col gap-0.5 hover:bg-[hsl(var(--accent)/0.4)] transition-colors rounded-lg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Services</span>
            <span className="text-lg font-semibold tabular-nums text-foreground">
              {typeof summary?.service_count === 'number' ? summary.service_count : (servicesList.data?.items?.length ?? 0)}
            </span>
          </Link>
          <Link
            to="/nodes"
            className="dashboard-metric px-3 py-2 flex flex-col gap-0.5 hover:bg-[hsl(var(--accent)/0.4)] transition-colors rounded-lg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Nodes</span>
            <span className="text-lg font-semibold tabular-nums text-foreground">{nodeStats.ready}/{nodeStats.total}</span>
          </Link>
          <Link
            to="/namespaces"
            className="dashboard-metric px-3 py-2 flex flex-col gap-0.5 hover:bg-[hsl(var(--accent)/0.4)] transition-colors rounded-lg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Namespaces</span>
            <span className="text-lg font-semibold tabular-nums text-foreground">
              {typeof summary?.namespace_count === 'number' ? summary.namespace_count : (namespacesList.data?.items?.length ?? 0)}
            </span>
          </Link>
        </div>

        {/* Pod phase stacked bar */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">Pods</span>
            <Link to="/pods" className="text-[hsl(var(--primary))] hover:underline font-medium">
              {totalPods} total
            </Link>
          </div>
          <div className="h-2 w-full rounded-full bg-[hsl(var(--accent)/0.5)] overflow-hidden flex">
            {workloadSegments.map(({ phase, count, color }) => (
              <div
                key={phase}
                className={cn(color, 'transition-all')}
                style={{ width: `${totalPods ? (count / totalPods) * 100 : 0}%` }}
                title={`${phase}: ${count}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
            {workloadSegments.map(({ phase, count }) => (
              <span key={phase}>
                {phase}: {count}
              </span>
            ))}
          </div>
        </div>

        {/* Node readiness */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">Nodes</span>
            <Link to="/nodes" className="text-[hsl(var(--primary))] hover:underline font-medium">
              {nodeStats.ready}/{nodeStats.total} ready
            </Link>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[hsl(var(--accent)/0.5)] overflow-hidden">
            <div
              className="h-full bg-[hsl(var(--success))] transition-all"
              style={{
                width: nodeStats.total ? `${(nodeStats.ready / nodeStats.total) * 100}%` : '100%',
              }}
            />
          </div>
        </div>

        {/* Top namespaces */}
        {topNamespaces.length > 0 && (
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-muted-foreground">Top namespaces</span>
              <Link to="/namespaces" className="text-[hsl(var(--primary))] hover:underline font-medium">
                View all
              </Link>
            </div>
            <div className="space-y-1.5">
              {topNamespaces.map(([name, count]) => (
                <div key={name} className="flex items-center gap-2">
                  <Link
                    to={`/pods?namespace=${encodeURIComponent(name)}`}
                    className="text-xs font-medium text-foreground hover:text-[hsl(var(--primary))] hover:underline w-24 truncate shrink-0"
                  >
                    {name}
                  </Link>
                  <div className="flex-1 h-1.5 rounded-full bg-[hsl(var(--accent)/0.5)] overflow-hidden min-w-0">
                    <div
                      className="h-full bg-[hsl(var(--ring)/0.7)] rounded-full transition-all"
                      style={{ width: `${(count / maxNs) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
