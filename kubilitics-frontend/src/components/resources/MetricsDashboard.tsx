import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Cpu, HardDrive, Network, Activity, TrendingUp, TrendingDown, RefreshCw, Info, BarChart2, Download } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionCard } from './SectionCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
import { cn } from '@/lib/utils';

const TOOLTIP_CPU_UNIT = 'Processing power over time. 1000m = 1 CPU core. Spikes may indicate heavy computation or request surges.';
const TOOLTIP_MEMORY_UNIT = 'RAM allocation over time. Steady growth may indicate a memory leak. Sudden drops typically mean a pod restart.';
import { useMetricsSummary, type MetricsSummaryResourceType } from '@/hooks/useMetricsSummary';
import { useMetricsHistory } from '@/hooks/useMetricsHistory';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import {
  TOOLTIP_METRICS_CPU_USAGE,
  TOOLTIP_METRICS_MEMORY_USAGE,
  TOOLTIP_METRICS_LIST_VS_DETAIL,
  TOOLTIP_METRICS_NETWORK_IO,
  TOOLTIP_POD_USAGE_SAME_AS_LIST,
  TOOLTIP_USAGE_VS_LIMITS,
} from '@/lib/k8sTooltips';
import { BackendApiError } from '@/services/backendApiClient';

interface MetricDataPoint {
  time: string;
  value: number;
}

interface ResourceMetrics {
  cpu: MetricDataPoint[];
  memory: MetricDataPoint[];
  network: { time: string; in: number; out: number }[];
}

/** Optional pod spec for computing usage vs limits (same as Containers tab). */
export interface PodResourceForMetrics {
  spec?: {
    containers?: Array<{
      name: string;
      resources?: { limits?: { cpu?: string; memory?: string } };
    }>;
  };
}

/** Resource types that use the unified metrics summary API (all except cluster). */
const METRICS_SUMMARY_TYPES: MetricsSummaryResourceType[] = [
  'pod',
  'node',
  'deployment',
  'replicaset',
  'statefulset',
  'daemonset',
  'job',
  'cronjob',
];

function isMetricsSummaryType(t: string): t is MetricsSummaryResourceType {
  return METRICS_SUMMARY_TYPES.includes(t as MetricsSummaryResourceType);
}

/**
 * Props for MetricsDashboard. One unified metrics API for pod, node, and all workload types.
 * Data decides rendering; same UI for all. Never empty without a reason (no data because X + resolution hints).
 */
interface MetricsDashboardProps {
  resourceType: 'pod' | 'node' | 'cluster' | MetricsSummaryResourceType;
  resourceName?: string;
  namespace?: string;
  /** When provided (e.g. from PodDetail), enables "Usage vs limits" row. */
  podResource?: PodResourceForMetrics | null;
  /** Optional; for display only. Metrics use the active cluster (same as the rest of the app). */
  clusterId?: string | null;
}

function parsePodCpuValue(s: string): number {
  if (!s || s === '-') return 0;
  const v = parseFloat(s.replace(/m$/, '').trim());
  return Number.isNaN(v) ? 0 : v;
}

function parsePodMemoryMi(s: string): number {
  if (!s || s === '-') return 0;
  const v = parseFloat(s.replace(/Mi$/, '').trim());
  return Number.isNaN(v) ? 0 : v;
}

function parseCPUToMillicores(s: string): number {
  if (!s || s === '-') return 0;
  const v = parseFloat(s.replace(/[nmuµ]$/i, '').trim());
  if (Number.isNaN(v)) return 0;
  if (s.endsWith('n')) return v / 1000000;
  if (s.endsWith('u') || s.endsWith('µ')) return v / 1000;
  if (s.endsWith('m')) return v;
  return v < 10 ? v * 1000 : v;
}

function parseMemoryToBytes(s: string): number {
  if (!s || s === '-') return 0;
  const num = parseFloat(s.replace(/[KMGT]i?$/i, '').trim());
  if (Number.isNaN(num)) return 0;
  if (s.endsWith('Ki')) return num * 1024;
  if (s.endsWith('Mi')) return num * 1024 * 1024;
  if (s.endsWith('Gi')) return num * 1024 * 1024 * 1024;
  if (s.endsWith('Ti')) return num * 1024 * 1024 * 1024 * 1024;
  if (s.endsWith('K')) return num * 1000;
  if (s.endsWith('M')) return num * 1000 * 1000;
  if (s.endsWith('G')) return num * 1000 * 1000 * 1000;
  if (s.endsWith('T')) return num * 1000 * 1000 * 1000 * 1000;
  return num;
}

