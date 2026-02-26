import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Scale, Search, RefreshCw, MoreHorizontal, Loader2, WifiOff, Plus, ChevronDown, Filter, List, Layers, CheckSquare, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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

interface LimitRangeItem {
  type: string;
  default?: Record<string, string>;
  defaultRequest?: Record<string, string>;
  min?: Record<string, string>;
  max?: Record<string, string>;
  maxLimitRequestRatio?: Record<string, string>;
}

interface LimitRangeResource extends KubernetesResource {
  spec?: { limits?: LimitRangeItem[] };
}

interface LimitRangeRow {
  name: string;
  namespace: string;
  types: string[];
  defaultCpu: string;
  defaultMemory: string;
  maxCpu: string;
  maxMemory: string;
  age: string;
  creationTimestamp?: string;
  hasContainer: boolean;
  hasPod: boolean;
}

function getContainerLimit(limits: LimitRangeItem[]): LimitRangeItem | undefined {
  return limits?.find((l) => l.type === 'Container');
}

function getPodLimit(limits: LimitRangeItem[]): LimitRangeItem | undefined {
  return limits?.find((l) => l.type === 'Pod');
}

function transformLimitRange(r: LimitRangeResource): LimitRangeRow {
  const limits = r.spec?.limits ?? [];
  const container = getContainerLimit(limits);
  const pod = getPodLimit(limits);
  const types = limits.map((l) => l.type);
  const defaultCpu = container?.default?.cpu ?? container?.defaultRequest?.cpu ?? '–';
  const defaultMemory = container?.default?.memory ?? container?.defaultRequest?.memory ?? '–';
  const maxCpu = container?.max?.cpu ?? pod?.max?.cpu ?? '–';
  const maxMemory = container?.max?.memory ?? pod?.max?.memory ?? '–';
  return {
    name: r.metadata.name,
    namespace: r.metadata.namespace || 'default',
    types,
    defaultCpu,
    defaultMemory,
    maxCpu,
    maxMemory,
    age: calculateAge(r.metadata.creationTimestamp),
    creationTimestamp: r.metadata?.creationTimestamp,
    hasContainer: !!container,
    hasPod: !!pod,
  };
}

const LR_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'name', defaultWidth: 160, minWidth: 100 },
  { id: 'namespace', defaultWidth: 120, minWidth: 80 },
  { id: 'types', defaultWidth: 160, minWidth: 100 },
  { id: 'defaultCpu', defaultWidth: 100, minWidth: 70 },
  { id: 'defaultMemory', defaultWidth: 110, minWidth: 80 },
  { id: 'maxCpu', defaultWidth: 90, minWidth: 60 },
  { id: 'maxMemory', defaultWidth: 110, minWidth: 80 },
  { id: 'age', defaultWidth: 90, minWidth: 56 },
];

const LR_COLUMNS_FOR_VISIBILITY = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'types', label: 'Limit Types' },
  { id: 'defaultCpu', label: 'Default CPU' },
  { id: 'defaultMemory', label: 'Default Memory' },
  { id: 'maxCpu', label: 'Max CPU' },
  { id: 'maxMemory', label: 'Max Memory' },
  { id: 'age', label: 'Age' },
];

