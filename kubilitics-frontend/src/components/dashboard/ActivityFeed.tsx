/**
 * Activity & Change Feed — rich timeline of deployments, restarts, scaling, failures.
 * Uses backend events API when configured; otherwise real K8s events from default namespace.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Layers,
  TrendingUp,
  XCircle,
  Clock,
  Loader2,
  FileText,
  Terminal,
  Scale,
  Activity,
} from 'lucide-react';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getEvents } from '@/services/backendApiClient';
import { useK8sResourceList } from '@/hooks/useKubernetes';
import { useKubernetesConfigStore } from '@/stores/kubernetesConfigStore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** Normalized event shape (backend or K8s list). */
interface NormalizedEvent {
  type: string;
  reason: string;
  message: string;
  resource_kind: string;
  resource_name: string;
  namespace: string;
  last_timestamp: string;
  first_timestamp: string;
  id: string;
}

function formatEventTime(timestamp: string): string {
  if (!timestamp) return 'unknown';
  const d = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

const ROUTE_BY_KIND: Record<string, string> = {
  Pod: 'pods',
  Deployment: 'deployments',
  ReplicaSet: 'replicasets',
  Node: 'nodes',
  Service: 'services',
};

function iconForReason(reason: string, type: string): { icon: typeof CheckCircle2; label: string } {
  const r = (reason || '').toLowerCase();
  if (type === 'Warning') return { icon: AlertTriangle, label: 'Warning' };
  if (r.includes('kill') || r.includes('fail') || r.includes('error'))
    return { icon: XCircle, label: 'Failure' };
  if (r.includes('pull') || r.includes('back')) return { icon: RotateCcw, label: 'Restart' };
  if (r.includes('scale') || r.includes('replica')) return { icon: TrendingUp, label: 'Scale' };
  if (r.includes('deploy') || r.includes('created') || r.includes('scheduled'))
    return { icon: Layers, label: 'Deploy' };
  return { icon: type === 'Normal' ? CheckCircle2 : AlertTriangle, label: reason || 'Event' };
}

function normalizeBackendEvent(e: Record<string, unknown>): NormalizedEvent {
  const ts = (e.last_timestamp as string) ?? (e.first_timestamp as string) ?? '';
  return {
    type: (e.type as string) ?? 'Normal',
    reason: (e.reason as string) ?? '',
    message: (e.message as string) ?? '',
    resource_kind: (e.resource_kind as string) ?? 'Pod',
    resource_name: (e.resource_name as string) ?? '',
    namespace: (e.namespace as string) ?? 'default',
    last_timestamp: (e.last_timestamp as string) ?? ts,
    first_timestamp: (e.first_timestamp as string) ?? ts,
    id: (e.id as string) ?? `${ts}-${e.resource_name}-${e.reason}`,
  };
}

function normalizeK8sEvent(item: { metadata?: { uid?: string }; type?: string; reason?: string; message?: string; involvedObject?: { kind?: string; name?: string; namespace?: string }; firstTimestamp?: string; lastTimestamp?: string }): NormalizedEvent {
  const ts = item.lastTimestamp ?? item.firstTimestamp ?? '';
  const ns = item.involvedObject?.namespace ?? 'default';
  return {
    type: item.type ?? 'Normal',
    reason: item.reason ?? '',
    message: item.message ?? '',
    resource_kind: item.involvedObject?.kind ?? 'Pod',
    resource_name: item.involvedObject?.name ?? '',
    namespace: ns,
    last_timestamp: item.lastTimestamp ?? ts,
    first_timestamp: item.firstTimestamp ?? ts,
    id: item.metadata?.uid ?? `${ts}-${item.involvedObject?.name}-${item.reason}`,
  };
}

export function ActivityFeed() {
  const { activeCluster } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const { config } = useKubernetesConfigStore();

  const backendEventsQuery = useQuery({
    queryKey: ['backend', 'events', currentClusterId, 'feed'],
    queryFn: () => getEvents(backendBaseUrl, currentClusterId!, { namespace: 'default', limit: 30 }),
    enabled: !!currentClusterId && isBackendConfigured(),
    staleTime: 10000,
    refetchInterval: 20000,
  });

  const k8sEventsList = useK8sResourceList('events', 'default', {
    enabled: !!activeCluster && !isBackendConfigured() && config.isConnected,
    limit: 50,
    refetchInterval: 20000,
  });

  const normalizedEvents = useMemo((): NormalizedEvent[] => {
    if (isBackendConfigured() && backendEventsQuery.data?.length) {
      return backendEventsQuery.data.slice(0, 25).map((e) => normalizeBackendEvent(e as Record<string, unknown>));
    }
    const raw = k8sEventsList.data?.items ?? [];
    return raw
      .slice(0, 25)
      .map((it) => normalizeK8sEvent(it as Parameters<typeof normalizeK8sEvent>[0]));
  }, [isBackendConfigured, backendEventsQuery.data, k8sEventsList.data?.items]);

  const items = useMemo(() => {
    return normalizedEvents.map((e) => {
      const { icon, label } = iconForReason(e.reason, e.type);
      const route = ROUTE_BY_KIND[e.resource_kind];
      const link = route && e.resource_name ? `/${route}/${e.namespace}/${e.resource_name}` : '/events';
      return {
        id: e.id,
        type: e.type,
        icon,
        label,
        message: e.message || e.reason,
        resourceKind: e.resource_kind,
        resourceName: e.resource_name,
        namespace: e.namespace,
        time: formatEventTime(e.last_timestamp || e.first_timestamp),
        link,
      };
    });
  }, [normalizedEvents]);

  const [filterType, setFilterType] = useState<string>('all');

  const filteredItems = useMemo(() => {
    if (filterType === 'all') return items;
    return items.filter((i) => i.resourceKind.toLowerCase() === filterType);
  }, [items, filterType]);

  if (!activeCluster) return null;

  return (
    <section
      className={cn(
        'dashboard-panel flex flex-col overflow-hidden min-h-0 h-full',
        'rounded-2xl border border-[hsl(var(--accent)/0.8)]',
        'bg-gradient-to-b from-white/80 to-[hsl(var(--accent)/0.08)]'
      )}
      aria-label="Activity feed and quick actions"
    >
      <div className="px-4 py-3 border-b border-[hsl(var(--accent)/0.5)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-[hsl(var(--accent))]">
            <Activity className="h-3.5 w-3.5 text-[hsl(var(--primary))]" aria-hidden />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Activity</h2>
        </div>
        <Link
          to="/events"
          className="text-xs font-medium text-[hsl(var(--primary))] hover:underline"
        >
          View all
        </Link>
      </div>

      {/* Quick action row */}
      <div className="px-3 py-2 border-b border-[hsl(var(--accent)/0.4)] flex flex-wrap gap-2 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs bg-[hsl(var(--accent)/0.5)] hover:bg-[hsl(var(--accent))] text-[hsl(var(--primary))]"
          asChild
        >
          <Link to="/pods">
            <FileText className="h-3.5 w-3.5 mr-1" aria-hidden />
            View logs
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs bg-[hsl(var(--accent)/0.5)] hover:bg-[hsl(var(--accent))] text-[hsl(var(--primary))]"
          asChild
        >
          <Link to="/deployments">
            <Scale className="h-3.5 w-3.5 mr-1" aria-hidden />
            Scale
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs bg-[hsl(var(--accent)/0.5)] hover:bg-[hsl(var(--accent))] text-[hsl(var(--primary))]"
          asChild
        >
          <Link to="/pods">
            <Terminal className="h-3.5 w-3.5 mr-1" aria-hidden />
            Exec
          </Link>
        </Button>
      </div>

      {/* Filter */}
      <div className="px-3 py-2 flex items-center gap-2 shrink-0">
        <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Filter</span>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="text-xs bg-white/80 border border-[hsl(var(--accent))] rounded-lg px-2 py-1.5 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          aria-label="Filter activity by resource type"
        >
          <option value="all">All</option>
          <option value="pod">Pod</option>
          <option value="deployment">Deployment</option>
          <option value="replicaset">ReplicaSet</option>
          <option value="node">Node</option>
          <option value="service">Service</option>
        </select>
      </div>

      {/* Rich timeline */}
      <div className="flex-1 max-h-[260px] overflow-auto min-h-0">
        {(isBackendConfigured() ? backendEventsQuery.isLoading : k8sEventsList.isLoading) ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--ring))]" aria-hidden />
            <span className="text-xs text-muted-foreground">Loading events...</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-[hsl(var(--accent))] flex items-center justify-center">
              <Clock className="h-6 w-6 text-[hsl(var(--ring)/0.6)]" aria-hidden />
            </div>
            <p className="text-sm font-medium text-foreground">
              {items.length === 0 ? 'No recent activity' : `No ${filterType} events`}
            </p>
            <p className="text-xs text-muted-foreground">
              {items.length === 0 ? 'Events in default namespace will appear here.' : 'Try another filter.'}
            </p>
          </div>
        ) : (
          <ul className="relative py-3 px-2" role="list">
            <div
              className="absolute left-6 top-4 bottom-4 w-px bg-gradient-to-b from-[hsl(var(--ring)/0.5)] via-[hsl(var(--accent))] to-transparent"
              aria-hidden
            />
            {filteredItems.map((item, i) => (
              <motion.li
                key={item.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: i * 0.02 }}
                className="relative flex gap-3 pl-1 pr-2 py-2 rounded-xl hover:bg-[hsl(var(--accent)/0.3)] transition-colors"
              >
                <div
                  className={cn(
                    'dashboard-timeline-dot',
                    item.type === 'Warning' && 'border-[hsl(var(--warning))] bg-[hsl(var(--warning)/0.08)]'
                  )}
                >
                  <item.icon
                    className={cn(
                      'h-3.5 w-3.5',
                      item.type === 'Warning' ? 'text-[hsl(var(--warning)/0.9)]' : 'text-[hsl(var(--primary))]'
                    )}
                    aria-hidden
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <Link to={item.link} className="block group">
                    <p className="text-sm font-medium text-foreground truncate group-hover:text-[hsl(var(--primary))] group-hover:underline">
                      {item.resourceName ? `${item.resourceKind} · ${item.resourceName}` : item.label}
                    </p>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">
                      {item.message}
                    </p>
                  </Link>
                  <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-muted-foreground">
                    <Clock className="h-3 w-3" aria-hidden />
                    <span className="tabular-nums">{item.time}</span>
                    {item.namespace && item.namespace !== 'default' && (
                      <>
                        <span>·</span>
                        <span className="font-mono">{item.namespace}</span>
                      </>
                    )}
                  </div>
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
