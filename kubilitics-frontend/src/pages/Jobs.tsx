import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Filter, RefreshCw, RotateCw, MoreHorizontal, CheckCircle2, XCircle, Clock, Loader2, WifiOff, Plus,
  ChevronDown, ChevronRight, CheckSquare, Trash2, Briefcase, FileText, List, Layers, Box, Gauge,
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
import { useK8sResourceList, useDeleteK8sResource, useCreateK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { postJobRetry } from '@/services/backendApiClient';
import { DeleteConfirmDialog, UsageBar, parseCpu, parseMemory, calculatePodResourceMax } from '@/components/resources';
import { ResourceExportDropdown, ListViewSegmentedControl, ListPagination, PAGE_SIZE_OPTIONS, ResourceCommandBar, resourceTableRowClassName, ROW_MOTION, StatusPill, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, AgeCell, TableEmptyState, TableSkeletonRows, CopyNameDropdownItem, NamespaceBadge, ResourceListTableToolbar } from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useWorkloadMetricsMap } from '@/hooks/useWorkloadMetricsMap';
import type { StatusPillVariant } from '@/components/list';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { toast } from 'sonner';
import { Progress } from '@/components/ui/progress';
import { JobIcon } from '@/components/icons/KubernetesIcons';

interface JobResource extends KubernetesResource {
  metadata: KubernetesResource['metadata'] & { ownerReferences?: Array<{ kind: string; name: string }> };
  spec: {
    completions?: number;
    parallelism?: number;
    backoffLimit?: number;
    template?: {
      spec?: {
        containers?: Array<{
          name: string;
          image: string;
          resources?: {
            requests?: { cpu?: string; memory?: string };
            limits?: { cpu?: string; memory?: string };
          };
        }>
      }
    };
  };
  status: { succeeded?: number; failed?: number; active?: number; startTime?: string; completionTime?: string };
}

interface Job {
  name: string;
  namespace: string;
  status: 'Complete' | 'Running' | 'Failed';
  completions: string;
  completionsNum: number;
  completionsDesired: number;
  parallelism: number;
  active: number;
  succeeded: number;
  failed: number;
  duration: string;
  backoffLimit: number;
  owner: string;
  age: string;
  creationTimestamp?: string;
  cpu: string;
  memory: string;
}

const statusConfig = {
  Complete: { icon: CheckCircle2, color: 'text-[hsl(142,76%,36%)]', bg: 'bg-[hsl(142,76%,36%)]/10' },
  Running: { icon: Clock, color: 'text-[hsl(45,93%,47%)]', bg: 'bg-[hsl(45,93%,47%)]/10' },
  Failed: { icon: XCircle, color: 'text-[hsl(0,72%,51%)]', bg: 'bg-[hsl(0,72%,51%)]/10' },
};

const JOBS_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'name', defaultWidth: 200, minWidth: 120 },
  { id: 'namespace', defaultWidth: 140, minWidth: 100 },
  { id: 'status', defaultWidth: 120, minWidth: 90 },
  { id: 'completions', defaultWidth: 140, minWidth: 115 },
  { id: 'parallelism', defaultWidth: 130, minWidth: 105 },
  { id: 'active', defaultWidth: 100, minWidth: 75 },
  { id: 'succeeded', defaultWidth: 130, minWidth: 100 },
  { id: 'failed', defaultWidth: 100, minWidth: 80 },
  { id: 'duration', defaultWidth: 130, minWidth: 100 },
  { id: 'backoffLimit', defaultWidth: 150, minWidth: 120 },
  { id: 'owner', defaultWidth: 140, minWidth: 95 },
  { id: 'cpu', defaultWidth: 120, minWidth: 85 },
  { id: 'memory', defaultWidth: 130, minWidth: 90 },
  { id: 'age', defaultWidth: 100, minWidth: 65 },
];

