/**
 * TASK-OBS-011: SLO/SLI Framework
 *
 * SLI definition page with platform SLIs, SLO target configuration,
 * burn rate alerts, and error budget remaining display.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Target,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Settings,
  BarChart3,
  Shield,
  Zap,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SLIDefinition {
  id: string;
  name: string;
  description: string;
  query: string;
  unit: string;
  goodThreshold: number;
  direction: 'above' | 'below'; // 'above' = good when value > threshold
}

interface SLOConfig {
  id: string;
  sliId: string;
  target: number;          // 0.0 - 1.0 (e.g. 0.999 = 99.9%)
  window: string;          // "30d", "7d"
  burnRateAlerts: BurnRateAlert[];
}

interface BurnRateAlert {
  shortWindow: string;     // "1h"
  longWindow: string;      // "6h"
  burnRateThreshold: number;
  severity: 'critical' | 'warning';
  firing: boolean;
}

interface SLOStatus {
  sloId: string;
  sliName: string;
  target: number;
  current: number;         // current SLI value (0-1)
  errorBudgetTotal: number;
  errorBudgetConsumed: number;
  errorBudgetRemaining: number; // 0-1
  isCompliant: boolean;
  burnRate1h: number;
  burnRate6h: number;
  history: { time: string; value: number; budget: number }[];
}

interface SLODashboardData {
  slis: SLIDefinition[];
  slos: SLOConfig[];
  statuses: SLOStatus[];
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchSLODashboard(baseUrl: string): Promise<SLODashboardData> {
  const res = await fetch(`${baseUrl}/api/v1/slo/dashboard`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch SLO data: ${res.status}`);
  return res.json();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPercent(value: number, decimals = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

function getBudgetColor(remaining: number): string {
  if (remaining >= 0.5) return 'text-emerald-600 dark:text-emerald-400';
  if (remaining >= 0.25) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function getBudgetBarColor(remaining: number): string {
  if (remaining >= 0.5) return 'bg-emerald-500';
  if (remaining >= 0.25) return 'bg-amber-500';
  return 'bg-red-500';
}

// ─── SLO Card ────────────────────────────────────────────────────────────────

function SLOCard({ status }: { status: SLOStatus }) {
  const budgetPercent = Math.max(0, Math.min(1, status.errorBudgetRemaining));
  const isHealthy = status.isCompliant && budgetPercent > 0.1;
  const burnRateHigh = status.burnRate1h > 1.0;

  return (
    <Card className={cn(
      'overflow-hidden transition-colors',
      !isHealthy && 'border-red-200 dark:border-red-900/40',
    )}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {status.isCompliant ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                {status.sliName}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Target: {formatPercent(status.target, 1)}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className={cn(
              'text-lg font-bold tabular-nums',
              status.current >= status.target ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
            )}>
              {formatPercent(status.current, 3)}
            </p>
            <p className="text-[10px] text-muted-foreground">Current SLI</p>
          </div>
        </div>

        {/* Error Budget Bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-semibold text-slate-600 dark:text-slate-400">Error Budget</span>
            <span className={cn('font-bold', getBudgetColor(budgetPercent))}>
              {formatPercent(budgetPercent, 1)} remaining
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${budgetPercent * 100}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className={cn('h-full rounded-full', getBudgetBarColor(budgetPercent))}
            />
          </div>
        </div>

        {/* Burn Rates */}
        <div className="grid grid-cols-2 gap-2">
          <div className={cn(
            'rounded-lg p-2 text-center',
            status.burnRate1h > 1 ? 'bg-red-50 dark:bg-red-950/20' : 'bg-slate-50 dark:bg-slate-800/40',
          )}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">1h Burn Rate</p>
            <p className={cn(
              'text-sm font-bold tabular-nums',
              status.burnRate1h > 1 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300',
            )}>
              {status.burnRate1h.toFixed(2)}x
            </p>
          </div>
          <div className={cn(
            'rounded-lg p-2 text-center',
            status.burnRate6h > 1 ? 'bg-amber-50 dark:bg-amber-950/20' : 'bg-slate-50 dark:bg-slate-800/40',
          )}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">6h Burn Rate</p>
            <p className={cn(
              'text-sm font-bold tabular-nums',
              status.burnRate6h > 1 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300',
            )}>
              {status.burnRate6h.toFixed(2)}x
            </p>
          </div>
        </div>

        {/* Sparkline */}
        {status.history.length >= 2 && (
          <ResponsiveContainer width="100%" height={60}>
            <AreaChart data={status.history} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-card, #fff)',
                  borderColor: 'var(--color-border, #e2e8f0)',
                  borderRadius: '0.5rem',
                  fontSize: '10px',
                  padding: '4px 8px',
                }}
                formatter={(val: number) => formatPercent(val, 3)}
              />
              <ReferenceLine
                y={status.target}
                stroke="#f59e0b"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={status.isCompliant ? '#10b981' : '#ef4444'}
                fill={status.isCompliant ? '#10b981' : '#ef4444'}
                fillOpacity={0.1}
                strokeWidth={1.5}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SLODashboard() {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['slo-dashboard', baseUrl],
    queryFn: () => fetchSLODashboard(baseUrl),
    refetchInterval: 60_000,
    enabled: isConfigured,
    staleTime: 30_000,
  });

  // Aggregate stats
  const stats = useMemo(() => {
    if (!data?.statuses) return null;
    const total = data.statuses.length;
    const compliant = data.statuses.filter((s) => s.isCompliant).length;
    const burning = data.statuses.filter((s) => s.burnRate1h > 1.0).length;
    const lowBudget = data.statuses.filter((s) => s.errorBudgetRemaining < 0.25).length;
    return { total, compliant, burning, lowBudget };
  }, [data]);

  // Error budget trend chart
  const budgetTrendData = useMemo(() => {
    if (!data?.statuses || data.statuses.length === 0) return [];
    // Use the first status's history for the combined view
    const primary = data.statuses[0];
    return primary.history.map((h) => ({
      time: h.time,
      budget: h.budget * 100,
    }));
  }, [data]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6 max-w-6xl"
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-950/40">
            <Target className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              SLO Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              Service Level Objectives, Indicators, and Error Budgets
            </p>
          </div>
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

      {error && (
        <Card className="border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20">
          <CardContent className="p-4 text-sm text-red-700 dark:text-red-400">
            Failed to load SLO data: {String(error)}
          </CardContent>
        </Card>
      )}

      {/* Stats Strip */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border p-3 flex items-center gap-3 bg-slate-50 dark:bg-slate-800/30">
            <Target className="h-4 w-4 text-slate-600" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total SLOs</p>
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">{stats.total}</p>
            </div>
          </div>
          <div className="rounded-xl border p-3 flex items-center gap-3 bg-emerald-50 dark:bg-emerald-950/20">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Compliant</p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{stats.compliant}</p>
            </div>
          </div>
          <div className="rounded-xl border p-3 flex items-center gap-3 bg-red-50 dark:bg-red-950/20">
            <Zap className="h-4 w-4 text-red-600" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">High Burn Rate</p>
              <p className="text-lg font-bold text-red-600 dark:text-red-400 tabular-nums">{stats.burning}</p>
            </div>
          </div>
          <div className="rounded-xl border p-3 flex items-center gap-3 bg-amber-50 dark:bg-amber-950/20">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Low Budget</p>
              <p className="text-lg font-bold text-amber-600 dark:text-amber-400 tabular-nums">{stats.lowBudget}</p>
            </div>
          </div>
        </div>
      )}

      {/* SLO Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4 h-[280px]" />
            </Card>
          ))}
        </div>
      ) : data?.statuses && data.statuses.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.statuses.map((status) => (
            <SLOCard key={status.sloId} status={status} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Target className="h-10 w-10 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-muted-foreground">No SLOs configured</p>
            <p className="text-xs text-muted-foreground text-center max-w-md">
              Define Service Level Indicators (SLIs) and set Objectives (SLOs) to track
              your platform reliability with error budgets and burn rate alerting.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Error Budget Trend */}
      {budgetTrendData.length >= 2 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-amber-500" />
              Error Budget Consumption Trend
            </CardTitle>
            <CardDescription className="text-xs">
              Error budget remaining over time (higher is better)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={budgetTrendData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-slate-500" />
                <YAxis
                  tick={{ fontSize: 10 }}
                  domain={[0, 100]}
                  className="text-slate-500"
                  width={35}
                  unit="%"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-card, #fff)',
                    borderColor: 'var(--color-border, #e2e8f0)',
                    borderRadius: '0.75rem',
                    fontSize: '12px',
                  }}
                  formatter={(val: number) => `${val.toFixed(1)}%`}
                />
                <ReferenceLine y={25} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "Warning", fontSize: 10 }} />
                <Area
                  type="monotone"
                  dataKey="budget"
                  stroke="#10b981"
                  fill="#10b981"
                  fillOpacity={0.1}
                  strokeWidth={2}
                  name="Error Budget %"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* SLI Definitions */}
      {data?.slis && data.slis.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4 text-indigo-500" />
              SLI Definitions
            </CardTitle>
            <CardDescription className="text-xs">
              Service Level Indicators used for SLO calculations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.slis.map((sli) => (
                <div
                  key={sli.id}
                  className="flex items-center justify-between rounded-xl border p-3 bg-slate-50/50 dark:bg-slate-800/30"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{sli.name}</p>
                    <p className="text-[10px] text-muted-foreground">{sli.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[9px] font-mono">
                      {sli.direction === 'above' ? '>' : '<'} {sli.goodThreshold}{sli.unit}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
