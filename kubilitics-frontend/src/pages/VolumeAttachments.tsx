import { useState, useMemo, useEffect } from 'react';
import {
 Search,
 RefreshCw,
 MoreHorizontal,
 Database,
 Loader2,
 WifiOff,
 Plus,
 ChevronDown,
 CheckSquare,
 Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { ResourceCommandBar, ClusterScopedScope, ResourceExportDropdown, ListPagination, PAGE_SIZE_OPTIONS, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, StatusPill, type StatusPillVariant, resourceTableRowClassName, ROW_MOTION, AgeCell, TableEmptyState, TableErrorState, ListPageLoadingShell, ResourceListTableToolbar } from '@/components/list';
import { StorageIcon } from '@/components/icons/KubernetesIcons';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { usePaginatedResourceList, useDeleteK8sResource, calculateAge } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { DeleteConfirmDialog } from '@/components/resources';
import { toast } from 'sonner';

interface VolumeAttachment {
 id: string;
 name: string;
 attacher: string;
 node: string;
 volume: string;
 attached: boolean;
 attachError: string;
 age: string;
 creationTimestamp?: string;
}

interface K8sVolumeAttachment {
 metadata?: { name?: string; uid?: string; creationTimestamp?: string };
 spec?: {
 attacher?: string;
 nodeName?: string;
 source?: { persistentVolumeName?: string; inlineVolumeSpec?: { csi?: { volumeHandle?: string } } };
 };
 status?: { attached?: boolean; attachError?: { message?: string }; detachError?: { message?: string } };
}

const VA_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 220, minWidth: 120 },
 { id: 'attacher', defaultWidth: 180, minWidth: 100 },
 { id: 'node', defaultWidth: 140, minWidth: 90 },
 { id: 'volume', defaultWidth: 160, minWidth: 90 },
 { id: 'attached', defaultWidth: 100, minWidth: 70 },
 { id: 'attachError', defaultWidth: 140, minWidth: 80 },
 { id: 'age', defaultWidth: 90, minWidth: 56 },
];

const VA_COLUMNS_FOR_VISIBILITY = [
 { id: 'attacher', label: 'Attacher' },
 { id: 'node', label: 'Node' },
 { id: 'volume', label: 'PV' },
 { id: 'attached', label: 'Attached' },
 { id: 'attachError', label: 'Attach Error' },
 { id: 'age', label: 'Age' },
];

function mapVA(item: K8sVolumeAttachment): VolumeAttachment {
 return {
 id: item.metadata?.uid ?? item.metadata?.name ?? '',
 name: item.metadata?.name ?? '',
 attacher: item.spec?.attacher ?? '—',
 node: item.spec?.nodeName ?? '—',
 volume: item.spec?.source?.persistentVolumeName ?? item.spec?.source?.inlineVolumeSpec?.csi?.volumeHandle ?? '—',
 attached: !!item.status?.attached,
 attachError: item.status?.attachError?.message ?? item.status?.detachError?.message ?? '—',
 age: calculateAge(item.metadata?.creationTimestamp),
 creationTimestamp: item.metadata?.creationTimestamp,
 };
}

