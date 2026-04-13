/**
 * Risk Ranking — Operational Intelligence Platform (T8).
 *
 * Sections:
 *   1. Header with generated_at timestamp + sync
 *   2. Level filter checkboxes
 *   3. Sortable, expandable table of namespace risk rankings
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  AlertCircle,
  Filter,
  Clock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useRiskRanking } from '@/hooks/useClusterHealth';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import type { NamespaceRisk } from '@/services/api/clusterHealth';

/* ─── Constants ───────────────────────────────────────────────────────────── */

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const LEVEL_BADGE_STYLES: Record<string, string> = {
  critical:
    'text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10',
  high:
    'text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/20 bg-orange-50 dark:bg-orange-500/10',
  medium:
    'text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-500/20 bg-yellow-50 dark:bg-yellow-500/10',
  low:
    'text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10',
};

const LEVEL_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const ALL_LEVELS = ['critical', 'high', 'medium', 'low'] as const;

function getRiskBarColor(score: number): string {
  if (score >= 75) return 'bg-red-500';
  if (score >= 50) return 'bg-orange-500';
  if (score >= 25) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

type SortKey =
  | 'rank'
  | 'namespace'
  | 'risk_score'
  | 'level'
  | 'spof_count'
  | 'avg_blast_radius'
  | 'cross_ns_dependencies'
  | 'workload_count';
type SortDir = 'asc' | 'desc';

/* ─── Risk Row ────────────────────────────────────────────────────────────── */

function RiskRow({
  ns,
  rank,
  isExpanded,
  onToggle,
}: {
  ns: NamespaceRisk;
  rank: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const levelStyle = LEVEL_BADGE_STYLES[ns.level] ?? LEVEL_BADGE_STYLES.medium;

  return (
    <>
      <motion.tr
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="group hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-6 py-3.5">
          <span className="text-sm font-bold tabular-nums text-muted-foreground">#{rank}</span>
        </td>
        <td className="px-6 py-3.5">
          <span className="text-sm font-semibold text-foreground">{ns.namespace}</span>
        </td>
        <td className="px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="w-20 h-2 bg-muted/50 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', getRiskBarColor(ns.risk_score))}
                style={{ width: `${ns.risk_score}%` }}
              />
            </div>
            <span className="text-sm font-bold tabular-nums text-foreground min-w-[2rem]">
              {Math.round(ns.risk_score)}
            </span>
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
          <span
            className={cn(
              'text-sm tabular-nums font-medium',
              ns.spof_count > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
            )}
          >
            {ns.spof_count}
          </span>
        </td>
        <td className="px-6 py-3.5">
          <span className="text-sm tabular-nums text-muted-foreground">
            {ns.avg_blast_radius.toFixed(1)}
          </span>
        </td>
        <td className="px-6 py-3.5">
          <span className="text-sm tabular-nums text-muted-foreground">
            {ns.cross_ns_dependencies}
          </span>
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
        {isExpanded && ns.top_risks.length > 0 && (
          <tr>
            <td colSpan={9} className="px-0 py-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-8 py-4 bg-muted/20 border-t border-b border-border/30">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Top Risks
                  </p>
                  <ul className="space-y-1.5">
                    {ns.top_risks.map((risk, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                        <AlertCircle className="h-3.5 w-3.5 text-orange-500 mt-0.5 shrink-0" />
                        {risk}
                      </li>
                    ))}
                  </ul>
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
  className,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const isActive = currentSort === sortKey;

  return (
    <th
      className={cn(
        'px-6 py-3.5 border-b border-border/50 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors',
        className,
      )}
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

export default function RiskRanking() {
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const [expandedNs, setExpandedNs] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('risk_score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [enabledLevels, setEnabledLevels] = useState<Set<string>>(new Set(ALL_LEVELS));

  // Pagination State
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const { data, isLoading, error } = useRiskRanking(currentClusterId);

  const handleSync = useCallback(() => {
    setIsSyncing(true);
    queryClient.invalidateQueries({ queryKey: ['risk-ranking'] });
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

  const toggleLevel = useCallback((level: string) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
    setPageIndex(0);
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

  const filteredAndSorted = useMemo(() => {
    if (!data?.namespaces) return [];
    const filtered = data.namespaces.filter((ns) => enabledLevels.has(ns.level));
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'rank':
        case 'risk_score':
          cmp = a.risk_score - b.risk_score;
          break;
        case 'namespace':
          cmp = a.namespace.localeCompare(b.namespace);
          break;
        case 'level': {
          const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
          cmp = (order[a.level] ?? 4) - (order[b.level] ?? 4);
          break;
        }
        case 'spof_count':
          cmp = a.spof_count - b.spof_count;
          break;
        case 'avg_blast_radius':
          cmp = a.avg_blast_radius - b.avg_blast_radius;
          break;
        case 'cross_ns_dependencies':
          cmp = a.cross_ns_dependencies - b.cross_ns_dependencies;
          break;
        case 'workload_count':
          cmp = a.workload_count - b.workload_count;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [data?.namespaces, sortKey, sortDir, enabledLevels]);

  // Calculate pagination
  const totalFiltered = filteredAndSorted.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = filteredAndSorted.slice(start, start + pageSize);

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

  const generatedAt = data?.generated_at
    ? new Date(data.generated_at).toLocaleString()
    : null;

  if (error) {
    return (
      <PageLayout label="Risk Ranking">
        <ApiError onRetry={() => queryClient.invalidateQueries({ queryKey: ['risk-ranking'] })} message={(error as Error)?.message} />
      </PageLayout>
    );
  }

  if (isLoading) {
    return <PageLoadingState message="Loading risk ranking..." />;
  }

  return (
    <PageLayout label="Risk Ranking">

        {/* Header */}
        <SectionOverviewHeader
          title="Namespace Risk Ranking"
          description="Risk-ordered view of all namespaces with blast radius and SPOF analysis."
          icon={ShieldAlert}
          iconClassName="from-amber-500/20 to-amber-500/5 text-amber-600 border-amber-500/10"
          onSync={handleSync}
          isSyncing={isSyncing}
          showAiButton={false}
          extraActions={
            generatedAt ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Generated {generatedAt}</span>
              </div>
            ) : undefined
          }
        />

        {/* Error state */}
        {error && (
          <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-300">
                Failed to load risk ranking
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                {error.message}
              </p>
            </div>
          </div>
        )}

        {/* Filter */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <Filter className="h-3.5 w-3.5" />
            Filter by level
          </div>
          {ALL_LEVELS.map((level) => (
            <label
              key={level}
              className="flex items-center gap-2 cursor-pointer select-none"
            >
              <Checkbox
                checked={enabledLevels.has(level)}
                onCheckedChange={() => toggleLevel(level)}
              />
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] uppercase tracking-wider font-semibold',
                  LEVEL_BADGE_STYLES[level],
                )}
              >
                {LEVEL_LABELS[level]}
              </Badge>
            </label>
          ))}
        </div>

        {/* Table */}
        <Card className="border-none soft-shadow glass-panel card-accent-warning overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted/30">
                  <SortHeader
                    label="Rank"
                    sortKey="rank"
                    currentSort={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    className="w-16"
                  />
                  <SortHeader
                    label="Namespace"
                    sortKey="namespace"
                    currentSort={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Risk Score"
                    sortKey="risk_score"
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
                    label="SPOFs"
                    sortKey="spof_count"
                    currentSort={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Avg Blast Radius"
                    sortKey="avg_blast_radius"
                    currentSort={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Cross-NS Deps"
                    sortKey="cross_ns_dependencies"
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
                  <th className="px-6 py-3.5 border-b border-border/50" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {itemsOnPage.map((ns, i) => (
                  <RiskRow
                    key={ns.namespace}
                    ns={ns}
                    rank={start + i + 1}
                    isExpanded={expandedNs.has(ns.namespace)}
                    onToggle={() => toggleExpand(ns.namespace)}
                  />
                ))}
                {filteredAndSorted.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <ShieldAlert className="h-10 w-10 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">
                          {data?.namespaces && data.namespaces.length > 0
                            ? 'No namespaces match the selected filters'
                            : 'No risk ranking data available'}
                        </p>
                        {data?.namespaces && data.namespaces.length > 0 && enabledLevels.size < ALL_LEVELS.length && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEnabledLevels(new Set(ALL_LEVELS))}
                          >
                            Show all levels
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {filteredAndSorted.length > 0 && (
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
    </PageLayout>
  );
}
