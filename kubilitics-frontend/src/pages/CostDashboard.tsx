/**
 * TASK-OBS-013: Cost Attribution
 *
 * Cost per namespace view, cost per workload breakdown,
 * OpenCost integration hooks, and cost trend charts.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  PieChart,
  RefreshCw,
  AlertCircle,
  ArrowUpDown,
  Search,
  Calendar,
  Layers,
  Box,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
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
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

// ─── Types ───────────────────────────────────────────────────────────────────

interface NamespaceCost {
  namespace: string;
  cpuCost: number;
  memoryCost: number;
  storageCost: number;
  networkCost: number;
  totalCost: number;
  trend: number; // percentage change from previous period
  workloads: WorkloadCost[];
}

interface WorkloadCost {
  name: string;
  kind: string;
  namespace: string;
  cpuCost: number;
  memoryCost: number;
  storageCost: number;
  totalCost: number;
  efficiency: number; // 0-1 (request vs usage ratio)
}

interface CostTrendPoint {
  date: string;
  total: number;
  cpu: number;
  memory: number;
  storage: number;
  network: number;
}

interface CostDashboardData {
  currency: string;
  period: string;
  totalCost: number;
  previousPeriodCost: number;
  costChange: number;
  namespaces: NamespaceCost[];
  trend: CostTrendPoint[];
  openCostAvailable: boolean;
  dataSource: 'opencost' | 'estimated';
  cpuCostPerCoreHour: number;
  memoryCostPerGiBHour: number;
}

type CostView = 'namespace' | 'workload';
type SortField = 'total' | 'cpu' | 'memory' | 'storage' | 'name';

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchCostData(baseUrl: string, clusterId: string | null, period: string): Promise<CostDashboardData> {
  const prefix = clusterId ? `/api/v1/clusters/${clusterId}` : '/api/v1';
  const res = await fetch(`${baseUrl}${prefix}/cost?period=${period}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch cost data: ${res.status}`);
  return res.json();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCost(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCostCompact(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

const COLORS = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
];

const TrendIndicator = ({ change }: { change: number }) => {
  if (change > 2) return <TrendingUp className="h-3 w-3 text-red-500" />;
  if (change < -2) return <TrendingDown className="h-3 w-3 text-emerald-500" />;
  return <Minus className="h-3 w-3 text-slate-400" />;
};

// ─── Efficiency Bar ──────────────────────────────────────────────────────────

function EfficiencyBar({ efficiency }: { efficiency: number }) {
  const percent = Math.round(efficiency * 100);
  const color = percent >= 70 ? 'bg-emerald-500' : percent >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.5 }}
          className={cn('h-full rounded-full', color)}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">{percent}%</span>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CostDashboard() {
  const [period, setPeriod] = useState('7d');
  const [view, setView] = useState<CostView>('namespace');
  const [sortBy, setSortBy] = useState<SortField>('total');
  const [search, setSearch] = useState('');
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(stored);
  const clusterId = useBackendConfigStore((s) => s.currentClusterId);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cost-dashboard', baseUrl, clusterId, period],
    queryFn: () => fetchCostData(baseUrl, clusterId, period),
    refetchInterval: 300_000, // 5 min
    enabled: isConfigured,
    staleTime: 120_000,
  });

  // Sorted + filtered namespace data
  const sortedNamespaces = useMemo(() => {
    if (!data?.namespaces) return [];
    let ns = [...data.namespaces];
    if (search) {
      const q = search.toLowerCase();
      ns = ns.filter((n) => n.namespace.toLowerCase().includes(q));
    }
    ns.sort((a, b) => {
      if (sortBy === 'name') return a.namespace.localeCompare(b.namespace);
      if (sortBy === 'cpu') return b.cpuCost - a.cpuCost;
      if (sortBy === 'memory') return b.memoryCost - a.memoryCost;
      if (sortBy === 'storage') return b.storageCost - a.storageCost;
      return b.totalCost - a.totalCost;
    });
    return ns;
  }, [data?.namespaces, search, sortBy]);

  // All workloads flattened
  const allWorkloads = useMemo(() => {
    if (!data?.namespaces) return [];
    const wl = data.namespaces.flatMap((ns) => ns.workloads);
    if (search) {
      const q = search.toLowerCase();
      return wl.filter(
        (w) => w.name.toLowerCase().includes(q) || w.namespace.toLowerCase().includes(q),
      );
    }
    wl.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'cpu') return b.cpuCost - a.cpuCost;
      if (sortBy === 'memory') return b.memoryCost - a.memoryCost;
      return b.totalCost - a.totalCost;
    });
    return wl;
  }, [data?.namespaces, search, sortBy]);

  // Pie chart data
  const pieData = useMemo(() => {
    if (!sortedNamespaces.length) return [];
    return sortedNamespaces
      .slice(0, 8)
      .map((ns, i) => ({
        name: ns.namespace,
        value: ns.totalCost,
        color: COLORS[i % COLORS.length],
      }));
  }, [sortedNamespaces]);

  const currency = data?.currency ?? 'USD';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6 max-w-6xl"
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-green-100 dark:bg-green-950/40">
            <DollarSign className="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Cost Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              Resource cost attribution by namespace and workload
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <Badge
              variant="outline"
              className={cn(
                'text-xs gap-1',
                data.openCostAvailable
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400',
              )}
            >
              {data.openCostAvailable ? 'OpenCost' : 'Estimated'}
            </Badge>
          )}
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[100px] h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1d">1 Day</SelectItem>
              <SelectItem value="7d">7 Days</SelectItem>
              <SelectItem value="30d">30 Days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          </Button>
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

      {/* Top KPI Cards */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-green-100 dark:bg-green-950/40">
                  <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Cost</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatCost(data.totalCost, currency)}
                  </p>
                  <div className="flex items-center gap-1">
                    <TrendIndicator change={data.costChange} />
                    <span className={cn(
                      'text-[10px] font-medium tabular-nums',
                      data.costChange > 0 ? 'text-red-500' : data.costChange < 0 ? 'text-emerald-500' : 'text-slate-400',
                    )}>
                      {data.costChange > 0 ? '+' : ''}{data.costChange.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-950/40">
                  <Layers className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Namespaces</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {data.namespaces.length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-950/40">
                  <Box className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">CPU Cost/core-hr</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatCost(data.cpuCostPerCoreHour, currency)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-950/40">
                  <BarChart3 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Mem Cost/GiB-hr</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatCost(data.memoryCostPerGiBHour, currency)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Charts Row */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Cost Trend */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-500" />
                Cost Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.trend.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={data.trend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} className="text-slate-500 dark:text-slate-400" />
                    <YAxis tick={{ fontSize: 10 }} className="text-slate-500 dark:text-slate-400" width={50} tickFormatter={(v) => formatCostCompact(v)} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--chart-tooltip-bg)',
                        borderColor: 'var(--chart-tooltip-border)',
                        borderRadius: '0.75rem',
                        fontSize: '11px',
                      }}
                      formatter={(val: number) => formatCost(val, currency)}
                    />
                    <Legend wrapperStyle={{ fontSize: '10px' }} />
                    <Area type="monotone" dataKey="cpu" name="CPU" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} stackId="1" />
                    <Area type="monotone" dataKey="memory" name="Memory" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.1} stackId="1" />
                    <Area type="monotone" dataKey="storage" name="Storage" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} stackId="1" />
                    <Area type="monotone" dataKey="network" name="Network" stroke="#10b981" fill="#10b981" fillOpacity={0.1} stackId="1" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
                  No trend data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* Namespace Pie */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <PieChart className="h-4 w-4 text-purple-500" />
                Cost by Namespace
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <RechartsPieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--chart-tooltip-bg)',
                        borderColor: 'var(--chart-tooltip-border)',
                        borderRadius: '0.75rem',
                        fontSize: '11px',
                      }}
                      formatter={(val: number) => formatCost(val, currency)}
                    />
                  </RechartsPieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
                  No data
                </div>
              )}
              {/* Legend */}
              <div className="flex flex-wrap gap-2 mt-2">
                {pieData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-1 text-[10px]">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                    <span className="text-muted-foreground">{entry.name}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* View Toggle + Search */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700">
          <button
            className={cn(
              'px-3 py-1 rounded-md text-xs font-medium transition-colors',
              view === 'namespace'
                ? 'bg-white dark:bg-slate-700 text-foreground shadow-sm border border-slate-200 dark:border-slate-600'
                : 'text-slate-600 dark:text-slate-400 hover:text-foreground hover:bg-slate-50 dark:hover:bg-slate-700/50',
            )}
            onClick={() => setView('namespace')}
          >
            Namespaces
          </button>
          <button
            className={cn(
              'px-3 py-1 rounded-md text-xs font-medium transition-colors',
              view === 'workload'
                ? 'bg-white dark:bg-slate-700 text-foreground shadow-sm border border-slate-200 dark:border-slate-600'
                : 'text-slate-600 dark:text-slate-400 hover:text-foreground hover:bg-slate-50 dark:hover:bg-slate-700/50',
            )}
            onClick={() => setView('workload')}
          >
            Workloads
          </button>
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortField)}>
          <SelectTrigger className="w-[120px] h-8 text-sm">
            <ArrowUpDown className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="total">Total Cost</SelectItem>
            <SelectItem value="cpu">CPU Cost</SelectItem>
            <SelectItem value="memory">Memory Cost</SelectItem>
            <SelectItem value="storage">Storage Cost</SelectItem>
            <SelectItem value="name">Name</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Namespace View */}
      {view === 'namespace' && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-slate-50/60 dark:bg-slate-800/40">
                    <th className="text-left p-3 font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Namespace</th>
                    <th className="text-right p-3 font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">CPU</th>
                    <th className="text-right p-3 font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Memory</th>
                    <th className="text-right p-3 font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Storage</th>
                    <th className="text-right p-3 font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Network</th>
                    <th className="text-right p-3 font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Total</th>
                    <th className="text-right p-3 font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedNamespaces.map((ns) => (
                    <tr key={ns.namespace} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className="p-3">
                        <span className="font-medium text-slate-900 dark:text-slate-100">{ns.namespace}</span>
                        <span className="ml-2 text-muted-foreground">({ns.workloads.length} workloads)</span>
                      </td>
                      <td className="p-3 text-right tabular-nums">{formatCost(ns.cpuCost, currency)}</td>
                      <td className="p-3 text-right tabular-nums">{formatCost(ns.memoryCost, currency)}</td>
                      <td className="p-3 text-right tabular-nums">{formatCost(ns.storageCost, currency)}</td>
                      <td className="p-3 text-right tabular-nums">{formatCost(ns.networkCost, currency)}</td>
                      <td className="p-3 text-right font-bold tabular-nums">{formatCost(ns.totalCost, currency)}</td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <TrendIndicator change={ns.trend} />
                          <span className={cn(
                            'tabular-nums',
                            ns.trend > 0 ? 'text-red-500' : ns.trend < 0 ? 'text-emerald-500' : 'text-slate-400',
                          )}>
                            {ns.trend > 0 ? '+' : ''}{ns.trend.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sortedNamespaces.length === 0 && (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                {isLoading ? 'Loading cost data...' : 'No namespace cost data available.'}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Workload View */}
      {view === 'workload' && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-slate-50/60 dark:bg-slate-800/40">
                    <th className="text-left p-3 font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Workload</th>
                    <th className="text-left p-3 font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Namespace</th>
                    <th className="text-left p-3 font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Kind</th>
                    <th className="text-right p-3 font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">CPU</th>
                    <th className="text-right p-3 font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Memory</th>
                    <th className="text-right p-3 font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Total</th>
                    <th className="text-center p-3 font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Efficiency</th>
                  </tr>
                </thead>
                <tbody>
                  {allWorkloads.slice(0, 50).map((wl, idx) => (
                    <tr key={`${wl.namespace}/${wl.name}-${idx}`} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className="p-3 font-medium text-slate-900 dark:text-slate-100">{wl.name}</td>
                      <td className="p-3 text-muted-foreground">{wl.namespace}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-[9px]">{wl.kind}</Badge>
                      </td>
                      <td className="p-3 text-right tabular-nums">{formatCost(wl.cpuCost, currency)}</td>
                      <td className="p-3 text-right tabular-nums">{formatCost(wl.memoryCost, currency)}</td>
                      <td className="p-3 text-right font-bold tabular-nums">{formatCost(wl.totalCost, currency)}</td>
                      <td className="p-3"><EfficiencyBar efficiency={wl.efficiency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {allWorkloads.length === 0 && (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                {isLoading ? 'Loading workload costs...' : 'No workload cost data available.'}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
