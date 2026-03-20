/**
 * Cluster Details Panel — horizontal strip at end of Dashboard: version, provider,
 * region, namespaces; blue action button. Blue/white theme.
 */
import { Link } from 'react-router-dom';
import { Server } from 'lucide-react';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useClusterSummary } from '@/hooks/useClusterSummary';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const PROVIDER_LABELS: Record<string, string> = {
  eks: 'EKS',
  gke: 'GKE',
  aks: 'AKS',
  minikube: 'Minikube',
  kind: 'Kind',
  'on-prem': 'On-Prem',
};

function formatProvider(p: string): string {
  return PROVIDER_LABELS[p?.toLowerCase()] ?? (p || 'Unknown');
}

export function ClusterDetailsPanel() {
  const { activeCluster } = useClusterStore();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;
  const summaryQuery = useClusterSummary(clusterId ?? undefined);

  // Real data: version from cluster, provider formatted, region or — when unknown
  const version = activeCluster?.version?.trim() ? activeCluster.version : '—';
  const provider = formatProvider(activeCluster?.provider ?? '');
  const rawRegion = activeCluster?.region ?? '';
  const region = rawRegion && rawRegion !== 'default' ? rawRegion : '—';
  const namespaces = typeof summaryQuery.data?.namespace_count === 'number'
    ? summaryQuery.data.namespace_count
    : (activeCluster?.namespaces ?? 0);

  const items = [
    { label: 'Cluster Version', value: version, bold: false },
    { label: 'Provider', value: provider, bold: true },
    { label: 'Region', value: region, bold: true },
    { label: 'Namespaces', value: String(namespaces), bold: false },
  ] as const;

  return (
    <section
      className={cn(
        'dashboard-panel overflow-hidden',
        'rounded-2xl border border-[hsl(var(--accent)/0.8)]',
        'bg-white'
      )}
      aria-label="Cluster details"
      style={{ boxShadow: '0 1px 3px rgb(0 0 0 / 0.06)' }}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2 min-w-0 flex-1">
          {items.map(({ label, value, bold }) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <span
                className={cn(
                  'text-sm text-foreground tabular-nums',
                  bold ? 'font-bold' : 'font-semibold'
                )}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/settings"
                className={cn(
                  'flex shrink-0 items-center justify-center w-11 h-11 rounded-full',
                  'bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--ring))]',
                  'text-white shadow-md shadow-[hsl(var(--ring)/0.3)]',
                  'hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2'
                )}
                aria-label="Cluster settings"
              >
                <Server className="h-5 w-5" aria-hidden />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">
              Cluster settings
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </section>
  );
}
