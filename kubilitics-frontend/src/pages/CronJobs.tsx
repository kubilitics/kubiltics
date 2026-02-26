import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Filter, RefreshCw, MoreHorizontal, CheckCircle2, XCircle, Clock, Loader2, WifiOff, Plus,
  ChevronDown, ChevronRight, CheckSquare, Trash2, FileText, Play, Pause, Timer, List, Layers, Box, Gauge, CalendarCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ResizableTableProvider, ResizableTableHead, ResizableTableCell, type ResizableColumnConfig } from '@/components/ui/resizable-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { useK8sResourceList, useDeleteK8sResource, usePatchK8sResource, useCreateK8sResource, calculateAge, useCronJobChildJobs, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { postCronJobTrigger } from '@/services/backendApiClient';
import { DeleteConfirmDialog } from '@/components/resources';
import { ResourceExportDropdown, ListViewSegmentedControl, ListPagination, PAGE_SIZE_OPTIONS, ResourceCommandBar, resourceTableRowClassName, ROW_MOTION, StatusPill, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, AgeCell, TableEmptyState, TableSkeletonRows, CopyNameDropdownItem, NamespaceBadge, ResourceListTableToolbar } from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import type { StatusPillVariant } from '@/components/list';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { toast } from 'sonner';
import { CronJobIcon } from '@/components/icons/KubernetesIcons';

interface CronJobResource extends KubernetesResource {
  spec: {
    schedule: string;
    suspend?: boolean;
    concurrencyPolicy?: string;
    successfulJobsHistoryLimit?: number;
    failedJobsHistoryLimit?: number;
  };
  status: {
    lastScheduleTime?: string;
    lastSuccessfulTime?: string;
    lastFailedTime?: string;
    active?: Array<unknown>;
    conditions?: Array<{ type: string; status: string }>;
  };
}

interface CronJob {
  name: string;
  namespace: string;
  status: 'Active' | 'Suspended';
  schedule: string;
  scheduleHuman: string;
  lastSchedule: string;
  nextSchedule: string;
  active: number;
  concurrencyPolicy: string;
  suspend: boolean;
  historyLimit: number;
  lastResult: string;
  successRate7d: string;
  age: string;
  creationTimestamp?: string;
}

const statusConfig = {
  Active: { icon: CheckCircle2, color: 'text-[hsl(142,76%,36%)]', bg: 'bg-[hsl(142,76%,36%)]/10' },
  Suspended: { icon: Pause, color: 'text-[hsl(45,93%,47%)]', bg: 'bg-[hsl(45,93%,47%)]/10' },
};

const CRONJOBS_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'expand', defaultWidth: 40, minWidth: 36 },
  { id: 'name', defaultWidth: 200, minWidth: 120 },
  { id: 'namespace', defaultWidth: 140, minWidth: 100 },
  { id: 'status', defaultWidth: 120, minWidth: 90 },
  { id: 'schedule', defaultWidth: 160, minWidth: 100 },
  { id: 'lastSchedule', defaultWidth: 140, minWidth: 115 },
  { id: 'nextSchedule', defaultWidth: 140, minWidth: 115 },
  { id: 'active', defaultWidth: 100, minWidth: 75 },
  { id: 'concurrencyPolicy', defaultWidth: 200, minWidth: 160 },
  { id: 'suspend', defaultWidth: 100, minWidth: 80 },
  { id: 'historyLimit', defaultWidth: 140, minWidth: 115 },
  { id: 'lastResult', defaultWidth: 130, minWidth: 105 },
  { id: 'age', defaultWidth: 100, minWidth: 65 },
];

const CRONJOBS_COLUMNS_FOR_VISIBILITY = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'status', label: 'Status' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'lastSchedule', label: 'Last Schedule' },
  { id: 'nextSchedule', label: 'Next Schedule' },
  { id: 'active', label: 'Active' },
  { id: 'concurrencyPolicy', label: 'Concurrency Policy' },
  { id: 'suspend', label: 'Suspend' },
  { id: 'historyLimit', label: 'History Limit' },
  { id: 'lastResult', label: 'Last Result' },
  { id: 'age', label: 'Age' },
];

const cronJobStatusToVariant: Record<CronJob['status'], StatusPillVariant> = {
  Active: 'success',
  Suspended: 'warning',
};

function cronScheduleToHuman(schedule: string): string {
  if (!schedule || schedule === '-') return '-';
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return schedule;
  const [min, hour, day, month, weekday] = parts;
  if (min.startsWith('*/') && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    const n = parseInt(min.slice(2), 10);
    if (n === 1) return 'Every minute';
    if (n <= 60) return `Every ${n} min`;
  }
  if (min === '*' && hour.startsWith('*/') && day === '*' && month === '*' && weekday === '*') {
    const n = parseInt(hour.slice(2), 10);
    if (n === 1) return 'Every hour';
    return `Every ${n}h`;
  }
  return schedule;
}

