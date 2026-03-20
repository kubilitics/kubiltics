/**
 * TASK-OBS-012: Network Metrics
 *
 * Network flow visibility with integration patterns for Cilium Hubble / Calico Felix.
 * Shows network I/O charts per pod/service with traffic flow indicators.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Network,
  ArrowDownToLine,
  ArrowUpFromLine,
  Globe,
  Shield,
  Search,
  RefreshCw,
  AlertCircle,
  Wifi,
  Activity,
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
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

// ─── Types ───────────────────────────────────────────────────────────────────

interface NetworkFlow {
  source: string;
  sourceNamespace: string;
  destination: string;
  destinationNamespace: string;
  protocol: string;
  port: number;
  bytesIn: number;
  bytesOut: number;
  packets: number;
  verdict: 'forwarded' | 'dropped' | 'error';
}

interface PodNetworkMetrics {
  name: string;
  namespace: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
  rxPacketsPerSec: number;
  txPacketsPerSec: number;
  history: { time: string; rx: number; tx: number }[];
}

interface NetworkOverview {
  cniPlugin: 'cilium' | 'calico' | 'flannel' | 'other' | 'unknown';
  hubbleEnabled: boolean;
  networkPoliciesCount: number;
  totalFlows: number;
  droppedFlows: number;
  pods: PodNetworkMetrics[];
  topFlows: NetworkFlow[];
}

type SortField = 'rx' | 'tx' | 'name';

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchNetworkMetrics(baseUrl: string, clusterId: string | null): Promise<NetworkOverview> {
  const prefix = clusterId ? `/api/v1/clusters/${clusterId}` : '/api/v1';
  const res = await fetch(`${baseUrl}${prefix}/metrics/network`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch network metrics: ${res.status}`);
  return res.json();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytesRate(bytesPerSec: number): string {
  if (bytesPerSec === 0) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.min(Math.floor(Math.log(bytesPerSec) / Math.log(1024)), units.length - 1);
  return `${(bytesPerSec / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

const cniLabels: Record<string, { label: string; color: string }> = {
  cilium:  { label: 'Cilium',  color: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400' },
  calico:  { label: 'Calico',  color: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400' },
  flannel: { label: 'Flannel', color: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400' },
  other:   { label: 'Other',   color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400' },
  unknown: { label: 'Unknown', color: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

const verdictColors: Record<string, string> = {
  forwarded: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  dropped: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
  error: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
};

// ─── Pod Network Card ────────────────────────────────────────────────────────

function PodNetworkCard({ pod }: { pod: PodNetworkMetrics }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{pod.name}</p>
            <p className="text-[10px] text-muted-foreground">{pod.namespace}</p>
          </div>
          <div className="flex items-center gap-3 text-xs shrink-0">
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <ArrowDownToLine className="h-3 w-3" />
              {formatBytesRate(pod.rxBytesPerSec)}
            </span>
            <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
              <ArrowUpFromLine className="h-3 w-3" />
              {formatBytesRate(pod.txBytesPerSec)}
            </span>
          </div>
        </div>

        {pod.history.length >= 2 && (
          <ResponsiveContainer width="100%" height={60}>
            <AreaChart data={pod.history} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-card, #fff)',
                  borderColor: 'var(--color-border, #e2e8f0)',
                  borderRadius: '0.5rem',
                  fontSize: '10px',
                  padding: '4px 8px',
                }}
              />
              <Area
                type="monotone"
                dataKey="rx"
                stroke="#10b981"
                fill="#10b981"
                fillOpacity={0.1}
                strokeWidth={1.5}
                dot={false}
                name="RX"
              />
              <Area
                type="monotone"
                dataKey="tx"
                stroke="#3b82f6"
                fill="#3b82f6"
                fillOpacity={0.1}
                strokeWidth={1.5}
                dot={false}
                name="TX"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function NetworkMetrics({ className }: { className?: string }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('rx');
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(stored);
  const clusterId = useBackendConfigStore((s) => s.currentClusterId);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['network-metrics', baseUrl, clusterId],
    queryFn: () => fetchNetworkMetrics(baseUrl, clusterId),
    refetchInterval: 30_000,
    enabled: isConfigured,
    staleTime: 15_000,
  });

  const filteredPods = useMemo(() => {
    if (!data?.pods) return [];
    let pods = [...data.pods];
    if (search) {
      const q = search.toLowerCase();
      pods = pods.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.namespace.toLowerCase().includes(q),
      );
    }
    pods.sort((a, b) => {
      if (sortBy === 'rx') return b.rxBytesPerSec - a.rxBytesPerSec;
      if (sortBy === 'tx') return b.txBytesPerSec - a.txBytesPerSec;
      return a.name.localeCompare(b.name);
    });
    return pods;
  }, [data?.pods, search, sortBy]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn('space-y-6', className)}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-100 dark:bg-cyan-950/40">
            <Network className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Network Metrics
            </h2>
            <p className="text-sm text-muted-foreground">
              Network flow visibility and I/O per pod/service
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <Badge
              variant="outline"
              className={cn('text-xs', cniLabels[data.cniPlugin]?.color)}
            >
              {cniLabels[data.cniPlugin]?.label ?? 'Unknown'} CNI
            </Badge>
          )}
          {data?.hubbleEnabled && (
            <Badge variant="outline" className="text-xs gap-1 text-green-700 dark:text-green-400">
              <Wifi className="h-3 w-3" />
              Hubble
            </Badge>
          )}
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
      </div>

      {error && (
        <Card className="border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20">
          <CardContent className="p-4 flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Failed to load network metrics: {String(error)}
          </CardContent>
        </Card>
      )}

      {/* Stats Strip */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Flows', value: data.totalFlows.toLocaleString(), icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30' },
            { label: 'Dropped', value: data.droppedFlows.toLocaleString(), icon: Shield, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30' },
            { label: 'Network Policies', value: data.networkPoliciesCount, icon: Shield, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
            { label: 'Monitored Pods', value: data.pods.length, icon: Globe, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/30' },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className={cn('rounded-xl border p-3 flex items-center gap-3', bg)}>
              <Icon className={cn('h-4 w-4', color)} />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
                <p className={cn('text-lg font-bold tabular-nums', color)}>{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Top Flows Table */}
      {data && data.topFlows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-500" />
              Top Network Flows
            </CardTitle>
            <CardDescription className="text-xs">
              Highest traffic flows across the cluster
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-slate-50/60 dark:bg-slate-800/40">
                    <th className="text-left p-2 font-bold uppercase tracking-widest text-slate-500">Source</th>
                    <th className="text-left p-2 font-bold uppercase tracking-widest text-slate-500">Destination</th>
                    <th className="text-left p-2 font-bold uppercase tracking-widest text-slate-500">Protocol</th>
                    <th className="text-right p-2 font-bold uppercase tracking-widest text-slate-500">In</th>
                    <th className="text-right p-2 font-bold uppercase tracking-widest text-slate-500">Out</th>
                    <th className="text-center p-2 font-bold uppercase tracking-widest text-slate-500">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topFlows.map((flow, idx) => (
                    <tr key={idx} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className="p-2">
                        <div className="font-medium text-slate-800 dark:text-slate-200">{flow.source}</div>
                        <div className="text-muted-foreground">{flow.sourceNamespace}</div>
                      </td>
                      <td className="p-2">
                        <div className="font-medium text-slate-800 dark:text-slate-200">{flow.destination}</div>
                        <div className="text-muted-foreground">{flow.destinationNamespace}</div>
                      </td>
                      <td className="p-2">
                        <Badge variant="outline" className="text-[9px]">
                          {flow.protocol}:{flow.port}
                        </Badge>
                      </td>
                      <td className="p-2 text-right tabular-nums">{formatBytes(flow.bytesIn)}</td>
                      <td className="p-2 text-right tabular-nums">{formatBytes(flow.bytesOut)}</td>
                      <td className="p-2 text-center">
                        <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full', verdictColors[flow.verdict])}>
                          {flow.verdict}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pod Network Cards */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search pods by name or namespace..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortField)}>
            <SelectTrigger className="w-[130px] h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rx">Sort by RX</SelectItem>
              <SelectItem value="tx">Sort by TX</SelectItem>
              <SelectItem value="name">Sort by Name</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {filteredPods.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredPods.map((pod) => (
              <PodNetworkCard key={`${pod.namespace}/${pod.name}`} pod={pod} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">
                {isLoading ? 'Loading network metrics...' : 'No pod network metrics available.'}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </motion.div>
  );
}

export default NetworkMetrics;
