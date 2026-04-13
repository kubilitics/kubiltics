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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GitBranch,
  ExternalLink,
  Loader2,
  AlertCircle,
  Hourglass,
  Radio,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useResourceTraces } from '@/hooks/useTraces';
import {
  getTracingStatus,
  enableTracing,
  getInstrumentationStatus,
  instrumentDeployment,
  uninstrumentDeployment,
} from '@/services/api/tracing';
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
  const queryClient = useQueryClient();

  // Tracing status — drives the intelligent empty state below.
  const { data: tracingStatus } = useQuery({
    queryKey: ['tracing-status', clusterId],
    queryFn: () => getTracingStatus(baseUrl, clusterId!),
    enabled: !!clusterId && !!baseUrl,
    staleTime: 30_000,
    retry: 1,
  });

  const enableMutation = useMutation({
    mutationFn: () => enableTracing(baseUrl, clusterId!),
    onSuccess: (res) => {
      toast.success('Tracing enabled', { description: res.message });
      queryClient.invalidateQueries({ queryKey: ['tracing-status', clusterId] });
    },
    onError: (err: Error) => {
      toast.error('Failed to enable tracing', { description: err.message });
    },
  });

  // Per-deployment instrumentation status (only fetched for Deployments).
  const isDeployment = resourceKind.toLowerCase() === 'deployment';
  const instrStatusKey = ['instrumentation-status', clusterId, namespace, resourceName];
  const { data: instrStatus } = useQuery({
    queryKey: instrStatusKey,
    queryFn: () =>
      getInstrumentationStatus(baseUrl, clusterId!, namespace, resourceName),
    enabled: !!clusterId && !!baseUrl && isDeployment && !!tracingStatus?.enabled,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  const instrumentMutation = useMutation({
    mutationFn: () =>
      instrumentDeployment(baseUrl, clusterId!, namespace, resourceName),
    onSuccess: (res) => {
      if (res.already) {
        toast.info('Already instrumented', {
          description: `Language: ${res.language}`,
        });
      } else {
        toast.success('Instrumentation enabled', {
          description: `Injecting OTel SDK (${res.language}). Pods will roll out.`,
        });
      }
      queryClient.invalidateQueries({ queryKey: instrStatusKey });
    },
    onError: (err: Error) => {
      toast.error('Failed to instrument', { description: err.message });
    },
  });

  const uninstrumentMutation = useMutation({
    mutationFn: () =>
      uninstrumentDeployment(baseUrl, clusterId!, namespace, resourceName),
    onSuccess: () => {
      toast.success('Instrumentation disabled');
      queryClient.invalidateQueries({ queryKey: instrStatusKey });
    },
    onError: (err: Error) => {
      toast.error('Failed to disable instrumentation', { description: err.message });
    },
  });

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

      {/* Instrumentation status panel (Deployments only, cluster tracing on) */}
      {isDeployment && tracingStatus?.enabled && instrStatus && (
        <div className="px-4 pt-3">
          {!instrStatus.otel_operator_ready ? (
            <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">
                OpenTelemetry Operator is still installing...
              </span>
            </div>
          ) : instrStatus.instrumented ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="text-foreground font-medium">
                  Instrumented
                  {instrStatus.language && (
                    <span className="text-muted-foreground font-normal">
                      {' '}({instrStatus.language})
                    </span>
                  )}
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={uninstrumentMutation.isPending}
                onClick={() => uninstrumentMutation.mutate()}
              >
                {uninstrumentMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  'Disable instrumentation'
                )}
              </Button>
            </div>
          ) : !instrStatus.supports_language ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-muted-foreground leading-relaxed">
                <div className="text-foreground font-medium">
                  Auto-instrumentation not available for this image
                </div>
                Manually set{' '}
                <code className="font-mono text-[10px] px-1 py-0.5 rounded bg-muted">
                  OTEL_EXPORTER_OTLP_ENDPOINT
                </code>{' '}
                in your container.
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary shrink-0" />
                <span className="text-foreground">
                  This deployment is not instrumented
                  <span className="text-muted-foreground">
                    {' '}• detected language:{' '}
                    <span className="font-medium text-foreground">
                      {instrStatus.detected_language}
                    </span>
                  </span>
                </span>
              </div>
              <Button
                size="sm"
                className="h-7 gap-1.5 text-xs"
                disabled={instrumentMutation.isPending}
                onClick={() => instrumentMutation.mutate()}
              >
                {instrumentMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Instrumenting...
                  </>
                ) : (
                  <>
                    <Zap className="h-3 w-3" />
                    Instrument with OpenTelemetry
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
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
          tracingStatus && tracingStatus.enabled ? (
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
            // State 1: collector not deployed — offer one-click enable.
            <div className="flex flex-col items-center justify-center py-12 px-4 text-muted-foreground">
              <AlertCircle className="h-10 w-10 mb-3 text-amber-500/70" />
              <p className="text-sm font-medium mb-1 text-foreground">
                Tracing not enabled
              </p>
              <p className="text-xs mt-1 max-w-md text-center leading-relaxed">
                Install the OpenTelemetry Collector to start collecting traces
                from instrumented apps in this cluster.
              </p>
              <div className="mt-4 flex items-center gap-3">
                <Button
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={!clusterId || enableMutation.isPending}
                  onClick={() => enableMutation.mutate()}
                >
                  {enableMutation.isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Installing...
                    </>
                  ) : (
                    <>
                      <Radio className="h-3.5 w-3.5" />
                      Enable Tracing
                    </>
                  )}
                </Button>
                <Link
                  to="/traces"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  Learn more
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
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
