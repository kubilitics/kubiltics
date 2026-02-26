import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search, RefreshCw, MoreHorizontal, Loader2, Cpu, ChevronDown, CheckSquare, Trash2, FileText,
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
import { ResourceCommandBar, ClusterScopedScope, ResourceExportDropdown, ListPagination, PAGE_SIZE_OPTIONS, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, resourceTableRowClassName, ROW_MOTION, AgeCell, TableEmptyState, TableSkeletonRows, CopyNameDropdownItem, ResourceListTableToolbar } from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { usePaginatedResourceList, useDeleteK8sResource, useCreateK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog } from '@/components/resources';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor/ResourceCreator';
import { toast } from 'sonner';

interface ResourceSlice {
  name: string;
  node: string;
  driver: string;
  pool: string;
  capacity: string;
  age: string;
  creationTimestamp?: string;
}

interface K8sResourceSlice extends KubernetesResource {
  driver?: string;
  nodeName?: string;
  pool?: { name?: string; generation?: number; resourceSliceCount?: number };
  namedResources?: unknown;
  structuredResources?: unknown;
}

function formatCapacity(rs: K8sResourceSlice): string {
  const raw = rs as unknown as Record<string, unknown>;
  const named = raw.namedResources as { entries?: Array<{ capacity?: Record<string, string> }> } | undefined;
  const structured = raw.structuredResources as { capacity?: Record<string, string> } | undefined;
  if (named?.entries?.length) {
    const caps = named.entries.flatMap((e) => e.capacity ? Object.values(e.capacity) : []);
    return caps.length ? caps.join(', ') : '—';
  }
  if (structured?.capacity && Object.keys(structured.capacity).length) {
    return Object.entries(structured.capacity).map(([k, v]) => `${k}: ${v}`).join(', ');
  }
  return '—';
}

function mapRS(rs: K8sResourceSlice): ResourceSlice {
  const raw = rs as unknown as Record<string, unknown>;
  const driver = (raw.driver as string) ?? (raw.spec as Record<string, unknown>)?.driver ?? '—';
  const nodeName = (raw.nodeName as string) ?? (raw.spec as Record<string, unknown>)?.nodeName;
  const pool = raw.pool as { name?: string } | undefined;
  const poolName = (pool as any)?.name ?? (raw.spec as any)?.pool?.name ?? '—';
  const node = nodeName ?? poolName ?? '—';
  return {
    name: rs.metadata?.name ?? '',
    node: String(node),
    driver: String(driver),
    pool: String(poolName),
    capacity: formatCapacity(rs),
    age: calculateAge(rs.metadata?.creationTimestamp),
    creationTimestamp: rs.metadata?.creationTimestamp,
  };
}

const RS_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'name', defaultWidth: 260, minWidth: 140 },
  { id: 'node', defaultWidth: 160, minWidth: 100 },
  { id: 'driver', defaultWidth: 180, minWidth: 100 },
  { id: 'pool', defaultWidth: 160, minWidth: 100 },
  { id: 'capacity', defaultWidth: 180, minWidth: 100 },
  { id: 'age', defaultWidth: 100, minWidth: 56 },
];

const RS_COLUMNS_FOR_VISIBILITY = [
  { id: 'node', label: 'Node' },
  { id: 'driver', label: 'Driver' },
  { id: 'pool', label: 'Pool' },
  { id: 'capacity', label: 'Capacity' },
  { id: 'age', label: 'Age' },
];

