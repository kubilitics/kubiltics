/**
 * TraceList — Filterable table of distributed traces.
 * Shows trace summaries with service badges, duration, span/error counts.
 */
import { useMemo, useState, useEffect, useCallback } from 'react';
import { Search, Clock, Filter, Plug } from 'lucide-react';
import { ListPagination } from '@/components/list/ListPagination';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useTracesStore } from '@/stores/tracesStore';
import { getBackendBase } from '@/lib/backendUrl';
import type { TraceSummary, TraceQueryParams } from '@/services/api/traces';

/* ─── Helpers ──────────────────────────────────────────────────────────── */

const TIME_RANGES: { value: string; label: string; ms: number }[] = [
  { value: '15m', label: 'Last 15m', ms: 15 * 60 * 1000 },
  { value: '1h', label: 'Last 1h', ms: 60 * 60 * 1000 },
  { value: '6h', label: 'Last 6h', ms: 6 * 60 * 60 * 1000 },
  { value: '24h', label: 'Last 24h', ms: 24 * 60 * 60 * 1000 },
];

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
  return id.length > 8 ? `${id.slice(0, 8)}...` : id;
}

/** Stable color palette for service badges */
const SERVICE_COLORS = [
  'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
  'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20',
  'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20',
  'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/20',
  'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20',
];

function serviceColorIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % SERVICE_COLORS.length;
}

/* ─── Component ────────────────────────────────────────────────────────── */

export function TraceList() {
  const store = useTracesStore();

  const timeRangeMs = TIME_RANGES.find((t) => t.value === store.timeRange)?.ms ?? 3_600_000;
  const fromNs = (Date.now() - timeRangeMs) * 1_000_000;

  const queryParams = useMemo<TraceQueryParams>(
    () => ({
      service: store.serviceFilter || undefined,
      status: store.statusFilter || undefined,
      min_duration: store.minDuration ?? undefined,
      from: fromNs,
      limit: 100,
    }),
    [store.serviceFilter, store.statusFilter, store.minDuration, fromNs],
  );

  // Pagination
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(1);

  // Direct fetch
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const base = getBackendBase();
        const clustersRes = await fetch(`${base}/api/v1/clusters`);
        const clusters: Array<{ id: string; status: string }> = await clustersRes.json();
        const connected = clusters.find((c) => c.status === 'connected');
        if (!connected) { setTraces([]); setIsLoading(false); return; }
        const qs = new URLSearchParams({ limit: '100' });
        if (queryParams.from) qs.set('from', String(queryParams.from));
        if (queryParams.service) qs.set('service', queryParams.service);
        if (queryParams.status) qs.set('status', queryParams.status);
        if (queryParams.min_duration) qs.set('min_duration', String(queryParams.min_duration));
        const res = await fetch(`${base}/api/v1/clusters/${connected.id}/traces?${qs}`);
        const data = await res.json();
        if (!cancelled) { setTraces(Array.isArray(data) ? data : []); setIsLoading(false); }
      } catch {
        if (!cancelled) { setTraces([]); setIsLoading(false); }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [queryParams.from, queryParams.service, queryParams.status, queryParams.min_duration]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [queryParams.from, queryParams.service, queryParams.status, queryParams.min_duration]);

  const totalPages = Math.max(1, Math.ceil(traces.length / PAGE_SIZE));
  const startIdx = (page - 1) * PAGE_SIZE;
  const paginatedTraces = traces.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <Card className="border-none soft-shadow glass-panel">
      <CardContent className="p-0">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-border/40">
          <Filter className="h-4 w-4 text-muted-foreground" />

          <Input
            placeholder="Filter by service..."
            value={store.serviceFilter}
            onChange={(e) => store.setServiceFilter(e.target.value)}
            className="h-8 w-48 text-sm"
          />

          <Select value={store.statusFilter || 'all'} onValueChange={(v) => store.setStatusFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 w-32 text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="OK">OK</SelectItem>
              <SelectItem value="ERROR">Error</SelectItem>
            </SelectContent>
          </Select>

          <Input
            type="number"
            placeholder="Min duration (ms)"
            value={store.minDuration ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              store.setMinDuration(v ? Number(v) : null);
            }}
            className="h-8 w-40 text-sm"
          />

          <Select value={store.timeRange} onValueChange={store.setTimeRange}>
            <SelectTrigger className="h-8 w-32 text-sm">
              <Clock className="h-3.5 w-3.5 mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(store.serviceFilter || store.statusFilter || store.minDuration !== null) && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={store.resetFilters}>
              Clear
            </Button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 text-muted-foreground text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3 font-medium">Trace ID</th>
                <th className="text-left px-4 py-3 font-medium">Service</th>
                <th className="text-left px-4 py-3 font-medium">Operation</th>
                <th className="text-right px-4 py-3 font-medium">Duration</th>
                <th className="text-right px-4 py-3 font-medium">Spans</th>
                <th className="text-right px-4 py-3 font-medium">Errors</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/20">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              )}
              {!isLoading && paginatedTraces.map((trace) => (
                <TraceRow key={trace.trace_id} trace={trace} onClick={() => store.selectTrace(trace.trace_id)} />
              ))}
              {!isLoading && traces?.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <Plug className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-foreground/80 mb-1">No traces yet</p>
                    <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                      Traces appear when your applications send data via OpenTelemetry.
                      Point your OTLP exporter to <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">http://localhost:8190/api/v1/v1/traces</code>
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {traces.length > 0 && (
          <div className="px-4 py-3 border-t border-border/40">
            <ListPagination
              hasPrev={page > 1}
              hasNext={page < totalPages}
              onPrev={() => setPage(p => Math.max(1, p - 1))}
              onNext={() => setPage(p => Math.min(totalPages, p + 1))}
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
              rangeLabel={`${startIdx + 1}–${Math.min(startIdx + PAGE_SIZE, traces.length)} of ${traces.length} traces`}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TraceRow({ trace, onClick }: { trace: TraceSummary; onClick: () => void }) {
  const isError = trace.status === 'ERROR' || trace.error_count > 0;

  return (
    <tr
      className={cn(
        'border-b border-border/20 cursor-pointer transition-colors hover:bg-muted/50',
        isError && 'bg-destructive/5',
      )}
      onClick={onClick}
    >
      <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground select-all max-w-[200px] truncate" title={trace.trace_id}>
        {trace.trace_id}
      </td>
      <td className="px-4 py-3">
        <Badge variant="outline" className={cn('text-xs font-medium', SERVICE_COLORS[serviceColorIndex(trace.root_service)])}>
          {trace.root_service}
        </Badge>
      </td>
      <td className="px-4 py-3 font-mono text-xs truncate max-w-[200px]" title={trace.root_operation}>
        {trace.root_operation}
      </td>
      <td className="px-4 py-3 text-right font-mono text-xs font-medium">
        {formatDuration(trace.duration_ns)}
      </td>
      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
        {trace.span_count}
      </td>
      <td className="px-4 py-3 text-right">
        {trace.error_count > 0 ? (
          <Badge variant="destructive" className="text-xs font-medium px-1.5 py-0">
            {trace.error_count}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        <span className="inline-flex items-center gap-1.5 text-xs">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              trace.status === 'ERROR' ? 'bg-destructive' : 'bg-[hsl(var(--success))]',
            )}
          />
          {trace.status === 'ERROR' ? 'ERR' : 'OK'}
        </span>
      </td>
      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
        {formatTimeAgo(trace.start_time)}
      </td>
    </tr>
  );
}
