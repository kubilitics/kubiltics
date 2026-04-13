/**
 * TracingStatusPill — persistent header indicator for the live tracing pipeline
 * state of the active cluster.
 *
 * - Colored 8px dot + "Tracing N/M" label (tabular-nums)
 * - Green (all ready) / Amber pulsing (installing) / Red (broken) / Gray (missing/unknown)
 * - Click → /clusters/:clusterId/setup/observability
 * - Hidden when no active cluster or backend not configured
 * - Polls every 60s; silent fail (retry: false) so it doesn't spam errors in header
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getTracingStatus } from '@/services/api/observability';

export function TracingStatusPill() {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  // Active cluster ID comes from backendConfigStore (set on cluster switch in Header)
  const clusterId = useBackendConfigStore((s) => s.currentClusterId);

  const { data } = useQuery({
    queryKey: ['tracing-status', clusterId],
    queryFn: () => getTracingStatus(baseUrl, clusterId!),
    enabled: !!clusterId && isBackendConfigured,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false, // silent fail — this is a header indicator, not a critical fetch
  });

  // Hidden when no active cluster
  if (!clusterId) return null;

  // Color + label logic
  let color: 'green' | 'amber' | 'red' | 'gray' = 'gray';
  let label = 'Tracing';

  if (data) {
    const readyCount = data.components.filter(
      (c) => c.status === 'ready' || c.status === 'no-data',
    ).length;
    const total = data.components.length;
    label = `Tracing ${readyCount}/${total}`;

    if (data.all_ready) {
      color = 'green';
    } else if (data.components.some((c) => c.status === 'installing')) {
      color = 'amber';
    } else if (data.components.every((c) => c.status === 'missing')) {
      color = 'gray';
    } else {
      color = 'red';
    }
  }

  return (
    <Link
      to={`/clusters/${clusterId}/setup/observability`}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors tabular-nums"
      title="Tracing status — click to open setup"
    >
      <span
        className={cn(
          'w-2 h-2 rounded-full shrink-0',
          color === 'green' && 'bg-emerald-400',
          color === 'amber' && 'bg-amber-400 animate-pulse',
          color === 'red' && 'bg-rose-400',
          color === 'gray' && 'bg-white/30',
        )}
      />
      <span>{label}</span>
    </Link>
  );
}
