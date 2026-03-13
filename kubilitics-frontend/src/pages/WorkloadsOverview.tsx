import { useState, useCallback, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PodStatusDistribution } from '@/features/dashboard/components/PodStatusDistribution';
import { ClusterEfficiencyCard } from '@/components/dashboard/ClusterEfficiencyCard';
import {
  ListPagination,
  PAGE_SIZE_OPTIONS,
  ColumnVisibilityDropdown,
  TableColumnHeaderWithFilterAndSort,
  TableFilterCell,
  TableFilterProvider,
} from '@/components/list';
import {
  Activity,
  AlertTriangle,
  Search,
  Zap,
  Box,
  Layers,
  Container,
  Clock,
  ChevronRight,
  Loader2,
  AlertCircle,
  ChevronDown,
  Filter,
  PanelRightClose,
  PanelRightOpen,
  Info,
  ArrowUpRight
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useWorkloadsOverview } from '@/hooks/useWorkloadsOverview';
import { useClusterStore } from '@/stores/clusterStore';
import { getDetailPath } from '@/utils/resourceKindMapper';
import { ConnectionRequiredBanner } from '@/components/layout/ConnectionRequiredBanner';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { WorkloadPulse } from '@/components/workloads/WorkloadPulse';
import { PageLoadingState } from '@/components/PageLoadingState';

const KIND_ICONS: Record<string, typeof Container> = {
  Deployment: Container,
  StatefulSet: Layers,
  DaemonSet: Box,
  Job: Activity,
  CronJob: Clock,
};

const STATUS_COLORS: Record<string, string> = {
  Running: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  Healthy: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  Optimal: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  Completed: 'bg-[#326CE5]/10 text-[#326CE5] border-[#326CE5]/20',
  Scheduled: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
  'Scaled to Zero': 'bg-slate-500/10 text-slate-600 border-slate-500/20',
  Pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  Failed: 'bg-rose-500/10 text-rose-600 border-rose-500/20',
};

const PRESSURE_COLORS: Record<string, string> = {
  Low: 'text-emerald-500',
  Normal: 'text-emerald-500',
  Medium: 'text-amber-500',
  Elevated: 'text-amber-500',
  High: 'text-rose-500',
  Zero: 'text-muted-foreground',
  Idle: 'text-muted-foreground',
  Unknown: 'text-muted-foreground',
};

type WorkloadItem = {
  kind: string;
  name: string;
  namespace: string;
  status: string;
  ready: number;
  desired: number;
  pressure: string;
};

function getWorkloadKey(w: WorkloadItem): string {
  return `${w.kind}/${w.namespace}/${w.name}`;
}

const WORKLOADS_COLUMNS_FOR_VISIBILITY = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'status', label: 'Status' },
  { id: 'replicas', label: 'Replicas' },
  { id: 'pressure', label: 'Pressure' },
];

