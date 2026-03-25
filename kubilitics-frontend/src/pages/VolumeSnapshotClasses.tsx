import { useState, useMemo, useEffect } from 'react';
import {
 Search, RefreshCw, MoreHorizontal, Layers, Loader2, WifiOff, Plus,
 ChevronDown, CheckSquare, Trash2, FileText, Camera, Star,
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
import { VolumeSnapshotIcon } from '@/components/icons/KubernetesIcons';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { usePaginatedResourceList, useDeleteK8sResource, useCreateK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { DeleteConfirmDialog } from '@/components/resources';
import { toast } from '@/components/ui/sonner';

interface VolumeSnapshotClass {
 name: string;
 driver: string;
 deletionPolicy: string;
 isDefault: boolean;
 age: string;
 creationTimestamp?: string;
}

interface K8sVolumeSnapshotClass extends KubernetesResource {
 driver?: string;
 deletionPolicy?: string;
}

const VSC_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'driver', defaultWidth: 220, minWidth: 120 },
 { id: 'deletionPolicy', defaultWidth: 160, minWidth: 100 },
 { id: 'isDefault', defaultWidth: 100, minWidth: 70 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const VSClass_COLUMNS_FOR_VISIBILITY = [
 { id: 'driver', label: 'Driver' },
 { id: 'deletionPolicy', label: 'Deletion Policy' },
 { id: 'isDefault', label: 'Is Default' },
 { id: 'age', label: 'Age' },
];

function mapVSC(vsc: K8sVolumeSnapshotClass): VolumeSnapshotClass {
 const isDefault = vsc.metadata?.annotations?.['snapshot.storage.kubernetes.io/is-default-class'] === 'true';
 const raw = vsc as Record<string, unknown>;
 const driver = (raw.driver as string) ?? (raw.spec as Record<string, unknown>)?.driver ?? '—';
 const deletionPolicy = (raw.deletionPolicy as string) ?? (raw.spec as Record<string, unknown>)?.deletionPolicy ?? 'Delete';
 return {
 name: vsc.metadata?.name ?? '',
 driver: String(driver),
 deletionPolicy: String(deletionPolicy),
 isDefault,
 age: calculateAge(vsc.metadata?.creationTimestamp),
 creationTimestamp: vsc.metadata?.creationTimestamp,
 };
}

export default function VolumeSnapshotClasses() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = usePaginatedResourceList<K8sVolumeSnapshotClass>('volumesnapshotclasses');
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: VolumeSnapshotClass | null; bulk?: boolean }>({ open: false, item: null });
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [searchQuery, setSearchQuery] = useState('');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);
 const deleteVSC = useDeleteK8sResource('volumesnapshotclasses');
 const createVSC = useCreateK8sResource('volumesnapshotclasses');

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const allItems = (data?.allItems ?? []) as K8sVolumeSnapshotClass[];
 const items: VolumeSnapshotClass[] = useMemo(() => (isConnected ? allItems.map(mapVSC) : []), [isConnected, allItems]);

 const stats = useMemo(() => ({
 total: items.length,
 defaultCount: items.filter((v) => v.isDefault).length,
 retainPolicy: items.filter((v) => v.deletionPolicy === 'Retain').length,
 deletePolicy: items.filter((v) => v.deletionPolicy === 'Delete').length,
 }), [items]);

 const itemsAfterSearch = useMemo(
 () => items.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.driver.toLowerCase().includes(searchQuery.toLowerCase())),
 [items, searchQuery]
 );

 const tableConfig: ColumnConfig<VolumeSnapshotClass>[] = useMemo(
 () => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'driver', getValue: (i) => i.driver, sortable: true, filterable: true },
 { columnId: 'deletionPolicy', getValue: (i) => i.deletionPolicy, sortable: true, filterable: true },
 { columnId: 'isDefault', getValue: (i) => (i.isDefault ? 'Yes' : 'No'), sortable: true, filterable: true },
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
 const columnVisibility = useColumnVisibility({ tableId: 'volumesnapshotclasses', columns: VSClass_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const totalFiltered = filteredItems.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredItems.slice(start, start + pageSize);

 const toggleDefaultFilter = () => {
 if (columnFilters.isDefault?.size === 1 && columnFilters.isDefault.has('Yes')) {
 setColumnFilter('isDefault', null);
 } else {
 setColumnFilter('isDefault', new Set(['Yes']));
 }
 };

 useEffect(() => {
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [safePageIndex, pageIndex]);

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
 await deleteVSC.mutateAsync({ name, namespace: '' });
 }
 toast.success(`Deleted ${selectedItems.size} volume snapshot class(es)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteVSC.mutateAsync({ name: deleteDialog.item.name, namespace: '' });
 toast.success(`VolumeSnapshotClass ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const toggleSelection = (vsc: VolumeSnapshotClass) => {
 const next = new Set(selectedItems);
 if (next.has(vsc.name)) next.delete(vsc.name);
 else next.add(vsc.name);
 setSelectedItems(next);
 };
 const toggleAll = () => {
 if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
 else setSelectedItems(new Set(itemsOnPage.map((v) => v.name)));
 };
 const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
 const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

 const pagination = {
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No volume snapshot classes',
 hasPrev: safePageIndex > 0,
 hasNext: start + pageSize < totalFiltered,
 onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
 onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
 currentPage: safePageIndex + 1,
 totalPages: Math.max(1, totalPages),
 onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
 };

 const exportConfig = {
 filenamePrefix: 'volumesnapshotclasses',
 resourceLabel: 'VolumeSnapshotClasses',
 getExportData: (v: VolumeSnapshotClass) => ({ name: v.name, driver: v.driver, deletionPolicy: v.deletionPolicy, isDefault: v.isDefault, age: v.age }),
 csvColumns: [
 { label: 'Name', getValue: (v: VolumeSnapshotClass) => v.name },
 { label: 'Driver', getValue: (v: VolumeSnapshotClass) => v.driver },
 { label: 'Deletion Policy', getValue: (v: VolumeSnapshotClass) => v.deletionPolicy },
 { label: 'Is Default', getValue: (v: VolumeSnapshotClass) => (v.isDefault ? 'Yes' : 'No') },
 { label: 'Age', getValue: (v: VolumeSnapshotClass) => v.age },
 ],
 toK8sYaml: (v: VolumeSnapshotClass) => `---
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
 name: ${v.name}
driver: ${v.driver}
deletionPolicy: ${v.deletionPolicy}
`,
 };

 return (
 <div className="space-y-6">
 <ListPageHeader
 icon={<VolumeSnapshotIcon className="h-6 w-6 text-primary" />}
 title="Volume Snapshot Classes"
 resourceCount={filteredItems.length}
 subtitle="Cluster-scoped · CSI snapshot parameters"
 demoMode={!isConnected}
 dataUpdatedAt={dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create VolumeSnapshotClass"
 onCreate={() => setShowCreateWizard(true)}
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
 <ListPageStatCard label="Total" value={stats.total} icon={Camera} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Default" value={stats.defaultCount} icon={Star} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.isDefault?.size === 1 && columnFilters.isDefault.has('Yes')} onClick={toggleDefaultFilter} className={cn(columnFilters.isDefault?.size === 1 && columnFilters.isDefault.has('Yes') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard label="Retain Policy" value={stats.retainPolicy} icon={Layers} iconColor="text-muted-foreground" selected={columnFilters.deletionPolicy?.size === 1 && columnFilters.deletionPolicy.has('Retain')} onClick={() => setColumnFilter('deletionPolicy', columnFilters.deletionPolicy?.has('Retain') ? null : new Set(['Retain']))} isLoading={isLoading} />
 <ListPageStatCard label="Delete Policy" value={stats.deletePolicy} icon={Layers} iconColor="text-muted-foreground" selected={columnFilters.deletionPolicy?.size === 1 && columnFilters.deletionPolicy.has('Delete')} onClick={() => setColumnFilter('deletionPolicy', columnFilters.deletionPolicy?.has('Delete') ? null : new Set(['Delete']))} isLoading={isLoading} />
 </div>

 {selectedItems.size > 0 && (
 <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
 <Badge variant="secondary" className="gap-1.5">
 <CheckSquare className="h-3.5 w-3.5" />
 {selectedItems.size} selected
 </Badge>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={(v) => v.name} config={exportConfig} selectionLabel="Selected classes" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
 <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
 <Trash2 className="h-4 w-4" />
 Delete
 </Button>
 <Button variant="ghost" size="sm" onClick={() => setSelectedItems(new Set())}>Clear</Button>
 </div>
 </div>
 )}

 <ResourceListTableToolbar
 globalFilterBar={
 <ResourceCommandBar
 scope={<ClusterScopedScope />}
 search={
 <div className="relative w-full min-w-0">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input placeholder="Search volume snapshot classes..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search volume snapshot classes" />
 </div>
 }
 />
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={VSClass_COLUMNS_FOR_VISIBILITY}
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
 <ListPagination hasPrev={pagination.hasPrev} hasNext={pagination.hasNext} onPrev={pagination.onPrev} onNext={pagination.onNext} rangeLabel={undefined} currentPage={pagination.currentPage} totalPages={pagination.totalPages} onPageChange={pagination.onPageChange} dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} />
 </div>
 }
 >
 <ResizableTableProvider tableId="volumesnapshotclasses" columnConfig={VSC_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 760 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 {columnVisibility.isColumnVisible('driver') && <ResizableTableHead columnId="driver"><TableColumnHeaderWithFilterAndSort columnId="driver" label="Driver" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('deletionPolicy') && <ResizableTableHead columnId="deletionPolicy"><TableColumnHeaderWithFilterAndSort columnId="deletionPolicy" label="Deletion Policy" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('isDefault') && <ResizableTableHead columnId="isDefault"><TableColumnHeaderWithFilterAndSort columnId="isDefault" label="Is Default" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 {columnVisibility.isColumnVisible('driver') && <ResizableTableCell columnId="driver" className="p-1.5"><TableFilterCell columnId="driver" label="Driver" distinctValues={distinctValuesByColumn.driver ?? []} selectedFilterValues={columnFilters.driver ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.driver} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('deletionPolicy') && <ResizableTableCell columnId="deletionPolicy" className="p-1.5"><TableFilterCell columnId="deletionPolicy" label="Deletion Policy" distinctValues={distinctValuesByColumn.deletionPolicy ?? []} selectedFilterValues={columnFilters.deletionPolicy ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.deletionPolicy} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('isDefault') && <ResizableTableCell columnId="isDefault" className="p-1.5"><TableFilterCell columnId="isDefault" label="Is Default" distinctValues={distinctValuesByColumn.isDefault ?? []} selectedFilterValues={columnFilters.isDefault ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.isDefault} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={8} resourceName="volume snapshot classes" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={8} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : itemsOnPage.length === 0 ? (
 <TableRow>
 <TableCell colSpan={8} className="h-40 text-center">
 <TableEmptyState
 icon={<Camera className="h-8 w-8" />}
 title="No Volume Snapshot Classes found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Volume Snapshot Classes require the CSI snapshot controller. Create one to define snapshot parameters.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create VolumeSnapshotClass"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((item, idx) => (
 <tr key={item.name} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(item.name) && 'bg-primary/5')}>
 <TableCell><Checkbox checked={selectedItems.has(item.name)} onCheckedChange={() => toggleSelection(item)} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/volumesnapshotclasses/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <VolumeSnapshotIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 </Link>
 </ResizableTableCell>
 {columnVisibility.isColumnVisible('driver') && <ResizableTableCell columnId="driver" className="font-mono text-sm truncate" title={item.driver}>{item.driver}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('deletionPolicy') && <ResizableTableCell columnId="deletionPolicy"><Badge variant={item.deletionPolicy === 'Retain' ? 'secondary' : 'outline'} className="text-xs">{item.deletionPolicy}</Badge></ResizableTableCell>}
 {columnVisibility.isColumnVisible('isDefault') && <ResizableTableCell columnId="isDefault"><Badge variant={item.isDefault ? 'default' : 'outline'} className="text-xs">{item.isDefault ? 'Yes' : 'No'}</Badge></ResizableTableCell>}
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
 <DropdownMenuItem onClick={() => navigate(`/volumesnapshotclasses/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/volumesnapshotclasses/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
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

 {showCreateWizard && (
 <ResourceCreator
 resourceKind="VolumeSnapshotClass"
 defaultYaml={DEFAULT_YAMLS.VolumeSnapshotClass}
 onClose={() => setShowCreateWizard(false)}
 onApply={async (yaml) => {
 if (!isConnected) { toast.error('Connect cluster to create volume snapshot class'); return; }
 try {
 await createVSC.mutateAsync({ yaml });
 toast.success('VolumeSnapshotClass created successfully');
 setShowCreateWizard(false);
 refetch();
 } catch (e: unknown) {
 const msg = e instanceof Error ? e.message : String(e);
 toast.error(msg ?? 'Failed to create');
 throw e;
 }
 }}
 />
 )}

 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
 resourceType="VolumeSnapshotClass"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} volume snapshot classes` : (deleteDialog.item?.name || '')}
 namespace={undefined}
 onConfirm={handleDelete}
 />
 </div>
 );
}
