import { useState, useMemo, useEffect } from 'react';
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
import { ResourceCommandBar, ClusterScopedScope, ResourceExportDropdown, ListPagination, PAGE_SIZE_OPTIONS, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, resourceTableRowClassName, ROW_MOTION, AgeCell, TableEmptyState, TableErrorState, ListPageLoadingShell, CopyNameDropdownItem, ResourceListTableToolbar } from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { usePaginatedResourceList, useDeleteK8sResource, useCreateK8sResource, usePatchK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog, BulkActionBar, executeBulkOperation } from '@/components/resources';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor/ResourceCreator';
import { toast } from '@/components/ui/sonner';
import { useMultiSelect } from '@/hooks/useMultiSelect';

interface DeviceClass {
 name: string;
 selectors: string;
 config: string;
 age: string;
 creationTimestamp?: string;
}

interface K8sDeviceClass extends KubernetesResource {
 spec?: {
 config?: Array<{ opaque?: { driver?: string; parameters?: unknown } }>;
 selectors?: Array<{ cel?: { expression?: string } }>;
 extendedResourceName?: string;
 };
}

function formatSelectors(dc: K8sDeviceClass): string {
 const sel = dc.spec?.selectors;
 if (!sel?.length) return '—';
 const celCount = sel.filter((s) => s.cel?.expression).length;
 if (celCount === 0) return '—';
 if (celCount === 1) {
 const expr = sel[0].cel?.expression ?? '';
 return expr.length > 60 ? `${expr.slice(0, 57)}…` : expr || '—';
 }
 return `${celCount} CEL`;
}

function formatConfig(dc: K8sDeviceClass): string {
 const cfg = dc.spec?.config;
 if (!cfg?.length) return '—';
 const drivers = cfg.map((c) => c.opaque?.driver).filter(Boolean) as string[];
 if (drivers.length === 0) return '—';
 const unique = [...new Set(drivers)];
 return unique.length > 2 ? `${unique.length} drivers` : unique.join(', ');
}

function mapDC(dc: K8sDeviceClass): DeviceClass {
 return {
 name: dc.metadata?.name ?? '',
 selectors: formatSelectors(dc),
 config: formatConfig(dc),
 age: calculateAge(dc.metadata?.creationTimestamp),
 creationTimestamp: dc.metadata?.creationTimestamp,
 };
}

