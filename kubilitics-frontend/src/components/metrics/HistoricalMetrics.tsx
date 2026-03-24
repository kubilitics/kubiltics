/**
 * TASK-OBS-014: Historical Metrics Storage
 *
 * Historical metrics viewer for offline clusters.
 * 5-minute granularity, 7-day retention display with time range navigation.
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  History,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  Cpu,
  HardDrive,
  Download,
  RefreshCw,
  AlertCircle,
  Database,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { downloadBlob, buildCsv, escapeCsvCell } from '@/lib/exportUtils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface HistoricalDataPoint {
  timestamp: number;     // epoch ms
  cpuPercent: number;    // 0-100
  memoryPercent: number; // 0-100
  cpuMillicores: number;
  memoryBytes: number;
  podCount: number;
}

interface HistoricalMetricsResponse {
  resourceName: string;
  resourceKind: string;
  namespace?: string;
  granularity: string; // "5m"
  retentionDays: number;
  data: HistoricalDataPoint[];
  oldestTimestamp: number;
  newestTimestamp: number;
}

type HistoricalRange = '6h' | '12h' | '1d' | '3d' | '7d';

// ─── Config ──────────────────────────────────────────────────────────────────

const RANGES: { value: HistoricalRange; label: string; ms: number }[] = [
  { value: '6h',  label: '6 Hours',  ms: 6 * 3600_000 },
  { value: '12h', label: '12 Hours', ms: 12 * 3600_000 },
  { value: '1d',  label: '1 Day',    ms: 24 * 3600_000 },
  { value: '3d',  label: '3 Days',   ms: 3 * 24 * 3600_000 },
  { value: '7d',  label: '7 Days',   ms: 7 * 24 * 3600_000 },
];

const GRANULARITY_MS = 5 * 60_000; // 5-min granularity

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateRange(startMs: number, endMs: number): string {
  const s = new Date(startMs);
  const e = new Date(endMs);
  const sameDay = s.toDateString() === e.toDateString();
  const dateOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (sameDay) {
    return `${s.toLocaleDateString(undefined, dateOpts)} ${s.toLocaleTimeString(undefined, timeOpts)} - ${e.toLocaleTimeString(undefined, timeOpts)}`;
  }
  return `${s.toLocaleDateString(undefined, dateOpts)} ${s.toLocaleTimeString(undefined, timeOpts)} - ${e.toLocaleDateString(undefined, dateOpts)} ${e.toLocaleTimeString(undefined, timeOpts)}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'Ki', 'Mi', 'Gi', 'Ti'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchHistoricalMetrics(
  baseUrl: string,
  clusterId: string | null,
  params: { start: number; end: number; kind?: string; name?: string; namespace?: string },
): Promise<HistoricalMetricsResponse> {
  const prefix = clusterId ? `/api/v1/clusters/${clusterId}` : '/api/v1';
  const qs = new URLSearchParams({
    start: Math.floor(params.start / 1000).toString(),
    end: Math.floor(params.end / 1000).toString(),
  });
  if (params.kind) qs.set('kind', params.kind);
  if (params.name) qs.set('name', params.name);
  if (params.namespace) qs.set('namespace', params.namespace);

  const res = await fetch(`${baseUrl}${prefix}/metrics/historical?${qs}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch historical metrics: ${res.status}`);
  return res.json();
}

// ─── Component ───────────────────────────────────────────────────────────────

interface HistoricalMetricsProps {
  resourceKind?: string;
  resourceName?: string;
  namespace?: string;
  className?: string;
}

export function HistoricalMetrics({
  resourceKind = 'cluster',
  resourceName,
  namespace,
  className,
}: HistoricalMetricsProps) {
  const [range, setRange] = useState<HistoricalRange>('1d');
  const [offset, setOffset] = useState(0); // offset in range-lengths from now
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(stored);
  const clusterId = useBackendConfigStore((s) => s.currentClusterId);

  const rangeConfig = RANGES.find((r) => r.value === range)!;
  const endMs = Date.now() - offset * rangeConfig.ms;
  const startMs = endMs - rangeConfig.ms;
  const isAtPresent = offset === 0;
  const maxOffset = Math.floor((7 * 24 * 3600_000) / rangeConfig.ms) - 1;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['historical-metrics', baseUrl, clusterId, resourceKind, resourceName, namespace, range, offset],
    queryFn: () =>
      fetchHistoricalMetrics(baseUrl, clusterId, {
        start: startMs,
        end: endMs,
        kind: resourceKind,
        name: resourceName,
        namespace,
      }),
    staleTime: GRANULARITY_MS,
    enabled: !!clusterId,  // baseUrl='' is valid in dev (Vite proxy)
  });

  // Chart data
  const chartData = useMemo(() => {
    if (!data?.data) return [];
    return data.data.map((dp) => ({
      time: new Date(dp.timestamp).toLocaleTimeString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      timestamp: dp.timestamp,
      cpu: dp.cpuPercent,
      memory: dp.memoryPercent,
      pods: dp.podCount,
    }));
  }, [data]);

  // Stats
  const stats = useMemo(() => {
    if (!data?.data || data.data.length === 0) return null;
    const d = data.data;
    return {
      avgCpu: d.reduce((s, p) => s + p.cpuPercent, 0) / d.length,
      maxCpu: Math.max(...d.map((p) => p.cpuPercent)),
      avgMemory: d.reduce((s, p) => s + p.memoryPercent, 0) / d.length,
      maxMemory: Math.max(...d.map((p) => p.memoryPercent)),
      avgPods: Math.round(d.reduce((s, p) => s + p.podCount, 0) / d.length),
      dataPoints: d.length,
    };
  }, [data]);

  const handlePrev = () => setOffset((o) => Math.min(o + 1, maxOffset));
  const handleNext = () => setOffset((o) => Math.max(o - 1, 0));
  const handleNow = () => setOffset(0);

  const handleExport = useCallback(() => {
    if (!data?.data) return;
    const headers = ['Timestamp', 'CPU %', 'Memory %', 'CPU (millicores)', 'Memory (bytes)', 'Pod Count'];
    const rows = data.data.map((dp) => [
      escapeCsvCell(new Date(dp.timestamp).toISOString()),
      escapeCsvCell(dp.cpuPercent.toFixed(2)),
      escapeCsvCell(dp.memoryPercent.toFixed(2)),
      escapeCsvCell(dp.cpuMillicores),
      escapeCsvCell(dp.memoryBytes),
      escapeCsvCell(dp.podCount),
    ]);
    const csv = buildCsv(headers, rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const dateSuffix = new Date(startMs).toISOString().slice(0, 10);
    downloadBlob(blob, `historical-metrics-${dateSuffix}.csv`);
  }, [data, startMs]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn('space-y-6', className)}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-100 dark:bg-indigo-950/40">
            <History className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Historical Metrics
            </h2>
            <p className="text-sm text-muted-foreground">
              5-minute granularity, 7-day retention
              {resourceName && ` for ${resourceName}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs gap-1">
            <Database className="h-3 w-3" />
            {data ? `${data.data.length} points` : '--'}
          </Badge>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20">
          <CardContent className="p-4 flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {String(error)}
          </CardContent>
        </Card>
      )}

      {/* Time Navigation */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Select value={range} onValueChange={(v) => { setRange(v as HistoricalRange); setOffset(0); }}>
                <SelectTrigger className="w-[120px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={handlePrev} disabled={offset >= maxOffset}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={handleNext} disabled={isAtPresent}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                {!isAtPresent && (
                  <Button variant="outline" size="sm" onClick={handleNow} className="gap-1 text-xs">
                    <Clock className="h-3 w-3" />
                    Now
                  </Button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {formatDateRange(startMs, endMs)}
              </span>
              <Button variant="outline" size="sm" className="gap-1" onClick={handleExport} disabled={!data?.data?.length}>
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
              <Button variant="outline" size="sm" className="gap-1" onClick={() => refetch()} disabled={isLoading}>
                <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Strip */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Avg CPU', value: `${stats.avgCpu.toFixed(1)}%`, icon: Cpu, color: 'text-blue-600' },
            { label: 'Max CPU', value: `${stats.maxCpu.toFixed(1)}%`, icon: Cpu, color: 'text-red-600' },
            { label: 'Avg Memory', value: `${stats.avgMemory.toFixed(1)}%`, icon: HardDrive, color: 'text-purple-600' },
            { label: 'Max Memory', value: `${stats.maxMemory.toFixed(1)}%`, icon: HardDrive, color: 'text-red-600' },
            { label: 'Avg Pods', value: stats.avgPods, icon: Database, color: 'text-emerald-600' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl border p-3 flex items-center gap-2 bg-slate-50/50 dark:bg-slate-800/30">
              <Icon className={cn('h-4 w-4 shrink-0', color)} />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
                <p className={cn('text-sm font-bold tabular-nums', color)}>{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4">
        {/* CPU + Memory Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Cpu className="h-4 w-4 text-blue-500" />
              CPU & Memory Utilization
            </CardTitle>
            <CardDescription className="text-xs">
              Historical resource utilization (5-minute granularity)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10 }}
                    interval="preserveStartEnd"
                    className="text-slate-500"
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    domain={[0, 100]}
                    className="text-slate-500"
                    width={35}
                    unit="%"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--chart-tooltip-bg)',
                      borderColor: 'var(--chart-tooltip-border)',
                      borderRadius: '0.75rem',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Area
                    type="monotone"
                    dataKey="cpu"
                    name="CPU %"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.1}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="memory"
                    name="Memory %"
                    stroke="#8b5cf6"
                    fill="#8b5cf6"
                    fillOpacity={0.1}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
                {isLoading ? 'Loading historical metrics...' : 'No historical data for this time range.'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}

export default HistoricalMetrics;