const JOBS_COLUMNS_FOR_VISIBILITY = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'status', label: 'Status' },
  { id: 'completions', label: 'Completions' },
  { id: 'parallelism', label: 'Parallelism' },
  { id: 'active', label: 'Active' },
  { id: 'succeeded', label: 'Succeeded' },
  { id: 'failed', label: 'Failed' },
  { id: 'duration', label: 'Duration' },
  { id: 'backoffLimit', label: 'Backoff Limit' },
  { id: 'owner', label: 'Owner' },
  { id: 'cpu', label: 'CPU' },
  { id: 'memory', label: 'Memory' },
  { id: 'age', label: 'Age' },
];

const jobStatusToVariant: Record<Job['status'], StatusPillVariant> = {
  Complete: 'success',
  Running: 'warning',
  Failed: 'error',
};

function transformResource(resource: JobResource): Job {
  const spec = resource.spec || {};
  const status = resource.status || {};
  const completionsDesired = spec.completions ?? 1;
  const succeeded = status.succeeded || 0;
  const active = status.active || 0;
  const failed = status.failed || 0;
  let jobStatus: Job['status'] = 'Running';
  if (succeeded >= completionsDesired) jobStatus = 'Complete';
  else if (failed > 0 && active === 0) jobStatus = 'Failed';
  let duration = '-';
  if (status.startTime) {
    const start = new Date(status.startTime);
    const end = status.completionTime ? new Date(status.completionTime) : new Date();
    const diffSec = Math.floor((end.getTime() - start.getTime()) / 1000);
    if (diffSec < 60) duration = `${diffSec}s`;
    else if (diffSec < 3600) duration = `${Math.floor(diffSec / 60)}m`;
    else duration = `${Math.floor(diffSec / 3600)}h`;
  }
  const ownerRef = resource.metadata?.ownerReferences?.find((r) => r.kind === 'CronJob');
  const owner = ownerRef?.name ?? '-';
  return {
    name: resource.metadata.name,
    namespace: resource.metadata.namespace || 'default',
    status: jobStatus,
    completions: `${succeeded}/${completionsDesired}`,
    completionsNum: succeeded,
    completionsDesired,
    parallelism: spec.parallelism ?? 1,
    active,
    succeeded,
    failed,
    duration,
    backoffLimit: spec.backoffLimit ?? 6,
    owner,
    age: calculateAge(resource.metadata.creationTimestamp),
    creationTimestamp: resource.metadata?.creationTimestamp,
    cpu: '-',
    memory: '-',
  };
}

type ListView = 'flat' | 'byNamespace';