const DC_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 300, minWidth: 150 },
 { id: 'selectors', defaultWidth: 220, minWidth: 120 },
 { id: 'config', defaultWidth: 220, minWidth: 120 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const DC_COLUMNS_FOR_VISIBILITY = [
 { id: 'selectors', label: 'Selectors' },
 { id: 'config', label: 'Config' },
 { id: 'age', label: 'Age' },
];

export default function DeviceClasses() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, refetch, pagination: hookPagination } = usePaginatedResourceList<K8sDeviceClass>('deviceclasses');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: DeviceClass | null; bulk?: boolean }>({ open: false, item: null });
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const multiSelect = useMultiSelect();
 const selectedItems = multiSelect.selectedIds;
 const patchResource = usePatchK8sResource('deviceclasses');
 const [searchQuery, setSearchQuery] = useState('');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);
 const deleteDC = useDeleteK8sResource('deviceclasses');
 const createDC = useCreateK8sResource('deviceclasses');

 const allItems = useMemo(() => (data?.allItems ?? []) as K8sDeviceClass[], [data?.allItems]);
 const items: DeviceClass[] = useMemo(() => (isConnected ? allItems.map(mapDC) : []), [isConnected, allItems]);

 const stats = useMemo(() => ({
 total: items.length,
 withSelectors: items.filter((i) => i.selectors !== '—').length,
 withConfig: items.filter((i) => i.config !== '—').length,
 }), [items]);

 const itemsAfterSearch = useMemo(
 () => items.filter((item) =>
 item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
 item.selectors.toLowerCase().includes(searchQuery.toLowerCase()) ||
 item.config.toLowerCase().includes(searchQuery.toLowerCase())
 ),
 [items, searchQuery]
 );

 const tableConfig: ColumnConfig<DeviceClass>[] = useMemo(
 () => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'selectors', getValue: (i) => i.selectors, sortable: true, filterable: true },
 { columnId: 'config', getValue: (i) => i.config, sortable: true, filterable: true },
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
 const columnVisibility = useColumnVisibility({ tableId: 'deviceclasses', columns: DC_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

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
 await createDC.mutateAsync({ yaml });
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
 await deleteDC.mutateAsync({ name, namespace: '' });
 }
 toast.success(`Deleted ${selectedItems.size} device class(es)`);
 multiSelect.clearSelection();
 } else if (deleteDialog.item) {
 await deleteDC.mutateAsync({ name: deleteDialog.item.name, namespace: '' });
 toast.success(`DeviceClass ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const allKeys = useMemo(() => itemsOnPage.map((v) => v.name), [itemsOnPage]);

 const toggleSelection = (dc: DeviceClass, event?: React.MouseEvent) => {
 if (event?.shiftKey) {
 multiSelect.toggleRange(dc.name, allKeys);
 } else {
 multiSelect.toggle(dc.name);
 }
 };
 const toggleAll = () => {
 if (multiSelect.isAllSelected(allKeys)) multiSelect.clearSelection();
 else multiSelect.selectAll(allKeys);
 };
 const isAllSelected = multiSelect.isAllSelected(allKeys);
 const isSomeSelected = multiSelect.isSomeSelected(allKeys);

 const handleBulkDelete = async () => {
 return executeBulkOperation(Array.from(selectedItems).map((n) => `/${n}`), async (_key, _ns, name) => {
 await deleteDC.mutateAsync({ name, namespace: '' });
 });
 };

 const handleBulkLabel = async (label: string) => {
 return executeBulkOperation(Array.from(selectedItems).map((n) => `/${n}`), async (_key, _ns, name) => {
 await patchResource.mutateAsync({ name, namespace: '', patch: { metadata: { labels: { [label.split('=')[0]]: label.split('=')[1] } } } });
 });
 };

 const pagination = {
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No device classes',
 hasPrev: safePageIndex > 0,
 hasNext: start + pageSize < totalFiltered,
 onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
 onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
 currentPage: safePageIndex + 1,
 totalPages: Math.max(1, totalPages),
 onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
 };

 const exportConfig = {
 filenamePrefix: 'deviceclasses',
 resourceLabel: 'DeviceClasses',
 getExportData: (v: DeviceClass) => ({ name: v.name, selectors: v.selectors, config: v.config, age: v.age }),
 csvColumns: [
 { label: 'Name', getValue: (v: DeviceClass) => v.name },
 { label: 'Selectors', getValue: (v: DeviceClass) => v.selectors },
 { label: 'Config', getValue: (v: DeviceClass) => v.config },
 { label: 'Age', getValue: (v: DeviceClass) => v.age },
 ],
 toK8sYaml: () => 'DeviceClasses define device configuration presets for DRA.',
 };

 return (
 <div className="space-y-6">
 <ListPageHeader
 icon={<Cpu className="h-6 w-6 text-primary" />}
 title="Device Classes"
 resourceCount={filteredItems.length}
 subtitle="Cluster-scoped · DRA device presets"
 demoMode={!isConnected}
 dataUpdatedAt={hookPagination?.dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create Device Class"
 onCreate={handleCreate}
 actions={
 <>
 <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={(v) => v.name} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected classes' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
 {selectedItems.size > 0 && (
 <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
 <Trash2 className="h-4 w-4" />
 Delete
 </Button>
 )}
 </>
 }
 />

 <div className={cn('grid grid-cols-2 sm:grid-cols-4 gap-4', !isConnected && 'opacity-60')}>
 <ListPageStatCard label="Total" value={stats.total} icon={Cpu} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="With Selectors" value={stats.withSelectors} icon={Cpu} iconColor="text-muted-foreground" selected={false} onClick={() => { }} isLoading={isLoading} />
 <ListPageStatCard label="With Config" value={stats.withConfig} icon={Cpu} iconColor="text-muted-foreground" selected={false} onClick={() => { }} isLoading={isLoading} />
 </div>

 <BulkActionBar
 selectedCount={selectedItems.size}
 resourceName="device class"
 resourceType="deviceclasses"
 onClearSelection={() => multiSelect.clearSelection()}
 onBulkDelete={handleBulkDelete}
 onBulkLabel={handleBulkLabel}
 />

 <ResourceListTableToolbar
 globalFilterBar={
 <ResourceCommandBar
 scope={<ClusterScopedScope />}
 search={
 <div className="relative w-full min-w-0">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input placeholder="Search device classes..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search device classes" />
 </div>
 }
 />
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={DC_COLUMNS_FOR_VISIBILITY}
 visibleColumns={columnVisibility.visibleColumns}
 onColumnToggle={columnVisibility.setColumnVisible}
 isLoading={isLoading && isConnected}
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
 <ResizableTableProvider tableId="deviceclasses" columnConfig={DC_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 720 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 {columnVisibility.isColumnVisible('selectors') && <ResizableTableHead columnId="selectors"><TableColumnHeaderWithFilterAndSort columnId="selectors" label="Selectors" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('config') && <ResizableTableHead columnId="config"><TableColumnHeaderWithFilterAndSort columnId="config" label="Config" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>}
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 {columnVisibility.isColumnVisible('selectors') && (
 <ResizableTableCell columnId="selectors" className="p-1.5">
 <TableFilterCell columnId="selectors" label="Selectors" distinctValues={distinctValuesByColumn.selectors ?? []} selectedFilterValues={columnFilters.selectors ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.selectors} />
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('config') && (
 <ResizableTableCell columnId="config" className="p-1.5">
 <TableFilterCell columnId="config" label="Config" distinctValues={distinctValuesByColumn.config ?? []} selectedFilterValues={columnFilters.config ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.config} />
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={7} resourceName="device classes" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={7} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : itemsOnPage.length === 0 ? (
 <TableRow>
 <TableCell colSpan={7} className="h-40 text-center">
 <TableEmptyState
 icon={<Cpu className="h-8 w-8" />}
 title="No Device Classes found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'DeviceClasses require Kubernetes 1.34+ with DynamicResourceAllocation feature gate.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((item, idx) => (
 <tr key={item.name} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(item.name) && 'bg-primary/5')}>
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(item, e); }}><Checkbox checked={selectedItems.has(item.name)} tabIndex={-1} aria-label={`Select ${item.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/deviceclasses/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <Cpu className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate font-mono text-sm">{item.name}</span>
 </Link>
 </ResizableTableCell>
 {columnVisibility.isColumnVisible('selectors') && <ResizableTableCell columnId="selectors" className="text-sm truncate max-w-[280px] font-mono" title={item.selectors}>{item.selectors}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('config') && <ResizableTableCell columnId="config" className="font-mono text-sm truncate" title={item.config}>{item.config}</ResizableTableCell>}
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
 <DropdownMenuItem onClick={() => navigate(`/deviceclasses/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/deviceclasses/${item.name}?tab=yaml`)} className="gap-2">Edit YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/deviceclasses/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-rose-600" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </tr>
 ))
 )}
 </TableBody>
 </Table>
 </ResizableTableProvider>
 </ResourceListTableToolbar>

 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
 resourceType="DeviceClass"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} device classes` : (deleteDialog.item?.name || '')}
 namespace={undefined}
 onConfirm={handleDelete}
 />

 {showCreateWizard && (
 <ResourceCreator
 resourceKind="DeviceClass"
 onClose={() => setShowCreateWizard(false)}
 onApply={handleApplyCreate}
 defaultYaml={DEFAULT_YAMLS.DeviceClass}
 />
 )}
 </div>
 );
}