function cronNextRun(schedule: string): string {
  if (!schedule || schedule === '-') return '-';
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return '-';
  const [minPart, hour, day, month, weekday] = parts;
  const now = new Date();
  if (minPart.startsWith('*/') && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    const n = parseInt(minPart.slice(2), 10);
    if (!Number.isFinite(n) || n < 1) return '-';
    const currMin = now.getMinutes();
    const nextMin = Math.ceil((currMin + 1) / n) * n;
    const next = new Date(now);
    if (nextMin >= 60) {
      next.setMinutes(0);
      next.setHours(next.getHours() + 1);
    } else {
      next.setMinutes(nextMin);
    }
    const secs = Math.round((next.getTime() - now.getTime()) / 1000);
    if (secs < 60) return 'in <1m';
    if (secs < 3600) return `in ${Math.floor(secs / 60)}m`;
    return next.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return '-';
}

function transformResource(resource: CronJobResource): CronJob {
  const spec = resource.spec;
  const status = resource.status;
  const schedule = spec?.schedule || '-';
  let lastSchedule = '-';
  if (status?.lastScheduleTime) {
    const diff = Date.now() - new Date(status.lastScheduleTime).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) lastSchedule = `${mins}m ago`;
    else if (mins < 1440) lastSchedule = `${Math.floor(mins / 60)}h ago`;
    else lastSchedule = `${Math.floor(mins / 1440)}d ago`;
  }
  const successfulLimit = spec?.successfulJobsHistoryLimit ?? 3;
  const failedLimit = spec?.failedJobsHistoryLimit ?? 1;
  const historyLimit = successfulLimit + failedLimit;
  const hasFailedCondition = status?.conditions?.some((c) => c.type === 'Failed' && c.status === 'True');
  const lastResult = status?.active?.length ? 'Running' : hasFailedCondition ? 'Failed' : status?.lastSuccessfulTime ? 'Success' : '–';
  return {
    name: resource.metadata.name,
    namespace: resource.metadata.namespace || 'default',
    status: spec?.suspend ? 'Suspended' : 'Active',
    schedule,
    scheduleHuman: cronScheduleToHuman(schedule),
    lastSchedule,
    nextSchedule: spec?.suspend ? '—' : cronNextRun(schedule),
    active: status?.active?.length || 0,
    concurrencyPolicy: spec?.concurrencyPolicy || 'Allow',
    suspend: !!spec?.suspend,
    historyLimit,
    lastResult,
    successRate7d: '-',
    age: calculateAge(resource.metadata.creationTimestamp),
    creationTimestamp: resource.metadata?.creationTimestamp,
  };
}

type ListView = 'flat' | 'byNamespace';