export default function WorkloadsOverview() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const queryClient = useQueryClient();
  const { activeCluster } = useClusterStore();
  const { data, isLoading, isError, refetch } = useWorkloadsOverview();

  const handleSync = useCallback(() => {
    setIsSyncing(true);
    queryClient.invalidateQueries({ queryKey: ['k8s'] });
    queryClient.invalidateQueries({ queryKey: ['backend', 'resources'] });
    queryClient.invalidateQueries({ queryKey: ['backend', 'workloads'] });
    queryClient.invalidateQueries({ queryKey: ['backend', 'clusterOverview'] });
    refetch();
    setTimeout(() => setIsSyncing(false), 1500);
  }, [queryClient, refetch]);

  const workloads: WorkloadItem[] = data?.workloads ?? [];
  const itemsAfterSearch = useMemo(() => {
    if (!searchQuery.trim()) return workloads;
    const q = searchQuery.toLowerCase();
    return workloads.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.namespace.toLowerCase().includes(q) ||
        w.kind.toLowerCase().includes(q)
    );
  }, [workloads, searchQuery]);

  const workloadsTableConfig: ColumnConfig<WorkloadItem>[] = useMemo(() => [
    { columnId: 'kind', getValue: (w) => w.kind, sortable: true, filterable: true },
    { columnId: 'name', getValue: (w) => w.name, sortable: true, filterable: false },
    { columnId: 'namespace', getValue: (w) => w.namespace || 'default', sortable: true, filterable: true },
    { columnId: 'status', getValue: (w) => w.status, sortable: true, filterable: true },
    {
      columnId: 'replicas',
      getValue: (w) => (w.desired > 0 ? `${w.ready}/${w.desired}` : '—'),
      sortable: true,
      filterable: false,
      compare: (a, b) => {
        const ra = a.desired > 0 ? a.ready / a.desired : 0;
        const rb = b.desired > 0 ? b.ready / b.desired : 0;
        return ra - rb;
      },
    },
    {
      columnId: 'pressure',
      getValue: (w) => {
        const p = w.pressure;
        return p === 'Low' || p === 'Normal' ? 'Normal' : p === 'Medium' || p === 'Elevated' ? 'Elevated' : p === 'Zero' || p === 'Idle' ? 'Idle' : p;
      },
      sortable: true,
      filterable: true,
    },
  ], []);

  const {
    filteredAndSortedItems: filteredWorkloads,
    distinctValuesByColumn,
    valueCountsByColumn,
    columnFilters,
    setColumnFilter,
    sortKey,
    sortOrder,
    setSort,
    clearAllFilters,
    hasActiveFilters,
  } = useTableFiltersAndSort(itemsAfterSearch, {
    columns: workloadsTableConfig,
    defaultSortKey: 'kind',
    defaultSortOrder: 'asc',
  });

  const columnVisibility = useColumnVisibility({
    tableId: 'workloads-overview',
    columns: WORKLOADS_COLUMNS_FOR_VISIBILITY,
    alwaysVisible: ['kind', 'name'],
  });

  const totalFiltered = filteredWorkloads.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = filteredWorkloads.slice(start, start + pageSize);

  useEffect(() => {
    if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
  }, [safePageIndex, pageIndex]);

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPageIndex(0);
  };

  const toggleSelection = (w: WorkloadItem) => {
    const key = getWorkloadKey(w);
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(itemsOnPage.map(getWorkloadKey)));
  };

  const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
  const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

  const pulse = data?.pulse;
  const alerts = data?.alerts;

  if (isLoading) {
    return <PageLoadingState message="Loading workload data..." />;
  }

  return (
    <div className="page-container" role="main" aria-label="Workloads Overview">
      <div className="page-inner p-6 gap-6 flex flex-col">
        <ConnectionRequiredBanner />

        {/* Header */}
        <SectionOverviewHeader
          title="Workloads Overview"
          description="Deployments, stateful sets, jobs, and other controllers running in your cluster."
          icon={Zap}
          onSync={handleSync}
          isSyncing={isSyncing}
        />

        {/* Hero Section: Workload Health Pulse */}
        <Card className="overflow-hidden border-slate-200/80 bg-white elevation-2" aria-live="polite">
          <CardHeader className="flex flex-row items-center justify-between pb-4 pt-8 px-8">
            <div>
              <CardTitle className="text-h4 text-slate-900">Workload Health</CardTitle>
              <p className="text-body-sm text-slate-500 mt-1">Overall health across all running workloads</p>
            </div>
            {pulse && (
              <div className="flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold uppercase tracking-wider border border-emerald-100">
                <span className="status-dot-live" />
                {pulse.optimal_percent >= 95 ? 'All Systems Nominal' : pulse.optimal_percent >= 80 ? 'Serviceable' : pulse.optimal_percent >= 60 ? 'Degraded' : 'Critical Failure'}
              </div>
            )}
          </CardHeader>
          <CardContent className="pt-2 pb-10 px-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
              <div className="relative">
                <WorkloadPulse data={pulse} />
                <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 h-1 w-24 bg-slate-100 rounded-full blur-[1px]" />
              </div>

              <div className="space-y-10 pr-4">
                <div className="relative pl-6">
                  <span className="block text-5xl font-bold text-slate-900 tracking-tighter leading-none">{pulse?.total ?? 0}</span>
                  <span className="label-xs mt-3 block">Total Workloads</span>
                  <div className="absolute left-0 top-1 bottom-1 w-1 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.3)]" />
                </div>

                <div className="grid grid-cols-3 gap-8 py-8 border-y border-slate-100 relative">
                  <div className="space-y-1.5">
                    <span className="label-xs block">Healthy</span>
                    <span className="text-2xl font-bold text-emerald-600">{pulse?.healthy ?? 0}</span>
                  </div>
                  <div className="space-y-1.5 border-l border-slate-100 pl-6">
                    <span className="label-xs block">Warning</span>
                    <span className="text-2xl font-bold text-amber-500">{pulse?.warning ?? 0}</span>
                  </div>
                  <div className="space-y-1.5 border-l border-slate-100 pl-6">
                    <span className="label-xs block">Critical</span>
                    <span className="text-2xl font-bold text-rose-600">{pulse?.critical ?? 0}</span>
                  </div>
                </div>

                <div className="pt-2">
                  <div className="flex items-center justify-between mb-4">
                    <span className="label-xs">Health Score</span>
                    <span className="text-sm font-bold text-emerald-600 tabular-nums">{pulse?.optimal_percent.toFixed(1)}%</span>
                  </div>
                  <div className="h-2.5 w-full bg-slate-50 rounded-full overflow-hidden p-0.5 border border-slate-100">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pulse?.optimal_percent ?? 0}%` }}
                      transition={{ duration: 1.2, ease: "circOut" }}
                      className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Resources Overview: Pod Distribution & Efficiency */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <Card className="lg:col-span-8 border-slate-200/80 overflow-hidden bg-white elevation-2">
            <PodStatusDistribution />
          </Card>
          <Card className="lg:col-span-4 border-slate-200/80 overflow-hidden bg-white elevation-2">
            <ClusterEfficiencyCard />
          </Card>
        </div>

        {/* Workloads Explorer */}
        <div className="section-card overflow-hidden !p-0">
          <div className="p-6 border-b border-slate-100">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-h5 text-slate-900">Workloads Explorer</h3>
                <p className="text-body-sm text-slate-500 mt-0.5">All controllers and their current state</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative flex-1 min-w-[300px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden />
                  <Input
                    placeholder="Search controllers..."
                    className="pl-10 bg-slate-50 border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500/10 focus:border-blue-300 h-10 text-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label="Search workload controllers"
                  />
                </div>
                <ColumnVisibilityDropdown
                  columns={WORKLOADS_COLUMNS_FOR_VISIBILITY}
                  visibleColumns={columnVisibility.visibleColumns}
                  onToggle={columnVisibility.setColumnVisible}
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80">
                  <th className="px-6 py-3.5 border-b border-slate-100 w-10">
                    <Checkbox checked={isAllSelected} onCheckedChange={toggleAll} />
                  </th>
                  <th className="px-6 py-3.5 table-header-cell border-b border-slate-100">Controller</th>
                  <th className="px-6 py-3.5 table-header-cell border-b border-slate-100">Namespace</th>
                  <th className="px-6 py-3.5 table-header-cell border-b border-slate-100">Status</th>
                  <th className="px-6 py-3.5 table-header-cell border-b border-slate-100 text-right">Replicas</th>
                  <th className="px-6 py-3.5 table-header-cell border-b border-slate-100 text-right">Pressure</th>
                  <th className="px-6 py-3.5 border-b border-slate-100"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {itemsOnPage.map((w, i) => {
                  const Icon = KIND_ICONS[w.kind] ?? Container;
                  const detailPath = getDetailPath(w.kind, w.name, w.namespace);
                  const isSelected = selectedItems.has(getWorkloadKey(w));

                  return (
                    <motion.tr
                      key={getWorkloadKey(w)}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className={cn("group hover:bg-slate-50/80 transition-colors", isSelected && "bg-blue-50/40")}
                    >
                      <td className="px-6 py-3.5">
                        <Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(w)} />
                      </td>
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <Link to={detailPath || '#'} className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors block leading-tight">
                              {w.name}
                            </Link>
                            <span className="label-xs text-xs mt-0.5 block">{w.kind}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className="font-mono text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md">
                          {w.namespace}
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <Badge variant="outline" className={cn("text-xs uppercase tracking-wider font-semibold",
                          w.status === 'Running' || w.status === 'Healthy' ? "text-emerald-600 border-emerald-100 bg-emerald-50" :
                          w.status === 'Failed' ? "text-rose-600 border-rose-100 bg-rose-50" :
                          w.status === 'Pending' ? "text-amber-600 border-amber-100 bg-amber-50" :
                          "text-blue-600 border-blue-100 bg-blue-50")}>
                          {w.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <span className="font-mono text-xs font-semibold text-slate-600">
                          {w.desired > 0 ? `${w.ready}/${w.desired}` : '—'}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <span className={cn("text-xs font-semibold uppercase tracking-wider", PRESSURE_COLORS[w.pressure])}>
                          {w.pressure}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-white hover:text-blue-600 hover:shadow-sm rounded-lg transition-all border border-transparent hover:border-slate-200 press-effect">
                          <ArrowUpRight className="h-4 w-4" aria-hidden />
                        </Button>
                      </td>
                    </motion.tr>
                  );
                })}
                {itemsOnPage.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Container className="h-8 w-8 text-muted-foreground/40" />
                        <p className="text-sm font-medium text-muted-foreground">
                          {searchQuery ? 'No workloads match your search.' : 'No workloads found in the cluster.'}
                        </p>
                        {searchQuery && (
                          <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')} className="mt-1 text-xs">
                            Clear search
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-4">
            <ListPagination
              rangeLabel={`${totalFiltered} ${totalFiltered === 1 ? 'workload' : 'workloads'}`}
              hasPrev={safePageIndex > 0}
              hasNext={start + pageSize < totalFiltered}
              onPrev={() => setPageIndex((i) => Math.max(0, i - 1))}
              onNext={() => setPageIndex((i) => Math.min(totalPages - 1, i + 1))}
              currentPage={safePageIndex + 1}
              totalPages={totalPages}
              onPageChange={(p) => setPageIndex(p - 1)}
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild className="h-9 px-4 font-medium border-slate-200 text-slate-600 hover:bg-white hover:text-blue-600 rounded-xl transition-all press-effect">
                <Link to="/deployments">Deployments</Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="h-9 px-4 font-medium border-slate-200 text-slate-600 hover:bg-white hover:text-blue-600 rounded-xl transition-all press-effect">
                <Link to="/statefulsets">StatefulSets</Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="h-9 px-4 font-medium border-slate-200 text-slate-600 hover:bg-white hover:text-blue-600 rounded-xl transition-all press-effect">
                <Link to="/pods">All Pods</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
