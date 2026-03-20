/**
 * TASK-OBS-003: Time-Range Metrics (Integration)
 *
 * Connects TimeRangeSelector to metrics queries with sparkline charts
 * on resource cards. Maintains an in-memory buffer for metrics-server
 * data (1-hour window).
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Cpu,
  HardDrive,
  RefreshCw,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

// ─── Types ───────────────────────────────────────────────────────────────────

export type TimeRange = '5m' | '15m' | '30m' | '1h' | '3h' | '6h' | '12h' | '24h';

interface MetricPoint {
  timestamp: number;  // epoch ms
  cpu: number;        // millicores
  memory: number;     // bytes
}

interface ResourceMetricsSummary {
  name: string;
  namespace?: string;
  kind: string;
  currentCpu: number;
  currentMemory: number;
  cpuTrend: 'up' | 'down' | 'stable';
  memoryTrend: 'up' | 'down' | 'stable';
  history: MetricPoint[];
}

interface TimeRangeMetricsProps {
  /** Resource kind to query (pod, node, deployment). */
  resourceKind: string;
  /** Optional namespace filter. */
  namespace?: string;
  /** Optional resource name filter. */
  resourceName?: string;
  className?: string;
}

// ─── Time Range Config ───────────────────────────────────────────────────────

const TIME_RANGES: { value: TimeRange; label: string; seconds: number; step: number }[] = [
  { value: '5m',  label: '5 min',   seconds: 300,    step: 15  },
  { value: '15m', label: '15 min',  seconds: 900,    step: 30  },
  { value: '30m', label: '30 min',  seconds: 1800,   step: 60  },
  { value: '1h',  label: '1 hour',  seconds: 3600,   step: 60  },
  { value: '3h',  label: '3 hours', seconds: 10800,  step: 120 },
  { value: '6h',  label: '6 hours', seconds: 21600,  step: 300 },
  { value: '12h', label: '12 hours', seconds: 43200, step: 600 },
  { value: '24h', label: '24 hours', seconds: 86400, step: 900 },
];

// ─── In-Memory Metrics Buffer ────────────────────────────────────────────────

const BUFFER_MAX_AGE_MS = 3600_000; // 1 hour window

class MetricsBuffer {
  private buffer: Map<string, MetricPoint[]> = new Map();

  push(key: string, point: MetricPoint): void {
    if (!this.buffer.has(key)) {
      this.buffer.set(key, []);
    }
    const arr = this.buffer.get(key)!;
    arr.push(point);
    // Prune points older than 1 hour
    const cutoff = Date.now() - BUFFER_MAX_AGE_MS;
    const firstValid = arr.findIndex((p) => p.timestamp >= cutoff);
    if (firstValid > 0) arr.splice(0, firstValid);
  }

  get(key: string, rangeMs: number): MetricPoint[] {
    const arr = this.buffer.get(key) ?? [];
    const cutoff = Date.now() - rangeMs;
    return arr.filter((p) => p.timestamp >= cutoff);
  }

  clear(): void {
    this.buffer.clear();
  }
}

const globalBuffer = new MetricsBuffer();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'Ki', 'Mi', 'Gi'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatMillicores(mc: number): string {
  if (mc >= 1000) return `${(mc / 1000).toFixed(2)} cores`;
  return `${mc.toFixed(0)}m`;
}

function computeTrend(values: number[]): 'up' | 'down' | 'stable' {
  if (values.length < 2) return 'stable';
  const first = values[0];
  const last = values[values.length - 1];
  const delta = ((last - first) / (first || 1)) * 100;
  if (delta > 5) return 'up';
  if (delta < -5) return 'down';
  return 'stable';
}

const TrendIcon = ({ trend }: { trend: 'up' | 'down' | 'stable' }) => {
  if (trend === 'up') return <TrendingUp className="h-3 w-3 text-red-500" />;
  if (trend === 'down') return <TrendingDown className="h-3 w-3 text-emerald-500" />;
  return <Minus className="h-3 w-3 text-slate-400" />;
};

// ─── Sparkline ───────────────────────────────────────────────────────────────

