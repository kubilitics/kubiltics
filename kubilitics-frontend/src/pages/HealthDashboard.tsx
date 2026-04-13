/**
 * Health Dashboard — Operational Intelligence Platform (T6).
 *
 * Sections:
 *   1. Header with sync + live badge
 *   2. Hero: Large circular score gauge + level badge
 *   3. Component breakdown: 6 horizontal bars with weight indicators
 *   4. Namespace table: sortable, expandable per-namespace component breakdown
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Shield,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Info,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ListPagination } from '@/components/list/ListPagination';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageLoadingState } from '@/components/PageLoadingState';
import { ApiError } from '@/components/ui/error-state';
import { HealthRing } from '@/components/HealthRing';
import { HealthBadge } from '@/components/health/HealthBadge';
import { useClusterHealth } from '@/hooks/useClusterHealth';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useActiveInsights, useDismissInsight } from '@/hooks/useEventsIntelligence';
import { InsightsBanner } from '@/components/events/InsightsBanner';
import { HealthChangesCard } from '@/components/events/HealthChangesCard';
import type { ComponentScore, NamespaceHealth } from '@/services/api/clusterHealth';

/* ─── Constants ───────────────────────────────────────────────────────────── */

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const COMPONENT_LABELS: Record<string, string> = {
  spof_density: 'SPOF Density',
  pdb_coverage: 'PDB Coverage',
  hpa_coverage: 'HPA Coverage',
  redundancy_ratio: 'Redundancy Ratio',
  dependency_depth: 'Dependency Depth',
  cross_ns_risk: 'Cross-Namespace Risk',
};

const LEVEL_BADGE_STYLES: Record<string, string> = {
  healthy:
    'text-[hsl(var(--success))] border-[hsl(var(--success)/0.2)] bg-[hsl(var(--success)/0.08)]',
  warning:
    'text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.2)] bg-[hsl(var(--warning)/0.08)]',
  degraded:
    'text-[hsl(38,70%,42%)] border-[hsl(38,70%,42%,0.2)] bg-[hsl(38,70%,42%,0.08)]',
  critical:
    'text-[hsl(var(--destructive))] border-[hsl(var(--destructive)/0.2)] bg-[hsl(var(--destructive)/0.08)]',
};

const LEVEL_LABELS: Record<string, string> = {
  healthy: 'Healthy',
  warning: 'Warning',
  degraded: 'Degraded',
  critical: 'Critical',
};

function getLevelIcon(level: string) {
  switch (level) {
    case 'healthy':
      return CheckCircle2;
    case 'warning':
      return AlertTriangle;
    case 'degraded':
    case 'critical':
      return AlertCircle;
    default:
      return Info;
  }
}

function getScoreBarColor(score: number): string {
  if (score >= 0.8) return 'bg-[hsl(var(--success))]';
  if (score >= 0.5) return 'bg-[hsl(var(--warning))]';
  if (score >= 0.25) return 'bg-[hsl(var(--warning)/0.8)]';
  return 'bg-[hsl(var(--destructive))]';
}

type SortKey = 'namespace' | 'score' | 'level' | 'workload_count';
type SortDir = 'asc' | 'desc';

/* ─── Component Bar ───────────────────────────────────────────────────────── */

function ComponentBar({ component, index }: { component: ComponentScore; index: number }) {
  const percent = Math.round(component.score * 100);
  const label = COMPONENT_LABELS[component.name] ?? component.name;

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      className="space-y-1.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-foreground">{label}</span>
          <span className="text-[10px] text-muted-foreground font-medium tabular-nums">
            w={Math.round(component.weight * 100)}%
          </span>
        </div>
        <span className="text-[13px] font-bold tabular-nums text-foreground">
          {percent}%
        </span>
      </div>
      <Progress
        value={percent}
        className="h-2.5 bg-muted/50 rounded-full"
        indicatorClassName={cn(getScoreBarColor(component.score), 'rounded-full')}
      />
      <p className="text-[11px] text-muted-foreground">{component.detail}</p>
    </motion.div>
  );
}

/* ─── Namespace Row ───────────────────────────────────────────────────────── */

