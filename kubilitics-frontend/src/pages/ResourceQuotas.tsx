import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Gauge, Search, RefreshCw, MoreHorizontal, Loader2, WifiOff, Plus, ChevronDown, Filter, List, Layers, CheckSquare, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ResizableTableProvider,
  ResizableTableHead,
  ResizableTableCell,
  type ResizableColumnConfig,
} from '@/components/ui/resizable-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { usePaginatedResourceList, useDeleteK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { DeleteConfirmDialog } from '@/components/resources';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { parseQuantityToNum, formatUsagePercent } from '@/lib/k8s-utils';
import {
  ResourceCommandBar,
  ResourceExportDropdown,
  ListViewSegmentedControl,
  ListPagination,
  ListPageStatCard,
  ListPageHeader,
  TableColumnHeaderWithFilterAndSort,
  resourceTableRowClassName,
  ROW_MOTION,
  PAGE_SIZE_OPTIONS,
  AgeCell,
  TableEmptyState,
  CopyNameDropdownItem,
  NamespaceBadge,
  ResourceListTableToolbar,
  TableFilterCell,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';

interface ResourceQuotaResource extends KubernetesResource {
  spec?: { hard?: Record<string, string>; scopeSelector?: unknown };
  status?: { hard?: Record<string, string>; used?: Record<string, string> };
}

interface ResourceQuotaRow {
  name: string;
  namespace: string;
  cpuRequests: string;
  cpuRequestsPct: number | null;
  cpuLimits: string;
  memoryRequests: string;
  memoryRequestsPct: number | null;
  memoryLimits: string;
  pods: string;
  podsPct: number | null;
  services: string;
  pvcs: string;
  overallUsagePct: number | null;
  age: string;
  creationTimestamp?: string;
  hasScopeSelector: boolean;
  isNearLimit: boolean;
  isAtLimit: boolean;
}

// parseQuantityToNum is now imported from @/lib/k8s-utils

function computeUsagePercent(used: Record<string, string>, hard: Record<string, string>): number | null {
  let maxPct: number | null = null;
  for (const key of Object.keys(hard || {})) {
    const pct = formatUsagePercent(used?.[key], hard?.[key]);
    if (pct != null && (maxPct == null || pct > maxPct)) maxPct = pct;
  }
  return maxPct;
}

function usagePercentForKey(used: Record<string, string>, hard: Record<string, string>, key: string): number | null {
  return formatUsagePercent(used?.[key], hard?.[key]);
}

function usageBarIndicatorClass(pct: number | null): string {
  if (pct == null) return 'bg-muted-foreground/40';
  if (pct >= 100) return 'bg-destructive';
  if (pct >= 80) return 'bg-amber-500';
  return 'bg-[hsl(142,76%,36%)]';
}

function formatUsedHard(used: Record<string, string>, hard: Record<string, string>, key: string): string {
  const u = (used || {})[key] ?? '–';
  const h = (hard || {})[key] ?? '–';
  return `${u}/${h}`;
}

function transformResourceQuota(r: ResourceQuotaResource): ResourceQuotaRow {
  const hard = r.status?.hard || r.spec?.hard || {};
  const used = r.status?.used || {};
  const overallPct = computeUsagePercent(used, hard);
  const isNearLimit = overallPct != null && overallPct >= 80 && overallPct < 100;
  const isAtLimit = overallPct != null && overallPct >= 100;
  const hasScopeSelector = !!(r.spec?.scopeSelector && Object.keys((r.spec.scopeSelector as Record<string, unknown>) || {}).length > 0);
  return {
    name: r.metadata.name,
    namespace: r.metadata.namespace || 'default',
    cpuRequests: formatUsedHard(used, hard, 'requests.cpu'),
    cpuRequestsPct: usagePercentForKey(used, hard, 'requests.cpu'),
    cpuLimits: formatUsedHard(used, hard, 'limits.cpu'),
    memoryRequests: formatUsedHard(used, hard, 'requests.memory'),
    memoryRequestsPct: usagePercentForKey(used, hard, 'requests.memory'),
    memoryLimits: formatUsedHard(used, hard, 'limits.memory'),
    pods: formatUsedHard(used, hard, 'pods'),
    podsPct: usagePercentForKey(used, hard, 'pods'),
    services: formatUsedHard(used, hard, 'services'),
    pvcs: formatUsedHard(used, hard, 'persistentvolumeclaims'),
    overallUsagePct: overallPct,
    age: calculateAge(r.metadata.creationTimestamp),
    creationTimestamp: r.metadata?.creationTimestamp,
    hasScopeSelector,
    isNearLimit,
    isAtLimit,
  };
}

const RQ_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'name', defaultWidth: 160, minWidth: 100 },
  { id: 'namespace', defaultWidth: 120, minWidth: 80 },
  { id: 'cpuRequests', defaultWidth: 110, minWidth: 80 },
  { id: 'cpuLimits', defaultWidth: 110, minWidth: 80 },
  { id: 'memoryRequests', defaultWidth: 120, minWidth: 80 },
  { id: 'memoryLimits', defaultWidth: 120, minWidth: 80 },
  { id: 'pods', defaultWidth: 80, minWidth: 50 },
  { id: 'services', defaultWidth: 90, minWidth: 50 },
  { id: 'pvcs', defaultWidth: 90, minWidth: 50 },
  { id: 'overallUsage', defaultWidth: 100, minWidth: 70 },
  { id: 'age', defaultWidth: 90, minWidth: 56 },
];

