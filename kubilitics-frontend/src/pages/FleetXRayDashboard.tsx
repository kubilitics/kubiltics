/**
 * FleetXRayDashboard -- Fleet X-Ray overview page.
 *
 * Route: /fleet/xray
 *
 * Shows fleet-wide health summary bar, sortable cluster ranking table
 * with color-coded health scores and trend arrows, and action buttons
 * for comparison and golden template matching.
 */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Server,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ChevronUp,
  ChevronDown,
  GitCompareArrows,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useXRayDashboard } from '@/hooks/useFleetXray';
import { useFleetXrayStore } from '@/stores/fleetXrayStore';
import type { XRayCluster, TrendDirection } from '@/services/api/fleetXray';

// ── Helpers ──────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'health_score' | 'spof_count' | 'critical_count' | 'blast_radius_avg';
type SortDir = 'asc' | 'desc';

function healthColor(score: number): string {
  if (score >= 80) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 60) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function healthBg(score: number): string {
  if (score >= 80) return 'bg-emerald-100 dark:bg-emerald-900/30';
  if (score >= 60) return 'bg-amber-100 dark:bg-amber-900/30';
  return 'bg-red-100 dark:bg-red-900/30';
}

function TrendIcon({ trend }: { trend: TrendDirection }) {
  if (trend === 'up') return <ArrowUpRight className="h-4 w-4 text-emerald-500" />;
  if (trend === 'down') return <ArrowDownRight className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-slate-400" />;
}

function SortIndicator({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return null;
  return dir === 'asc' ? (
    <ChevronUp className="h-3.5 w-3.5 inline-block ml-1" />
  ) : (
    <ChevronDown className="h-3.5 w-3.5 inline-block ml-1" />
  );
}

function getDimensionValue(cluster: XRayCluster, key: SortKey): string | number {
  switch (key) {
    case 'name': return cluster.name;
    case 'health_score': return cluster.dimensions.health_score;
    case 'spof_count': return cluster.dimensions.spof_count;
    case 'critical_count': return cluster.dimensions.critical_count;
    case 'blast_radius_avg': return cluster.dimensions.blast_radius_avg;
  }
}

// ── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon: Icon,
  iconClass,
  bgClass,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  iconClass: string;
  bgClass: string;
}) {
  return (
    <Card className="border-0 shadow-sm bg-card/80 backdrop-blur-sm">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center', bgClass)}>
          <Icon className={cn('h-5 w-5', iconClass)} />
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function FleetXRayDashboard() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useXRayDashboard();
  const setSelectedClusterA = useFleetXrayStore((s) => s.setSelectedClusterA);
  const setSelectedClusterB = useFleetXrayStore((s) => s.setSelectedClusterB);

  const [sortKey, setSortKey] = useState<SortKey>('health_score');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const clusters = data?.clusters ?? [];

  const sorted = useMemo(() => {
    const copy = [...clusters];
    copy.sort((a, b) => {
      const av = getDimensionValue(a, sortKey);
      const bv = getDimensionValue(b, sortKey);
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [clusters, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'asc');
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleCompare() {
    const ids = Array.from(selected);
    if (ids.length >= 2) {
      setSelectedClusterA(ids[0]);
      setSelectedClusterB(ids[1]);
      navigate('/fleet/xray/compare');
    }
  }

  function handleTemplateMatch() {
    navigate('/fleet/xray/templates');
  }

  // Header columns
  const columns: Array<{ key: SortKey; label: string; className?: string }> = [
    { key: 'name', label: 'Cluster' },
    { key: 'health_score', label: 'Health Score', className: 'text-right' },
    { key: 'spof_count', label: 'SPOFs', className: 'text-right' },
    { key: 'critical_count', label: 'Critical', className: 'text-right' },
    { key: 'blast_radius_avg', label: 'Avg Blast Radius', className: 'text-right' },
  ];

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-3" />
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            Failed to load Fleet X-Ray dashboard. The backend may not have the X-Ray endpoints enabled yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fleet X-Ray</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Deep structural health analysis across all clusters
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={selected.size < 2}
            onClick={handleCompare}
          >
            <GitCompareArrows className="h-4 w-4 mr-1.5" />
            Compare Selected
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTemplateMatch}
          >
            <ShieldCheck className="h-4 w-4 mr-1.5" />
            Golden Template Match
          </Button>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label="Fleet Health Avg"
          value={data ? `${Math.round(data.fleet_health_avg)}%` : '--'}
          icon={Activity}
          iconClass="text-emerald-600"
          bgClass="bg-emerald-100 dark:bg-emerald-900/30"
        />
        <SummaryCard
          label="Total Clusters"
          value={data?.total_clusters ?? 0}
          icon={Server}
          iconClass="text-blue-600"
          bgClass="bg-blue-100 dark:bg-blue-900/30"
        />
        <SummaryCard
          label="Total SPOFs"
          value={data?.total_spofs ?? 0}
          icon={AlertTriangle}
          iconClass="text-amber-600"
          bgClass="bg-amber-100 dark:bg-amber-900/30"
        />
      </div>

      {/* Cluster ranking table */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="p-3 text-left w-10">
                    <span className="sr-only">Select</span>
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={cn(
                        'p-3 font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors',
                        col.className,
                      )}
                      onClick={() => toggleSort(col.key)}
                    >
                      {col.label}
                      <SortIndicator active={sortKey === col.key} dir={sortDir} />
                    </th>
                  ))}
                  <th className="p-3 text-center font-medium text-muted-foreground">Trend</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={columns.length + 2} className="p-8 text-center text-muted-foreground">
                      No clusters found. Connect clusters via the Fleet page to see X-Ray analysis.
                    </td>
                  </tr>
                )}
                {sorted.map((cluster) => (
                  <tr
                    key={cluster.id}
                    className="border-b border-border/30 hover:bg-muted/40 transition-colors cursor-pointer"
                    onClick={() => toggleSelect(cluster.id)}
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(cluster.id)}
                        onChange={() => toggleSelect(cluster.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 rounded border-border"
                      />
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{cluster.name}</div>
                      <div className="text-xs text-muted-foreground">{cluster.provider} / {cluster.region}</div>
                    </td>
                    <td className="p-3 text-right">
                      <span
                        className={cn(
                          'inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-bold tabular-nums',
                          healthColor(cluster.dimensions.health_score),
                          healthBg(cluster.dimensions.health_score),
                        )}
                      >
                        {cluster.dimensions.health_score}
                      </span>
                    </td>
                    <td className="p-3 text-right tabular-nums">{cluster.dimensions.spof_count}</td>
                    <td className="p-3 text-right tabular-nums">{cluster.dimensions.critical_count}</td>
                    <td className="p-3 text-right tabular-nums">
                      {cluster.dimensions.blast_radius_avg.toFixed(1)}%
                    </td>
                    <td className="p-3 text-center">
                      <TrendIcon trend={cluster.trend} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
