import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Filter, RefreshCw, MoreHorizontal, CheckCircle2, XCircle, Clock, Loader2, WifiOff, Plus,
  ChevronDown, ChevronRight, CheckSquare, Trash2, RotateCcw, History, Server, FileText, List, Layers, Box, SlidersHorizontal, Gauge,
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
import { useK8sResourceList, useDeleteK8sResource, usePatchK8sResource, useCreateK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog, RolloutActionsDialog, UsageBar, parseCpu, parseMemory, calculatePodResourceMax } from '@/components/resources';
import { ResourceExportDropdown, ListViewSegmentedControl, ListPagination, PAGE_SIZE_OPTIONS, ResourceCommandBar, resourceTableRowClassName, ROW_MOTION, StatusPill, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, AgeCell, TableEmptyState, TableSkeletonRows, NamespaceBadge, ResourceListTableToolbar } from '@/components/list';
import type { StatusPillVariant } from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useWorkloadMetricsMap } from '@/hooks/useWorkloadMetricsMap';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { toast } from 'sonner';
import { Progress } from '@/components/ui/progress';
import { DaemonSetIcon } from '@/components/icons/KubernetesIcons';

interface DaemonSetResource extends KubernetesResource {
  spec: {
    updateStrategy?: { type: string };
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
  status: { desiredNumberScheduled?: number; currentNumberScheduled?: number; numberReady?: number; numberAvailable?: number; updatedNumberScheduled?: number; numberMisscheduled?: number };
}

interface DaemonSet {
  name: string;
  namespace: string;
  status: 'Healthy' | 'Progressing' | 'Degraded';
  desired: number;
  current: number;
  ready: number;
  available: number;
  updated: number;
  nodeCoveragePct: number;
  updateStrategy: string;
  nodeSelector: string;
  age: string;
  creationTimestamp?: string;
  cpu: string;
  memory: string;
}

const statusConfig = {
  Healthy: { icon: CheckCircle2, color: 'text-[hsl(142,76%,36%)]', bg: 'bg-[hsl(142,76%,36%)]/10' },
  Progressing: { icon: Clock, color: 'text-[hsl(45,93%,47%)]', bg: 'bg-[hsl(45,93%,47%)]/10' },
  Degraded: { icon: XCircle, color: 'text-[hsl(0,72%,51%)]', bg: 'bg-[hsl(0,72%,51%)]/10' },
};

const DAEMONSETS_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'name', defaultWidth: 200, minWidth: 120 },
  { id: 'namespace', defaultWidth: 140, minWidth: 100 },
  { id: 'status', defaultWidth: 120, minWidth: 90 },
  { id: 'desired', defaultWidth: 100, minWidth: 80 },
  { id: 'current', defaultWidth: 100, minWidth: 80 },
  { id: 'ready', defaultWidth: 100, minWidth: 80 },
  { id: 'upToDate', defaultWidth: 120, minWidth: 100 },
  { id: 'available', defaultWidth: 120, minWidth: 100 },
  { id: 'nodeCoverage', defaultWidth: 180, minWidth: 130 },
  { id: 'updateStrategy', defaultWidth: 180, minWidth: 140 },
  { id: 'cpu', defaultWidth: 120, minWidth: 85 },
  { id: 'memory', defaultWidth: 130, minWidth: 90 },
  { id: 'age', defaultWidth: 100, minWidth: 65 },
];

const DAEMONSETS_COLUMNS_FOR_VISIBILITY = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'status', label: 'Status' },
  { id: 'desired', label: 'Desired' },
  { id: 'current', label: 'Current' },
  { id: 'ready', label: 'Ready' },
  { id: 'upToDate', label: 'Up-to-date' },
  { id: 'available', label: 'Available' },
  { id: 'nodeCoverage', label: 'Node Coverage' },
  { id: 'updateStrategy', label: 'Update Strategy' },
  { id: 'cpu', label: 'CPU' },
  { id: 'memory', label: 'Memory' },
  { id: 'age', label: 'Age' },
];

const daemonSetStatusToVariant: Record<DaemonSet['status'], StatusPillVariant> = {
  Healthy: 'success',
  Progressing: 'warning',
  Degraded: 'error',
};

