/**
 * TASK-OBS-001: Platform Metrics Instrumentation (Frontend)
 *
 * Dashboard showing Kubilitics platform metrics:
 * - HTTP request duration & request rate
 * - WebSocket active connections
 * - Circuit breaker state indicators
 * - Cache hit ratio gauges
 *
 * Uses TanStack Query to fetch from /metrics endpoint.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Activity,
  Clock,
  Gauge,
  Globe,
  Radio,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Wifi,
  Zap,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlatformMetricsData {
  httpRequestRate: number;
  httpRequestDurationP50: number;
  httpRequestDurationP99: number;
  httpRequestsByStatus: { status: string; count: number }[];
  wsActiveConnections: number;
  wsConnectionsPeak: number;
  circuitBreakers: CircuitBreakerState[];
  cacheHitRatio: number;
  cacheHits: number;
  cacheMisses: number;
  uptimeSeconds: number;
  requestHistory: { time: string; rate: number; latency: number }[];
}

interface CircuitBreakerState {
  name: string;
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailure?: string;
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchPlatformMetrics(baseUrl: string): Promise<PlatformMetricsData> {
  const res = await fetch(`${baseUrl}/api/v1/metrics/platform`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch platform metrics: ${res.status}`);
  return res.json();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3 },
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function MetricCard({
  icon: Icon,
  iconColor,
  label,
  value,
  sub,
  className,
}: {
  icon: React.ElementType;
  iconColor: string;
  label: string;
  value: string | number;
  sub?: string;
  className?: string;
}) {
  return (
    <motion.div {...fadeIn}>
      <Card className={cn('h-full', className)}>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className={cn('p-2 rounded-xl', iconColor)}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {value}
              </p>
              {sub && (
                <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function CircuitBreakerIndicator({ breaker }: { breaker: CircuitBreakerState }) {
  const stateConfig = {
    closed: {
      icon: ShieldCheck,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-100 dark:bg-emerald-950/40',
      badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
    },
    open: {
      icon: ShieldAlert,
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-100 dark:bg-red-950/40',
      badge: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
    },
    'half-open': {
      icon: Shield,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-100 dark:bg-amber-950/40',
      badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
    },
  };

  const cfg = stateConfig[breaker.state];
  const Icon = cfg.icon;

  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 p-3">
      <div className="flex items-center gap-2">
        <div className={cn('p-1.5 rounded-lg', cfg.bg)}>
          <Icon className={cn('h-3.5 w-3.5', cfg.color)} />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{breaker.name}</p>
          <p className="text-[10px] text-muted-foreground">
            {breaker.failureCount} failures
            {breaker.lastFailure && ` - last ${new Date(breaker.lastFailure).toLocaleTimeString()}`}
          </p>
        </div>
      </div>
      <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase', cfg.badge)}>
        {breaker.state}
      </span>
    </div>
  );
}

function CacheHitGauge({ ratio }: { ratio: number }) {
  const percent = Math.round(ratio * 100);
  const circumference = 2 * Math.PI * 36;
  const strokeDashoffset = circumference - (circumference * percent) / 100;
  const color = percent >= 80 ? '#10b981' : percent >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex items-center justify-center">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
          <circle
            cx="40"
            cy="40"
            r="36"
            fill="none"
            className="stroke-slate-200 dark:stroke-slate-700"
            strokeWidth="6"
          />
          <motion.circle
            cx="40"
            cy="40"
            r="36"
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {percent}%
          </span>
          <span className="text-[9px] text-muted-foreground">hit ratio</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function PlatformMetrics({ className }: { className?: string }) {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  const { data, isLoading, error } = useQuery({
    queryKey: ['platform-metrics', baseUrl],
    queryFn: () => fetchPlatformMetrics(baseUrl),
    refetchInterval: 15_000,
    enabled: isConfigured,
    staleTime: 10_000,
  });

  // Placeholder data for loading / error states
  const metrics = useMemo<PlatformMetricsData>(() => {
    if (data) return data;
    return {
      httpRequestRate: 0,
      httpRequestDurationP50: 0,
      httpRequestDurationP99: 0,
      httpRequestsByStatus: [],
      wsActiveConnections: 0,
      wsConnectionsPeak: 0,
      circuitBreakers: [],
      cacheHitRatio: 0,
      cacheHits: 0,
      cacheMisses: 0,
      uptimeSeconds: 0,
      requestHistory: [],
    };
  }, [data]);

  if (!isConfigured) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">
            Backend not configured. Connect to a backend to view platform metrics.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn('space-y-6', className)}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-violet-100 dark:bg-violet-950/40">
            <Activity className="h-6 w-6 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Platform Metrics
            </h2>
            <p className="text-sm text-muted-foreground">
              Kubilitics backend health and performance
            </p>
          </div>
        </div>
        {metrics.uptimeSeconds > 0 && (
          <Badge variant="outline" className="gap-1.5 text-xs">
            <Clock className="h-3 w-3" />
            Uptime: {formatUptime(metrics.uptimeSeconds)}
          </Badge>
        )}
      </div>

      {error && (
        <Card className="border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20">
          <CardContent className="p-4 text-sm text-red-700 dark:text-red-400">
            Failed to load platform metrics: {String(error)}
          </CardContent>
        </Card>
      )}

      {/* Top-level KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          icon={Zap}
          iconColor="bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400"
          label="Request Rate"
          value={isLoading ? '--' : `${metrics.httpRequestRate.toFixed(1)}/s`}
          sub="HTTP requests per second"
        />
        <MetricCard
          icon={Clock}
          iconColor="bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400"
          label="P99 Latency"
          value={isLoading ? '--' : formatDuration(metrics.httpRequestDurationP99)}
          sub={`P50: ${formatDuration(metrics.httpRequestDurationP50)}`}
        />
        <MetricCard
          icon={Wifi}
          iconColor="bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
          label="WebSocket Connections"
          value={isLoading ? '--' : metrics.wsActiveConnections}
          sub={`Peak: ${metrics.wsConnectionsPeak}`}
        />
        <MetricCard
          icon={Gauge}
          iconColor="bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400"
          label="Cache Hit Ratio"
          value={isLoading ? '--' : `${(metrics.cacheHitRatio * 100).toFixed(1)}%`}
          sub={`${metrics.cacheHits} hits / ${metrics.cacheMisses} misses`}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Request Rate Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              Request Rate Over Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.requestHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={metrics.requestHistory}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10 }}
                    className="text-slate-500"
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    className="text-slate-500"
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--chart-tooltip-bg)',
                      borderColor: 'var(--chart-tooltip-border)',
                      borderRadius: '0.75rem',
                      fontSize: '12px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="rate"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.1}
                    strokeWidth={2}
                    name="req/s"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
                {isLoading ? 'Loading...' : 'No data available'}
              </div>
            )}
          </CardContent>
        </Card>

        {/* HTTP Status Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe className="h-4 w-4 text-emerald-500" />
              HTTP Status Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.httpRequestsByStatus.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={metrics.httpRequestsByStatus}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                  <XAxis
                    dataKey="status"
                    tick={{ fontSize: 10 }}
                    className="text-slate-500"
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    className="text-slate-500"
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--chart-tooltip-bg)',
                      borderColor: 'var(--chart-tooltip-border)',
                      borderRadius: '0.75rem',
                      fontSize: '12px',
                    }}
                  />
                  <Bar
                    dataKey="count"
                    radius={[4, 4, 0, 0]}
                    fill="#10b981"
                    name="Requests"
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
                {isLoading ? 'Loading...' : 'No data available'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row: Circuit Breakers + Cache Gauge */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Circuit Breakers */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Radio className="h-4 w-4 text-amber-500" />
              Circuit Breakers
            </CardTitle>
            <CardDescription className="text-xs">
              Backend resilience circuit state indicators
            </CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.circuitBreakers.length > 0 ? (
              <div className="space-y-2">
                {metrics.circuitBreakers.map((cb) => (
                  <CircuitBreakerIndicator key={cb.name} breaker={cb} />
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                {isLoading ? 'Loading...' : 'No circuit breakers registered'}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cache Gauge */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gauge className="h-4 w-4 text-purple-500" />
              Cache Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            <CacheHitGauge ratio={metrics.cacheHitRatio} />
            <div className="grid grid-cols-2 gap-4 w-full text-center">
              <div>
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {metrics.cacheHits.toLocaleString()}
                </p>
                <p className="text-[10px] text-muted-foreground">Hits</p>
              </div>
              <div>
                <p className="text-lg font-bold text-red-500 dark:text-red-400 tabular-nums">
                  {metrics.cacheMisses.toLocaleString()}
                </p>
                <p className="text-[10px] text-muted-foreground">Misses</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}

export default PlatformMetrics;
