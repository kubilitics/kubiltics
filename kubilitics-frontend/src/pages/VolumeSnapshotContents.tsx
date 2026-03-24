import { useState, useMemo, useEffect } from 'react';
import {
 Search, RefreshCw, MoreHorizontal, Loader2, CheckCircle2, XCircle, Clock,
 ChevronDown, CheckSquare, Trash2, FileText, Camera,
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
import { ResourceCommandBar, ClusterScopedScope, ResourceExportDropdown, ListPagination, PAGE_SIZE_OPTIONS, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, resourceTableRowClassName, ROW_MOTION, AgeCell, TableEmptyState, TableErrorState, ListPageLoadingShell, CopyNameDropdownItem, StatusPill, ResourceListTableToolbar } from '@/components/list';
import type { StatusPillVariant } from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { usePaginatedResourceList, useDeleteK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog } from '@/components/resources';
import { toast } from '@/components/ui/sonner';

interface VolumeSnapshotContent {
 name: string;
 status: 'Ready' | 'Pending' | 'Failed';
 source: string;
 snapshotClass: string;
 capacity: string;
 deletionPolicy: string;
 age: string;
 creationTimestamp?: string;
 volumeSnapshotRef?: { namespace?: string; name?: string };
}

interface K8sVolumeSnapshotContent extends KubernetesResource {
 spec?: {
 source?: { volumeHandle?: string; snapshotHandle?: string; persistentVolumeClaimName?: string };
 volumeSnapshotClassName?: string;
 deletionPolicy?: string;
 volumeSnapshotRef?: { namespace?: string; name?: string };
 };
 status?: {
 readyToUse?: boolean;
 restoreSize?: string;
 error?: { message?: string };
 };
}

const VSC_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 300, minWidth: 150 },
 { id: 'status', defaultWidth: 150, minWidth: 100 },
 { id: 'source', defaultWidth: 220, minWidth: 120 },
 { id: 'snapshotClass', defaultWidth: 160, minWidth: 100 },
 { id: 'capacity', defaultWidth: 130, minWidth: 90 },
 { id: 'deletionPolicy', defaultWidth: 160, minWidth: 100 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const VSC_COLUMNS_FOR_VISIBILITY = [
 { id: 'status', label: 'Status' },
 { id: 'source', label: 'Source' },
 { id: 'snapshotClass', label: 'Snapshot Class' },
 { id: 'capacity', label: 'Capacity' },
 { id: 'deletionPolicy', label: 'Deletion Policy' },
 { id: 'age', label: 'Age' },
];

const statusToVariant: Record<VolumeSnapshotContent['status'], StatusPillVariant> = {
 Ready: 'success',
 Pending: 'warning',
 Failed: 'destructive',
};

const statusIcon: Record<VolumeSnapshotContent['status'], React.ComponentType<{ className?: string }>> = {
 Ready: CheckCircle2,
 Pending: Clock,
 Failed: XCircle,
};

function mapVSC(vsc: K8sVolumeSnapshotContent): VolumeSnapshotContent {
 const spec = vsc.spec ?? {};
 const status = vsc.status ?? {};
 const sourceSpec = spec.source ?? {};
 const vsRef = spec.volumeSnapshotRef ?? {};

 let source = '—';
 if (sourceSpec.snapshotHandle) {
 source = 'Pre-provisioned';
 } else if (vsRef.namespace && vsRef.name) {
 source = `VolumeSnapshot ${vsRef.namespace}/${vsRef.name}`;
 } else if (sourceSpec.volumeHandle) {
 source = 'Dynamic (from PVC)';
 }

 let vsStatus: VolumeSnapshotContent['status'] = 'Pending';
 if (status.error?.message) vsStatus = 'Failed';
 else if (status.readyToUse === true) vsStatus = 'Ready';

 const raw = vsc as Record<string, unknown>;
 const deletionPolicy = (raw.deletionPolicy as string) ?? (spec.deletionPolicy as string) ?? (raw.spec as Record<string, unknown>)?.deletionPolicy ?? 'Delete';

 return {
 name: vsc.metadata?.name ?? '',
 status: vsStatus,
 source,
 snapshotClass: spec.volumeSnapshotClassName ?? '—',
 capacity: status.restoreSize ?? '—',
 deletionPolicy: String(deletionPolicy),
 age: calculateAge(vsc.metadata?.creationTimestamp),
 creationTimestamp: vsc.metadata?.creationTimestamp,
 volumeSnapshotRef: vsRef.namespace && vsRef.name ? { namespace: vsRef.namespace, name: vsRef.name } : undefined,
 };
}

export default function VolumeSnapshotContents() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = usePaginatedResourceList<K8sVolumeSnapshotContent>('volumesnapshotcontents');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: VolumeSnapshotContent | null; bulk?: boolean }>({ open: false, item: null });
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [searchQuery, setSearchQuery] = useState('');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);
 const deleteVSC = useDeleteK8sResource('volumesnapshotcontents');

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const allItems = (data?.allItems ?? []) as K8sVolumeSnapshotContent[];
 const items: VolumeSnapshotContent[] = useMemo(() => (isConnected ? allItems.map(mapVSC) : []), [isConnected, allItems]);

 const stats = useMemo(() => ({
 total: items.length,
 ready: items.filter((v) => v.status === 'Ready').length,
 pending: items.filter((v) => v.status === 'Pending').length,
 failed: items.filter((v) => v.status === 'Failed').length,
 }), [items]);

 const itemsAfterSearch = useMemo(
 () => items.filter((item) =>
 item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
 item.source.toLowerCase().includes(searchQuery.toLowerCase()) ||
 item.snapshotClass.toLowerCase().includes(searchQuery.toLowerCase())
 ),
 [items, searchQuery]
 );

 const tableConfig: ColumnConfig<VolumeSnapshotContent>[] = useMemo(
 () => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'status', getValue: (i) => i.status, sortable: true, filterable: true },
 { columnId: 'source', getValue: (i) => i.source, sortable: true, filterable: true },
 { columnId: 'snapshotClass', getValue: (i) => i.snapshotClass, sortable: true, filterable: true },
 { columnId: 'capacity', getValue: (i) => i.capacity, sortable: true, filterable: false },
 { columnId: 'deletionPolicy', getValue: (i) => i.deletionPolicy, sortable: true, filterable: true },
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
 const columnVisibility = useColumnVisibility({ tableId: 'volumesnapshotcontents', columns: VSC_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const totalFiltered = filteredItems.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredItems.slice(start, start + pageSize);

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
 toast.success(`Deleted ${selectedItems.size} volume snapshot content(s)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteVSC.mutateAsync({ name: deleteDialog.item.name, namespace: '' });
 toast.success(`VolumeSnapshotContent ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const toggleSelection = (vsc: VolumeSnapshotContent) => {
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
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No volume snapshot contents',
 hasPrev: safePageIndex > 0,
 hasNext: start + pageSize < totalFiltered,
 onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
 onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
 currentPage: safePageIndex + 1,
 totalPages: Math.max(1, totalPages),
 onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
 };

 const exportConfig = {
 filenamePrefix: 'volumesnapshotcontents',
 resourceLabel: 'VolumeSnapshotContents',
 getExportData: (v: VolumeSnapshotContent) => ({ name: v.name, status: v.status, source: v.source, snapshotClass: v.snapshotClass, capacity: v.capacity, deletionPolicy: v.deletionPolicy, age: v.age }),
 csvColumns: [
 { label: 'Name', getValue: (v: VolumeSnapshotContent) => v.name },
 { label: 'Status', getValue: (v: VolumeSnapshotContent) => v.status },
 { label: 'Source', getValue: (v: VolumeSnapshotContent) => v.source },
 { label: 'Snapshot Class', getValue: (v: VolumeSnapshotContent) => v.snapshotClass },
 { label: 'Capacity', getValue: (v: VolumeSnapshotContent) => v.capacity },
 { label: 'Deletion Policy', getValue: (v: VolumeSnapshotContent) => v.deletionPolicy },
 { label: 'Age', getValue: (v: VolumeSnapshotContent) => v.age },
 ],
 toK8sYaml: () => 'VolumeSnapshotContent is typically created by the snapshot controller.',
 };

 return (
 <div className="space-y-6">
 <ListPageHeader
 icon={<Camera className="h-6 w-6 text-primary" />}
 title="Volume Snapshot Contents"
 resourceCount={filteredItems.length}
 subtitle="Cluster-scoped · Actual snapshot data binding"
 demoMode={!isConnected}
 dataUpdatedAt={dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 actions={
 <>
 <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={(v) => v.name} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected contents' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
 <ListPageStatCard label="Total" value={stats.total} icon={Camera} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Ready" value={stats.ready} icon={CheckCircle2} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Ready')} onClick={() => setColumnFilter('status', columnFilters.status?.has('Ready') ? null : new Set(['Ready']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Ready') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard label="Pending" value={stats.pending} icon={Clock} iconColor="text-muted-foreground" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Pending')} onClick={() => setColumnFilter('status', columnFilters.status?.has('Pending') ? null : new Set(['Pending']))} isLoading={isLoading} />
 <ListPageStatCard label="Failed" value={stats.failed} icon={XCircle} iconColor="text-destructive" valueClassName="text-destructive" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Failed')} onClick={() => setColumnFilter('status', columnFilters.status?.has('Failed') ? null : new Set(['Failed']))} isLoading={isLoading} />
 </div>

 {selectedItems.size > 0 && (
 <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
 <Badge variant="secondary" className="gap-1.5">
 <CheckSquare className="h-3.5 w-3.5" />
 {selectedItems.size} selected
 </Badge>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={(v) => v.name} config={exportConfig} selectionLabel="Selected contents" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
 <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
 <Trash2 className="h-3.5 w-3.5" />
 Delete selected
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
 <Input placeholder="Search volume snapshot contents..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search volume snapshot contents" />
 </div>
 }
 />
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={VSC_COLUMNS_FOR_VISIBILITY}
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
 <ResizableTableProvider tableId="volumesnapshotcontents" columnConfig={VSC_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 900 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 {columnVisibility.isColumnVisible('status') && <ResizableTableHead columnId="status"><TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('source') && <ResizableTableHead columnId="source"><TableColumnHeaderWithFilterAndSort columnId="source" label="Source" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('snapshotClass') && <ResizableTableHead columnId="snapshotClass"><TableColumnHeaderWithFilterAndSort columnId="snapshotClass" label="Snapshot Class" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('capacity') && <ResizableTableHead columnId="capacity"><TableColumnHeaderWithFilterAndSort columnId="capacity" label="Capacity" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('deletionPolicy') && <ResizableTableHead columnId="deletionPolicy"><TableColumnHeaderWithFilterAndSort columnId="deletionPolicy" label="Deletion Policy" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 {columnVisibility.isColumnVisible('status') && <ResizableTableCell columnId="status" className="p-1.5"><TableFilterCell columnId="status" label="Status" distinctValues={distinctValuesByColumn.status ?? []} selectedFilterValues={columnFilters.status ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.status} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('source') && <ResizableTableCell columnId="source" className="p-1.5"><TableFilterCell columnId="source" label="Source" distinctValues={distinctValuesByColumn.source ?? []} selectedFilterValues={columnFilters.source ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.source} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('snapshotClass') && <ResizableTableCell columnId="snapshotClass" className="p-1.5"><TableFilterCell columnId="snapshotClass" label="Snapshot Class" distinctValues={distinctValuesByColumn.snapshotClass ?? []} selectedFilterValues={columnFilters.snapshotClass ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.snapshotClass} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('capacity') && <ResizableTableCell columnId="capacity" className="p-1.5" />}
 {columnVisibility.isColumnVisible('deletionPolicy') && <ResizableTableCell columnId="deletionPolicy" className="p-1.5"><TableFilterCell columnId="deletionPolicy" label="Deletion Policy" distinctValues={distinctValuesByColumn.deletionPolicy ?? []} selectedFilterValues={columnFilters.deletionPolicy ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.deletionPolicy} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={10} resourceName="volume snapshot contents" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={10} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : itemsOnPage.length === 0 ? (
 <TableRow>
 <TableCell colSpan={10} className="h-40 text-center">
 <TableEmptyState
 icon={<Camera className="h-8 w-8" />}
 title="No Volume Snapshot Contents found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'VolumeSnapshotContents are created by the CSI snapshot controller when VolumeSnapshots are created.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((item, idx) => (
 <tr key={item.name} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(item.name) && 'bg-primary/5')}>
 <TableCell><Checkbox checked={selectedItems.has(item.name)} onCheckedChange={() => toggleSelection(item)} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/volumesnapshotcontents/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <Camera className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate font-mono text-sm">{item.name}</span>
 </Link>
 </ResizableTableCell>
 {columnVisibility.isColumnVisible('status') && <ResizableTableCell columnId="status"><StatusPill variant={statusToVariant[item.status]} icon={statusIcon[item.status]} label={item.status} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('source') && <ResizableTableCell columnId="source" className="text-sm">{item.volumeSnapshotRef ? (<Link to={`/volumesnapshots/${item.volumeSnapshotRef.namespace}/${item.volumeSnapshotRef.name}`} className="text-primary hover:underline truncate block">{item.source}</Link>) : (<span className="truncate">{item.source}</span>)}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('snapshotClass') && <ResizableTableCell columnId="snapshotClass">{item.snapshotClass !== '—' ? (<Link to={`/volumesnapshotclasses/${item.snapshotClass}`} className="text-primary hover:underline font-mono text-sm truncate block">{item.snapshotClass}</Link>) : (<span className="font-mono text-sm text-muted-foreground">—</span>)}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('capacity') && <ResizableTableCell columnId="capacity" className="font-mono text-sm text-muted-foreground">{item.capacity}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('deletionPolicy') && <ResizableTableCell columnId="deletionPolicy"><Badge variant={item.deletionPolicy === 'Retain' ? 'secondary' : 'outline'} className="text-xs">{item.deletionPolicy}</Badge></ResizableTableCell>}
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
 <DropdownMenuItem onClick={() => navigate(`/volumesnapshotcontents/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 {item.volumeSnapshotRef && (
 <DropdownMenuItem asChild>
 <Link to={`/volumesnapshots/${item.volumeSnapshotRef.namespace}/${item.volumeSnapshotRef.name}`} className="gap-2">View VolumeSnapshot</Link>
 </DropdownMenuItem>
 )}
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/volumesnapshotcontents/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
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
 resourceType="VolumeSnapshotContent"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} volume snapshot contents` : (deleteDialog.item?.name || '')}
 namespace={undefined}
 onConfirm={handleDelete}
 />
 </div>
 );
}
