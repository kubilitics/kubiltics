import { useState, useMemo, useEffect } from 'react';
import {
 Search,
 RefreshCw,
 MoreHorizontal,
 HardDrive,
 Loader2,
 WifiOff,
 Plus,
 ChevronDown,
 Trash2,
 CheckSquare,
} from 'lucide-react';
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
 DropdownMenuTrigger,
 DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { ResourceCommandBar, ClusterScopedScope, ResourceExportDropdown, ListPagination, PAGE_SIZE_OPTIONS, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, StatusPill, type StatusPillVariant, resourceTableRowClassName, ROW_MOTION, AgeCell, TableEmptyState, ListPageLoadingShell, TableErrorState, ResourceListTableToolbar } from '@/components/list';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StorageIcon } from '@/components/icons/KubernetesIcons';
import { DeleteConfirmDialog } from '@/components/resources';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { usePaginatedResourceList, useDeleteK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { toast } from 'sonner';

interface PersistentVolume {
 name: string;
 capacity: string;
 accessModes: string[];
 reclaimPolicy: string;
 status: string;
 claim: string;
 claimNamespace?: string;
 claimName?: string;
 storageClass: string;
 volumeMode: string;
 provisioner: string;
 age: string;
 creationTimestamp?: string;
}

interface K8sPersistentVolume extends KubernetesResource {
 spec?: {
 capacity?: { storage?: string };
 accessModes?: string[];
 persistentVolumeReclaimPolicy?: string;
 storageClassName?: string;
 claimRef?: { namespace?: string; name?: string };
 volumeMode?: string;
 csi?: { driver?: string };
 flexVolume?: { driver?: string };
 };
 status?: { phase?: string };
}

const pvStatusVariant: Record<string, StatusPillVariant> = {
 Bound: 'success',
 Available: 'neutral',
 Released: 'warning',
 Failed: 'error',
};

function formatAccessMode(mode: string): string {
 const modeMap: Record<string, string> = {
 ReadWriteOnce: 'RWO',
 ReadOnlyMany: 'ROX',
 ReadWriteMany: 'RWX',
 ReadWriteOncePod: 'RWOP',
 };
 return modeMap[mode] || mode;
}

const PV_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'status', defaultWidth: 150, minWidth: 100 },
 { id: 'capacity', defaultWidth: 130, minWidth: 90 },
 { id: 'accessModes', defaultWidth: 160, minWidth: 100 },
 { id: 'reclaimPolicy', defaultWidth: 160, minWidth: 100 },
 { id: 'storageClass', defaultWidth: 160, minWidth: 100 },
 { id: 'provisioner', defaultWidth: 160, minWidth: 100 },
 { id: 'claim', defaultWidth: 220, minWidth: 120 },
 { id: 'volumeMode', defaultWidth: 160, minWidth: 100 },
 { id: 'usage', defaultWidth: 100, minWidth: 70 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const PV_COLUMNS_FOR_VISIBILITY = [
 { id: 'status', label: 'Status' },
 { id: 'capacity', label: 'Capacity' },
 { id: 'accessModes', label: 'Access Modes' },
 { id: 'reclaimPolicy', label: 'Reclaim Policy' },
 { id: 'storageClass', label: 'Storage Class' },
 { id: 'provisioner', label: 'Provisioner' },
 { id: 'claim', label: 'Claim' },
 { id: 'volumeMode', label: 'Volume Mode' },
 { id: 'age', label: 'Age' },
];

function mapPV(pv: K8sPersistentVolume): PersistentVolume {
 const claimRef = pv.spec?.claimRef;
 const provisioner = pv.spec?.csi?.driver ?? pv.spec?.flexVolume?.driver ?? '—';
 return {
 name: pv.metadata?.name ?? '',
 capacity: pv.spec?.capacity?.storage || '—',
 accessModes: (pv.spec?.accessModes || []).map(formatAccessMode),
 reclaimPolicy: pv.spec?.persistentVolumeReclaimPolicy || '—',
 status: pv.status?.phase || 'Unknown',
 claim: claimRef ? `${claimRef.namespace}/${claimRef.name}` : '—',
 claimNamespace: claimRef?.namespace,
 claimName: claimRef?.name,
 storageClass: pv.spec?.storageClassName || '—',
 volumeMode: pv.spec?.volumeMode || 'Filesystem',
 provisioner,
 age: calculateAge(pv.metadata?.creationTimestamp),
 creationTimestamp: pv.metadata?.creationTimestamp,
 };
}

export default function PersistentVolumes() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, refetch, pagination: hookPagination } = usePaginatedResourceList<K8sPersistentVolume>('persistentvolumes');
 const [showCreator, setShowCreator] = useState(false);
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: PersistentVolume | null; bulk?: boolean }>({ open: false, item: null });
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [searchQuery, setSearchQuery] = useState('');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);
 const deletePV = useDeleteK8sResource('persistentvolumes');

 const allItems = (data?.allItems ?? []) as K8sPersistentVolume[];
 const items: PersistentVolume[] = useMemo(() => (isConnected ? allItems.map(mapPV) : []), [isConnected, allItems]);

 const stats = useMemo(() => {
 const fullList = isConnected ? allItems.map(mapPV) : [];
 return {
 total: fullList.length,
 bound: fullList.filter((p) => p.status === 'Bound').length,
 available: fullList.filter((p) => p.status === 'Available').length,
 released: fullList.filter((p) => p.status === 'Released').length,
 failed: fullList.filter((p) => p.status === 'Failed').length,
 };
 }, [isConnected, allItems]);

 const itemsAfterSearch = useMemo(() => {
 return items.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.status.toLowerCase().includes(searchQuery.toLowerCase()) || item.storageClass.toLowerCase().includes(searchQuery.toLowerCase()));
 }, [items, searchQuery]);

 const tableConfig: ColumnConfig<PersistentVolume>[] = useMemo(
 () => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'status', getValue: (i) => i.status, sortable: true, filterable: true },
 { columnId: 'capacity', getValue: (i) => i.capacity, sortable: true, filterable: false },
 { columnId: 'accessModes', getValue: (i) => i.accessModes.join(', '), sortable: true, filterable: true },
 { columnId: 'reclaimPolicy', getValue: (i) => i.reclaimPolicy, sortable: true, filterable: true },
 { columnId: 'storageClass', getValue: (i) => i.storageClass, sortable: true, filterable: true },
 { columnId: 'provisioner', getValue: (i) => i.provisioner, sortable: true, filterable: false },
 { columnId: 'claim', getValue: (i) => i.claim, sortable: true, filterable: false },
 { columnId: 'volumeMode', getValue: (i) => i.volumeMode, sortable: true, filterable: true },
 { columnId: 'usage', getValue: () => '', sortable: false, filterable: false },
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
 const columnVisibility = useColumnVisibility({ tableId: 'persistentvolumes', columns: PV_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

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

 const pagination = {
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No persistent volumes',
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

 const handleAction = (action: string, pv: PersistentVolume) => {
 if (action === 'View Details') navigate(`/persistentvolumes/${pv.name}`);
 if (action === 'View Claim' && pv.claimNamespace && pv.claimName) navigate(`/persistentvolumeclaims/${pv.claimNamespace}/${pv.claimName}`);
 if (action === 'View Storage Class' && pv.storageClass !== '—') navigate(`/storageclasses/${pv.storageClass}`);
 if (action === 'Delete') setDeleteDialog({ open: true, item: pv });
 };

 const handleDeleteConfirm = async () => {
 if (!isConnected) {
 toast.info('Connect cluster to delete resources');
 return;
 }
 if (deleteDialog.bulk && selectedItems.size > 0) {
 for (const name of selectedItems) {
 await deletePV.mutateAsync({ name });
 }
 toast.success(`Deleted ${selectedItems.size} PV(s)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deletePV.mutateAsync({ name: deleteDialog.item.name });
 toast.success(`PersistentVolume ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const toggleSelection = (pv: PersistentVolume) => {
 const next = new Set(selectedItems);
 if (next.has(pv.name)) next.delete(pv.name);
 else next.add(pv.name);
 setSelectedItems(next);
 };
 const toggleAll = () => {
 if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
 else setSelectedItems(new Set(itemsOnPage.map((p) => p.name)));
 };
 const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
 const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

 const exportConfig = {
 filenamePrefix: 'persistentvolumes',
 resourceLabel: 'PVs',
 getExportData: (pv: PersistentVolume) => ({ name: pv.name, status: pv.status, capacity: pv.capacity, claim: pv.claim, storageClass: pv.storageClass, age: pv.age }),
 csvColumns: [
 { label: 'Name', getValue: (pv: PersistentVolume) => pv.name },
 { label: 'Status', getValue: (pv: PersistentVolume) => pv.status },
 { label: 'Capacity', getValue: (pv: PersistentVolume) => pv.capacity },
 { label: 'Claim', getValue: (pv: PersistentVolume) => pv.claim },
 { label: 'Storage Class', getValue: (pv: PersistentVolume) => pv.storageClass },
 { label: 'Age', getValue: (pv: PersistentVolume) => pv.age },
 ],
 };

 if (showCreator) {
 return (
 <ResourceCreator
 resourceKind="PersistentVolume"
 defaultYaml={DEFAULT_YAMLS.PersistentVolume}
 onClose={() => setShowCreator(false)}
 onApply={() => {
 toast.success('PersistentVolume created');
 setShowCreator(false);
 refetch();
 }}
 />
 );
 }

 return (
 <>
 <div className="space-y-6">
 <ListPageHeader
 icon={<StorageIcon className="h-6 w-6 text-primary" />}
 title="Persistent Volumes"
 resourceCount={filteredItems.length}
 subtitle="Cluster-scoped"
 demoMode={!isConnected}
 dataUpdatedAt={hookPagination?.dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create"
 onCreate={() => setShowCreator(true)}
 actions={
 <>
 <ResourceExportDropdown
 items={filteredItems}
 selectedKeys={selectedItems}
 getKey={(pv) => pv.name}
 config={exportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected PVs' : 'All visible PVs'}
 onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
 />
 {selectedItems.size > 0 && (
 <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
 <Trash2 className="h-3.5 w-3.5" />
 Delete {selectedItems.size} selected
 </Button>
 )}
 </>
 }
 />

 <div className={cn('grid grid-cols-2 sm:grid-cols-5 gap-4', !isConnected && 'opacity-60')}>
 <ListPageStatCard label="Total PVs" value={stats.total} icon={HardDrive} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Bound" value={stats.bound} icon={HardDrive} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Bound')} onClick={() => setColumnFilter('status', new Set(['Bound']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Bound') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard label="Available" value={stats.available} icon={HardDrive} iconColor="text-muted-foreground" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Available')} onClick={() => setColumnFilter('status', new Set(['Available']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Available') && 'ring-2 ring-muted-foreground')} isLoading={isLoading} />
 <ListPageStatCard label="Released" value={stats.released} icon={HardDrive} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Released')} onClick={() => setColumnFilter('status', new Set(['Released']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Released') && 'ring-2 ring-amber-600')} isLoading={isLoading} />
 <ListPageStatCard label="Failed" value={stats.failed} icon={HardDrive} iconColor="text-destructive" valueClassName="text-destructive" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Failed')} onClick={() => setColumnFilter('status', new Set(['Failed']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Failed') && 'ring-2 ring-destructive')} isLoading={isLoading} />
 </div>

 {/* Bulk Actions Bar */}
 {selectedItems.size > 0 && (
 <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
 <Badge variant="secondary" className="gap-1.5">
 <CheckSquare className="h-3.5 w-3.5" />
 {selectedItems.size} selected
 </Badge>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={(pv) => pv.name} config={exportConfig} selectionLabel="Selected PVs" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
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
 <Input
 placeholder="Search persistent volumes..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20"
 aria-label="Search persistent volumes"
 />
 </div>
 }
 />
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={PV_COLUMNS_FOR_VISIBILITY}
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
 <ListPagination hasPrev={pagination.hasPrev} hasNext={pagination.hasNext} onPrev={pagination.onPrev} onNext={pagination.onNext} rangeLabel={undefined} currentPage={pagination.currentPage} totalPages={pagination.totalPages} onPageChange={pagination.onPageChange} dataUpdatedAt={pagination.dataUpdatedAt} isFetching={pagination.isFetching} />
 </div>
 }
 >
 <ResizableTableProvider tableId="persistentvolumes" columnConfig={PV_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 1100 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name">
 <TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="status">
 <TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="capacity">
 <TableColumnHeaderWithFilterAndSort columnId="capacity" label="Capacity" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="accessModes" title="Access Modes">
 <TableColumnHeaderWithFilterAndSort columnId="accessModes" label="Access Modes" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="reclaimPolicy">
 <TableColumnHeaderWithFilterAndSort columnId="reclaimPolicy" label="Reclaim" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="storageClass">
 <TableColumnHeaderWithFilterAndSort columnId="storageClass" label="Storage Class" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="provisioner">
 <TableColumnHeaderWithFilterAndSort columnId="provisioner" label="Provisioner" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="claim" title="Claim">
 <TableColumnHeaderWithFilterAndSort columnId="claim" label="Claim" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="volumeMode">
 <TableColumnHeaderWithFilterAndSort columnId="volumeMode" label="Volume Mode" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="usage" title="Usage">
 <span className="text-xs font-medium text-muted-foreground">Usage</span>
 </ResizableTableHead>
 <ResizableTableHead columnId="age">
 <TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <TableHead className="w-12 text-center">
 <span className="sr-only">Actions</span>
 <MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden />
 </TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="status" className="p-1.5"><TableFilterCell columnId="status" label="Status" distinctValues={distinctValuesByColumn.status ?? []} selectedFilterValues={columnFilters.status ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.status} /></ResizableTableCell>
 <ResizableTableCell columnId="capacity" className="p-1.5" />
 <ResizableTableCell columnId="accessModes" className="p-1.5"><TableFilterCell columnId="accessModes" label="Access Modes" distinctValues={distinctValuesByColumn.accessModes ?? []} selectedFilterValues={columnFilters.accessModes ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.accessModes} /></ResizableTableCell>
 <ResizableTableCell columnId="reclaimPolicy" className="p-1.5"><TableFilterCell columnId="reclaimPolicy" label="Reclaim" distinctValues={distinctValuesByColumn.reclaimPolicy ?? []} selectedFilterValues={columnFilters.reclaimPolicy ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.reclaimPolicy} /></ResizableTableCell>
 <ResizableTableCell columnId="storageClass" className="p-1.5"><TableFilterCell columnId="storageClass" label="Storage Class" distinctValues={distinctValuesByColumn.storageClass ?? []} selectedFilterValues={columnFilters.storageClass ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.storageClass} /></ResizableTableCell>
 <ResizableTableCell columnId="provisioner" className="p-1.5" />
 <ResizableTableCell columnId="claim" className="p-1.5" />
 <ResizableTableCell columnId="volumeMode" className="p-1.5"><TableFilterCell columnId="volumeMode" label="Volume Mode" distinctValues={distinctValuesByColumn.volumeMode ?? []} selectedFilterValues={columnFilters.volumeMode ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.volumeMode} /></ResizableTableCell>
 <ResizableTableCell columnId="usage" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={13} resourceName="persistent volumes" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={13} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : filteredItems.length === 0 ? (
 <TableRow>
 <TableCell colSpan={13} className="h-40 text-center">
 <TableEmptyState
 icon={<HardDrive className="h-8 w-8" />}
 title="No persistent volumes found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Create or provision PersistentVolumes for cluster storage.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create PersistentVolume"
 onCreate={() => setShowCreator(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((item, idx) => {
 const key = item.name;
 return (
 <tr
 key={key}
 className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(key) && 'bg-primary/5')}
 >
 <TableCell><Checkbox checked={selectedItems.has(key)} onCheckedChange={() => toggleSelection(item)} aria-label={`Select ${item.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/persistentvolumes/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <HardDrive className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 </Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="status">
 <StatusPill label={item.status} variant={pvStatusVariant[item.status] || 'neutral'} />
 </ResizableTableCell>
 <ResizableTableCell columnId="capacity">
 <Badge variant="secondary" className="font-mono text-xs">{item.capacity}</Badge>
 </ResizableTableCell>
 <ResizableTableCell columnId="accessModes" className="font-mono text-sm">
 {item.accessModes.join(', ') || '—'}
 </ResizableTableCell>
 <ResizableTableCell columnId="reclaimPolicy" className="text-sm">
 {item.reclaimPolicy}
 </ResizableTableCell>
 <ResizableTableCell columnId="storageClass">
 {item.storageClass !== '—' ? (
 <Link to={`/storageclasses/${item.storageClass}`} className="font-mono text-xs text-primary hover:underline">
 {item.storageClass}
 </Link>
 ) : (
 <span className="text-muted-foreground">—</span>
 )}
 </ResizableTableCell>
 <ResizableTableCell columnId="provisioner" className="font-mono text-xs text-muted-foreground">
 {item.provisioner}
 </ResizableTableCell>
 <ResizableTableCell columnId="claim" className="font-mono text-sm">
 {item.claimNamespace && item.claimName ? (
 <Link to={`/persistentvolumeclaims/${item.claimNamespace}/${item.claimName}`} className="text-primary hover:underline">
 {item.claim}
 </Link>
 ) : (
 <span className="text-muted-foreground">{item.claim}</span>
 )}
 </ResizableTableCell>
 <ResizableTableCell columnId="volumeMode">
 <Badge variant="secondary" className="font-normal">{item.volumeMode}</Badge>
 </ResizableTableCell>
 <ResizableTableCell columnId="usage">
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="text-muted-foreground text-sm">—</span>
 </TooltipTrigger>
 <TooltipContent>
 <p className="text-xs">Volume usage requires metrics from storage provider; not exposed by Kubernetes API.</p>
 </TooltipContent>
 </Tooltip>
 </ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap">
 <AgeCell age={item.age} timestamp={item.creationTimestamp} />
 </ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="PV actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem onClick={() => handleAction('View Details', item)} className="gap-2">
 View Details
 </DropdownMenuItem>
 {item.claimNamespace && item.claimName && (
 <DropdownMenuItem onClick={() => handleAction('View Claim', item)} className="gap-2">
 View Claim
 </DropdownMenuItem>
 )}
 {item.storageClass !== '—' && (
 <DropdownMenuItem onClick={() => handleAction('View Storage Class', item)} className="gap-2">
 View Storage Class
 </DropdownMenuItem>
 )}
 <DropdownMenuItem onClick={() => handleAction('Download YAML', item)} className="gap-2">
 Download YAML
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => handleAction('Delete', item)} className="gap-2 text-destructive focus:text-destructive">
 Delete
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </tr>
 );
 })
 )}
 </TableBody>
 </Table>
 </ResizableTableProvider>
 </ResourceListTableToolbar>
 </div>
 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null, bulk: open ? deleteDialog.bulk : false })}
 resourceType="PersistentVolume"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name ?? '')}
 onConfirm={handleDeleteConfirm}
 requireNameConfirmation={!deleteDialog.bulk}
 />
 </>
 );
}