export default function LimitRanges() {
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const { data, isLoading, refetch, pagination: hookPagination } = usePaginatedResourceList<LimitRangeResource>('limitranges');
  const deleteResource = useDeleteK8sResource('limitranges');

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: LimitRangeRow | null; bulk?: boolean }>({ open: false, item: null });
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showCreator, setShowCreator] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [listView, setListView] = useState<'flat' | 'byNamespace'>('flat');
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  const allItems = (data?.allItems ?? []) as LimitRangeResource[];
  const items: LimitRangeRow[] = useMemo(() => (isConnected ? allItems.map(transformLimitRange) : []), [isConnected, allItems]);

  const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.namespace)))], [items]);
  const itemsAfterNs = useMemo(() => (selectedNamespace === 'all' ? items : items.filter((i) => i.namespace === selectedNamespace)), [items, selectedNamespace]);

  const tableConfig: ColumnConfig<LimitRangeRow>[] = useMemo(() => [
    { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
    { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
    { columnId: 'limitCategory', getValue: (i) => i.hasContainer && i.hasPod ? 'Container + Pod' : i.hasContainer ? 'Container' : i.hasPod ? 'Pod' : 'Other', sortable: true, filterable: true },
    { columnId: 'types', getValue: (i) => i.types.join(', '), sortable: true, filterable: false },
    { columnId: 'defaultCpu', getValue: (i) => i.defaultCpu, sortable: true, filterable: false },
    { columnId: 'defaultMemory', getValue: (i) => i.defaultMemory, sortable: true, filterable: false },
    { columnId: 'maxCpu', getValue: (i) => i.maxCpu, sortable: true, filterable: false },
    { columnId: 'maxMemory', getValue: (i) => i.maxMemory, sortable: true, filterable: false },
    { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
  ], []);

  const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterNs, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
  const columnVisibility = useColumnVisibility({ tableId: 'limitranges', columns: LR_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

  const searchFiltered = useMemo(() => {
    if (!searchQuery.trim()) return filteredItems;
    const q = searchQuery.toLowerCase();
    return filteredItems.filter((i) => i.name.toLowerCase().includes(q) || i.namespace.toLowerCase().includes(q));
  }, [filteredItems, searchQuery]);

  const stats = useMemo(() => {
    const total = items.length;
    const namespacesCovered = new Set(items.map((i) => i.namespace)).size;
    const containerLimits = items.filter((i) => i.hasContainer).length;
    const podLimits = items.filter((i) => i.hasPod).length;
    return { total, namespacesCovered, containerLimits, podLimits };
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
    rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No limit ranges',
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
      toast.success(`Deleted ${selectedItems.size} limit range(s)`);
      setSelectedItems(new Set());
    } else if (deleteDialog.item) {
      await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
      toast.success(`Limit range ${deleteDialog.item.name} deleted`);
    }
    setDeleteDialog({ open: false, item: null });
    refetch();
  };

  const toggleSelection = (r: LimitRangeRow) => {
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
    filenamePrefix: 'limit-ranges',
    resourceLabel: 'Limit Ranges',
    getExportData: (r: LimitRangeRow) => ({ name: r.name, namespace: r.namespace, types: r.types.join(', '), defaultCpu: r.defaultCpu, defaultMemory: r.defaultMemory, age: r.age }),
    csvColumns: [
      { label: 'Name', getValue: (r: LimitRangeRow) => r.name },
      { label: 'Namespace', getValue: (r: LimitRangeRow) => r.namespace },
      { label: 'Types', getValue: (r: LimitRangeRow) => r.types.join(', ') },
      { label: 'Age', getValue: (r: LimitRangeRow) => r.age },
    ],
  };

  if (showCreator) {
    return (
      <ResourceCreator
        resourceKind="LimitRange"
        defaultYaml={DEFAULT_YAMLS.LimitRange}
        onClose={() => setShowCreator(false)}
        onApply={() => { toast.success('LimitRange created'); setShowCreator(false); refetch(); }}
      />
    );
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <ListPageHeader
          icon={<Scale className="h-6 w-6 text-primary" />}
          title="Limit Ranges"
          resourceCount={searchFiltered.length}
          subtitle={namespaces.length > 1 ? `across ${namespaces.length - 1} namespaces` : undefined}
          demoMode={!isConnected}
          isLoading={isLoading}
          onRefresh={() => refetch()}
          createLabel="Create"
          onCreate={() => setShowCreator(true)}
          actions={
            <>
              <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => `${r.namespace}/${r.name}`} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected limit ranges' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
          <ListPageStatCard label="Total Limit Ranges" value={stats.total} icon={Scale} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && 'ring-2 ring-primary')} />
          <ListPageStatCard label="Namespaces Covered" value={stats.namespacesCovered} icon={Scale} iconColor="text-muted-foreground" />
          <ListPageStatCard label="Container Limits" value={stats.containerLimits} icon={Scale} iconColor="text-[hsl(217,91%,60%)]" valueClassName="text-[hsl(217,91%,60%)]" selected={columnFilters.limitCategory?.size === 1 && columnFilters.limitCategory.has('Container')} onClick={() => setColumnFilter('limitCategory', new Set(['Container']))} className={cn(columnFilters.limitCategory?.size === 1 && columnFilters.limitCategory.has('Container') && 'ring-2 ring-[hsl(217,91%,60%)]')} />
          <ListPageStatCard label="Pod Limits" value={stats.podLimits} icon={Scale} iconColor="text-[hsl(45,93%,47%)]" valueClassName="text-[hsl(45,93%,47%)]" selected={columnFilters.limitCategory?.size === 1 && columnFilters.limitCategory.has('Pod')} onClick={() => setColumnFilter('limitCategory', new Set(['Pod']))} className={cn(columnFilters.limitCategory?.size === 1 && columnFilters.limitCategory.has('Pod') && 'ring-2 ring-[hsl(45,93%,47%)]')} />
        </div>

        {/* Bulk Actions Bar */}
        {selectedItems.size > 0 && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <Badge variant="secondary" className="gap-1.5">
              <CheckSquare className="h-3.5 w-3.5" />
              {selectedItems.size} selected
            </Badge>
            <div className="flex items-center gap-2">
              <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => `${r.namespace}/${r.name}`} config={exportConfig} selectionLabel="Selected limit ranges" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
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
                  <Input placeholder="Search limit ranges..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search limit ranges" />
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
          columns={LR_COLUMNS_FOR_VISIBILITY}
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
          <ResizableTableProvider tableId="limitranges" columnConfig={LR_TABLE_COLUMNS}>
            <Table className="table-fixed" style={{ minWidth: 850 }}>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
                  <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
                  <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="types"><TableColumnHeaderWithFilterAndSort columnId="types" label="Limit Types" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="defaultCpu"><TableColumnHeaderWithFilterAndSort columnId="defaultCpu" label="Default CPU" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="defaultMemory"><TableColumnHeaderWithFilterAndSort columnId="defaultMemory" label="Default Memory" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="maxCpu"><TableColumnHeaderWithFilterAndSort columnId="maxCpu" label="Max CPU" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="maxMemory"><TableColumnHeaderWithFilterAndSort columnId="maxMemory" label="Max Memory" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                  <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
                </TableRow>
                {showTableFilters && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
                    <TableCell className="w-10" />
                    <ResizableTableCell columnId="name" className="p-1.5" />
                    <ResizableTableCell columnId="namespace" className="p-1.5"><TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} /></ResizableTableCell>
                    <ResizableTableCell columnId="types" className="p-1.5"><TableFilterCell columnId="limitCategory" label="Limit Category" distinctValues={distinctValuesByColumn.limitCategory ?? []} selectedFilterValues={columnFilters.limitCategory ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.limitCategory} /></ResizableTableCell>
                    <ResizableTableCell columnId="defaultCpu" className="p-1.5" />
                    <ResizableTableCell columnId="defaultMemory" className="p-1.5" />
                    <ResizableTableCell columnId="maxCpu" className="p-1.5" />
                    <ResizableTableCell columnId="maxMemory" className="p-1.5" />
                    <ResizableTableCell columnId="age" className="p-1.5" />
                    <TableCell className="w-12" />
                  </TableRow>
                )}
              </TableHeader>
              <TableBody>
                {isLoading && isConnected ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-32 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Loading...</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : searchFiltered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-40 text-center">
                      <TableEmptyState
                        icon={<Scale className="h-8 w-8" />}
                        title="No LimitRanges found"
                        subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Set default request/limit constraints per namespace.'}
                        hasActiveFilters={!!(searchQuery || hasActiveFilters)}
                        onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
                        createLabel="Create LimitRange"
                        onCreate={() => setShowCreator(true)}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  itemsOnPage.map((r, idx) => (
                    <motion.tr key={`${r.namespace}/${r.name}`} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(`${r.namespace}/${r.name}`) && 'bg-primary/5')}>
                      <TableCell><Checkbox checked={selectedItems.has(`${r.namespace}/${r.name}`)} onCheckedChange={() => toggleSelection(r)} aria-label={`Select ${r.name}`} /></TableCell>
                      <ResizableTableCell columnId="name">
                        <Link to={`/limitranges/${r.namespace}/${r.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
                          <Scale className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">{r.name}</span>
                        </Link>
                      </ResizableTableCell>
                      <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={r.namespace} /></ResizableTableCell>
                      <ResizableTableCell columnId="types">
                        <div className="flex flex-wrap gap-1">
                          {r.types.map((t) => (
                            <Badge key={t} variant={t === 'Container' ? 'default' : t === 'Pod' ? 'secondary' : 'outline'} className="text-xs">{t}</Badge>
                          ))}
                          {r.types.length === 0 && <span className="text-muted-foreground">–</span>}
                        </div>
                      </ResizableTableCell>
                      <ResizableTableCell columnId="defaultCpu" className="font-mono text-sm">{r.defaultCpu}</ResizableTableCell>
                      <ResizableTableCell columnId="defaultMemory" className="font-mono text-sm">{r.defaultMemory}</ResizableTableCell>
                      <ResizableTableCell columnId="maxCpu" className="font-mono text-sm">{r.maxCpu}</ResizableTableCell>
                      <ResizableTableCell columnId="maxMemory" className="font-mono text-sm">{r.maxMemory}</ResizableTableCell>
                      <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={r.age} timestamp={r.creationTimestamp} /></ResizableTableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="Limit range actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <CopyNameDropdownItem name={r.name} namespace={r.namespace} />
                            <DropdownMenuItem onClick={() => navigate(`/limitranges/${r.namespace}/${r.name}`)} className="gap-2">View Details</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => navigate(`/limitranges/${r.namespace}/${r.name}?tab=yaml`)} className="gap-2">Edit YAML</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => navigate(`/limitranges/${r.namespace}/${r.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
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
        resourceType="LimitRange"
        resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name || '')}
        namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace}
        onConfirm={handleDelete}
        requireNameConfirmation={!deleteDialog.bulk}
      />
    </>
  );
}
