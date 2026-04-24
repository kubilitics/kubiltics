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
import { useQuery } from '@tanstack/react-query';
import {
  GitBranch,
  ExternalLink,
  Loader2,
  Hourglass,
  Activity,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useResourceTraces } from '@/hooks/useTraces';
import { getTracingStatus } from '@/services/api/observability';
import { InstrumentationPanel } from './InstrumentationPanel';
import {
  getEffectiveBackendBaseUrl,
  useBackendConfigStore,
} from '@/stores/backendConfigStore';
import { TraceGroupList } from './TraceGroupList';

/* ---- Time range presets ------------------------------------------------- */

const TIME_RANGES: { label: string; value: string; ms: number }[] = [
  { label: 'Last 1h', value: '1h', ms: 3_600_000 },
  { label: 'Last 6h', value: '6h', ms: 21_600_000 },
  { label: 'Last 24h', value: '24h', ms: 86_400_000 },
  { label: 'Last 7d', value: '7d', ms: 604_800_000 },
];

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
  clusterId,
}: ResourceTracesTabProps) {
  const [timeRange, setTimeRange] = useState('24h');
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);

  // Tracing status — drives the intelligent empty state below.
  const { data: tracingStatus } = useQuery({
    queryKey: ['tracing-status', clusterId],
    queryFn: () => getTracingStatus(baseUrl, clusterId!),
    // '' baseUrl = same-origin (dev proxy / in-cluster nginx); do not gate on truthy.
    enabled: !!clusterId,
    staleTime: 30_000,
    retry: 1,
  });

  const isDeployment = resourceKind.toLowerCase() === 'deployment';

  const timeRangeMs = TIME_RANGES.find((t) => t.value === timeRange)?.ms ?? 86_400_000;
  // Stabilize the time window — only recalculate when timeRange changes,
  // not on every render (prevents infinite query key changes → skeleton flicker).
  const fromNs = useMemo(() => (Date.now() - timeRangeMs) * 1_000_000, [timeRangeMs]);

  const { data: traces, isLoading: queryLoading, isFetching, fetchStatus } = useResourceTraces(
    resourceKind,
    resourceName,
    namespace,
    { from: fromNs, limit: 50 },
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

      {/* Instrumentation panel (Deployments only) */}
      {isDeployment && clusterId && (
        <InstrumentationPanel
          clusterId={clusterId}
          namespace={namespace}
          resourceName={resourceName}
        />
      )}

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
          tracingStatus?.all_ready ? (
            // State 2: collector deployed and ready, but no spans for this resource yet.
            <div className="flex flex-col items-center justify-center py-12 px-4 text-muted-foreground">
              <Hourglass className="h-10 w-10 mb-3 text-primary/40" />
              <p className="text-sm font-medium mb-1 text-foreground">
                Waiting for traces from {resourceName}
              </p>
              <p className="text-xs mt-1 max-w-md text-center leading-relaxed">
                The OpenTelemetry Collector is running. Traces will appear here
                once {resourceName} sends them.
              </p>
              <div className="mt-4 w-full max-w-md rounded-md border border-border/60 bg-muted/40 p-3 text-left">
                <p className="text-[11px] font-medium text-foreground/80 mb-1.5">
                  To send traces, set these env vars on your container:
                </p>
                <pre className="font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
{`OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.kubilitics-system:4318
OTEL_SERVICE_NAME=${resourceName}`}
                </pre>
              </div>
              <Link
                to="/traces"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
              >
                Auto-instrumentation guide
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          ) : (
            // State 1: collector not deployed — link to setup page.
            <div className="flex flex-col items-center justify-center py-12 px-4 text-muted-foreground">
              <Activity className="h-10 w-10 mb-3 text-muted-foreground/50" />
              <p className="text-sm font-medium mb-1 text-foreground">
                Tracing not configured for this cluster
              </p>
              <p className="text-xs mt-1 max-w-md text-center leading-relaxed">
                Run a single helm command to install the OpenTelemetry collector and start collecting traces.
              </p>
              <Link
                to={`/clusters/${clusterId}/setup/observability`}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
              >
                Set up tracing
                <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          )
        ) : (
          <TraceGroupList traces={sortedTraces} />
        )}
      </CardContent>

      {/* Footer link — single line, minimal chrome */}
      <div className="px-4 py-2.5 border-t border-border/40 flex items-center justify-end">
        <Link
          to={tracesPageLink}
          className={cn(
            'inline-flex items-center gap-1.5 text-[11px] font-medium',
            'text-primary hover:text-primary/80 transition-colors',
          )}
        >
          Open in Traces Explorer
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </Card>
  );
}