export default function CronJobs() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: CronJob | null; bulk?: boolean }>({ open: false, item: null });
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [listView, setListView] = useState<ListView>('flat');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  const { isConnected } = useConnectionStatus();
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<CronJobResource>('cronjobs', undefined, { limit: 5000 });
  const deleteResource = useDeleteK8sResource('cronjobs');
  const patchCronJob = usePatchK8sResource('cronjobs');
  const createResource = useCreateK8sResource('cronjobs');

  const items: CronJob[] = isConnected && data ? (data.items ?? []).map(transformResource) : [];

  const [expandedNs, expandedName] = expandedRow ? expandedRow.split('/') : [null, null];
  const { data: childJobsData, isLoading: childJobsLoading } = useCronJobChildJobs(
    expandedNs ?? '',
    expandedName ?? '',
    !!expandedRow && !!expandedNs && !!expandedName
  );
  const childJobs = childJobsData ?? [];

  const stats = useMemo(() => {
    const activeCount = items.filter((i) => i.active > 0).length;
    const onSchedule = items.filter((i) => i.lastSchedule !== '-').length;
    return {
      total: items.length,
      active: activeCount,
      suspended: items.filter((i) => i.status === 'Suspended').length,
      onSchedule,
      overdue: 0,
      successRate7d: '-',
    };
  }, [items]);
  const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map(i => i.namespace)))], [items]);

  const itemsAfterSearchAndNs = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.namespace.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesNamespace = selectedNamespace === 'all' || item.namespace === selectedNamespace;
      return matchesSearch && matchesNamespace;
    });
  }, [items, searchQuery, selectedNamespace]);

  const cronJobsTableConfig = useMemo(() => ({
    defaultSortKey: 'name' as const,
    defaultSortOrder: 'asc' as const,
    columns: [
      { columnId: 'name', getValue: (c: CronJob) => c.name, sortable: true, filterable: true },
      { columnId: 'namespace', getValue: (c: CronJob) => c.namespace, sortable: true, filterable: true },
      { columnId: 'status', getValue: (c: CronJob) => c.status, sortable: true, filterable: true },
      { columnId: 'hasActiveJobs', getValue: (c: CronJob) => c.active > 0 ? 'Yes' : 'No', sortable: true, filterable: true },
      { columnId: 'schedule', getValue: (c: CronJob) => c.schedule, sortable: true, filterable: false },
      { columnId: 'lastSchedule', getValue: (c: CronJob) => c.lastSchedule, sortable: true, filterable: false },
      { columnId: 'nextSchedule', getValue: (c: CronJob) => c.nextSchedule, sortable: true, filterable: false },
      { columnId: 'active', getValue: (c: CronJob) => c.active, sortable: true, filterable: false },
      { columnId: 'concurrencyPolicy', getValue: (c: CronJob) => c.concurrencyPolicy, sortable: true, filterable: true },
      { columnId: 'suspend', getValue: (c: CronJob) => c.suspend, sortable: true, filterable: false },
      { columnId: 'historyLimit', getValue: (c: CronJob) => c.historyLimit, sortable: true, filterable: false },
      { columnId: 'lastResult', getValue: (c: CronJob) => c.lastResult, sortable: true, filterable: false },
      { columnId: 'age', getValue: (c: CronJob) => c.age, sortable: true, filterable: false },
    ] as ColumnConfig<CronJob>[],
  }), []);

  const {
    filteredAndSortedItems: filteredItems,
    distinctValuesByColumn,
    valueCountsByColumn,
    columnFilters,
    setColumnFilter,
    sortKey,
    sortOrder,
    setSort,
    clearAllFilters,
    hasActiveFilters,
  } = useTableFiltersAndSort(itemsAfterSearchAndNs, cronJobsTableConfig);

  const columnVisibility = useColumnVisibility({
    tableId: 'cronjobs',
    columns: CRONJOBS_COLUMNS_FOR_VISIBILITY,
    alwaysVisible: ['name'],
  });

  const totalFiltered = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = filteredItems.slice(start, start + pageSize);

  const groupedOnPage = useMemo(() => {
    if (listView !== 'byNamespace' || itemsOnPage.length === 0) return [];
    const map = new Map<string, CronJob[]>();
    for (const item of itemsOnPage) {
      const list = map.get(item.namespace) ?? [];
      list.push(item);
      map.set(item.namespace, list);
    }
    return Array.from(map.entries())
      .map(([label, list]) => ({ groupKey: `ns:${label}`, label, list }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [listView, itemsOnPage]);

  useEffect(() => {
    if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
  }, [safePageIndex, pageIndex]);

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPageIndex(0);
  };

  const pagination = {
    rangeLabel: totalFiltered > 0
      ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}`
      : 'No cronjobs',
    hasPrev: safePageIndex > 0,
    hasNext: start + pageSize < totalFiltered,
    onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
    onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
    currentPage: safePageIndex + 1,
    totalPages: Math.max(1, totalPages),
    onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
  };

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const handleDelete = async () => {
    if (!isConnected) {
      toast.error('Connect cluster to delete cronjobs');
      setDeleteDialog({ open: false, item: null });
      return;
    }
    if (deleteDialog.bulk && selectedItems.size > 0) {
      for (const key of selectedItems) {
        const [ns, n] = key.split('/');
        if (n && ns) await deleteResource.mutateAsync({ name: n, namespace: ns });
      }
      toast.success(`Deleted ${selectedItems.size} cronjob(s)`);
      setSelectedItems(new Set());
    } else if (deleteDialog.item) {
      await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
      toast.success(`CronJob ${deleteDialog.item.name} deleted`);
    }
    setDeleteDialog({ open: false, item: null });
  };

  const cronJobExportConfig = {
    filenamePrefix: 'cronjobs',
    resourceLabel: 'cronjobs',
    getExportData: (c: CronJob) => ({ name: c.name, namespace: c.namespace, status: c.status, schedule: c.schedule, lastSchedule: c.lastSchedule, nextSchedule: c.nextSchedule, active: c.active, concurrencyPolicy: c.concurrencyPolicy, suspend: c.suspend, historyLimit: c.historyLimit, lastResult: c.lastResult, age: c.age }),
    csvColumns: [
      { label: 'Name', getValue: (c: CronJob) => c.name },
      { label: 'Namespace', getValue: (c: CronJob) => c.namespace },
      { label: 'Status', getValue: (c: CronJob) => c.status },
      { label: 'Schedule', getValue: (c: CronJob) => c.schedule },
      { label: 'Last Schedule', getValue: (c: CronJob) => c.lastSchedule },
      { label: 'Active', getValue: (c: CronJob) => c.active },
      { label: 'Age', getValue: (c: CronJob) => c.age },
    ],
    toK8sYaml: (c: CronJob) => `---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ${c.name}
  namespace: ${c.namespace}
spec:
  schedule: "${c.schedule}"
  jobTemplate:
    spec:
      template:
        spec:
          containers: []
          restartPolicy: OnFailure
`,
  };

  const toggleSelection = (item: CronJob) => { const key = `${item.namespace}/${item.name}`; const newSel = new Set(selectedItems); if (newSel.has(key)) newSel.delete(key); else newSel.add(key); setSelectedItems(newSel); };
  const toggleAll = () => { if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set()); else setSelectedItems(new Set(itemsOnPage.map(i => `${i.namespace}/${i.name}`))); };
  const handleTriggerNow = async (item: CronJob) => {
    if (!isConnected) { toast.error('Connect cluster to trigger CronJob'); return; }
    if (!isBackendConfigured()) {
      toast.error('Connect to Kubilitics backend and select a cluster to trigger CronJob.');
      return;
    }
    const cid = useBackendConfigStore.getState().currentClusterId;
    if (!cid) {
      toast.error('Select a cluster from the cluster list to perform this action.');
      return;
    }
    const backendBase = getEffectiveBackendBaseUrl(useBackendConfigStore.getState().backendBaseUrl);
    try {
      await postCronJobTrigger(backendBase, cid, item.namespace, item.name);
      toast.success(`Triggered Job from CronJob ${item.name}`);
      refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg ?? 'Trigger failed');
    }
  };
  const handleToggleSuspend = async (item: CronJob) => {
    if (!isConnected) { toast.error('Connect cluster to suspend/resume CronJob'); return; }
    try {
      await patchCronJob.mutateAsync({
        name: item.name,
        namespace: item.namespace,
        patch: { spec: { suspend: item.status !== 'Suspended' } },
      });
      toast.success(item.status === 'Active' ? `Suspended ${item.name}` : `Resumed ${item.name}`);
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to update');
    }
  };

  const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
  const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <ListPageHeader
        icon={<CronJobIcon className="h-6 w-6 text-primary" />}
        title="CronJobs"
        resourceCount={filteredItems.length}
        subtitle={namespaces.length > 1 ? `across ${namespaces.length - 1} namespaces` : undefined}
        demoMode={!isConnected}
        isLoading={isLoading}
        onRefresh={() => refetch()}
        createLabel="Create CronJob"
        onCreate={() => setShowCreateWizard(true)}
        actions={
          <>
            <ResourceExportDropdown
              items={filteredItems}
              selectedKeys={selectedItems}
              getKey={(i) => `${i.namespace}/${i.name}`}
              config={cronJobExportConfig}
              selectionLabel={selectedItems.size > 0 ? 'Selected cronjobs' : 'All visible cronjobs'}
              onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
            />
            {selectedItems.size > 0 && (
              <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}><Trash2 className="h-4 w-4" />Delete</Button>
            )}
          </>
        }
        leftExtra={selectedItems.size > 0 ? (
          <div className="flex items-center gap-2 ml-2 pl-2 border-l border-border">
            <span className="text-sm text-muted-foreground">{selectedItems.size} selected</span>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelectedItems(new Set())}>Clear</Button>
          </div>
        ) : undefined}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <ListPageStatCard label="Total" value={stats.total} icon={CronJobIcon as any} iconColor="text-primary" selected={!columnFilters.status?.size} onClick={() => setColumnFilter('status', null)} className={cn(!columnFilters.status?.size && 'ring-2 ring-primary')} />
        <ListPageStatCard label="Active" value={stats.active} icon={Clock} iconColor="text-cyan-500" valueClassName="text-cyan-600" selected={columnFilters.hasActiveJobs?.size === 1 && columnFilters.hasActiveJobs.has('Yes')} onClick={() => setColumnFilter('hasActiveJobs', new Set(['Yes']))} className={cn(columnFilters.hasActiveJobs?.size === 1 && columnFilters.hasActiveJobs.has('Yes') && 'ring-2 ring-cyan-500')} />
        <ListPageStatCard label="Suspended" value={stats.suspended} icon={Pause} iconColor="text-[hsl(45,93%,47%)]" valueClassName="text-[hsl(45,93%,47%)]" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Suspended')} onClick={() => setColumnFilter('status', new Set(['Suspended']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Suspended') && 'ring-2 ring-[hsl(45,93%,47%)]')} />
        <ListPageStatCard label="On Schedule" value={stats.onSchedule} icon={CalendarCheck} iconColor="text-[hsl(142,76%,36%)]" valueClassName="text-[hsl(142,76%,36%)]" />
        <ListPageStatCard label="Overdue" value={stats.overdue} icon={Timer} iconColor="text-muted-foreground" />
        <ListPageStatCard label="Success Rate (7d)" value={stats.successRate7d} icon={Gauge} iconColor="text-muted-foreground" />
      </div>

      <ResourceListTableToolbar
        globalFilterBar={
          <ResourceCommandBar
            scope={
              <div className="w-full min-w-0">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full min-w-0 justify-between h-10 gap-2 rounded-lg border border-border bg-background font-medium shadow-sm hover:bg-muted/50 hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary/20">
                      <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{selectedNamespace === 'all' ? 'All Namespaces' : selectedNamespace}</span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {namespaces.map((ns) => (
                      <DropdownMenuItem key={ns} onClick={() => setSelectedNamespace(ns)} className={cn(selectedNamespace === ns && 'bg-accent')}>
                        {ns === 'all' ? 'All Namespaces' : ns}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            }
            search={
              <div className="relative w-full min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search cronjobs..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all" aria-label="Search cronjobs" />
              </div>
            }
            structure={<ListViewSegmentedControl value={listView} onChange={(v) => setListView(v as ListView)} options={[{ id: 'flat', label: 'Flat', icon: List }, { id: 'byNamespace', label: 'By Namespace', icon: Layers }]} label="" ariaLabel="List structure" />}
            className="mb-0"
          />
        }
        hasActiveFilters={hasActiveFilters}
        onClearAllFilters={clearAllFilters}
        showTableFilters={showTableFilters}
        onToggleTableFilters={() => setShowTableFilters((v) => !v)}
        columns={CRONJOBS_COLUMNS_FOR_VISIBILITY}
        visibleColumns={columnVisibility.visibleColumns}
        onColumnToggle={columnVisibility.setColumnVisible}
        footer={
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">{pagination.rangeLabel}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    {pageSize} per page
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <DropdownMenuItem key={size} onClick={() => handlePageSizeChange(size)} className={cn(pageSize === size && 'bg-accent')}>
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
              dataUpdatedAt={dataUpdatedAt}
              isFetching={isFetching}
            />
          </div>
        }
      >
        <ResizableTableProvider tableId="cronjobs" columnConfig={CRONJOBS_TABLE_COLUMNS}>
          <Table className="table-fixed" style={{ minWidth: 1810 }}>
            <TableHeader><TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
              <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
              <ResizableTableHead columnId="expand">
                <span className="sr-only">Expand</span>
              </ResizableTableHead>
              <ResizableTableHead columnId="name">
                <TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="namespace">
                <TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="status">
                <TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="schedule">
                <TableColumnHeaderWithFilterAndSort columnId="schedule" label="Schedule" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="lastSchedule">
                <TableColumnHeaderWithFilterAndSort columnId="lastSchedule" label="Last Schedule" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="nextSchedule">
                <TableColumnHeaderWithFilterAndSort columnId="nextSchedule" label="Next Schedule" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="active">
                <TableColumnHeaderWithFilterAndSort columnId="active" label="Active Jobs" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="concurrencyPolicy">
                <TableColumnHeaderWithFilterAndSort columnId="concurrencyPolicy" label="Concurrency" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="suspend">
                <TableColumnHeaderWithFilterAndSort columnId="suspend" label="Suspend" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="historyLimit">
                <TableColumnHeaderWithFilterAndSort columnId="historyLimit" label="History Limit" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="lastResult">
                <TableColumnHeaderWithFilterAndSort columnId="lastResult" label="Last Result" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="age">
                <TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
            </TableRow>
              {showTableFilters && (
                <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
                  <TableCell className="w-10 p-1.5" />
                  <ResizableTableCell columnId="expand" className="p-1.5" />
                  <ResizableTableCell columnId="name" className="p-1.5">
                    <TableFilterCell columnId="name" label="Name" distinctValues={distinctValuesByColumn.name ?? []} selectedFilterValues={columnFilters.name ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.name} />
                  </ResizableTableCell>
                  <ResizableTableCell columnId="namespace" className="p-1.5">
                    <TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} />
                  </ResizableTableCell>
                  <ResizableTableCell columnId="status" className="p-1.5">
                    <TableFilterCell columnId="status" label="Status" distinctValues={distinctValuesByColumn.status ?? []} selectedFilterValues={columnFilters.status ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.status} />
                  </ResizableTableCell>
                  <ResizableTableCell columnId="schedule" className="p-1.5" />
                  <ResizableTableCell columnId="lastSchedule" className="p-1.5" />
                  <ResizableTableCell columnId="nextSchedule" className="p-1.5" />
                  <ResizableTableCell columnId="active" className="p-1.5">
                    <TableFilterCell columnId="hasActiveJobs" label="Has Active Jobs" distinctValues={distinctValuesByColumn.hasActiveJobs ?? []} selectedFilterValues={columnFilters.hasActiveJobs ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.hasActiveJobs} />
                  </ResizableTableCell>
                  <ResizableTableCell columnId="concurrencyPolicy" className="p-1.5">
                    <TableFilterCell columnId="concurrencyPolicy" label="Concurrency Policy" distinctValues={distinctValuesByColumn.concurrencyPolicy ?? []} selectedFilterValues={columnFilters.concurrencyPolicy ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.concurrencyPolicy} />
                  </ResizableTableCell>
                  <ResizableTableCell columnId="suspend" className="p-1.5" />
                  <ResizableTableCell columnId="historyLimit" className="p-1.5" />
                  <ResizableTableCell columnId="lastResult" className="p-1.5" />
                  <ResizableTableCell columnId="age" className="p-1.5" />
                  <TableCell className="w-12 p-1.5" />
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {isLoading && isConnected ? (
                <TableSkeletonRows columnCount={15} />
              ) : itemsOnPage.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={16} className="h-40 text-center">
                    <TableEmptyState
                      icon={<Timer className="h-8 w-8" />}
                      title="No CronJobs found"
                      subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Get started by creating a CronJob for scheduled jobs.'}
                      hasActiveFilters={!!(searchQuery || hasActiveFilters)}
                      onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
                      createLabel="Create CronJob"
                      onCreate={() => setShowCreateWizard(true)}
                    />
                  </TableCell>
                </TableRow>
              ) : listView === 'flat' ? itemsOnPage.flatMap((item, idx) => {
                const StatusIcon = statusConfig[item.status]?.icon || Clock;
                const key = `${item.namespace}/${item.name}`;
                const isSelected = selectedItems.has(key);
                const isExpanded = expandedRow === key;
                return [
                  <motion.tr key={key} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
                    <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(item)} /></TableCell>
                    <ResizableTableCell columnId="expand">
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setExpandedRow(isExpanded ? null : key)} aria-label={isExpanded ? 'Collapse' : 'Expand'} aria-expanded={isExpanded}>
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </ResizableTableCell>
                    <ResizableTableCell columnId="name"><Link to={`/cronjobs/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate"><CronJobIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="truncate">{item.name}</span></Link></ResizableTableCell>
                    <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} className="font-normal truncate block w-fit max-w-full" /></ResizableTableCell>
                    <ResizableTableCell columnId="status"><StatusPill label={item.status} variant={cronJobStatusToVariant[item.status]} icon={StatusIcon} /></ResizableTableCell>
                    <ResizableTableCell columnId="schedule" className="min-w-0" title={item.schedule}><span className="text-xs truncate block">{item.scheduleHuman !== '-' ? item.scheduleHuman : item.schedule}</span></ResizableTableCell>
                    <ResizableTableCell columnId="lastSchedule" className="text-muted-foreground whitespace-nowrap text-sm">{item.lastSchedule}</ResizableTableCell>
                    <ResizableTableCell columnId="nextSchedule" className="text-muted-foreground whitespace-nowrap text-sm">{item.nextSchedule}</ResizableTableCell>
                    <ResizableTableCell columnId="active" className="font-mono text-sm">{item.active}</ResizableTableCell>
                    <ResizableTableCell columnId="concurrencyPolicy">
                      <Badge
                        variant={item.concurrencyPolicy === 'Allow' ? 'default' : item.concurrencyPolicy === 'Forbid' ? 'secondary' : 'destructive'}
                        className={cn('font-mono text-xs', item.concurrencyPolicy === 'Forbid' && 'bg-amber-500/90 text-white border-0')}
                      >
                        {item.concurrencyPolicy}
                      </Badge>
                    </ResizableTableCell>
                    <ResizableTableCell columnId="suspend">
                      <Badge variant={item.suspend ? 'secondary' : 'outline'} className="text-xs">{item.suspend ? 'Yes' : 'No'}</Badge>
                    </ResizableTableCell>
                    <ResizableTableCell columnId="historyLimit" className="font-mono text-sm">{item.historyLimit}</ResizableTableCell>
                    <ResizableTableCell columnId="lastResult">
                      {item.lastResult !== '–' ? (
                        <StatusPill
                          label={item.lastResult}
                          variant={item.lastResult === 'Success' ? 'success' : item.lastResult === 'Failed' ? 'error' : 'warning'}
                          icon={item.lastResult === 'Success' ? CheckCircle2 : item.lastResult === 'Failed' ? XCircle : Play}
                        />
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </ResizableTableCell>
                    <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>
                    <TableCell>
                      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="CronJob actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <CopyNameDropdownItem name={item.name} namespace={item.namespace} />
                          <DropdownMenuItem onClick={() => navigate(`/cronjobs/${item.namespace}/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleTriggerNow(item)} className="gap-2" disabled={!isConnected}><Play className="h-4 w-4" />Trigger Now</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleToggleSuspend(item)} className="gap-2" disabled={!isConnected}>{item.status === 'Active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{item.status === 'Active' ? 'Suspend' : 'Resume'}</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/jobs?namespace=${item.namespace}`)} className="gap-2"><Box className="h-4 w-4" />View Jobs</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/cronjobs/${item.namespace}/${item.name}?tab=logs`)} className="gap-2"><FileText className="h-4 w-4" />View Last Job Logs</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/cronjobs/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
                          <DropdownMenuSeparator /><DropdownMenuItem className="gap-2 text-[hsl(0,72%,51%)]" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </motion.tr>,
                  ...(isExpanded ? [
                    <TableRow key={`${key}-jobs`} className="bg-muted/20 hover:bg-muted/20 border-b border-border/60">
                      <TableCell colSpan={16} className="p-0 align-top">
                        <div className="pl-14 pr-4 py-3">
                          <div className="text-xs font-medium text-muted-foreground mb-2">Recent Jobs (last 5)</div>
                          {childJobsLoading ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading jobs…</div>
                          ) : childJobs.length === 0 ? (
                            <div className="text-sm text-muted-foreground">No jobs yet</div>
                          ) : (
                            <Table>
                              <TableHeader><TableRow className="border-0 hover:bg-transparent">
                                <TableHead className="h-8 text-xs font-medium text-muted-foreground">Job Name</TableHead>
                                <TableHead className="h-8 text-xs font-medium text-muted-foreground">Status</TableHead>
                                <TableHead className="h-8 text-xs font-medium text-muted-foreground">Start Time</TableHead>
                                <TableHead className="h-8 text-xs font-medium text-muted-foreground">Duration</TableHead>
                              </TableRow></TableHeader>
                              <TableBody>
                                {childJobs.map((job) => (
                                  <TableRow key={job.name} className="border-0 hover:bg-muted/30" onClick={() => navigate(`/jobs/${job.namespace}/${job.name}`)}>
                                    <TableCell className="py-1.5 text-sm"><Link to={`/jobs/${job.namespace}/${job.name}`} className="text-primary hover:underline font-medium" onClick={(e) => e.stopPropagation()}>{job.name}</Link></TableCell>
                                    <TableCell className="py-1.5"><StatusPill label={job.status} variant={job.status === 'Complete' ? 'success' : job.status === 'Failed' ? 'error' : 'warning'} icon={job.status === 'Complete' ? CheckCircle2 : job.status === 'Failed' ? XCircle : Clock} /></TableCell>
                                    <TableCell className="py-1.5 text-sm text-muted-foreground">{job.startTime !== '-' ? new Date(job.startTime).toLocaleString() : '-'}</TableCell>
                                    <TableCell className="py-1.5 text-sm font-mono">{job.duration}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>,
                  ] : []),
                ];
              }) : groupedOnPage.flatMap((group) => {
                const isCollapsed = collapsedGroups.has(group.groupKey);
                return [
                  <TableRow key={group.groupKey} className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-b border-border" onClick={() => toggleGroup(group.groupKey)}>
                    <TableCell colSpan={16} className="py-2 font-medium">
                      <div className="flex items-center gap-2">
                        {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                        Namespace: {group.label}
                        <span className="text-muted-foreground font-normal">({group.list.length})</span>
                      </div>
                    </TableCell>
                  </TableRow>,
                  ...(isCollapsed ? [] : group.list.flatMap((item, idx) => {
                    const StatusIcon = statusConfig[item.status]?.icon || Clock;
                    const key = `${item.namespace}/${item.name}`;
                    const isSelected = selectedItems.has(key);
                    const isExpanded = expandedRow === key;
                    return [
                      <motion.tr key={key} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
                        <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(item)} /></TableCell>
                        <ResizableTableCell columnId="expand">
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setExpandedRow(isExpanded ? null : key)} aria-label={isExpanded ? 'Collapse' : 'Expand'} aria-expanded={isExpanded}>
                            {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </Button>
                        </ResizableTableCell>
                        <ResizableTableCell columnId="name"><Link to={`/cronjobs/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate"><CronJobIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="truncate">{item.name}</span></Link></ResizableTableCell>
                        <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} className="font-normal truncate block w-fit max-w-full" /></ResizableTableCell>
                        <ResizableTableCell columnId="status"><StatusPill label={item.status} variant={cronJobStatusToVariant[item.status]} icon={StatusIcon} /></ResizableTableCell>
                        <ResizableTableCell columnId="schedule" className="min-w-0" title={item.schedule}><span className="text-xs truncate block">{item.scheduleHuman !== '-' ? item.scheduleHuman : item.schedule}</span></ResizableTableCell>
                        <ResizableTableCell columnId="lastSchedule" className="text-muted-foreground whitespace-nowrap text-sm">{item.lastSchedule}</ResizableTableCell>
                        <ResizableTableCell columnId="nextSchedule" className="text-muted-foreground whitespace-nowrap text-sm">{item.nextSchedule}</ResizableTableCell>
                        <ResizableTableCell columnId="active" className="font-mono text-sm">{item.active}</ResizableTableCell>
                        <ResizableTableCell columnId="concurrencyPolicy">
                          <Badge
                            variant={item.concurrencyPolicy === 'Allow' ? 'default' : item.concurrencyPolicy === 'Forbid' ? 'secondary' : 'destructive'}
                            className={cn('font-mono text-xs', item.concurrencyPolicy === 'Forbid' && 'bg-amber-500/90 text-white border-0')}
                          >
                            {item.concurrencyPolicy}
                          </Badge>
                        </ResizableTableCell>
                        <ResizableTableCell columnId="suspend">
                          <Badge variant={item.suspend ? 'secondary' : 'outline'} className="text-xs">{item.suspend ? 'Yes' : 'No'}</Badge>
                        </ResizableTableCell>
                        <ResizableTableCell columnId="historyLimit" className="font-mono text-sm">{item.historyLimit}</ResizableTableCell>
                        <ResizableTableCell columnId="lastResult">
                          {item.lastResult !== '–' ? (
                            <StatusPill
                              label={item.lastResult}
                              variant={item.lastResult === 'Success' ? 'success' : item.lastResult === 'Failed' ? 'error' : 'warning'}
                              icon={item.lastResult === 'Success' ? CheckCircle2 : item.lastResult === 'Failed' ? XCircle : Play}
                            />
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </ResizableTableCell>
                        <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>
                        <TableCell>
                          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="CronJob actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <CopyNameDropdownItem name={item.name} namespace={item.namespace} />
                              <DropdownMenuItem onClick={() => navigate(`/cronjobs/${item.namespace}/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleTriggerNow(item)} className="gap-2" disabled={!isConnected}><Play className="h-4 w-4" />Trigger Now</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleToggleSuspend(item)} className="gap-2" disabled={!isConnected}>{item.status === 'Active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{item.status === 'Active' ? 'Suspend' : 'Resume'}</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/jobs?namespace=${item.namespace}`)} className="gap-2"><Box className="h-4 w-4" />View Jobs</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/cronjobs/${item.namespace}/${item.name}?tab=logs`)} className="gap-2"><FileText className="h-4 w-4" />View Last Job Logs</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/cronjobs/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
                              <DropdownMenuSeparator /><DropdownMenuItem className="gap-2 text-[hsl(0,72%,51%)]" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </motion.tr>,
                      ...(isExpanded ? [
                        <TableRow key={`${key}-jobs`} className="bg-muted/20 hover:bg-muted/20 border-b border-border/60">
                          <TableCell colSpan={16} className="p-0 align-top">
                            <div className="pl-14 pr-4 py-3">
                              <div className="text-xs font-medium text-muted-foreground mb-2">Recent Jobs (last 5)</div>
                              {childJobsLoading ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading jobs…</div>
                              ) : childJobs.length === 0 ? (
                                <div className="text-sm text-muted-foreground">No jobs yet</div>
                              ) : (
                                <Table>
                                  <TableHeader><TableRow className="border-0 hover:bg-transparent">
                                    <TableHead className="h-8 text-xs font-medium text-muted-foreground">Job Name</TableHead>
                                    <TableHead className="h-8 text-xs font-medium text-muted-foreground">Status</TableHead>
                                    <TableHead className="h-8 text-xs font-medium text-muted-foreground">Start Time</TableHead>
                                    <TableHead className="h-8 text-xs font-medium text-muted-foreground">Duration</TableHead>
                                  </TableRow></TableHeader>
                                  <TableBody>
                                    {childJobs.map((job) => (
                                      <TableRow key={job.name} className="border-0 hover:bg-muted/30" onClick={() => navigate(`/jobs/${job.namespace}/${job.name}`)}>
                                        <TableCell className="py-1.5 text-sm"><Link to={`/jobs/${job.namespace}/${job.name}`} className="text-primary hover:underline font-medium" onClick={(e) => e.stopPropagation()}>{job.name}</Link></TableCell>
                                        <TableCell className="py-1.5"><StatusPill label={job.status} variant={job.status === 'Complete' ? 'success' : job.status === 'Failed' ? 'error' : 'warning'} icon={job.status === 'Complete' ? CheckCircle2 : job.status === 'Failed' ? XCircle : Clock} /></TableCell>
                                        <TableCell className="py-1.5 text-sm text-muted-foreground">{job.startTime !== '-' ? new Date(job.startTime).toLocaleString() : '-'}</TableCell>
                                        <TableCell className="py-1.5 text-sm font-mono">{job.duration}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>,
                      ] : []),
                    ];
                  })),
                ];
              })}
            </TableBody>
          </Table>
        </ResizableTableProvider>
      </ResourceListTableToolbar>

      {showCreateWizard && (
        <ResourceCreator
          resourceKind="CronJob"
          defaultYaml={DEFAULT_YAMLS.CronJob}
          onClose={() => setShowCreateWizard(false)}
          onApply={async (yaml) => {
            try {
              await createResource.mutateAsync({ yaml });
              setShowCreateWizard(false);
              refetch();
            } catch (e) {
              // Error toast is handled by useCreateK8sResource
            }
          }}
        />
      )}
      <DeleteConfirmDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })} resourceType="CronJob" resourceName={deleteDialog.bulk ? `${selectedItems.size} cronjobs` : (deleteDialog.item?.name || '')} namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace} onConfirm={handleDelete} />
    </motion.div>
  );
}