function NamespaceRow({
  ns,
  isExpanded,
  onToggle,
}: {
  ns: NamespaceHealth;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const levelStyle = LEVEL_BADGE_STYLES[ns.level] ?? LEVEL_BADGE_STYLES.warning;

  return (
    <>
      <motion.tr
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="group hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-6 py-3.5">
          <span className="text-sm font-semibold text-foreground">{ns.namespace}</span>
        </td>
        <td className="px-6 py-3.5">
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 bg-muted/50 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full', getScoreBarColor(ns.score / 100))}
                style={{ width: `${ns.score}%` }}
              />
            </div>
            <span className="text-sm font-bold tabular-nums text-foreground">{Math.round(ns.score)}</span>
          </div>
        </td>
        <td className="px-6 py-3.5">
          <Badge
            variant="outline"
            className={cn('text-[10px] uppercase tracking-wider font-semibold', levelStyle)}
          >
            {LEVEL_LABELS[ns.level] ?? ns.level}
          </Badge>
        </td>
        <td className="px-6 py-3.5">
          <span className="text-sm tabular-nums text-muted-foreground">{ns.workload_count}</span>
        </td>
        <td className="px-6 py-3.5 text-right">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </td>
      </motion.tr>
      <AnimatePresence>
        {isExpanded && (
          <tr>
            <td colSpan={5} className="px-0 py-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-8 py-4 bg-muted/20 border-t border-b border-border/30">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Component Breakdown
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {ns.components.map((comp, i) => (
                      <ComponentBar key={comp.name} component={comp} index={i} />
                    ))}
                  </div>
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

/* ─── Sort Header ─────────────────────────────────────────────────────────── */

function SortHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = currentSort === sortKey;

  return (
    <th
      className="px-6 py-3.5 border-b border-border/50 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        {label}
        {isActive ? (
          currentDir === 'asc' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </div>
    </th>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Main Component                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function HealthDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const [expandedNs, setExpandedNs] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Pagination State
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const { data, isLoading, error } = useClusterHealth(currentClusterId);
  const { data: insights } = useActiveInsights();
  const dismissInsightMutation = useDismissInsight();

  const handleSync = useCallback(() => {
    setIsSyncing(true);
    queryClient.invalidateQueries({ queryKey: ['cluster-health'] });
    setTimeout(() => setIsSyncing(false), 1500);
  }, [queryClient]);

  const toggleExpand = useCallback((namespace: string) => {
    setExpandedNs((prev) => {
      const next = new Set(prev);
      if (next.has(namespace)) next.delete(namespace);
      else next.add(namespace);
      return next;
    });
  }, []);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir(key === 'namespace' ? 'asc' : 'desc');
      }
      setPageIndex(0);
    },
    [sortKey],
  );

  const sortedNamespaces = useMemo(() => {
    if (!data?.namespaces) return [];
    const sorted = [...data.namespaces];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'namespace':
          cmp = a.namespace.localeCompare(b.namespace);
          break;
        case 'score':
          cmp = a.score - b.score;
          break;
        case 'level': {
          const order: Record<string, number> = { critical: 0, degraded: 1, warning: 2, healthy: 3 };
          cmp = (order[a.level] ?? 4) - (order[b.level] ?? 4);
          break;
        }
        case 'workload_count':
          cmp = a.workload_count - b.workload_count;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [data?.namespaces, sortKey, sortDir]);

  // Calculate pagination
  const totalFiltered = sortedNamespaces.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = sortedNamespaces.slice(start, start + pageSize);

  useEffect(() => {
    if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
  }, [safePageIndex, pageIndex]);

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPageIndex(0);
  };

  const pagination = {
    rangeLabel: totalFiltered > 0
      ? `Showing ${start + 1}\u2013${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}`
      : 'No namespaces',
    hasPrev: safePageIndex > 0,
    hasNext: start + pageSize < totalFiltered,
    onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
    onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
    currentPage: safePageIndex + 1,
    totalPages: Math.max(1, totalPages),
    onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
  };

  if (error) {
    return (
      <PageLayout label="Health Dashboard">
        <ApiError onRetry={() => queryClient.invalidateQueries({ queryKey: ['cluster-health'] })} message={(error as Error)?.message} />
      </PageLayout>
    );
  }

  if (isLoading) {
    return <PageLoadingState message="Loading cluster health..." />;
  }

  const score = data?.score ?? 0;
  const level = data?.level ?? 'warning';
  const LevelIcon = getLevelIcon(level);

  return (
    <PageLayout label="Health Dashboard">

        {/* Header */}
        <SectionOverviewHeader
          title="Health Dashboard"
          description="Cluster operational health score and component breakdown."
          icon={Activity}
          iconClassName="from-emerald-500/20 to-emerald-500/5 text-emerald-600 border-emerald-500/10"
          onSync={handleSync}
          isSyncing={isSyncing}
          showAiButton={false}
        />

        {/* Insights Banner */}
        {insights && insights.length > 0 && (
          <InsightsBanner
            insights={insights}
            onDismiss={(id) => dismissInsightMutation.mutate(id)}
            isDismissing={dismissInsightMutation.isPending}
          />
        )}

        {/* Error state */}
        {error && (
          <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                Failed to load health data
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                {error.message}
              </p>
            </div>
          </div>
        )}

        {/* Hero: Score Gauge + Component Breakdown */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Score Gauge Card */}
          <Card className="lg:col-span-4 border-none soft-shadow glass-panel relative overflow-hidden flex flex-col">
            <div
              className="absolute top-0 left-0 right-0 h-1 rounded-t-lg"
              style={{
                background:
                  level === 'healthy'
                    ? 'linear-gradient(to right, hsl(142, 71%, 45%), hsl(142, 71%, 55%), hsl(142, 60%, 48%))'
                    : level === 'warning'
                      ? 'linear-gradient(to right, hsl(38, 92%, 50%), hsl(38, 92%, 60%), hsl(38, 80%, 50%))'
                      : level === 'degraded'
                        ? 'linear-gradient(to right, hsl(25, 85%, 50%), hsl(30, 85%, 55%), hsl(38, 80%, 50%))'
                        : 'linear-gradient(to right, hsl(0, 84%, 60%), hsl(0, 80%, 65%), hsl(350, 80%, 58%))',
              }}
            />

            <div className="p-6 pb-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Cluster Health</h2>
                <div
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold shadow-sm backdrop-blur-sm',
                    LEVEL_BADGE_STYLES[level] ?? LEVEL_BADGE_STYLES.warning,
                  )}
                >
                  <LevelIcon className="w-3 h-3" />
                  <span>{LEVEL_LABELS[level] ?? level}</span>
                </div>
              </div>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6">
              <HealthRing score={score} size={180} strokeWidth={12} />
              <p className="mt-4 text-sm text-muted-foreground text-center">
                Overall operational health across {data?.namespaces?.length ?? 0} namespaces
              </p>
            </div>
          </Card>

          {/* Component Breakdown Card */}
          <Card className="lg:col-span-8 border-none soft-shadow glass-panel relative overflow-hidden flex flex-col">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-primary" />

            <div className="p-6 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-foreground">Component Scores</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Weighted health indicators composing the overall score
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="text-[11px] font-semibold border-border text-muted-foreground"
                >
                  {data?.components?.length ?? 0} components
                </Badge>
              </div>
            </div>

            <div className="flex-1 px-6 pb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {(data?.components ?? []).map((comp, i) => (
                  <ComponentBar key={comp.name} component={comp} index={i} />
                ))}
              </div>
              {(!data?.components || data.components.length === 0) && (
                <div className="flex items-center justify-center h-32 rounded-2xl border-2 border-dashed border-border/50">
                  <p className="text-sm text-muted-foreground">No component data available</p>
                </div>
              )}
            </div>
          </Card>
        </section>

        {/* What Changed — recent health-impacting changes */}
        <HealthChangesCard />

        {/* Namespace Table */}
        <section>
          <Card className="border-none soft-shadow glass-panel card-accent overflow-hidden">
            <div className="p-6 border-b border-border/50">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-foreground">Namespace Health</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Per-namespace health scores. Click a row to see component breakdown.
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="text-[11px] font-semibold border-border text-muted-foreground"
                >
                  {sortedNamespaces.length} {sortedNamespaces.length === 1 ? 'namespace' : 'namespaces'}
                </Badge>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-muted/30">
                    <SortHeader
                      label="Namespace"
                      sortKey="namespace"
                      currentSort={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label="Score"
                      sortKey="score"
                      currentSort={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label="Level"
                      sortKey="level"
                      currentSort={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label="Workloads"
                      sortKey="workload_count"
                      currentSort={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <th className="px-6 py-3.5 border-b border-border/50 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {itemsOnPage.map((ns) => (
                    <NamespaceRow
                      key={ns.namespace}
                      ns={ns}
                      isExpanded={expandedNs.has(ns.namespace)}
                      onToggle={() => toggleExpand(ns.namespace)}
                    />
                  ))}
                  {sortedNamespaces.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <Shield className="h-10 w-10 text-muted-foreground/40" />
                          <p className="text-sm text-muted-foreground">
                            No namespace health data available
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            {sortedNamespaces.length > 0 && (
              <div className="p-4 border-t border-border/50 bg-muted/20 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-muted-foreground">{pagination.rangeLabel}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="press-effect gap-2">
                        {pageSize} per page
                        <ChevronDown className="h-4 w-4 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <DropdownMenuItem
                          key={size}
                          onClick={() => handlePageSizeChange(size)}
                          className={cn(pageSize === size && 'bg-accent')}
                        >
                          {size} per page
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <ListPagination
                  hasPrev={pagination.hasPrev}
                  hasNext={pagination.hasNext}
                  onPrev={pagination.onPrev}
                  onNext={pagination.onNext}
                  rangeLabel={undefined}
                  currentPage={pagination.currentPage}
                  totalPages={pagination.totalPages}
                  onPageChange={pagination.onPageChange}
                />
              </div>
            )}
          </Card>
        </section>
    </PageLayout>
  );
}