export default function Jobs() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: Job | null; bulk?: boolean }>({ open: false, item: null });
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [listView, setListView] = useState<ListView>('flat');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  const { isConnected } = useConnectionStatus();
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;
  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<JobResource>('jobs', undefined, { limit: 5000 });
  const deleteResource = useDeleteK8sResource('jobs');
  const createResource = useCreateK8sResource('jobs');

  const items: Job[] = isConnected && data ? (data.items ?? []).map(transformResource) : [];

  const stats = useMemo(() => {
    const succeeded = items.filter((i) => i.status === 'Complete').length;
    const total = items.length;
    const completionRatePct = total > 0 ? Math.round((succeeded / total) * 100) : 0;
    return {
      total,
      running: items.filter((i) => i.status === 'Running').length,
      succeeded,
      failed: items.filter((i) => i.status === 'Failed').length,
      completionRatePct,
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

  const jobsTableConfig = useMemo(() => {
    const parseDurationSec = (d: string): number => {
      if (!d || d === '-') return -1;
      const m = d.match(/^(\d+)(s|m|h)$/);
      if (!m) return 0;
      const n = parseInt(m[1], 10);
      if (m[2] === 's') return n;
      if (m[2] === 'm') return n * 60;
      return n * 3600;
    };
    return {
      defaultSortKey: 'name' as const,
      defaultSortOrder: 'asc' as const,
      columns: [
        { columnId: 'name', getValue: (j: Job) => j.name, sortable: true, filterable: true },
        { columnId: 'namespace', getValue: (j: Job) => j.namespace, sortable: true, filterable: true },
        { columnId: 'status', getValue: (j: Job) => j.status, sortable: true, filterable: true },
        { columnId: 'completions', getValue: (j: Job) => j.completions, sortable: true, filterable: false },
        { columnId: 'parallelism', getValue: (j: Job) => j.parallelism, sortable: true, filterable: false },
        { columnId: 'active', getValue: (j: Job) => j.active, sortable: true, filterable: false },
        { columnId: 'succeeded', getValue: (j: Job) => j.succeeded, sortable: true, filterable: false },
        { columnId: 'failed', getValue: (j: Job) => j.failed, sortable: true, filterable: false },
        { columnId: 'duration', getValue: (j: Job) => j.duration, sortable: true, filterable: false, compare: (a, b) => parseDurationSec(a.duration) - parseDurationSec(b.duration) },
        { columnId: 'backoffLimit', getValue: (j: Job) => j.backoffLimit, sortable: true, filterable: false },
        { columnId: 'owner', getValue: (j: Job) => j.owner, sortable: true, filterable: true },
        { columnId: 'cpu', getValue: (j: Job) => j.cpu, sortable: true, filterable: false },
        { columnId: 'memory', getValue: (j: Job) => j.memory, sortable: true, filterable: false },
        { columnId: 'age', getValue: (j: Job) => j.age, sortable: true, filterable: false },
      ] as ColumnConfig<Job>[],
    };
  }, []);

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
  } = useTableFiltersAndSort(itemsAfterSearchAndNs, jobsTableConfig);

  const columnVisibility = useColumnVisibility({
    tableId: 'jobs',
    columns: JOBS_COLUMNS_FOR_VISIBILITY,
    alwaysVisible: ['name'],
  });

  const totalFiltered = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = filteredItems.slice(start, start + pageSize);

  const metricsEntries = useMemo(
    () => itemsOnPage.map((i) => ({ namespace: i.namespace, name: i.name })),
    [itemsOnPage]
  );
  const { metricsMap } = useWorkloadMetricsMap('job', metricsEntries);

  // Calculate resource max values from job pod template container limits/requests
  const jobResourceMaxMap = useMemo(() => {
    const m: Record<string, { cpuMax?: number; memoryMax?: number }> = {};
    if (data?.items) {
      data.items.forEach((jobResource) => {
        const key = `${jobResource.metadata.namespace}/${jobResource.metadata.name}`;
        const containers = jobResource.spec?.template?.spec?.containers || [];
        const cpuMax = calculatePodResourceMax(containers, 'cpu');
        const memoryMax = calculatePodResourceMax(containers, 'memory');
        if (cpuMax !== undefined || memoryMax !== undefined) {
          m[key] = { cpuMax, memoryMax };
        }
      });
    }
    return m;
  }, [data?.items]);

  const groupedOnPage = useMemo(() => {
    if (listView !== 'byNamespace' || itemsOnPage.length === 0) return [];
    const map = new Map<string, Job[]>();
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
      : 'No jobs',
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

  const handleRetry = async (item: Job) => {
    if (!isConnected) {
      toast.error('Connect cluster to retry Job');
      return;
    }
    if (!isBackendConfigured()) {
      toast.error('Connect to Kubilitics backend in Settings to retry Job.');
      return;
    }
    if (!clusterId) {
      toast.error('Select a cluster from the cluster list to perform this action.');
      return;
    }
    try {
      await postJobRetry(backendBaseUrl, clusterId, item.namespace, item.name);
      toast.success(`Created new Job from ${item.name} (retry)`);
      refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg ?? 'Retry failed');
    }
  };

  const handleDelete = async () => {
    if (!isConnected) {
      toast.error('Connect cluster to delete jobs');
      setDeleteDialog({ open: false, item: null });
      return;
    }
    if (deleteDialog.bulk && selectedItems.size > 0) {
      for (const key of selectedItems) {
        const [ns, n] = key.split('/');
        if (n && ns) await deleteResource.mutateAsync({ name: n, namespace: ns });
      }
      toast.success(`Deleted ${selectedItems.size} job(s)`);
      setSelectedItems(new Set());
    } else if (deleteDialog.item) {
      await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
      toast.success(`Job ${deleteDialog.item.name} deleted`);
    }
    setDeleteDialog({ open: false, item: null });
  };

  const jobExportConfig = {
    filenamePrefix: 'jobs',
    resourceLabel: 'jobs',
    getExportData: (j: Job) => ({ name: j.name, namespace: j.namespace, status: j.status, completions: j.completions, parallelism: j.parallelism, active: j.active, succeeded: j.succeeded, failed: j.failed, duration: j.duration, backoffLimit: j.backoffLimit, owner: j.owner, age: j.age }),
    csvColumns: [
      { label: 'Name', getValue: (j: Job) => j.name },
      { label: 'Namespace', getValue: (j: Job) => j.namespace },
      { label: 'Status', getValue: (j: Job) => j.status },
      { label: 'Completions', getValue: (j: Job) => j.completions },
      { label: 'Duration', getValue: (j: Job) => j.duration },
      { label: 'Age', getValue: (j: Job) => j.age },
    ],
    toK8sYaml: (j: Job) => `---
apiVersion: batch/v1
kind: Job
metadata:
  name: ${j.name}
  namespace: ${j.namespace}
spec:
  template:
    spec:
      containers: []
      restartPolicy: Never
`,
  };

  const toggleSelection = (item: Job) => { const key = `${item.namespace}/${item.name}`; const newSel = new Set(selectedItems); if (newSel.has(key)) newSel.delete(key); else newSel.add(key); setSelectedItems(newSel); };
  const toggleAll = () => { if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set()); else setSelectedItems(new Set(itemsOnPage.map(i => `${i.namespace}/${i.name}`))); };

  const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
  const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <ListPageHeader
        icon={<JobIcon className="h-6 w-6 text-primary" />}
        title="Jobs"
        resourceCount={filteredItems.length}
        subtitle={namespaces.length > 1 ? `across ${namespaces.length - 1} namespaces` : undefined}
        demoMode={!isConnected}
        isLoading={isLoading}
        onRefresh={() => refetch()}
        createLabel="Create Job"
        onCreate={() => setShowCreateWizard(true)}
        actions={
          <>
            <ResourceExportDropdown
              items={filteredItems}
              selectedKeys={selectedItems}
              getKey={(i) => `${i.namespace}/${i.name}`}
              config={jobExportConfig}
              selectionLabel={selectedItems.size > 0 ? 'Selected jobs' : 'All visible jobs'}
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <ListPageStatCard label="Total" value={stats.total} icon={JobIcon as any} iconColor="text-primary" selected={!columnFilters.status?.size} onClick={() => setColumnFilter('status', null)} className={cn(!columnFilters.status?.size && 'ring-2 ring-primary')} />
        <ListPageStatCard label="Running" value={stats.running} icon={Clock} iconColor="text-[hsl(45,93%,47%)]" valueClassName="text-[hsl(45,93%,47%)]" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Running')} onClick={() => setColumnFilter('status', new Set(['Running']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Running') && 'ring-2 ring-[hsl(45,93%,47%)]')} />
        <ListPageStatCard label="Succeeded" value={stats.succeeded} icon={CheckCircle2} iconColor="text-[hsl(142,76%,36%)]" valueClassName="text-[hsl(142,76%,36%)]" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Complete')} onClick={() => setColumnFilter('status', new Set(['Complete']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Complete') && 'ring-2 ring-[hsl(142,76%,36%)]')} />
        <ListPageStatCard label="Failed" value={stats.failed} icon={XCircle} iconColor="text-[hsl(0,72%,51%)]" valueClassName="text-[hsl(0,72%,51%)]" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Failed')} onClick={() => setColumnFilter('status', new Set(['Failed']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Failed') && 'ring-2 ring-[hsl(0,72%,51%)]')} />
        <ListPageStatCard label="Completion Rate" value={stats.completionRatePct + '%'} icon={Gauge} iconColor="text-cyan-500" valueClassName="text-cyan-600" />
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
                <Input placeholder="Search jobs..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all" aria-label="Search jobs" />
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
        columns={JOBS_COLUMNS_FOR_VISIBILITY}
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
        <ResizableTableProvider tableId="jobs" columnConfig={JOBS_TABLE_COLUMNS}>
          <Table className="table-fixed" style={{ minWidth: 1850 }}>
            <TableHeader><TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
              <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
              <ResizableTableHead columnId="name">
                <TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="namespace">
                <TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="status">
                <TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="completions">
                <TableColumnHeaderWithFilterAndSort columnId="completions" label="Completions" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="parallelism">
                <TableColumnHeaderWithFilterAndSort columnId="parallelism" label="Parallelism" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="active">
                <TableColumnHeaderWithFilterAndSort columnId="active" label="Active" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="succeeded">
                <TableColumnHeaderWithFilterAndSort columnId="succeeded" label="Succeeded" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="failed">
                <TableColumnHeaderWithFilterAndSort columnId="failed" label="Failed" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="duration">
                <TableColumnHeaderWithFilterAndSort columnId="duration" label="Duration" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="backoffLimit">
                <TableColumnHeaderWithFilterAndSort columnId="backoffLimit" label="Backoff Limit" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="owner">
                <TableColumnHeaderWithFilterAndSort columnId="owner" label="Owner" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="cpu" title="CPU">
                <TableColumnHeaderWithFilterAndSort columnId="cpu" label="CPU" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="memory" title="Memory">
                <TableColumnHeaderWithFilterAndSort columnId="memory" label="Memory" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="age">
                <TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
            </TableRow>
              {showTableFilters && (
                <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
                  <TableCell className="w-10 p-1.5" />
                  <ResizableTableCell columnId="name" className="p-1.5">
                    <TableFilterCell columnId="name" label="Name" distinctValues={distinctValuesByColumn.name ?? []} selectedFilterValues={columnFilters.name ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.name} />
                  </ResizableTableCell>
                  <ResizableTableCell columnId="namespace" className="p-1.5">
                    <TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} />
                  </ResizableTableCell>
                  <ResizableTableCell columnId="status" className="p-1.5">
                    <TableFilterCell columnId="status" label="Status" distinctValues={distinctValuesByColumn.status ?? []} selectedFilterValues={columnFilters.status ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.status} />
                  </ResizableTableCell>
                  <ResizableTableCell columnId="completions" className="p-1.5" />
                  <ResizableTableCell columnId="parallelism" className="p-1.5" />
                  <ResizableTableCell columnId="active" className="p-1.5" />
                  <ResizableTableCell columnId="succeeded" className="p-1.5" />
                  <ResizableTableCell columnId="failed" className="p-1.5" />
                  <ResizableTableCell columnId="duration" className="p-1.5" />
                  <ResizableTableCell columnId="backoffLimit" className="p-1.5" />
                  <ResizableTableCell columnId="owner" className="p-1.5">
                    <TableFilterCell columnId="owner" label="Owner" distinctValues={distinctValuesByColumn.owner ?? []} selectedFilterValues={columnFilters.owner ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.owner} />
                  </ResizableTableCell>
                  <ResizableTableCell columnId="cpu" className="p-1.5" />
                  <ResizableTableCell columnId="memory" className="p-1.5" />
                  <ResizableTableCell columnId="age" className="p-1.5" />
                  <TableCell className="w-12 p-1.5" />
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {isLoading && isConnected ? (
                <TableSkeletonRows columnCount={16} />
              ) : itemsOnPage.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={16} className="h-40 text-center">
                    <TableEmptyState
                      icon={<Briefcase className="h-8 w-8" />}
                      title="No Jobs found"
                      subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Get started by creating a Job for one-off or batch workloads.'}
                      hasActiveFilters={!!(searchQuery || hasActiveFilters)}
                      onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
                      createLabel="Create Job"
                      onCreate={() => setShowCreateWizard(true)}
                    />
                  </TableCell>
                </TableRow>
              ) : listView === 'flat' ? itemsOnPage.map((item, idx) => {
                const StatusIcon = statusConfig[item.status]?.icon || Clock;
                const key = `${item.namespace}/${item.name}`;
                const isSelected = selectedItems.has(key);
                const completionsPct = item.completionsDesired > 0 ? Math.round((item.completionsNum / item.completionsDesired) * 100) : 0;
                const cpuVal = metricsMap[key]?.cpu ?? '-';
                const memVal = metricsMap[key]?.memory ?? '-';
                const cpuNum = parseCpu(cpuVal);
                const memNum = parseMemory(memVal);
                const cpuDataPoints = cpuNum != null ? Array(12).fill(cpuNum) : undefined;
                const memDataPoints = memNum != null ? Array(12).fill(memNum) : undefined;
                return (
                  <motion.tr key={key} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
                    <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(item)} /></TableCell>
                    <ResizableTableCell columnId="name"><Link to={`/jobs/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate"><JobIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="truncate">{item.name}</span></Link></ResizableTableCell>
                    <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} className="font-normal truncate block w-fit max-w-full" /></ResizableTableCell>
                    <ResizableTableCell columnId="status"><StatusPill label={item.status} variant={jobStatusToVariant[item.status]} icon={StatusIcon} /></ResizableTableCell>
                    <ResizableTableCell columnId="completions" className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <Progress value={completionsPct} className="h-1.5 w-10 flex-shrink-0" />
                        <span className="tabular-nums text-sm">{item.completions}</span>
                      </div>
                    </ResizableTableCell>
                    <ResizableTableCell columnId="parallelism" className="font-mono text-sm">{item.parallelism}</ResizableTableCell>
                    <ResizableTableCell columnId="active" className="font-mono text-sm">{item.active}</ResizableTableCell>
                    <ResizableTableCell columnId="succeeded" className="font-mono text-sm">{item.succeeded}</ResizableTableCell>
                    <ResizableTableCell columnId="failed" className="font-mono text-sm">{item.failed}</ResizableTableCell>
                    <ResizableTableCell columnId="duration" className="font-mono text-sm">{item.duration}</ResizableTableCell>
                    <ResizableTableCell columnId="backoffLimit" className="font-mono text-sm">{item.backoffLimit}</ResizableTableCell>
                    <ResizableTableCell columnId="owner">
                      {item.owner !== '-' ? (
                        <Link to={`/cronjobs/${item.namespace}/${item.owner}`} className="text-primary hover:underline text-sm truncate block">{item.owner}</Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </ResizableTableCell>
                    <ResizableTableCell columnId="cpu">
                      <div className="min-w-0 overflow-hidden">
                        <UsageBar variant="sparkline" value={cpuVal} kind="cpu" displayFormat="compact" width={56} max={jobResourceMaxMap[key]?.cpuMax} />
                      </div>
                    </ResizableTableCell>
                    <ResizableTableCell columnId="memory">
                      <div className="min-w-0 overflow-hidden">
                        <UsageBar variant="sparkline" value={memVal} kind="memory" displayFormat="compact" width={56} max={jobResourceMaxMap[key]?.memoryMax} />
                      </div>
                    </ResizableTableCell>
                    <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>
                    <TableCell>
                      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Job actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <CopyNameDropdownItem name={item.name} namespace={item.namespace} />
                          <DropdownMenuItem onClick={() => navigate(`/jobs/${item.namespace}/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/pods?namespace=${item.namespace}`)} className="gap-2"><Box className="h-4 w-4" />View Pods</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/jobs/${item.namespace}/${item.name}?tab=logs`)} className="gap-2"><FileText className="h-4 w-4" />View Logs</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleRetry(item)} className="gap-2" disabled={!isConnected}><RotateCw className="h-4 w-4" />Retry</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/jobs/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
                          <DropdownMenuSeparator /><DropdownMenuItem className="gap-2 text-[hsl(0,72%,51%)]" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </motion.tr>
                );
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
                  ...(isCollapsed ? [] : group.list.map((item, idx) => {
                    const StatusIcon = statusConfig[item.status]?.icon || Clock;
                    const key = `${item.namespace}/${item.name}`;
                    const isSelected = selectedItems.has(key);
                    const completionsPct = item.completionsDesired > 0 ? Math.round((item.completionsNum / item.completionsDesired) * 100) : 0;
                    const cpuVal = metricsMap[key]?.cpu ?? '-';
                    const memVal = metricsMap[key]?.memory ?? '-';
                    const cpuNum = parseCpu(cpuVal);
                    const memNum = parseMemory(memVal);
                    const cpuDataPoints = cpuNum != null ? Array(12).fill(cpuNum) : undefined;
                    const memDataPoints = memNum != null ? Array(12).fill(memNum) : undefined;
                    return (
                      <motion.tr key={key} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
                        <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(item)} /></TableCell>
                        <ResizableTableCell columnId="name"><Link to={`/jobs/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate"><JobIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="truncate">{item.name}</span></Link></ResizableTableCell>
                        <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} className="font-normal truncate block w-fit max-w-full" /></ResizableTableCell>
                        <ResizableTableCell columnId="status"><StatusPill label={item.status} variant={jobStatusToVariant[item.status]} icon={StatusIcon} /></ResizableTableCell>
                        <ResizableTableCell columnId="completions" className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <Progress value={completionsPct} className="h-1.5 w-10 flex-shrink-0" />
                            <span className="tabular-nums text-sm">{item.completions}</span>
                          </div>
                        </ResizableTableCell>
                        <ResizableTableCell columnId="parallelism" className="font-mono text-sm">{item.parallelism}</ResizableTableCell>
                        <ResizableTableCell columnId="active" className="font-mono text-sm">{item.active}</ResizableTableCell>
                        <ResizableTableCell columnId="succeeded" className="font-mono text-sm">{item.succeeded}</ResizableTableCell>
                        <ResizableTableCell columnId="failed" className="font-mono text-sm">{item.failed}</ResizableTableCell>
                        <ResizableTableCell columnId="duration" className="font-mono text-sm">{item.duration}</ResizableTableCell>
                        <ResizableTableCell columnId="backoffLimit" className="font-mono text-sm">{item.backoffLimit}</ResizableTableCell>
                        <ResizableTableCell columnId="owner">
                          {item.owner !== '-' ? (
                            <Link to={`/cronjobs/${item.namespace}/${item.owner}`} className="text-primary hover:underline text-sm truncate block">{item.owner}</Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </ResizableTableCell>
                        <ResizableTableCell columnId="cpu">
                          <div className="min-w-0 overflow-hidden">
                            <UsageBar variant="sparkline" value={cpuVal} kind="cpu" displayFormat="compact" width={56} max={jobResourceMaxMap[key]?.cpuMax} />
                          </div>
                        </ResizableTableCell>
                        <ResizableTableCell columnId="memory">
                          <div className="min-w-0 overflow-hidden">
                            <UsageBar variant="sparkline" value={memVal} kind="memory" displayFormat="compact" width={56} max={jobResourceMaxMap[key]?.memoryMax} />
                          </div>
                        </ResizableTableCell>
                        <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>
                        <TableCell>
                          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Job actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <CopyNameDropdownItem name={item.name} namespace={item.namespace} />
                              <DropdownMenuItem onClick={() => navigate(`/jobs/${item.namespace}/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/pods?namespace=${item.namespace}`)} className="gap-2"><Box className="h-4 w-4" />View Pods</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/jobs/${item.namespace}/${item.name}?tab=logs`)} className="gap-2"><FileText className="h-4 w-4" />View Logs</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleRetry(item)} className="gap-2" disabled={!isConnected}><RotateCw className="h-4 w-4" />Retry</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/jobs/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
                              <DropdownMenuSeparator /><DropdownMenuItem className="gap-2 text-[hsl(0,72%,51%)]" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </motion.tr>
                    );
                  })),
                ];
              })}
            </TableBody>
          </Table>
        </ResizableTableProvider>
      </ResourceListTableToolbar>

      {showCreateWizard && (
        <ResourceCreator
          resourceKind="Job"
          defaultYaml={DEFAULT_YAMLS.Job}
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
      <DeleteConfirmDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })} resourceType="Job" resourceName={deleteDialog.bulk ? `${selectedItems.size} jobs` : (deleteDialog.item?.name || '')} namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace} onConfirm={handleDelete} />
    </motion.div>
  );
}