const RQ_COLUMNS_FOR_VISIBILITY = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'cpuRequests', label: 'CPU Used / Limit' },
  { id: 'cpuLimits', label: 'CPU Lim' },
  { id: 'memoryRequests', label: 'Memory Used / Limit' },
  { id: 'memoryLimits', label: 'Mem Lim' },
  { id: 'pods', label: 'Pod Count' },
  { id: 'services', label: 'Services' },
  { id: 'pvcs', label: 'PVCs' },
  { id: 'overallUsage', label: 'Overall %' },
  { id: 'age', label: 'Age' },
];

export default function ResourceQuotas() {
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const { data, isLoading, refetch, pagination: hookPagination } = usePaginatedResourceList<ResourceQuotaResource>('resourcequotas');
  const deleteResource = useDeleteK8sResource('resourcequotas');

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: ResourceQuotaRow | null; bulk?: boolean }>({ open: false, item: null });
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showCreator, setShowCreator] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [listView, setListView] = useState<'flat' | 'byNamespace'>('flat');
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  const allItems = (data?.allItems ?? []) as ResourceQuotaResource[];
  const items: ResourceQuotaRow[] = useMemo(() => (isConnected ? allItems.map(transformResourceQuota) : []), [isConnected, allItems]);

  const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.namespace)))], [items]);
  const itemsAfterNs = useMemo(() => (selectedNamespace === 'all' ? items : items.filter((i) => i.namespace === selectedNamespace)), [items, selectedNamespace]);

  const tableConfig: ColumnConfig<ResourceQuotaRow>[] = useMemo(() => [
    { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
    { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
    { columnId: 'quotaStatus', getValue: (i) => i.isAtLimit ? 'At Limit' : i.isNearLimit ? 'Warning' : 'Healthy', sortable: true, filterable: true },
    { columnId: 'cpuRequests', getValue: (i) => i.cpuRequests, sortable: true, filterable: false },
    { columnId: 'cpuLimits', getValue: (i) => i.cpuLimits, sortable: true, filterable: false },
    { columnId: 'memoryRequests', getValue: (i) => i.memoryRequests, sortable: true, filterable: false },
    { columnId: 'memoryLimits', getValue: (i) => i.memoryLimits, sortable: true, filterable: false },
    { columnId: 'pods', getValue: (i) => i.pods, sortable: true, filterable: false },
    { columnId: 'services', getValue: (i) => i.services, sortable: true, filterable: false },
    { columnId: 'pvcs', getValue: (i) => i.pvcs, sortable: true, filterable: false },
    { columnId: 'overallUsage', getValue: (i) => i.overallUsagePct ?? -1, sortable: true, filterable: false, compare: (a, b) => (a.overallUsagePct ?? -1) - (b.overallUsagePct ?? -1) },
    { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
  ], []);

  const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterNs, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
  const columnVisibility = useColumnVisibility({ tableId: 'resourcequotas', columns: RQ_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

  const searchFiltered = useMemo(() => {
    if (!searchQuery.trim()) return filteredItems;
    const q = searchQuery.toLowerCase();
    return filteredItems.filter((i) => i.name.toLowerCase().includes(q) || i.namespace.toLowerCase().includes(q));
  }, [filteredItems, searchQuery]);

  const stats = useMemo(() => {
    const total = items.length;
    const atLimit = items.filter((i) => i.isAtLimit).length;
    const warning = items.filter((i) => i.isNearLimit).length;
    const healthy = items.filter((i) => !i.isNearLimit && !i.isAtLimit).length;
    return { total, atLimit, warning, healthy };
  }, [items]);

  const totalFiltered = searchFiltered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = searchFiltered.slice(start, start + pageSize);

  useEffect(() => {
    if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
  }, [safePageIndex, pageIndex]);

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPageIndex(0);
  };

  const pagination = {
    rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No resource quotas',
    hasPrev: safePageIndex > 0,
    hasNext: start + pageSize < totalFiltered,
    onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
    onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
    currentPage: safePageIndex + 1,
    totalPages: Math.max(1, totalPages),
    onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
    dataUpdatedAt: hookPagination?.dataUpdatedAt,
    isFetching: hookPagination?.isFetching,
  };

  const handleDelete = async () => {
    if (!isConnected) {
      toast.info('Connect cluster to delete resources');
      return;
    }
    if (deleteDialog.bulk && selectedItems.size > 0) {
      for (const key of selectedItems) {
        const [ns, n] = key.split('/');
        if (n && ns) await deleteResource.mutateAsync({ name: n, namespace: ns });
      }
      toast.success(`Deleted ${selectedItems.size} resource quota(s)`);
      setSelectedItems(new Set());
    } else if (deleteDialog.item) {
      await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
      toast.success(`Resource quota ${deleteDialog.item.name} deleted`);
    }
    setDeleteDialog({ open: false, item: null });
    refetch();
  };

  const toggleSelection = (r: ResourceQuotaRow) => {
    const key = `${r.namespace}/${r.name}`;
    const next = new Set(selectedItems);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedItems(next);
  };
  const toggleAll = () => {
    if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(itemsOnPage.map((r) => `${r.namespace}/${r.name}`)));
  };
  const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
  const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

  const exportConfig = {
    filenamePrefix: 'resource-quotas',
    resourceLabel: 'Resource Quotas',
    getExportData: (r: ResourceQuotaRow) => ({ name: r.name, namespace: r.namespace, cpuRequests: r.cpuRequests, memoryRequests: r.memoryRequests, pods: r.pods, overallUsagePct: r.overallUsagePct, age: r.age }),
    csvColumns: [
      { label: 'Name', getValue: (r: ResourceQuotaRow) => r.name },
      { label: 'Namespace', getValue: (r: ResourceQuotaRow) => r.namespace },
      { label: 'Pods', getValue: (r: ResourceQuotaRow) => r.pods },
      { label: 'Overall %', getValue: (r: ResourceQuotaRow) => (r.overallUsagePct != null ? String(r.overallUsagePct) : '–') },
      { label: 'Age', getValue: (r: ResourceQuotaRow) => r.age },
    ],
  };

  if (showCreator) {
    return (
      <ResourceCreator
        resourceKind="ResourceQuota"
        defaultYaml={DEFAULT_YAMLS.ResourceQuota}
        onClose={() => setShowCreator(false)}
        onApply={() => { toast.success('ResourceQuota created'); setShowCreator(false); refetch(); }}
      />
    );
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <ListPageHeader
          icon={<Gauge className="h-6 w-6 text-primary" />}
          title="Resource Quotas"
          resourceCount={searchFiltered.length}
          subtitle={namespaces.length > 1 ? `across ${namespaces.length - 1} namespaces` : undefined}
          demoMode={!isConnected}
          isLoading={isLoading}
          onRefresh={() => refetch()}
          createLabel="Create"
          onCreate={() => setShowCreator(true)}
          actions={
            <>
              <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => `${r.namespace}/${r.name}`} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected resource quotas' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
              {selectedItems.size > 0 && (
                <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete {selectedItems.size} selected
                </Button>
              )}
            </>
          }
        />

        <div className={cn('grid grid-cols-2 sm:grid-cols-4 gap-4', !isConnected && 'opacity-60')}>
          <ListPageStatCard label="Total" value={stats.total} icon={Gauge} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && 'ring-2 ring-primary')} />
          <ListPageStatCard label="At Limit" value={stats.atLimit} icon={Gauge} iconColor="text-destructive" valueClassName="text-destructive" selected={columnFilters.quotaStatus?.size === 1 && columnFilters.quotaStatus.has('At Limit')} onClick={() => setColumnFilter('quotaStatus', new Set(['At Limit']))} className={cn(columnFilters.quotaStatus?.size === 1 && columnFilters.quotaStatus.has('At Limit') && 'ring-2 ring-destructive')} />
          <ListPageStatCard label="Warning (≥80%)" value={stats.warning} icon={Gauge} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.quotaStatus?.size === 1 && columnFilters.quotaStatus.has('Warning')} onClick={() => setColumnFilter('quotaStatus', new Set(['Warning']))} className={cn(columnFilters.quotaStatus?.size === 1 && columnFilters.quotaStatus.has('Warning') && 'ring-2 ring-amber-600')} />
          <ListPageStatCard label="Healthy" value={stats.healthy} icon={Gauge} iconColor="text-[hsl(142,76%,36%)]" valueClassName="text-[hsl(142,76%,36%)]" selected={columnFilters.quotaStatus?.size === 1 && columnFilters.quotaStatus.has('Healthy')} onClick={() => setColumnFilter('quotaStatus', new Set(['Healthy']))} className={cn(columnFilters.quotaStatus?.size === 1 && columnFilters.quotaStatus.has('Healthy') && 'ring-2 ring-[hsl(142,76%,36%)]')} />
        </div>

        {/* Bulk Actions Bar */}
        {selectedItems.size > 0 && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <Badge variant="secondary" className="gap-1.5">
              <CheckSquare className="h-3.5 w-3.5" />
              {selectedItems.size} selected
            </Badge>
            <div className="flex items-center gap-2">
              <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => `${r.namespace}/${r.name}`} config={exportConfig} selectionLabel="Selected resource quotas" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
              <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete selected
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedItems(new Set())}>
                Clear
              </Button>
            </div>
          </motion.div>
        )}

        <ResourceListTableToolbar
          hasActiveFilters={hasActiveFilters}
          onClearAllFilters={clearAllFilters}
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
                  <Input placeholder="Search resource quotas..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search resource quotas" />
                </div>
              }
              structure={
                <ListViewSegmentedControl
                  value={listView}
                  onChange={(v) => setListView(v as 'flat' | 'byNamespace')}
                  options={[
                    { id: 'flat', label: 'Flat', icon: List },
                    { id: 'byNamespace', label: 'By Namespace', icon: Layers },
                  ]}
                  label=""
                  ariaLabel="List structure"
                />
              }
            />
          }
          showTableFilters={showTableFilters}
          onToggleTableFilters={() => setShowTableFilters((v) => !v)}
          columns={RQ_COLUMNS_FOR_VISIBILITY}
          visibleColumns={columnVisibility.visibleColumns}
          onColumnToggle={columnVisibility.setColumnVisible}
          footer={
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">{pagination.rangeLabel}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">{pageSize} per page<ChevronDown className="h-4 w-4 opacity-50" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <DropdownMenuItem key={size} onClick={() => handlePageSizeChange(size)} className={cn(pageSize === size && 'bg-accent')}>{size} per page</DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <ListPagination hasPrev={pagination.hasPrev} hasNext={pagination.hasNext} onPrev={pagination.onPrev} onNext={pagination.onNext} rangeLabel={undefined} currentPage={pagination.currentPage} totalPages={pagination.totalPages} onPageChange={pagination.onPageChange} dataUpdatedAt={pagination.dataUpdatedAt} isFetching={pagination.isFetching} />
            </div>
          }
        >
          <ResizableTableProvider tableId="resourcequotas" columnConfig={RQ_TABLE_COLUMNS}>
            <Table className="table-fixed" style={{ minWidth: 1100 }}>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
                  <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
                  <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="cpuRequests"><TableColumnHeaderWithFilterAndSort columnId="cpuRequests" label="CPU Used / Limit" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="cpuLimits"><TableColumnHeaderWithFilterAndSort columnId="cpuLimits" label="CPU Lim" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="memoryRequests"><TableColumnHeaderWithFilterAndSort columnId="memoryRequests" label="Memory Used / Limit" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="memoryLimits"><TableColumnHeaderWithFilterAndSort columnId="memoryLimits" label="Mem Lim" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="pods"><TableColumnHeaderWithFilterAndSort columnId="pods" label="Pod Count" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="services"><TableColumnHeaderWithFilterAndSort columnId="services" label="Services" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="pvcs"><TableColumnHeaderWithFilterAndSort columnId="pvcs" label="PVCs" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="overallUsage"><TableColumnHeaderWithFilterAndSort columnId="overallUsage" label="Overall %" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
                </TableRow>
                {showTableFilters && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
                    <TableCell className="w-10" />
                    <ResizableTableCell columnId="name" className="p-1.5" />
                    <ResizableTableCell columnId="namespace" className="p-1.5"><TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} /></ResizableTableCell>
                    <ResizableTableCell columnId="cpuRequests" className="p-1.5" />
                    <ResizableTableCell columnId="cpuLimits" className="p-1.5" />
                    <ResizableTableCell columnId="memoryRequests" className="p-1.5" />
                    <ResizableTableCell columnId="memoryLimits" className="p-1.5" />
                    <ResizableTableCell columnId="pods" className="p-1.5" />
                    <ResizableTableCell columnId="services" className="p-1.5" />
                    <ResizableTableCell columnId="pvcs" className="p-1.5" />
                    <ResizableTableCell columnId="overallUsage" className="p-1.5"><TableFilterCell columnId="quotaStatus" label="Status" distinctValues={distinctValuesByColumn.quotaStatus ?? []} selectedFilterValues={columnFilters.quotaStatus ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.quotaStatus} /></ResizableTableCell>
                    <ResizableTableCell columnId="age" className="p-1.5" />
                    <TableCell className="w-12" />
                  </TableRow>
                )}
              </TableHeader>
              <TableBody>
                {isLoading && isConnected ? (
                  <TableRow>
                    <TableCell colSpan={13} className="h-32 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Loading...</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : searchFiltered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="h-40 text-center">
                      <TableEmptyState
                        icon={<Gauge className="h-8 w-8" />}
                        title="No ResourceQuotas found"
                        subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Set aggregate resource limits per namespace.'}
                        hasActiveFilters={!!(searchQuery || hasActiveFilters)}
                        onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
                        createLabel="Create ResourceQuota"
                        onCreate={() => setShowCreator(true)}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  itemsOnPage.map((r, idx) => (
                    <motion.tr key={`${r.namespace}/${r.name}`} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(`${r.namespace}/${r.name}`) && 'bg-primary/5')}>
                      <TableCell><Checkbox checked={selectedItems.has(`${r.namespace}/${r.name}`)} onCheckedChange={() => toggleSelection(r)} aria-label={`Select ${r.name}`} /></TableCell>
                      <ResizableTableCell columnId="name">
                        <Link to={`/resourcequotas/${r.namespace}/${r.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
                          <Gauge className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">{r.name}</span>
                        </Link>
                      </ResizableTableCell>
                      <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={r.namespace} /></ResizableTableCell>
                      <ResizableTableCell columnId="cpuRequests">
                        {r.cpuRequestsPct != null ? (
                          <div className="flex items-center gap-2 min-w-0">
                            <Progress value={Math.min(r.cpuRequestsPct, 100)} className="h-2 w-16 shrink-0" indicatorClassName={usageBarIndicatorClass(r.cpuRequestsPct)} />
                            <span className={cn('text-xs font-mono truncate', r.cpuRequestsPct >= 100 && 'text-destructive', r.cpuRequestsPct >= 80 && r.cpuRequestsPct < 100 && 'text-amber-600', r.cpuRequestsPct < 80 && 'text-[hsl(142,76%,36%)]')} title={r.cpuRequests}>{r.cpuRequests}</span>
                          </div>
                        ) : <span className="text-muted-foreground font-mono text-xs" title={r.cpuRequests}>{r.cpuRequests}</span>}
                      </ResizableTableCell>
                      <ResizableTableCell columnId="cpuLimits" className="font-mono text-xs">{r.cpuLimits}</ResizableTableCell>
                      <ResizableTableCell columnId="memoryRequests">
                        {r.memoryRequestsPct != null ? (
                          <div className="flex items-center gap-2 min-w-0">
                            <Progress value={Math.min(r.memoryRequestsPct, 100)} className="h-2 w-16 shrink-0" indicatorClassName={usageBarIndicatorClass(r.memoryRequestsPct)} />
                            <span className={cn('text-xs font-mono truncate', r.memoryRequestsPct >= 100 && 'text-destructive', r.memoryRequestsPct >= 80 && r.memoryRequestsPct < 100 && 'text-amber-600', r.memoryRequestsPct < 80 && 'text-[hsl(142,76%,36%)]')} title={r.memoryRequests}>{r.memoryRequests}</span>
                          </div>
                        ) : <span className="text-muted-foreground font-mono text-xs" title={r.memoryRequests}>{r.memoryRequests}</span>}
                      </ResizableTableCell>
                      <ResizableTableCell columnId="memoryLimits" className="font-mono text-xs truncate" title={r.memoryLimits}>{r.memoryLimits}</ResizableTableCell>
                      <ResizableTableCell columnId="pods">
                        {r.podsPct != null ? (
                          <div className="flex items-center gap-2 min-w-0">
                            <Progress value={Math.min(r.podsPct, 100)} className="h-2 w-16 shrink-0" indicatorClassName={usageBarIndicatorClass(r.podsPct)} />
                            <span className={cn('text-xs font-mono truncate', r.podsPct >= 100 && 'text-destructive', r.podsPct >= 80 && r.podsPct < 100 && 'text-amber-600', r.podsPct < 80 && 'text-[hsl(142,76%,36%)]')} title={r.pods}>{r.pods}</span>
                          </div>
                        ) : <span className="text-muted-foreground font-mono text-xs" title={r.pods}>{r.pods}</span>}
                      </ResizableTableCell>
                      <ResizableTableCell columnId="services" className="font-mono text-sm">{r.services}</ResizableTableCell>
                      <ResizableTableCell columnId="pvcs" className="font-mono text-sm">{r.pvcs}</ResizableTableCell>
                      <ResizableTableCell columnId="overallUsage">
                        {r.overallUsagePct != null ? (
                          <div className="flex items-center gap-2">
                            <Progress value={Math.min(r.overallUsagePct, 100)} className="h-2 w-14" indicatorClassName={usageBarIndicatorClass(r.overallUsagePct)} />
                            <span className={cn('text-sm font-medium', r.isAtLimit && 'text-destructive', r.isNearLimit && !r.isAtLimit && 'text-amber-600', !r.isAtLimit && !r.isNearLimit && 'text-[hsl(142,76%,36%)]')}>{r.overallUsagePct}%</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </ResizableTableCell>
                      <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={r.age} timestamp={r.creationTimestamp} /></ResizableTableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="Resource quota actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <CopyNameDropdownItem name={r.name} namespace={r.namespace} />
                            <DropdownMenuItem onClick={() => navigate(`/resourcequotas/${r.namespace}/${r.name}`)} className="gap-2">View Details</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/namespaces/${r.namespace}`)} className="gap-2">View Namespace</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => navigate(`/resourcequotas/${r.namespace}/${r.name}?tab=yaml`)} className="gap-2">Edit YAML</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/resourcequotas/${r.namespace}/${r.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteDialog({ open: true, item: r })} disabled={!isConnected}>Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </motion.tr>
                  ))
                )}
              </TableBody>
            </Table>
          </ResizableTableProvider>
        </ResourceListTableToolbar>
      </motion.div>

      <DeleteConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null, bulk: open ? deleteDialog.bulk : false })}
        resourceType="ResourceQuota"
        resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name || '')}
        namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace}
        onConfirm={handleDelete}
        requireNameConfirmation={!deleteDialog.bulk}
      />
    </>
  );
}