export default function VolumeAttachments() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, refetch, pagination: hookPagination } = usePaginatedResourceList<K8sVolumeAttachment>('volumeattachments');
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: VolumeAttachment | null; bulk?: boolean }>({ open: false, item: null });
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [searchQuery, setSearchQuery] = useState('');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);
 const deleteVA = useDeleteK8sResource('volumeattachments');

 const allItems = (data?.allItems ?? []) as K8sVolumeAttachment[];
 const items: VolumeAttachment[] = useMemo(() => (isConnected ? allItems.map(mapVA) : []), [isConnected, allItems]);

 const stats = useMemo(() => {
 const fullList = isConnected ? allItems.map(mapVA) : [];
 return {
 total: fullList.length,
 attached: fullList.filter((i) => i.attached).length,
 detaching: fullList.filter((i) => !i.attached && i.attachError === '—').length,
 error: fullList.filter((i) => i.attachError !== '—').length,
 };
 }, [isConnected, allItems]);

 const itemsAfterSearch = useMemo(
 () => items.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.node.toLowerCase().includes(searchQuery.toLowerCase()) || item.volume.toLowerCase().includes(searchQuery.toLowerCase())),
 [items, searchQuery]
 );

 const tableConfig: ColumnConfig<VolumeAttachment>[] = useMemo(
 () => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'attacher', getValue: (i) => i.attacher, sortable: true, filterable: true },
 { columnId: 'node', getValue: (i) => i.node, sortable: true, filterable: true },
 { columnId: 'volume', getValue: (i) => i.volume, sortable: true, filterable: false },
 { columnId: 'attached', getValue: (i) => (i.attached ? 'Yes' : 'No'), sortable: true, filterable: true },
 { columnId: 'attachmentState', getValue: (i) => (i.attached ? 'Attached' : i.attachError !== '—' ? 'Error' : 'Detaching'), sortable: false, filterable: true },
 { columnId: 'attachError', getValue: (i) => i.attachError, sortable: true, filterable: false },
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
 const columnVisibility = useColumnVisibility({ tableId: 'volumeattachments', columns: VA_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

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

 const toggleStatFilter = (value: 'Attached' | 'Detaching' | 'Error') => {
 const current = columnFilters.attachmentState;
 if (current?.size === 1 && current.has(value)) {
 setColumnFilter('attachmentState', null);
 } else {
 setColumnFilter('attachmentState', new Set([value]));
 }
 };

 const pagination = {
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No volume attachments',
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

 const isStatCardSelected = (value: 'Attached' | 'Detaching' | 'Error') =>
 columnFilters.attachmentState?.size === 1 && columnFilters.attachmentState.has(value);

 const handleAction = (action: string, item: VolumeAttachment) => {
 if (action === 'View Details') navigate(`/volumeattachments/${item.name}`);
 if (action === 'View Node' && item.node !== '—') navigate(`/nodes/${item.node}`);
 if (action === 'View Volume' && item.volume !== '—') navigate(`/persistentvolumes/${item.volume}`);
 if (action === 'Download YAML') navigate(`/volumeattachments/${item.name}?tab=yaml`);
 if (action === 'Delete') setDeleteDialog({ open: true, item });
 };

 const idToItem = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
 const handleDeleteConfirm = async () => {
 if (!isConnected) {
 toast.info('Connect cluster to delete resources');
 return;
 }
 if (deleteDialog.bulk && selectedItems.size > 0) {
 for (const id of selectedItems) {
 const item = idToItem.get(id);
 if (item?.name) await deleteVA.mutateAsync({ name: item.name });
 }
 toast.success(`Deleted ${selectedItems.size} volume attachment(s)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteVA.mutateAsync({ name: deleteDialog.item.name });
 toast.success(`VolumeAttachment ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const toggleSelection = (item: VolumeAttachment) => {
 const next = new Set(selectedItems);
 if (next.has(item.id)) next.delete(item.id);
 else next.add(item.id);
 setSelectedItems(next);
 };
 const toggleAll = () => {
 if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
 else setSelectedItems(new Set(itemsOnPage.map((i) => i.id)));
 };
 const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
 const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

 const exportConfig = {
 filenamePrefix: 'volumeattachments',
 resourceLabel: 'VolumeAttachments',
 getExportData: (item: VolumeAttachment) => ({ name: item.name, attacher: item.attacher, node: item.node, volume: item.volume, attached: item.attached, age: item.age }),
 csvColumns: [
 { label: 'Name', getValue: (item: VolumeAttachment) => item.name },
 { label: 'Attacher', getValue: (item: VolumeAttachment) => item.attacher },
 { label: 'Node', getValue: (item: VolumeAttachment) => item.node },
 { label: 'Volume', getValue: (item: VolumeAttachment) => item.volume },
 { label: 'Attached', getValue: (item: VolumeAttachment) => (item.attached ? 'Yes' : 'No') },
 { label: 'Age', getValue: (item: VolumeAttachment) => item.age },
 ],
 };

 return (
 <>
 <div className="space-y-6">
 <ListPageHeader
 icon={<StorageIcon className="h-6 w-6 text-primary" />}
 title="Volume Attachments"
 resourceCount={filteredItems.length}
 subtitle="Cluster-scoped"
 demoMode={!isConnected}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create"
 onCreate={() => setShowCreateWizard(true)}
 actions={
 <>
 <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={(item) => item.id} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected volume attachments' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
 <ListPageStatCard
 label="Total Attachments"
 value={stats.total}
 icon={Database}
 iconColor="text-primary"
 selected={!hasActiveFilters}
 onClick={clearAllFilters}
 className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard
 label="Attached"
 value={stats.attached}
 icon={Database}
 iconColor="text-emerald-600"
 valueClassName="text-emerald-600"
 selected={isStatCardSelected('Attached')}
 onClick={() => toggleStatFilter('Attached')}
 className={cn(isStatCardSelected('Attached') && 'ring-2 ring-emerald-500')}
 isLoading={isLoading} />
 <ListPageStatCard
 label="Detaching"
 value={stats.detaching}
 icon={Database}
 iconColor="text-amber-600"
 valueClassName="text-amber-600"
 selected={isStatCardSelected('Detaching')}
 onClick={() => toggleStatFilter('Detaching')}
 className={cn(isStatCardSelected('Detaching') && 'ring-2 ring-amber-500')}
 isLoading={isLoading} />
 <ListPageStatCard
 label="Error"
 value={stats.error}
 icon={Database}
 iconColor="text-rose-600"
 valueClassName="text-rose-600"
 selected={isStatCardSelected('Error')}
 onClick={() => toggleStatFilter('Error')}
 className={cn(isStatCardSelected('Error') && 'ring-2 ring-rose-500')}
 isLoading={isLoading} />
 </div>

 {/* Bulk Actions Bar */}
 {selectedItems.size > 0 && (
 <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
 <Badge variant="secondary" className="gap-1.5">
 <CheckSquare className="h-3.5 w-3.5" />
 {selectedItems.size} selected
 </Badge>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={(i) => i.id} config={exportConfig} selectionLabel="Selected volume attachments" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
 <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
 <Trash2 className="h-3.5 w-3.5" />
 Delete selected
 </Button>
 <Button variant="ghost" size="sm" onClick={() => setSelectedItems(new Set())}>
 Clear
 </Button>
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
 <Input placeholder="Search volume attachments..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search volume attachments" />
 </div>
 }
 />
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={VA_COLUMNS_FOR_VISIBILITY}
 visibleColumns={columnVisibility.visibleColumns}
 onColumnToggle={columnVisibility.setColumnVisible}
 isLoading={isLoading && isConnected}
 footer={
 <div className="flex items-center justify-between flex-wrap gap-2">
 <div className="flex items-center gap-3">
 <span className="text-sm text-muted-foreground">{pagination.rangeLabel}</span>
 <DropdownMenu>
 <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="gap-2">{pageSize} per page<ChevronDown className="h-4 w-4 opacity-50" /></Button></DropdownMenuTrigger>
 <DropdownMenuContent align="start">
 {PAGE_SIZE_OPTIONS.map((size) => <DropdownMenuItem key={size} onClick={() => handlePageSizeChange(size)} className={cn(pageSize === size && 'bg-accent')}>{size} per page</DropdownMenuItem>)}
 </DropdownMenuContent>
 </DropdownMenu>
 </div>
 <ListPagination hasPrev={pagination.hasPrev} hasNext={pagination.hasNext} onPrev={pagination.onPrev} onNext={pagination.onNext} rangeLabel={undefined} currentPage={pagination.currentPage} totalPages={pagination.totalPages} onPageChange={pagination.onPageChange} dataUpdatedAt={pagination.dataUpdatedAt} isFetching={pagination.isFetching} />
 </div>
 }
 >
 <ResizableTableProvider tableId="volumeattachments" columnConfig={VA_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 1000 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 {columnVisibility.isColumnVisible('attacher') && <ResizableTableHead columnId="attacher"><TableColumnHeaderWithFilterAndSort columnId="attacher" label="Attacher" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('node') && <ResizableTableHead columnId="node"><TableColumnHeaderWithFilterAndSort columnId="node" label="Node" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('volume') && <ResizableTableHead columnId="volume" title="PV"><TableColumnHeaderWithFilterAndSort columnId="volume" label="PV" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('attached') && <ResizableTableHead columnId="attached"><TableColumnHeaderWithFilterAndSort columnId="attached" label="Attached" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('attachError') && <ResizableTableHead columnId="attachError" title="Attach Error"><TableColumnHeaderWithFilterAndSort columnId="attachError" label="Attach Error" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 {columnVisibility.isColumnVisible('attacher') && <ResizableTableCell columnId="attacher" className="p-1.5"><TableFilterCell columnId="attacher" label="Attacher" distinctValues={distinctValuesByColumn.attacher ?? []} selectedFilterValues={columnFilters.attacher ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.attacher} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('node') && <ResizableTableCell columnId="node" className="p-1.5"><TableFilterCell columnId="node" label="Node" distinctValues={distinctValuesByColumn.node ?? []} selectedFilterValues={columnFilters.node ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.node} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('volume') && <ResizableTableCell columnId="volume" className="p-1.5" />}
 {columnVisibility.isColumnVisible('attached') && <ResizableTableCell columnId="attached" className="p-1.5"><TableFilterCell columnId="attached" label="Attached" distinctValues={['Yes', 'No']} selectedFilterValues={columnFilters.attached ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.attached} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('attachError') && <ResizableTableCell columnId="attachError" className="p-1.5" />}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={9} resourceName="volume attachments" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={9} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : filteredItems.length === 0 ? (
 <TableRow>
 <TableCell colSpan={9} className="h-40 text-center">
 <TableEmptyState
 icon={<Database className="h-8 w-8" />}
 title="No volume attachments found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'VolumeAttachments are created by the storage system when volumes are attached.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create VolumeAttachment"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((item, idx) => (
 <tr key={item.id} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(item.id) && 'bg-primary/5')}>
 <TableCell><Checkbox checked={selectedItems.has(item.id)} onCheckedChange={() => toggleSelection(item)} aria-label={`Select ${item.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/volumeattachments/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <Database className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 </Link>
 </ResizableTableCell>
 {columnVisibility.isColumnVisible('attacher') && <ResizableTableCell columnId="attacher" className="font-mono text-sm">{item.attacher}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('node') && <ResizableTableCell columnId="node">{item.node !== '—' ? <button type="button" className="text-primary hover:underline" onClick={() => navigate(`/nodes/${item.node}`)}>{item.node}</button> : <span className="text-muted-foreground">—</span>}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('volume') && <ResizableTableCell columnId="volume" className="font-mono text-sm">{item.volume !== '—' ? <button type="button" className="text-primary hover:underline" onClick={() => navigate(`/persistentvolumes/${item.volume}`)}>{item.volume}</button> : <span className="text-muted-foreground">—</span>}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('attached') && <ResizableTableCell columnId="attached"><StatusPill label={item.attached ? 'Yes' : 'No'} variant={(item.attached ? 'success' : 'neutral') as StatusPillVariant} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('attachError') && <ResizableTableCell columnId="attachError" className={item.attachError !== '—' ? 'text-destructive text-sm' : 'text-muted-foreground'}>{item.attachError}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>}
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="VolumeAttachment actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem onClick={() => handleAction('View Details', item)} className="gap-2">View Details</DropdownMenuItem>
 {item.node !== '—' && <DropdownMenuItem onClick={() => handleAction('View Node', item)} className="gap-2">View Node</DropdownMenuItem>}
 {item.volume !== '—' && <DropdownMenuItem onClick={() => handleAction('View Volume', item)} className="gap-2">View Volume</DropdownMenuItem>}
 <DropdownMenuItem onClick={() => handleAction('Download YAML', item)} className="gap-2">Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-destructive" onClick={() => handleAction('Delete', item)} disabled={!isConnected}>Delete</DropdownMenuItem>
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
 </div>

 {showCreateWizard && <ResourceCreator resourceKind="VolumeAttachment" defaultYaml={DEFAULT_YAMLS.VolumeAttachment} onClose={() => setShowCreateWizard(false)} onApply={() => { toast.success('VolumeAttachment created'); setShowCreateWizard(false); refetch(); }} />}
 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null, bulk: open ? deleteDialog.bulk : false })}
 resourceType="VolumeAttachment"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name ?? '')}
 onConfirm={handleDeleteConfirm}
 requireNameConfirmation={!deleteDialog.bulk}
 />
 </>
 );
}