function Sparkline({
  data,
  dataKey,
  color,
  height = 40,
}: {
  data: { time: string; value: number }[];
  dataKey?: string;
  color: string;
  height?: number;
}) {
  if (data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-[10px] text-muted-foreground"
        style={{ height }}
      >
        Insufficient data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--color-card, #fff)',
            borderColor: 'var(--color-border, #e2e8f0)',
            borderRadius: '0.5rem',
            fontSize: '10px',
            padding: '4px 8px',
          }}
          labelStyle={{ fontSize: '10px' }}
        />
        <Area
          type="monotone"
          dataKey={dataKey ?? 'value'}
          stroke={color}
          fill={color}
          fillOpacity={0.1}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Resource Metric Card ────────────────────────────────────────────────────

function ResourceMetricCard({ resource }: { resource: ResourceMetricsSummary }) {
  const cpuData = resource.history.map((p) => ({
    time: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    value: p.cpu,
  }));
  const memData = resource.history.map((p) => ({
    time: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    value: p.memory,
  }));

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
              {resource.name}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {resource.kind}
              {resource.namespace && ` / ${resource.namespace}`}
            </p>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* CPU */}
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Cpu className="h-3 w-3 text-blue-500" />
              <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">CPU</span>
              <TrendIcon trend={resource.cpuTrend} />
            </div>
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatMillicores(resource.currentCpu)}
            </p>
            <Sparkline data={cpuData} color="#3b82f6" />
          </div>

          {/* Memory */}
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <HardDrive className="h-3 w-3 text-purple-500" />
              <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">Memory</span>
              <TrendIcon trend={resource.memoryTrend} />
            </div>
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatBytes(resource.currentMemory)}
            </p>
            <Sparkline data={memData} color="#8b5cf6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function TimeRangeMetrics({
  resourceKind,
  namespace,
  resourceName,
  className,
}: TimeRangeMetricsProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(stored);
  const clusterId = useBackendConfigStore((s) => s.currentClusterId);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const rangeConfig = TIME_RANGES.find((r) => r.value === timeRange)!;

  // Fetch metrics from backend
  const { data: apiData, isLoading, refetch } = useQuery({
    queryKey: ['time-range-metrics', baseUrl, clusterId, resourceKind, namespace, resourceName, timeRange],
    queryFn: async () => {
      const end = Math.floor(Date.now() / 1000);
      const start = end - rangeConfig.seconds;
      const params = new URLSearchParams({
        kind: resourceKind,
        start: start.toString(),
        end: end.toString(),
        step: rangeConfig.step.toString(),
      });
      if (namespace) params.set('namespace', namespace);
      if (resourceName) params.set('name', resourceName);
      const prefix = clusterId ? `/api/v1/clusters/${clusterId}` : '/api/v1';
      const res = await fetch(`${baseUrl}${prefix}/metrics/range?${params}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Failed to fetch range metrics: ${res.status}`);
      return res.json() as Promise<ResourceMetricsSummary[]>;
    },
    refetchInterval: rangeConfig.step * 1000,
    enabled: !!baseUrl,
    staleTime: rangeConfig.step * 500,
  });

  // Buffer incoming data for metrics-server fallback
  useEffect(() => {
    if (!apiData) return;
    for (const resource of apiData) {
      const key = `${resource.kind}/${resource.namespace ?? '_'}/${resource.name}`;
      if (resource.history.length > 0) {
        const latest = resource.history[resource.history.length - 1];
        globalBuffer.push(key, latest);
      }
    }
  }, [apiData]);

  // Build display data — merge API response with buffer for short ranges
  const resources = useMemo<ResourceMetricsSummary[]>(() => {
    if (!apiData) return [];
    return apiData.map((r) => {
      const key = `${r.kind}/${r.namespace ?? '_'}/${r.name}`;
      const buffered = globalBuffer.get(key, rangeConfig.seconds * 1000);
      // Merge: prefer API data, fill gaps with buffer
      const combined = r.history.length > 0 ? r.history : buffered;
      return {
        ...r,
        history: combined,
        cpuTrend: computeTrend(combined.map((p) => p.cpu)),
        memoryTrend: computeTrend(combined.map((p) => p.memory)),
      };
    });
  }, [apiData, rangeConfig.seconds]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn('space-y-4', className)}
    >
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
            <SelectTrigger className="w-[140px] h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="outline" className="text-[10px] gap-1">
            Step: {rangeConfig.step}s
          </Badge>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Resource Cards Grid */}
      {isLoading && resources.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-3 h-[160px]" />
            </Card>
          ))}
        </div>
      ) : resources.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {resources.map((r) => (
            <ResourceMetricCard key={`${r.kind}/${r.namespace}/${r.name}`} resource={r} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">
              No metrics data available for the selected time range.
            </p>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}

export default TimeRangeMetrics;