export default function ResourceSlices() {
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const { data, isLoading, refetch, pagination: hookPagination } = usePaginatedResourceList<K8sResourceSlice>('resourceslices');
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: ResourceSlice | null; bulk?: boolean }>({ open: false, item: null });
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const deleteRS = useDeleteK8sResource('resourceslices');
  const createRS = useCreateK8sResource('resourceslices');

  const allItems = (data?.allItems ?? []) as K8sResourceSlice[];
  const items: ResourceSlice[] = useMemo(() => (isConnected ? allItems.map(mapRS) : []), [isConnected, allItems]);

  const stats = useMemo(() => ({
    total: items.length,
    drivers: new Set(items.map((i) => i.driver).filter((d) => d !== '—')).size,
    nodes: new Set(items.map((i) => i.node).filter((n) => n !== '—')).size,
    pools: new Set(items.map((i) => i.pool).filter((p) => p !== '—')).size,
  }), [items]);

  const itemsAfterSearch = useMemo(
    () => items.filter((item) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.driver.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.node.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.pool.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [items, searchQuery]
  );

  const tableConfig: ColumnConfig<ResourceSlice>[] = useMemo(
    () => [
      { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
      { columnId: 'node', getValue: (i) => i.node, sortable: true, filterable: true },
      { columnId: 'driver', getValue: (i) => i.driver, sortable: true, filterable: true },
      { columnId: 'pool', getValue: (i) => i.pool, sortable: true, filterable: true },
      { columnId: 'capacity', getValue: (i) => i.capacity, sortable: true, filterable: false },
      { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
    ],
    []
  );

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
  } = useTableFiltersAndSort(itemsAfterSearch, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
  const columnVisibility = useColumnVisibility({ tableId: 'resourceslices', columns: RS_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

  const totalFiltered = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = filteredItems.slice(start, start + pageSize);

  useEffect(() => {
    if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
  }, [safePageIndex, pageIndex]);

  const handleCreate = () => setShowCreateWizard(true);
  const handleApplyCreate = async (yaml: string) => {
    try {
      await createRS.mutateAsync({ yaml });
      setShowCreateWizard(false);
      refetch();
    } catch (err) {
      // toast handled in hook
    }
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPageIndex(0);
  };

  const handleDelete = async () => {
    if (!isConnected) {
      toast.info('Connect cluster to delete resources');
      return;
    }
    if (deleteDialog.bulk && selectedItems.size > 0) {
      for (const name of selectedItems) {
        await deleteRS.mutateAsync({ name, namespace: '' });
      }
      toast.success(`Deleted ${selectedItems.size} resource slice(s)`);
      setSelectedItems(new Set());
    } else if (deleteDialog.item) {
      await deleteRS.mutateAsync({ name: deleteDialog.item.name, namespace: '' });
      toast.success(`ResourceSlice ${deleteDialog.item.name} deleted`);
    }
    setDeleteDialog({ open: false, item: null });
    refetch();
  };

  const toggleSelection = (rs: ResourceSlice) => {
    const next = new Set(selectedItems);
    if (next.has(rs.name)) next.delete(rs.name);
    else next.add(rs.name);
    setSelectedItems(next);
  };
  const toggleAll = () => {
    if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(itemsOnPage.map((v) => v.name)));
  };
  const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
  const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

  const pagination = {
    rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No resource slices',
    hasPrev: safePageIndex > 0,
    hasNext: start + pageSize < totalFiltered,
    onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
    onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
    currentPage: safePageIndex + 1,
    totalPages: Math.max(1, totalPages),
    onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
  };

  const exportConfig = {
    filenamePrefix: 'resourceslices',
    resourceLabel: 'ResourceSlices',
    getExportData: (v: ResourceSlice) => ({ name: v.name, node: v.node, driver: v.driver, pool: v.pool, capacity: v.capacity, age: v.age }),
    csvColumns: [
      { label: 'Name', getValue: (v: ResourceSlice) => v.name },
      { label: 'Node', getValue: (v: ResourceSlice) => v.node },
      { label: 'Driver', getValue: (v: ResourceSlice) => v.driver },
      { label: 'Pool', getValue: (v: ResourceSlice) => v.pool },
      { label: 'Capacity', getValue: (v: ResourceSlice) => v.capacity },
      { label: 'Age', getValue: (v: ResourceSlice) => v.age },
    ],
    toK8sYaml: () => 'ResourceSlices are published by DRA drivers.',
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <ListPageHeader
        icon={<Cpu className="h-6 w-6 text-primary" />}
        title="Resource Slices"
        resourceCount={filteredItems.length}
        subtitle="Cluster-scoped · DRA (GPU/accelerator) capacity"
        demoMode={!isConnected}
        isLoading={isLoading}
        onRefresh={() => refetch()}
        createLabel="Create Resource Slice"
        onCreate={handleCreate}
        actions={
          <>
            <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={(v) => v.name} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected slices' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
        <ListPageStatCard label="Total" value={stats.total} icon={Cpu} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && 'ring-2 ring-primary')} />
        <ListPageStatCard label="By Driver" value={stats.drivers} icon={Cpu} iconColor="text-muted-foreground" selected={false} onClick={() => { }} />
        <ListPageStatCard label="Nodes" value={stats.nodes} icon={Cpu} iconColor="text-muted-foreground" selected={false} onClick={() => { }} />
        <ListPageStatCard label="Pools" value={stats.pools} icon={Cpu} iconColor="text-muted-foreground" selected={false} onClick={() => { }} />
      </div>

      {selectedItems.size > 0 && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <Badge variant="secondary" className="gap-1.5">
            <CheckSquare className="h-3.5 w-3.5" />
            {selectedItems.size} selected
          </Badge>
          <div className="flex items-center gap-2">
            <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={(v) => v.name} config={exportConfig} selectionLabel="Selected slices" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete selected
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedItems(new Set())}>Clear</Button>
          </div>
        </motion.div>
      )}

      <ResourceListTableToolbar
        globalFilterBar={
          <ResourceCommandBar
            scope={<ClusterScopedScope />}
            search={
              <div className="relative w-full min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search resource slices..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search resource slices" />
              </div>
            }
          />
        }
        hasActiveFilters={hasActiveFilters}
        onClearAllFilters={clearAllFilters}
        showTableFilters={showTableFilters}
        onToggleTableFilters={() => setShowTableFilters((v) => !v)}
        columns={RS_COLUMNS_FOR_VISIBILITY}
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
            <ListPagination hasPrev={pagination.hasPrev} hasNext={pagination.hasNext} onPrev={pagination.onPrev} onNext={pagination.onNext} rangeLabel={undefined} currentPage={pagination.currentPage} totalPages={pagination.totalPages} onPageChange={pagination.onPageChange} dataUpdatedAt={hookPagination?.dataUpdatedAt} isFetching={hookPagination?.isFetching} />
          </div>
        }
      >
        <ResizableTableProvider tableId="resourceslices" columnConfig={RS_TABLE_COLUMNS}>
          <Table className="table-fixed" style={{ minWidth: 980 }}>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
                <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
                <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                {columnVisibility.isColumnVisible('node') && <ResizableTableHead columnId="node"><TableColumnHeaderWithFilterAndSort columnId="node" label="Node" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>}
                {columnVisibility.isColumnVisible('driver') && <ResizableTableHead columnId="driver"><TableColumnHeaderWithFilterAndSort columnId="driver" label="Driver" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>}
                {columnVisibility.isColumnVisible('pool') && <ResizableTableHead columnId="pool"><TableColumnHeaderWithFilterAndSort columnId="pool" label="Pool" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>}
                {columnVisibility.isColumnVisible('capacity') && <ResizableTableHead columnId="capacity"><TableColumnHeaderWithFilterAndSort columnId="capacity" label="Capacity" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>}
                {columnVisibility.isColumnVisible('age') && <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>}
                <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
              </TableRow>
              {showTableFilters && (
                <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
                  <TableCell className="w-10 p-1.5" />
                  <ResizableTableCell columnId="name" className="p-1.5" />
                  {columnVisibility.isColumnVisible('node') && (
                    <ResizableTableCell columnId="node" className="p-1.5">
                      <TableFilterCell columnId="node" label="Node" distinctValues={distinctValuesByColumn.node ?? []} selectedFilterValues={columnFilters.node ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.node} />
                    </ResizableTableCell>
                  )}
                  {columnVisibility.isColumnVisible('driver') && (
                    <ResizableTableCell columnId="driver" className="p-1.5">
                      <TableFilterCell columnId="driver" label="Driver" distinctValues={distinctValuesByColumn.driver ?? []} selectedFilterValues={columnFilters.driver ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.driver} />
                    </ResizableTableCell>
                  )}
                  {columnVisibility.isColumnVisible('pool') && (
                    <ResizableTableCell columnId="pool" className="p-1.5">
                      <TableFilterCell columnId="pool" label="Pool" distinctValues={distinctValuesByColumn.pool ?? []} selectedFilterValues={columnFilters.pool ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.pool} />
                    </ResizableTableCell>
                  )}
                  {columnVisibility.isColumnVisible('capacity') && <ResizableTableCell columnId="capacity" className="p-1.5" />}
                  {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
                  <TableCell className="w-12 p-1.5" />
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {isLoading && isConnected ? (
                <TableSkeletonRows columnCount={9} />
              ) : itemsOnPage.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-40 text-center">
                    <TableEmptyState
                      icon={<Cpu className="h-8 w-8" />}
                      title="No Resource Slices found"
                      subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'ResourceSlices require Kubernetes 1.31+ with DynamicResourceAllocation feature gate and a DRA driver (e.g. for GPUs).'}
                      hasActiveFilters={!!(searchQuery || hasActiveFilters)}
                      onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                itemsOnPage.map((item, idx) => (
                  <motion.tr key={item.name} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(item.name) && 'bg-primary/5')}>
                    <TableCell><Checkbox checked={selectedItems.has(item.name)} onCheckedChange={() => toggleSelection(item)} /></TableCell>
                    <ResizableTableCell columnId="name">
                      <Link to={`/resourceslices/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
                        <Cpu className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="truncate font-mono text-sm">{item.name}</span>
                      </Link>
                    </ResizableTableCell>
                    {columnVisibility.isColumnVisible('node') && <ResizableTableCell columnId="node">{item.node !== '—' ? <Link to={`/nodes/${item.node}`} className="text-primary hover:underline truncate block">{item.node}</Link> : <span className="text-muted-foreground">—</span>}</ResizableTableCell>}
                    {columnVisibility.isColumnVisible('driver') && <ResizableTableCell columnId="driver" className="font-mono text-sm truncate" title={item.driver}>{item.driver}</ResizableTableCell>}
                    {columnVisibility.isColumnVisible('pool') && <ResizableTableCell columnId="pool" className="font-mono text-sm truncate" title={item.pool}>{item.pool}</ResizableTableCell>}
                    {columnVisibility.isColumnVisible('capacity') && <ResizableTableCell columnId="capacity" className="text-sm text-muted-foreground truncate max-w-[180px]" title={item.capacity}>{item.capacity}</ResizableTableCell>}
                    {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>}
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <CopyNameDropdownItem name={item.name} />
                          <DropdownMenuItem onClick={() => navigate(`/resourceslices/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
                          {item.node !== '—' && (
                            <DropdownMenuItem asChild>
                              <Link to={`/nodes/${item.node}`} className="gap-2">View Node</Link>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => navigate(`/resourceslices/${item.name}?tab=yaml`)} className="gap-2">Edit YAML</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => navigate(`/resourceslices/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="gap-2 text-[hsl(0,72%,51%)]" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
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

      <DeleteConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
        resourceType="ResourceSlice"
        resourceName={deleteDialog.bulk ? `${selectedItems.size} resource slices` : (deleteDialog.item?.name || '')}
        namespace={undefined}
        onConfirm={handleDelete}
      />

      {showCreateWizard && (
        <ResourceCreator
          resourceKind="ResourceSlice"
          onClose={() => setShowCreateWizard(false)}
          onApply={handleApplyCreate}
          defaultYaml={DEFAULT_YAMLS.ResourceSlice}
        />
      )}
    </motion.div>
  );
}
