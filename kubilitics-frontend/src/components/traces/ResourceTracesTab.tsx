/**
 * ResourceTracesTab -- Reusable tab component that shows OTel traces
 * for a specific Kubernetes resource. Designed to be embedded inside
 * GenericResourceDetail's tab system.
 *
 * For Pods: matches k8s_pod_name
 * For Deployments: matches k8s_deployment
 * For Services: matches service_name
 */
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { GitBranch, ExternalLink, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useResourceTraces } from '@/hooks/useTraces';

/* ---- Time range presets ------------------------------------------------- */

const TIME_RANGES: { label: string; value: string; ms: number }[] = [
  { label: 'Last 1h', value: '1h', ms: 3_600_000 },
  { label: 'Last 6h', value: '6h', ms: 21_600_000 },
  { label: 'Last 24h', value: '24h', ms: 86_400_000 },
  { label: 'Last 7d', value: '7d', ms: 604_800_000 },
];

/* ---- Helpers ------------------------------------------------------------ */

function formatDuration(ns: number): string {
  const ms = ns / 1_000_000;
  if (ms < 1) return `${(ns / 1_000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimeAgo(unixNs: number): string {
  const now = Date.now();
  const ms = now - unixNs / 1_000_000;
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function truncateId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

/* ---- Props -------------------------------------------------------------- */

export interface ResourceTracesTabProps {
  resourceKind: string;
  resourceName: string;
  namespace: string;
  clusterId: string | null;
}

/* ---- Component ---------------------------------------------------------- */

export function ResourceTracesTab({
  resourceKind,
  resourceName,
  namespace,
}: ResourceTracesTabProps) {
  const [timeRange, setTimeRange] = useState('24h');

  const timeRangeMs = TIME_RANGES.find((t) => t.value === timeRange)?.ms ?? 86_400_000;
  const now = Date.now();
  // OTel times are nanoseconds on the backend
  const fromNs = (now - timeRangeMs) * 1_000_000;
  const toNs = now * 1_000_000;

  const { data: traces, isLoading: queryLoading, isFetching, fetchStatus } = useResourceTraces(
    resourceKind,
    resourceName,
    namespace,
    { from: fromNs, to: toNs, limit: 50 },
  );
  // React Query v5: disabled queries stay isLoading=true forever (pending state).
  // Show skeleton only when actually fetching, not when disabled/idle.
  const isLoading = queryLoading && fetchStatus !== 'idle';

  const sortedTraces = useMemo(
    () => (traces ?? []).slice().sort((a, b) => b.start_time - a.start_time),
    [traces],
  );

  // Link to the full Traces page filtered for this resource
  const tracesPageLink = useMemo(() => {
    const params = new URLSearchParams();
    if (resourceKind.toLowerCase() === 'service') {
      params.set('service', resourceName);
    }
    const qs = params.toString();
    return `/traces${qs ? `?${qs}` : ''}`;
  }, [resourceKind, resourceName]);

  return (
    <Card className="border-none soft-shadow glass-panel">
      {/* Header */}
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              Traces for {resourceName}
              {sortedTraces.length > 0 && (
                <Badge variant="secondary" className="text-[10px] h-5">
                  {sortedTraces.length}
                </Badge>
              )}
              {isFetching && !isLoading && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </CardTitle>
          </div>

          {/* Time range selector */}
          <div className="flex items-center gap-1">
            {TIME_RANGES.map((t) => (
              <Button
                key={t.value}
                variant={timeRange === t.value ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => setTimeRange(t.value)}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>

      {/* Trace list */}
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-5 w-20 shrink-0" />
                <Skeleton className="h-5 w-32 shrink-0" />
                <Skeleton className="h-5 flex-1" />
              </div>
            ))}
          </div>
        ) : sortedTraces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-muted-foreground">
            <GitBranch className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm font-medium mb-1">No traces found for this resource</p>
            <p className="text-xs mt-1 max-w-sm text-center leading-relaxed">
              Traces appear when your apps send OpenTelemetry data through a collector.
            </p>
            <Link
              to="/traces"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              View setup instructions
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        ) : (
          <div className="max-h-[600px] overflow-y-auto">
            {sortedTraces.map((trace) => (
              <Link
                key={trace.trace_id}
                to={`/traces?traceId=${encodeURIComponent(trace.trace_id)}`}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-border/40 hover:bg-muted/50 transition-colors group"
              >
                {/* Status dot */}
                <div
                  className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    trace.status === 'ERROR'
                      ? 'bg-red-500'
                      : trace.status === 'OK'
                        ? 'bg-green-500'
                        : 'bg-muted-foreground/40',
                  )}
                />

                {/* Trace ID */}
                <span className="font-mono text-xs text-muted-foreground/70 shrink-0 w-28 truncate">
                  {truncateId(trace.trace_id)}
                </span>

                {/* Service + Operation */}
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 h-4 shrink-0 bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20"
                  >
                    {trace.root_service || 'unknown'}
                  </Badge>
                  <span className="text-xs truncate">
                    {trace.root_operation || '-'}
                  </span>
                </div>

                {/* Duration */}
                <span className="text-xs font-mono text-muted-foreground shrink-0">
                  {formatDuration(trace.duration_ns)}
                </span>

                {/* Span count */}
                <Badge
                  variant="secondary"
                  className="text-[10px] h-4 px-1.5 shrink-0"
                >
                  {trace.span_count} spans
                </Badge>

                {/* Error count */}
                {trace.error_count > 0 && (
                  <Badge
                    variant="destructive"
                    className="text-[10px] h-4 px-1.5 shrink-0"
                  >
                    {trace.error_count} err
                  </Badge>
                )}

                {/* Time ago */}
                <span className="text-[10px] text-muted-foreground/60 shrink-0 w-14 text-right">
                  {formatTimeAgo(trace.start_time)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>

      {/* Footer link */}
      <div className="px-4 py-3 border-t border-border/40">
        <Link
          to={tracesPageLink}
          className={cn(
            'inline-flex items-center gap-1.5 text-xs font-medium',
            'text-primary hover:text-primary/80 transition-colors',
          )}
        >
          View in Traces Explorer
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </Card>
  );
}