/**
 * Metrics tab content for Pod, Node, and all workload detail pages.
 * Single unified API (GET .../metrics/summary); data decides rendering. Never empty without a reason.
 */
const TIME_RANGES = [
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '168h' },
] as const;

export function MetricsDashboard({ resourceType, resourceName, namespace, podResource }: MetricsDashboardProps) {
  const [metrics, setMetrics] = useState<ResourceMetrics | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [timeRange, setTimeRange] = useState('15m');

  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const summaryType: MetricsSummaryResourceType | null = isMetricsSummaryType(resourceType) ? resourceType : null;
  const {
    data: queryResult,
    isLoading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useMetricsSummary(summaryType ?? 'pod', namespace, resourceName, {
    enabled: !!summaryType && !!resourceName && (resourceType === 'node' || !!namespace),
  });

  const summary = queryResult?.summary;

  // Fetch history from backend (SQLite for long ranges, ring buffer for short)
  const { data: historyResult, refetch: refetchHistory } = useMetricsHistory(summaryType ?? 'pod', namespace, resourceName, {
    enabled: !!summaryType && !!resourceName && (resourceType === 'node' || !!namespace),
    duration: timeRange,
  });

  const filteredHistory = historyResult?.points ?? [];

  const historyPointCount = filteredHistory.length;

  /** Chart data from real history, filtered by selected time range. */
  const resourceMetrics = useMemo<ResourceMetrics | null>(() => {
    if (!summary) return null;
    const cpuVal = parseCPUToMillicores(summary.total_cpu);
    const memVal = parseMemoryToBytes(summary.total_memory) / (1024 * 1024);

    const formatTime = (ts: number) =>
      new Date(ts * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let cpuPoints: MetricDataPoint[];
    let memPoints: MetricDataPoint[];

    if (filteredHistory.length >= 2) {
      cpuPoints = filteredHistory.map((p) => ({ time: formatTime(p.ts), value: p.cpu_milli }));
      memPoints = filteredHistory.map((p) => ({ time: formatTime(p.ts), value: p.memory_mib }));
    } else {
      const timeStr = formatTime(Date.now() / 1000);
      cpuPoints = [{ time: timeStr, value: cpuVal }];
      memPoints = [{ time: timeStr, value: memVal }];
    }

    // Network I/O
    const rxMB = (summary.total_network_rx ?? 0) / (1024 * 1024);
    const txMB = (summary.total_network_tx ?? 0) / (1024 * 1024);
    const networkPoints: { time: string; in: number; out: number }[] = [];
    if (filteredHistory.length >= 2) {
      for (const p of filteredHistory) {
        networkPoints.push({
          time: formatTime(p.ts),
          in: (p.network_rx ?? 0) / (1024 * 1024),
          out: (p.network_tx ?? 0) / (1024 * 1024),
        });
      }
    } else if (rxMB > 0 || txMB > 0) {
      networkPoints.push({ time: formatTime(Date.now() / 1000), in: rxMB, out: txMB });
    }

    return { cpu: cpuPoints, memory: memPoints, network: networkPoints };
  }, [summary, filteredHistory]);

  useEffect(() => {
    if (resourceType === 'cluster') {
      setMetrics(null);
      return;
    }
    if (!isMetricsSummaryType(resourceType)) {
      setMetrics(null);
      return;
    }
    if (summaryLoading && !queryResult) {
      setMetrics(null);
      return;
    }
    if (resourceMetrics) {
      setMetrics(resourceMetrics);
    } else {
      setMetrics(null);
    }
  }, [resourceType, summaryLoading, queryResult, resourceMetrics]);

  /** Per-pod table: same shape as before (pods from summary). */
  const podsForTable = summary?.pods ?? [];

  const handleRefresh = () => { refetchSummary(); refetchHistory(); };

  // All hooks must be called unconditionally (before any early return) to satisfy Rules of Hooks.
  const usageVsLimits = useMemo<{ cpuPct: number; memPct: number } | null>(() => {
    if (resourceType !== 'pod' || !summary || !podResource?.spec?.containers?.length) return null;
    const specContainers = podResource.spec.containers;
    const podMetrics = summary.pods?.[0];
    const containerMetricsList = podMetrics?.containers ?? [];
    const podCpuMc = podMetrics?.cpu ? parseCPUToMillicores(podMetrics.cpu) : parseCPUToMillicores(summary.total_cpu);
    const podMemBytes = podMetrics?.memory ? parseMemoryToBytes(podMetrics.memory) : parseMemoryToBytes(summary.total_memory);
    const containerCount = specContainers.length;
    let totalCpuPct = 0;
    let totalMemPct = 0;
    let countWithLimits = 0;
    specContainers.forEach((c) => {
      const cm = containerMetricsList.find((m) => m.name === c.name);
      const usageCpuMc = cm ? parseCPUToMillicores(cm.cpu) : containerCount > 0 ? podCpuMc / containerCount : 0;
      const usageMemBytes = cm ? parseMemoryToBytes(cm.memory) : containerCount > 0 ? podMemBytes / containerCount : 0;
      const limitCpuMc = c.resources?.limits?.cpu ? parseCPUToMillicores(c.resources.limits.cpu) : 0;
      const limitMemBytes = c.resources?.limits?.memory ? parseMemoryToBytes(c.resources.limits.memory) : 0;
      if (limitCpuMc > 0 || limitMemBytes > 0) {
        countWithLimits++;
        totalCpuPct += limitCpuMc > 0 ? Math.min(100, (usageCpuMc / limitCpuMc) * 100) : 0;
        totalMemPct += limitMemBytes > 0 ? Math.min(100, (usageMemBytes / limitMemBytes) * 100) : 0;
      }
    });
    if (countWithLimits === 0) return null;
    return {
      cpuPct: totalCpuPct / countWithLimits,
      memPct: totalMemPct / countWithLimits,
    };
  }, [resourceType, summary, podResource]);

  const CPU_MIN_RANGE = 10;
  const MEMORY_MIN_RANGE = 20;

  const cpuDomainMax = useMemo(() => {
    if (!metrics?.cpu?.length) return CPU_MIN_RANGE;
    const values = metrics.cpu.map(d => d.value).filter(v => typeof v === 'number' && !isNaN(v));
    const maxVal = values.length > 0 ? Math.max(...values) : 1;
    return Math.max(maxVal * 1.1, CPU_MIN_RANGE);
  }, [metrics?.cpu]);

  const memoryDomainMax = useMemo(() => {
    if (!metrics?.memory?.length) return MEMORY_MIN_RANGE;
    const values = metrics.memory.map(d => d.value).filter(v => typeof v === 'number' && !isNaN(v));
    const maxVal = values.length > 0 ? Math.max(...values) : 1;
    return Math.max(maxVal * 1.1, MEMORY_MIN_RANGE);
  }, [metrics?.memory]);

  // Derived values used only when metrics is non-null; computed here so hook order is fixed.
  const currentCpu = metrics?.cpu?.[metrics.cpu.length - 1]?.value ?? 0;
  const currentMemory = metrics?.memory?.[metrics.memory.length - 1]?.value ?? 0;
  const prevCpu = metrics?.cpu?.[metrics.cpu.length - 2]?.value ?? currentCpu;
  const prevMemory = metrics?.memory?.[metrics.memory.length - 2]?.value ?? currentMemory;
  const cpuTrend = currentCpu - prevCpu;
  const memoryTrend = currentMemory - prevMemory;
  const totalNetworkIn = metrics?.network?.reduce((sum, d) => sum + d.in, 0) ?? 0;
  const totalNetworkOut = metrics?.network?.reduce((sum, d) => sum + d.out, 0) ?? 0;
  const podUsageCpuDisplay = `${currentCpu.toFixed(2)}m`;
  const podUsageMemoryDisplay = `${currentMemory.toFixed(2)}Mi`;
  const isSingleOrFewPoints = false; // Forced false to show history by default

  // Stats computed from real history
  const cpuStats = useMemo(() => {
    const vals = (metrics?.cpu ?? []).map(d => d.value).filter(v => typeof v === 'number' && !isNaN(v) && v >= 0);
    if (vals.length === 0) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { min, max, avg };
  }, [metrics?.cpu]);

  const memStats = useMemo(() => {
    const vals = (metrics?.memory ?? []).map(d => d.value).filter(v => typeof v === 'number' && !isNaN(v) && v >= 0);
    if (vals.length === 0) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { min, max, avg };
  }, [metrics?.memory]);

  const isLoading = !!summaryType && summaryLoading && !queryResult;
  const needsConnect = !currentClusterId && !!summaryType;
  const isClusterNotFound =
    queryResult?.error_code === 'CLUSTER_NOT_FOUND' ||
    (summaryError instanceof BackendApiError && summaryError.status === 404);
  const noDataReason = queryResult?.error;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!metrics) {
    const metricsServerMissing = !needsConnect && !isClusterNotFound && !noDataReason && resourceType !== 'cluster';
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground">
        <Activity className="h-12 w-12 mb-3 opacity-50" />
        <p className="font-medium text-foreground">Metrics unavailable</p>
        <p className="text-sm mt-1 max-w-sm">
          {needsConnect
            ? 'Select a cluster in the header dropdown or connect via Connect so metrics can load. Metrics use the cluster you selected there.'
            : isClusterNotFound
              ? 'Cluster not found in backend. Add this cluster via Connect (or Settings) to view metrics.'
              : noDataReason
                ? `No data because ${noDataReason}`
                : resourceType === 'cluster'
                  ? 'Metrics are not available for cluster scope yet.'
                  : 'Metrics Server is not installed on this cluster. Install it to view real-time CPU and memory usage.'}
        </p>
        {noDataReason && (
          <p className="text-xs mt-2 max-w-sm text-muted-foreground">
            Resolution: ensure the cluster is connected, metrics-server is installed, and the resource has running pods.
          </p>
        )}
        <div className="flex items-center gap-2 mt-3">
          {metricsServerMissing && (
            <Button variant="default" size="sm" asChild>
              <Link to={`/addons/${encodeURIComponent('kubilitics/metrics-server')}`}>
                <Download className="h-4 w-4 mr-2" />
                Install metrics-server
              </Link>
            </Button>
          )}
          {summaryType && (
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <SectionCard
      icon={BarChart2}
      title="Metrics"
      tooltip={
        <>
          <p className="font-medium">Metrics</p>
          <p className="mt-1 text-muted-foreground text-xs">
            Real-time performance data for {resourceName || resourceType}
            {namespace && ` in ${namespace}`}
          </p>
          <p className="mt-2 text-muted-foreground text-xs border-t border-border/40 pt-2">
            {TOOLTIP_METRICS_LIST_VS_DETAIL}
          </p>
        </>
      }
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-6"
      >
        {/* No separate header — time range is integrated into chart tabs below */}

        {/* Usage (pod single / deployment aggregated) */}
        <div>
          <UiTooltip>
            <TooltipTrigger asChild>
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5 cursor-help">
                {resourceType === 'node' ? 'Node usage' : resourceType !== 'pod' ? 'Usage (aggregated from pods)' : 'Current usage'}
              </h3>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">{TOOLTIP_POD_USAGE_SAME_AS_LIST}</TooltipContent>
          </UiTooltip>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <UiTooltip>
              <TooltipTrigger asChild>
                <Card className="rounded-xl border border-border/50 shadow-sm overflow-hidden cursor-help">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-500/10">
                          <Cpu className="h-5 w-5 text-blue-500" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">CPU</p>
                          <p className="text-2xl font-semibold tabular-nums">{podUsageCpuDisplay}</p>
                        </div>
                      </div>
                      {metrics.cpu.length >= 2 && (
                        <div className={cn(
                          'flex items-center gap-1 text-sm',
                          cpuTrend >= 0 ? 'text-error' : 'text-success'
                        )}>
                          {cpuTrend >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                          {cpuTrend >= 0 ? '+' : ''}{cpuTrend.toFixed(2)}m
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">{TOOLTIP_METRICS_CPU_USAGE}</TooltipContent>
            </UiTooltip>

            <UiTooltip>
              <TooltipTrigger asChild>
                <Card className="rounded-xl border border-border/50 shadow-sm overflow-hidden cursor-help">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-purple-500/10">
                          <HardDrive className="h-5 w-5 text-purple-500" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Memory</p>
                          <p className="text-2xl font-semibold tabular-nums">{podUsageMemoryDisplay}</p>
                        </div>
                      </div>
                      {metrics.memory.length >= 2 && (
                        <div className={cn(
                          'flex items-center gap-1 text-sm',
                          memoryTrend >= 0 ? 'text-error' : 'text-success'
                        )}>
                          {memoryTrend >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                          {memoryTrend >= 0 ? '+' : ''}{memoryTrend.toFixed(2)}Mi
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">{TOOLTIP_METRICS_MEMORY_USAGE}</TooltipContent>
            </UiTooltip>

            <UiTooltip>
              <TooltipTrigger asChild>
                <Card className="rounded-xl border border-border/50 shadow-sm overflow-hidden cursor-help">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-green-500/10">
                          <Network className="h-5 w-5 text-green-500" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Network I/O</p>
                          <p className="text-2xl font-semibold tabular-nums">{(totalNetworkIn + totalNetworkOut).toFixed(2)} MB</p>
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        ↓{totalNetworkIn.toFixed(2)}MB ↑{totalNetworkOut.toFixed(2)}MB
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">{TOOLTIP_METRICS_NETWORK_IO}</TooltipContent>
            </UiTooltip>
          </div>

          {/* Per-pod breakdown for controllers */}
          {podsForTable.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-foreground mb-2">Per-pod</h3>
              <div className="rounded-lg border border-border/50 overflow-hidden">
                <div className="grid grid-cols-4 gap-2 p-3 bg-muted/40 text-xs font-medium text-muted-foreground">
                  <span>Pod</span>
                  <span>CPU</span>
                  <span>Memory</span>
                  <span>Network I/O</span>
                </div>
                {podsForTable.map((p) => {
                  const rx = (p.network_rx_bytes ?? 0) / (1024 * 1024);
                  const tx = (p.network_tx_bytes ?? 0) / (1024 * 1024);
                  return (
                    <div
                      key={p.name}
                      className="grid grid-cols-4 gap-2 p-3 border-t border-border/50 text-sm"
                    >
                      <span className="font-medium truncate" title={p.name}>{p.name}</span>
                      <span className="tabular-nums">{p.cpu || '-'}</span>
                      <span className="tabular-nums">{p.memory || '-'}</span>
                      <span className="tabular-nums text-xs">
                        {rx > 0 || tx > 0 ? `↓${rx.toFixed(1)}Mi ↑${tx.toFixed(1)}Mi` : '-'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {/* Resource Allocation — Usage vs Requests vs Limits */}
        {usageVsLimits != null && (
          <div>
            <UiTooltip>
              <TooltipTrigger asChild>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5 cursor-help">
                  Resource Allocation
                </h3>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">{TOOLTIP_USAGE_VS_LIMITS}</TooltipContent>
            </UiTooltip>

            {/* Allocation bars with progress */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <Card className="rounded-xl border border-border/50 shadow-sm overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/10">
                      <Cpu className="h-5 w-5 text-blue-500" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm text-muted-foreground">CPU of limit</p>
                        <p className="text-sm font-bold tabular-nums">{usageVsLimits.cpuPct.toFixed(1)}%</p>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-700',
                            usageVsLimits.cpuPct < 60 ? 'bg-emerald-500' : usageVsLimits.cpuPct < 80 ? 'bg-amber-500' : 'bg-red-500'
                          )}
                          style={{ width: `${Math.min(usageVsLimits.cpuPct, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {podUsageCpuDisplay} used
                    {usageVsLimits.cpuPct < 20 ? ' · Well under limit' : usageVsLimits.cpuPct > 80 ? ' · Throttling risk' : ''}
                  </p>
                </CardContent>
              </Card>
              <Card className="rounded-xl border border-border/50 shadow-sm overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-purple-500/10">
                      <HardDrive className="h-5 w-5 text-purple-500" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm text-muted-foreground">Memory of limit</p>
                        <p className="text-sm font-bold tabular-nums">{usageVsLimits.memPct.toFixed(1)}%</p>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-700',
                            usageVsLimits.memPct < 60 ? 'bg-emerald-500' : usageVsLimits.memPct < 80 ? 'bg-amber-500' : 'bg-red-500'
                          )}
                          style={{ width: `${Math.min(usageVsLimits.memPct, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {podUsageMemoryDisplay} used
                    {usageVsLimits.memPct < 20 ? ' · Well under limit' : usageVsLimits.memPct > 80 ? ' · OOM risk' : ''}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Container Resources Table */}
            {podResource?.spec?.containers && podResource.spec.containers.length > 0 && (
              <Card className="rounded-xl border border-border/50 shadow-sm overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Resources by Container</CardTitle>
                  <CardDescription>CPU and memory requests and limits configured per container.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/50 bg-muted/30">
                          <th className="text-left p-3 font-medium text-muted-foreground">Container</th>
                          <th className="text-right p-3 font-medium text-blue-500">CPU Request</th>
                          <th className="text-right p-3 font-medium text-blue-600">CPU Limit</th>
                          <th className="text-right p-3 font-medium text-purple-500">Memory Request</th>
                          <th className="text-right p-3 font-medium text-purple-600">Memory Limit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {podResource.spec.containers.map((c) => (
                          <tr key={c.name} className="border-b border-border/30 last:border-0">
                            <td className="p-3 font-medium">{c.name}</td>
                            <td className="p-3 text-right tabular-nums">{c.resources?.requests?.cpu ?? '—'}</td>
                            <td className="p-3 text-right tabular-nums">{c.resources?.limits?.cpu ?? '—'}</td>
                            <td className="p-3 text-right tabular-nums">{c.resources?.requests?.memory ?? '—'}</td>
                            <td className="p-3 text-right tabular-nums">{c.resources?.limits?.memory ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Charts with integrated time range selector */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex items-center justify-between gap-3 mb-3">
            {/* Chart type tabs */}
            <TabsList className="bg-muted/50 p-1 border border-border/50 shadow-sm h-9">
              <TabsTrigger value="overview" className="px-4 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-primary transition-all font-semibold text-xs">Overview</TabsTrigger>
              <TabsTrigger value="cpu" className="px-4 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-primary transition-all font-semibold text-xs">CPU</TabsTrigger>
              <TabsTrigger value="memory" className="px-4 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-primary transition-all font-semibold text-xs">Memory</TabsTrigger>
              <TabsTrigger value="network" className="px-4 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-primary transition-all font-semibold text-xs">Network</TabsTrigger>
            </TabsList>

            {/* Time range + controls — right-aligned, same row */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 bg-muted/30 rounded-lg p-0.5">
                {TIME_RANGES.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setTimeRange(r.value)}
                    className={cn(
                      'px-2.5 py-1 text-[11px] font-medium rounded-md transition-all duration-150',
                      timeRange === r.value
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <Badge variant="outline" className="gap-1 tabular-nums text-[10px] h-7">
                <Activity className="h-3 w-3" />
                {historyPointCount > 0 ? `${historyPointCount} pts` : '...'}
              </Badge>
              <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1 h-7 text-[11px]">
                <RefreshCw className="h-3 w-3" />
                Refresh
              </Button>
            </div>
          </div>

          <TabsContent value="overview" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="rounded-xl border border-border/50 shadow-sm overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">CPU Usage Over Time</CardTitle>
                    <UiTooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help text-muted-foreground hover:text-foreground">
                          <Info className="h-4 w-4" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        {TOOLTIP_CPU_UNIT}
                      </TooltipContent>
                    </UiTooltip>
                  </div>
                  <CardDescription>Processing power consumption over time.</CardDescription>
                </CardHeader>
                <CardContent>
                  {isSingleOrFewPoints && (
                    <p className="text-sm font-semibold text-foreground mb-2 tabular-nums">
                      Current value: {podUsageCpuDisplay}
                    </p>
                  )}
                  {isSingleOrFewPoints && (
                    <p className="text-xs text-muted-foreground mb-3">
                      Live value; more history will appear as data is collected.
                    </p>
                  )}
                  <div className="h-64 mt-4 -ml-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={metrics.cpu}>
                        <defs>
                          <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="0" stroke="hsl(var(--border)/0.3)" />
                        <XAxis
                          dataKey="time"
                          stroke="hsl(var(--foreground))"
                          fontSize={10}
                          axisLine={false}
                          tickLine={false}
                          interval="preserveStartEnd"
                          tick={{ fill: 'hsl(var(--foreground))', fontSize: 10, fontWeight: 500 }}
                        />
                        <YAxis
                          stroke="hsl(var(--foreground))"
                          fontSize={10}
                          domain={[0, cpuDomainMax]}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => (Number.isFinite(v) ? `${v}m` : '')}
                          tick={{ fill: 'hsl(var(--foreground))', fontSize: 10, fontWeight: 500 }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'rgba(255, 255, 255, 0.95)',
                            backdropFilter: 'blur(4px)',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                            fontSize: '11px'
                          }}
                          itemStyle={{ color: 'hsl(var(--primary))', fontWeight: 'bold' }}
                          formatter={(value: number) => [`${value.toFixed(2)}m`, 'CPU Usage']}
                        />
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke="hsl(var(--primary))"
                          fill="url(#cpuGradient)"
                          strokeWidth={1.5}
                          animationDuration={1500}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-xl border border-border/50 shadow-sm overflow-hidden bg-white/40 backdrop-blur-[2px]">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-bold tracking-tight">Memory Utilization</CardTitle>
                    <UiTooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help text-muted-foreground/60 hover:text-foreground">
                          <Info className="h-4 w-4" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">{TOOLTIP_MEMORY_UNIT}</TooltipContent>
                    </UiTooltip>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="h-64 mt-4 -ml-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={metrics.memory}>
                        <defs>
                          <linearGradient id="memoryGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(270, 70%, 60%)" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="hsl(270, 70%, 60%)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="0" stroke="hsl(var(--border)/0.3)" />
                        <XAxis
                          dataKey="time"
                          stroke="hsl(var(--foreground))"
                          fontSize={10}
                          axisLine={false}
                          tickLine={false}
                          interval="preserveStartEnd"
                          tick={{ fill: 'hsl(var(--foreground))', fontSize: 10, fontWeight: 600 }}
                        />
                        <YAxis
                          stroke="hsl(var(--foreground))"
                          fontSize={10}
                          domain={[0, memoryDomainMax]}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => (Number.isFinite(v) ? `${v}Mi` : '')}
                          tick={{ fill: 'hsl(var(--foreground))', fontSize: 10, fontWeight: 600 }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'rgba(255, 255, 255, 0.95)',
                            backdropFilter: 'blur(4px)',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                            fontSize: '11px'
                          }}
                          itemStyle={{ color: 'hsl(270, 70%, 60%)', fontWeight: 'bold' }}
                          formatter={(value: number) => [`${value.toFixed(2)}Mi`, 'Memory Usage']}
                        />
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke="hsl(270, 70%, 60%)"
                          fill="url(#memoryGradient)"
                          strokeWidth={1.5}
                          animationDuration={1500}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
            {/* Quick Stats below overview charts */}
            {(cpuStats || memStats) && (
              <div className="grid grid-cols-2 gap-6 mt-4">
                {cpuStats && (
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <Cpu className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                    <span>Min <strong className="text-foreground">{cpuStats.min.toFixed(1)}m</strong></span>
                    <span>Max <strong className="text-foreground">{cpuStats.max.toFixed(1)}m</strong></span>
                    <span>Avg <strong className="text-foreground">{cpuStats.avg.toFixed(1)}m</strong></span>
                  </div>
                )}
                {memStats && (
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <HardDrive className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                    <span>Min <strong className="text-foreground">{memStats.min.toFixed(1)}Mi</strong></span>
                    <span>Max <strong className="text-foreground">{memStats.max.toFixed(1)}Mi</strong></span>
                    <span>Avg <strong className="text-foreground">{memStats.avg.toFixed(1)}Mi</strong></span>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="cpu" className="mt-4">
            <Card className="rounded-xl border border-border/50 shadow-sm overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">CPU Utilization</CardTitle>
                  <UiTooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help text-muted-foreground hover:text-foreground">
                        <Info className="h-4 w-4" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      {TOOLTIP_CPU_UNIT}
                    </TooltipContent>
                  </UiTooltip>
                </div>
                <CardDescription>Processing power consumption over time.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-80 mt-4 -ml-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={metrics.cpu}>
                      <CartesianGrid vertical={false} strokeDasharray="0" stroke="hsl(var(--border)/0.3)" />
                      <XAxis
                        dataKey="time"
                        stroke="hsl(var(--foreground))"
                        fontSize={11}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                        tick={{ fill: 'hsl(var(--foreground))', fontSize: 10, fontWeight: 600 }}
                      />
                      <YAxis
                        stroke="hsl(var(--foreground))"
                        fontSize={11}
                        domain={[0, cpuDomainMax]}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => (Number.isFinite(v) ? `${v}m` : '')}
                        tick={{ fill: 'hsl(var(--foreground))', fontSize: 10, fontWeight: 600 }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(255, 255, 255, 0.95)',
                          backdropFilter: 'blur(4px)',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          fontSize: '11px'
                        }}
                        formatter={(value: number) => [`${value.toFixed(2)}m`, 'CPU Usage']}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: 'hsl(var(--primary))', strokeWidth: 0 }}
                        animationDuration={1500}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            {cpuStats && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div className="rounded-lg border border-border/40 bg-card/50 p-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Min</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">{cpuStats.min.toFixed(2)}m</p>
                </div>
                <div className="rounded-lg border border-border/40 bg-card/50 p-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Max</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">{cpuStats.max.toFixed(2)}m</p>
                </div>
                <div className="rounded-lg border border-border/40 bg-card/50 p-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Avg</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">{cpuStats.avg.toFixed(2)}m</p>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="memory" className="mt-4">
            <Card className="rounded-xl border border-border/50 shadow-sm overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">Memory Utilization</CardTitle>
                  <UiTooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help text-muted-foreground hover:text-foreground">
                        <Info className="h-4 w-4" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      {TOOLTIP_MEMORY_UNIT}
                    </TooltipContent>
                  </UiTooltip>
                </div>
                <CardDescription>RAM allocation over time. Steady growth may indicate a leak.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-80 mt-4 -ml-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={metrics.memory}>
                      <CartesianGrid vertical={false} strokeDasharray="0" stroke="hsl(var(--border)/0.3)" />
                      <XAxis
                        dataKey="time"
                        stroke="hsl(var(--foreground))"
                        fontSize={11}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                        tick={{ fill: 'hsl(var(--foreground))', fontSize: 10, fontWeight: 600 }}
                      />
                      <YAxis
                        stroke="hsl(var(--foreground))"
                        fontSize={11}
                        domain={[0, memoryDomainMax]}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => (Number.isFinite(v) ? `${v}Mi` : '')}
                        tick={{ fill: 'hsl(var(--foreground))', fontSize: 10, fontWeight: 600 }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(255, 255, 255, 0.95)',
                          backdropFilter: 'blur(4px)',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          fontSize: '11px'
                        }}
                        formatter={(value: number) => [`${value.toFixed(2)}Mi`, 'Memory Usage']}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="hsl(270, 70%, 60%)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: 'hsl(270, 70%, 60%)', strokeWidth: 0 }}
                        animationDuration={1500}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            {memStats && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div className="rounded-lg border border-border/40 bg-card/50 p-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Min</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">{memStats.min.toFixed(2)}Mi</p>
                </div>
                <div className="rounded-lg border border-border/40 bg-card/50 p-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Max</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">{memStats.max.toFixed(2)}Mi</p>
                </div>
                <div className="rounded-lg border border-border/40 bg-card/50 p-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Avg</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">{memStats.avg.toFixed(2)}Mi</p>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="network" className="mt-4">
            {/* Network Summary Cards */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="rounded-lg border border-border/40 bg-card/50 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Received</p>
                <p className="text-lg font-bold tabular-nums text-emerald-500">↓ {totalNetworkIn.toFixed(2)} MB</p>
              </div>
              <div className="rounded-lg border border-border/40 bg-card/50 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Sent</p>
                <p className="text-lg font-bold tabular-nums text-blue-500">↑ {totalNetworkOut.toFixed(2)} MB</p>
              </div>
              <div className="rounded-lg border border-border/40 bg-card/50 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Traffic</p>
                <p className="text-lg font-bold tabular-nums text-foreground">{(totalNetworkIn + totalNetworkOut).toFixed(2)} MB</p>
              </div>
              <div className="rounded-lg border border-border/40 bg-card/50 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Direction</p>
                <p className="text-sm font-medium text-muted-foreground mt-1">
                  {totalNetworkIn > totalNetworkOut * 2 ? 'Mostly inbound' : totalNetworkOut > totalNetworkIn * 2 ? 'Mostly outbound' : 'Balanced'}
                </p>
              </div>
            </div>

            <Card className="rounded-xl border border-border/50 shadow-sm overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Network I/O Over Time</CardTitle>
                <CardDescription>Inbound and outbound traffic patterns. Monitor for spikes or unusual activity.</CardDescription>
              </CardHeader>
              <CardContent>
                {metrics.network.length === 0 && (
                  <p className="text-xs text-muted-foreground mb-3">
                    Network data collecting. Charts will appear as history accumulates.
                  </p>
                )}
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={metrics.network}>
                      <CartesianGrid vertical={false} strokeDasharray="0" stroke="hsl(var(--border)/0.3)" />
                      <XAxis
                        dataKey="time"
                        stroke="hsl(var(--foreground))"
                        fontSize={11}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: 'hsl(var(--foreground))', fontSize: 10, fontWeight: 600 }}
                      />
                      <YAxis
                        stroke="hsl(var(--foreground))"
                        fontSize={11}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: 'hsl(var(--foreground))', fontSize: 10, fontWeight: 600 }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--popover))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                      <Bar dataKey="in" name="Inbound" fill="hsl(142, 70%, 45%)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="out" name="Outbound" fill="hsl(200, 70%, 50%)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </motion.div>
    </SectionCard>
  );
}