function transformResource(resource: DaemonSetResource): DaemonSet {
  const status = resource.status || {};
  const desired = status.desiredNumberScheduled || 0;
  const ready = status.numberReady || 0;
  const available = status.numberAvailable || 0;
  const updated = status.updatedNumberScheduled ?? status.currentNumberScheduled ?? 0;
  const nodeCoveragePct = desired > 0 ? Math.round((ready / desired) * 100) : 100;
  let dsStatus: DaemonSet['status'] = 'Healthy';
  if (ready === 0 && desired > 0) dsStatus = 'Degraded';
  else if (ready < desired) dsStatus = 'Progressing';
  return {
    name: resource.metadata.name,
    namespace: resource.metadata.namespace || 'default',
    status: dsStatus,
    desired,
    current: status.currentNumberScheduled || 0,
    ready,
    available,
    updated,
    nodeCoveragePct,
    updateStrategy: resource.spec?.updateStrategy?.type ?? 'RollingUpdate',
    nodeSelector: 'all nodes',
    age: calculateAge(resource.metadata.creationTimestamp),
    creationTimestamp: resource.metadata?.creationTimestamp,
    cpu: '-',
    memory: '-',
  };
}

type ListView = 'flat' | 'byNamespace';

export default function DaemonSets() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: DaemonSet | null; bulk?: boolean }>({ open: false, item: null });
  const [rolloutDialog, setRolloutDialog] = useState<{ open: boolean; item: DaemonSet | null }>({ open: false, item: null });
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [listView, setListView] = useState<ListView>('flat');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  const { isConnected } = useConnectionStatus();
  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<DaemonSetResource>('daemonsets', undefined, { limit: 5000 });
  const deleteResource = useDeleteK8sResource('daemonsets');
  const patchDaemonSet = usePatchK8sResource('daemonsets');
  const createResource = useCreateK8sResource('daemonsets');

  const items: DaemonSet[] = isConnected && data ? (data.items ?? []).map(transformResource) : [];

  const stats = useMemo(() => {
    const fullyDeployed = items.filter(i => i.desired > 0 && i.available === i.desired).length;
    const partiallyDeployed = items.filter(i => i.desired > 0 && i.ready > 0 && i.ready < i.desired).length;
    const updating = items.filter(i => i.desired > 0 && i.updated < i.desired).length;
    const nodeCoverageAvg = items.length > 0 ? Math.round(items.reduce((s, i) => s + i.nodeCoveragePct, 0) / items.length) : 0;
    return {
      total: items.length,
      healthy: items.filter(i => i.status === 'Healthy').length,
      progressing: items.filter(i => i.status === 'Progressing').length,
      degraded: items.filter(i => i.status === 'Degraded').length,
      fullyDeployed,
      partiallyDeployed,
      updating,
      nodeCoverageAvg,
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

  const daemonSetsTableConfig: ColumnConfig<DaemonSet>[] = useMemo(() => [
    { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: true },
    { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
    { columnId: 'status', getValue: (i) => i.status, sortable: true, filterable: true },
    { columnId: 'desired', getValue: (i) => i.desired, sortable: true, filterable: false },
    { columnId: 'current', getValue: (i) => i.current, sortable: true, filterable: false },
    { columnId: 'ready', getValue: (i) => i.ready, sortable: true, filterable: false },
    { columnId: 'upToDate', getValue: (i) => i.updated, sortable: true, filterable: false },
    { columnId: 'available', getValue: (i) => i.available, sortable: true, filterable: false },
    { columnId: 'nodeCoverage', getValue: (i) => i.nodeCoveragePct, sortable: true, filterable: false },
    { columnId: 'updateStrategy', getValue: (i) => i.updateStrategy, sortable: true, filterable: true },
    { columnId: 'cpu', getValue: (i) => i.cpu, sortable: true, filterable: false },
    { columnId: 'memory', getValue: (i) => i.memory, sortable: true, filterable: false },
    { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
  ], []);

  const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearchAndNs, { columns: daemonSetsTableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });

  const columnVisibility = useColumnVisibility({
    tableId: 'daemonsets',
    columns: DAEMONSETS_COLUMNS_FOR_VISIBILITY,
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
  const { metricsMap } = useWorkloadMetricsMap('daemonset', metricsEntries);

  // Calculate resource max values from daemonset pod template container limits/requests
  const daemonsetResourceMaxMap = useMemo(() => {
    const m: Record<string, { cpuMax?: number; memoryMax?: number }> = {};
    if (data?.items) {
      data.items.forEach((dsResource) => {
        const key = `${dsResource.metadata.namespace}/${dsResource.metadata.name}`;
        const containers = dsResource.spec?.template?.spec?.containers || [];
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
    const map = new Map<string, DaemonSet[]>();
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
      : 'No daemonsets',
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
      toast.error('Connect cluster to delete daemonsets');
      setDeleteDialog({ open: false, item: null });
      return;
    }
    if (deleteDialog.bulk && selectedItems.size > 0) {
      for (const key of selectedItems) {
        const [ns, n] = key.split('/');
        if (n && ns) await deleteResource.mutateAsync({ name: n, namespace: ns });
      }
      toast.success(`Deleted ${selectedItems.size} daemonset(s)`);
      setSelectedItems(new Set());
    } else if (deleteDialog.item) {
      await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
      toast.success(`DaemonSet ${deleteDialog.item.name} deleted`);
    }
    setDeleteDialog({ open: false, item: null });
  };

  const daemonSetExportConfig = {
    filenamePrefix: 'daemonsets',
    resourceLabel: 'daemonsets',
    getExportData: (d: DaemonSet) => ({ name: d.name, namespace: d.namespace, status: d.status, desired: d.desired, current: d.current, ready: d.ready, available: d.available, nodeSelector: d.nodeSelector, age: d.age }),
    csvColumns: [
      { label: 'Name', getValue: (d: DaemonSet) => d.name },
      { label: 'Namespace', getValue: (d: DaemonSet) => d.namespace },
      { label: 'Status', getValue: (d: DaemonSet) => d.status },
      { label: 'Desired', getValue: (d: DaemonSet) => d.desired },
      { label: 'Current', getValue: (d: DaemonSet) => d.current },
      { label: 'Ready', getValue: (d: DaemonSet) => d.ready },
      { label: 'Available', getValue: (d: DaemonSet) => d.available },
      { label: 'Age', getValue: (d: DaemonSet) => d.age },
    ],
    toK8sYaml: (d: DaemonSet) => `---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ${d.name}
  namespace: ${d.namespace}
spec:
  selector:
    matchLabels: {}
  template:
    metadata:
      labels: {}
    spec:
      containers: []
`,
  };

  const toggleSelection = (item: DaemonSet) => { const key = `${item.namespace}/${item.name}`; const newSel = new Set(selectedItems); if (newSel.has(key)) newSel.delete(key); else newSel.add(key); setSelectedItems(newSel); };
  const toggleAll = () => { if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set()); else setSelectedItems(new Set(itemsOnPage.map(i => `${i.namespace}/${i.name}`))); };
  const handleBulkRestart = () => {
    if (!isConnected) { toast.error('Connect cluster to restart daemonsets'); return; }
    toast.info('Bulk restart: trigger rollout restart for each selected DaemonSet when backend supports it.');
    setSelectedItems(new Set());
  };

  const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
  const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <ListPageHeader
        icon={<DaemonSetIcon className="h-6 w-6 text-primary" />}
        title="DaemonSets"
        resourceCount={filteredItems.length}
        subtitle={namespaces.length > 1 ? `across ${namespaces.length - 1} namespaces` : undefined}
        demoMode={!isConnected}
        isLoading={isLoading}
        onRefresh={() => refetch()}
        createLabel="Create DaemonSet"
        onCreate={() => setShowCreateWizard(true)}
        actions={
          <>
            <ResourceExportDropdown
              items={filteredItems}
              selectedKeys={selectedItems}
              getKey={(i) => `${i.namespace}/${i.name}`}
              config={daemonSetExportConfig}
              selectionLabel={selectedItems.size > 0 ? 'Selected daemonsets' : 'All visible daemonsets'}
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
        <ListPageStatCard label="Total" value={stats.total} icon={DaemonSetIcon as any} iconColor="text-primary" selected={!columnFilters.status?.size} onClick={() => setColumnFilter('status', null)} className={cn(!columnFilters.status?.size && 'ring-2 ring-primary')} />
        <ListPageStatCard label="Fully Deployed" value={stats.fullyDeployed} icon={CheckCircle2} iconColor="text-[hsl(142,76%,36%)]" valueClassName="text-[hsl(142,76%,36%)]" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Healthy')} onClick={() => setColumnFilter('status', new Set(['Healthy']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Healthy') && 'ring-2 ring-[hsl(142,76%,36%)]')} />
        <ListPageStatCard label="Partially Deployed" value={stats.partiallyDeployed} icon={Clock} iconColor="text-[hsl(45,93%,47%)]" valueClassName="text-[hsl(45,93%,47%)]" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Progressing')} onClick={() => setColumnFilter('status', new Set(['Progressing']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Progressing') && 'ring-2 ring-[hsl(45,93%,47%)]')} />
        <ListPageStatCard label="Updating" value={stats.updating} icon={History} iconColor="text-purple-500" valueClassName="text-purple-600" />
        <ListPageStatCard label="Node Coverage" value={stats.nodeCoverageAvg + '%'} icon={Gauge} iconColor="text-cyan-500" valueClassName="text-cyan-600" />
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
                <Input
                  placeholder="Search daemonsets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all"
                  aria-label="Search daemonsets"
                />
              </div>
            }
            structure={
              <ListViewSegmentedControl
                value={listView}
                onChange={(v) => setListView(v as ListView)}
                options={[{ id: 'flat', label: 'Flat', icon: List }, { id: 'byNamespace', label: 'By Namespace', icon: Layers }]}
                label=""
                ariaLabel="List structure"
              />
            }
            className="mb-0"
          />
        }
        hasActiveFilters={hasActiveFilters}
        onClearAllFilters={clearAllFilters}
        showTableFilters={showTableFilters}
        onToggleTableFilters={() => setShowTableFilters((v) => !v)}
        columns={DAEMONSETS_COLUMNS_FOR_VISIBILITY}
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
        <ResizableTableProvider tableId="daemonsets" columnConfig={DAEMONSETS_TABLE_COLUMNS}>
          <Table className="table-fixed" style={{ minWidth: 1740 }}>
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
              <ResizableTableHead columnId="desired">
                <TableColumnHeaderWithFilterAndSort columnId="desired" label="Desired" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="current">
                <TableColumnHeaderWithFilterAndSort columnId="current" label="Current" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="ready">
                <TableColumnHeaderWithFilterAndSort columnId="ready" label="Ready" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="upToDate">
                <TableColumnHeaderWithFilterAndSort columnId="upToDate" label="Up-to-date" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="available">
                <TableColumnHeaderWithFilterAndSort columnId="available" label="Available" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="nodeCoverage">
                <TableColumnHeaderWithFilterAndSort columnId="nodeCoverage" label="Node Coverage" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
              </ResizableTableHead>
              <ResizableTableHead columnId="updateStrategy">
                <TableColumnHeaderWithFilterAndSort columnId="updateStrategy" label="Update Strategy" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
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
                  <ResizableTableCell columnId="desired" className="p-1.5" />
                  <ResizableTableCell columnId="current" className="p-1.5" />
                  <ResizableTableCell columnId="ready" className="p-1.5" />
                  <ResizableTableCell columnId="upToDate" className="p-1.5" />
                  <ResizableTableCell columnId="available" className="p-1.5" />
                  <ResizableTableCell columnId="nodeCoverage" className="p-1.5" />
                  <ResizableTableCell columnId="updateStrategy" className="p-1.5">
                    <TableFilterCell columnId="updateStrategy" label="Update Strategy" distinctValues={distinctValuesByColumn.updateStrategy ?? []} selectedFilterValues={columnFilters.updateStrategy ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.updateStrategy} />
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
                <TableSkeletonRows columnCount={15} />
              ) : itemsOnPage.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={15} className="h-40 text-center">
                    <TableEmptyState
                      icon={<Server className="h-8 w-8" />}
                      title="No DaemonSets found"
                      subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Get started by creating a DaemonSet to run a pod on every node.'}
                      hasActiveFilters={!!(searchQuery || hasActiveFilters)}
                      onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
                      createLabel="Create DaemonSet"
                      onCreate={() => setShowCreateWizard(true)}
                    />
                  </TableCell>
                </TableRow>
              ) : listView === 'flat' ? itemsOnPage.map((item, idx) => {
                const StatusIcon = statusConfig[item.status]?.icon || Clock;
                const key = `${item.namespace}/${item.name}`;
                const isSelected = selectedItems.has(key);
                const nodeCoverageVal = item.desired > 0 ? Math.round((item.ready / item.desired) * 100) : 0;
                const cpuVal = metricsMap[key]?.cpu ?? '-';
                const memVal = metricsMap[key]?.memory ?? '-';
                const cpuNum = parseCpu(cpuVal);
                const memNum = parseMemory(memVal);
                const cpuDataPoints = cpuNum != null ? Array(12).fill(cpuNum) : undefined;
                const memDataPoints = memNum != null ? Array(12).fill(memNum) : undefined;
                return (
                  <motion.tr key={key} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
                    <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(item)} /></TableCell>
                    <ResizableTableCell columnId="name"><Link to={`/daemonsets/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate"><DaemonSetIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="truncate">{item.name}</span></Link></ResizableTableCell>
                    <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} className="font-normal truncate block w-fit max-w-full" /></ResizableTableCell>
                    <ResizableTableCell columnId="status"><StatusPill label={item.status} variant={daemonSetStatusToVariant[item.status]} icon={StatusIcon} /></ResizableTableCell>
                    <ResizableTableCell columnId="desired" className="font-mono text-sm">{item.desired}</ResizableTableCell>
                    <ResizableTableCell columnId="current" className="font-mono text-sm">{item.current}</ResizableTableCell>
                    <ResizableTableCell columnId="ready" className="font-mono text-sm">{item.ready}</ResizableTableCell>
                    <ResizableTableCell columnId="upToDate" className="font-mono text-sm">{item.updated}</ResizableTableCell>
                    <ResizableTableCell columnId="available" className="font-mono text-sm">{item.available}</ResizableTableCell>
                    <ResizableTableCell columnId="nodeCoverage" className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <Progress value={nodeCoverageVal} className="h-1.5 w-10 flex-shrink-0" />
                        <span className="tabular-nums text-sm">{item.ready}/{item.desired} nodes</span>
                      </div>
                    </ResizableTableCell>
                    <ResizableTableCell columnId="updateStrategy"><Badge variant="secondary" className="font-mono text-xs truncate block w-fit max-w-full">{item.updateStrategy}</Badge></ResizableTableCell>
                    <ResizableTableCell columnId="cpu">
                      <div className="min-w-0 overflow-hidden">
                        <UsageBar variant="sparkline" value={cpuVal} kind="cpu" displayFormat="compact" width={56} max={daemonsetResourceMaxMap[key]?.cpuMax} />
                      </div>
                    </ResizableTableCell>
                    <ResizableTableCell columnId="memory">
                      <div className="min-w-0 overflow-hidden">
                        <UsageBar variant="sparkline" value={memVal} kind="memory" displayFormat="compact" width={56} max={daemonsetResourceMaxMap[key]?.memoryMax} />
                      </div>
                    </ResizableTableCell>
                    <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>
                    <TableCell>
                      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="DaemonSet actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => navigate(`/daemonsets/${item.namespace}/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/pods?namespace=${item.namespace}`)} className="gap-2">View Pods</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRolloutDialog({ open: true, item })} className="gap-2" disabled={!isConnected}><RotateCcw className="h-4 w-4" />Restart</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/daemonsets/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
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
                    <TableCell colSpan={15} className="py-2 font-medium">
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
                    const nodeCoverageVal = item.desired > 0 ? Math.round((item.ready / item.desired) * 100) : 0;
                    const cpuVal = metricsMap[key]?.cpu ?? '-';
                    const memVal = metricsMap[key]?.memory ?? '-';
                    const cpuNum = parseCpu(cpuVal);
                    const memNum = parseMemory(memVal);
                    const cpuDataPoints = cpuNum != null ? Array(12).fill(cpuNum) : undefined;
                    const memDataPoints = memNum != null ? Array(12).fill(memNum) : undefined;
                    return (
                      <motion.tr key={key} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
                        <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(item)} /></TableCell>
                        <ResizableTableCell columnId="name"><Link to={`/daemonsets/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate"><DaemonSetIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="truncate">{item.name}</span></Link></ResizableTableCell>
                        <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} className="font-normal truncate block w-fit max-w-full" /></ResizableTableCell>
                        <ResizableTableCell columnId="status"><StatusPill label={item.status} variant={daemonSetStatusToVariant[item.status]} icon={StatusIcon} /></ResizableTableCell>
                        <ResizableTableCell columnId="desired" className="font-mono text-sm">{item.desired}</ResizableTableCell>
                        <ResizableTableCell columnId="current" className="font-mono text-sm">{item.current}</ResizableTableCell>
                        <ResizableTableCell columnId="ready" className="font-mono text-sm">{item.ready}</ResizableTableCell>
                        <ResizableTableCell columnId="upToDate" className="font-mono text-sm">{item.updated}</ResizableTableCell>
                        <ResizableTableCell columnId="available" className="font-mono text-sm">{item.available}</ResizableTableCell>
                        <ResizableTableCell columnId="nodeCoverage" className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <Progress value={nodeCoverageVal} className="h-1.5 w-10 flex-shrink-0" />
                            <span className="tabular-nums text-sm">{item.ready}/{item.desired} nodes</span>
                          </div>
                        </ResizableTableCell>
                        <ResizableTableCell columnId="updateStrategy"><Badge variant="secondary" className="font-mono text-xs truncate block w-fit max-w-full">{item.updateStrategy}</Badge></ResizableTableCell>
                        <ResizableTableCell columnId="cpu">
                          <div className="min-w-0 overflow-hidden">
                            <UsageBar variant="sparkline" value={cpuVal} kind="cpu" displayFormat="compact" width={56} max={daemonsetResourceMaxMap[key]?.cpuMax} />
                          </div>
                        </ResizableTableCell>
                        <ResizableTableCell columnId="memory">
                          <div className="min-w-0 overflow-hidden">
                            <UsageBar variant="sparkline" value={memVal} kind="memory" displayFormat="compact" width={56} max={daemonsetResourceMaxMap[key]?.memoryMax} />
                          </div>
                        </ResizableTableCell>
                        <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>
                        <TableCell>
                          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="DaemonSet actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => navigate(`/daemonsets/${item.namespace}/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/pods?namespace=${item.namespace}`)} className="gap-2">View Pods</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setRolloutDialog({ open: true, item })} className="gap-2" disabled={!isConnected}><RotateCcw className="h-4 w-4" />Restart</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/daemonsets/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
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
          resourceKind="DaemonSet"
          defaultYaml={DEFAULT_YAMLS.DaemonSet}
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
      <DeleteConfirmDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })} resourceType="DaemonSet" resourceName={deleteDialog.bulk ? `${selectedItems.size} daemonsets` : (deleteDialog.item?.name || '')} namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace} onConfirm={handleDelete} />
      {rolloutDialog.item && (
        <RolloutActionsDialog
          open={rolloutDialog.open}
          onOpenChange={(open) => setRolloutDialog({ open, item: open ? rolloutDialog.item : null })}
          resourceType="DaemonSet"
          resourceName={rolloutDialog.item.name}
          namespace={rolloutDialog.item.namespace}
          revisions={[]}
          onRestart={async () => {
            if (!isConnected) { toast.error('Connect cluster to restart'); return; }
            try {
              await patchDaemonSet.mutateAsync({
                name: rolloutDialog.item!.name,
                namespace: rolloutDialog.item!.namespace,
                patch: { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } } },
              });
              toast.success(`Restarted ${rolloutDialog.item?.name}`);
              setRolloutDialog({ open: false, item: null });
              refetch();
            } catch (e: any) {
              toast.error(e?.message ?? 'Failed to restart');
            }
          }}
          onRollback={() => { toast.info('DaemonSet does not support rollback to revision.'); setRolloutDialog({ open: false, item: null }); }}
        />
      )}
    </motion.div>
  );
}
