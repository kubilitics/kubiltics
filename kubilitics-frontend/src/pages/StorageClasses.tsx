import { useState, useMemo, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import {
 Search,
 RefreshCw,
 MoreHorizontal,
 Layers,
 Loader2,
 WifiOff,
 Plus,
 ChevronDown,
 CheckSquare,
 Trash2,
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
 DropdownMenuSeparator,
 DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { ResourceCommandBar, ClusterScopedScope, ResourceExportDropdown, ListPagination, PAGE_SIZE_OPTIONS, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, resourceTableRowClassName, ROW_MOTION, AgeCell, TableEmptyState, TableErrorState, ListPageLoadingShell, ResourceListTableToolbar } from '@/components/list';
import { StorageIcon } from '@/components/icons/KubernetesIcons';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { usePaginatedResourceList, useDeleteK8sResource, usePatchK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { getStorageClassPVCounts } from '@/services/backendApiClient';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { DeleteConfirmDialog, BulkActionBar, executeBulkOperation } from '@/components/resources';
import { Star } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { useMultiSelect } from '@/hooks/useMultiSelect';

interface StorageClass {
 name: string;
 provisioner: string;
 reclaimPolicy: string;
 volumeBindingMode: string;
 allowVolumeExpansion: boolean;
 isDefault: boolean;
 age: string;
 creationTimestamp?: string;
}

interface K8sStorageClass extends KubernetesResource {
 provisioner?: string;
 reclaimPolicy?: string;
 volumeBindingMode?: string;
 allowVolumeExpansion?: boolean;
}

const SC_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'provisioner', defaultWidth: 220, minWidth: 120 },
 { id: 'reclaimPolicy', defaultWidth: 160, minWidth: 100 },
 { id: 'volumeBindingMode', defaultWidth: 160, minWidth: 100 },
 { id: 'allowVolumeExpansion', defaultWidth: 160, minWidth: 100 },
 { id: 'pvCount', defaultWidth: 100, minWidth: 70 },
 { id: 'default', defaultWidth: 100, minWidth: 70 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const SC_COLUMNS_FOR_VISIBILITY = [
 { id: 'provisioner', label: 'Provisioner' },
 { id: 'reclaimPolicy', label: 'Reclaim Policy' },
 { id: 'volumeBindingMode', label: 'Volume Binding' },
 { id: 'allowVolumeExpansion', label: 'Expansion' },
 { id: 'pvCount', label: 'PVs' },
 { id: 'default', label: 'Default' },
 { id: 'age', label: 'Age' },
];

function mapSC(sc: K8sStorageClass): StorageClass {
 const isDefault = sc.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true';
 return {
 name: sc.metadata?.name ?? '',
 provisioner: sc.provisioner || '—',
 reclaimPolicy: sc.reclaimPolicy || 'Delete',
 volumeBindingMode: sc.volumeBindingMode || 'Immediate',
 allowVolumeExpansion: sc.allowVolumeExpansion ?? false,
 isDefault,
 age: calculateAge(sc.metadata?.creationTimestamp),
 creationTimestamp: sc.metadata?.creationTimestamp,
 };
}

export default function StorageClasses() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, refetch, pagination: hookPagination } = usePaginatedResourceList<K8sStorageClass>('storageclasses');
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: StorageClass | null; bulk?: boolean }>({ open: false, item: null });
 const multiSelect = useMultiSelect();
 const selectedItems = multiSelect.selectedIds;
 const setSelectedItems = (s: Set<string>) => { if (s.size === 0) multiSelect.clearSelection(); else multiSelect.selectAll(Array.from(s)); };
 const [searchQuery, setSearchQuery] = useState('');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);
 const deleteSC = useDeleteK8sResource('storageclasses');
 const patchSC = usePatchK8sResource('storageclasses');
 const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
 const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
 const activeCluster = useClusterStore((s) => s.activeCluster);
 const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
 const clusterId = currentClusterId ?? null;

 const { data: pvCounts } = useQuery({
 queryKey: ['storageclass-pv-counts', clusterId],
 queryFn: () => getStorageClassPVCounts(backendBaseUrl!, clusterId!),
 enabled: !!(isBackendConfigured && clusterId && backendBaseUrl),
 staleTime: 60_000,
 });

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const allItems = (data?.allItems ?? []) as K8sStorageClass[];
 const items: StorageClass[] = useMemo(() => (isConnected ? allItems.map(mapSC) : []), [isConnected, allItems]);

 const stats = useMemo(() => {
 const fullList = isConnected ? allItems.map(mapSC) : [];
 const withPVs = pvCounts ? fullList.filter((sc) => (pvCounts[sc.name] ?? 0) > 0).length : 0;
 return {
 total: fullList.length,
 defaultCount: fullList.filter((sc) => sc.isDefault).length,
 withPVs,
 provisioners: new Set(fullList.map((sc) => sc.provisioner)).size,
 };
 }, [isConnected, allItems, pvCounts]);

 const itemsAfterSearch = useMemo(
 () => items.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.provisioner.toLowerCase().includes(searchQuery.toLowerCase())),
 [items, searchQuery]
 );

 const tableConfig: ColumnConfig<StorageClass>[] = useMemo(
 () => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'provisioner', getValue: (i) => i.provisioner, sortable: true, filterable: true },
 { columnId: 'reclaimPolicy', getValue: (i) => i.reclaimPolicy, sortable: true, filterable: true },
 { columnId: 'volumeBindingMode', getValue: (i) => i.volumeBindingMode, sortable: true, filterable: true },
 { columnId: 'allowVolumeExpansion', getValue: (i) => (i.allowVolumeExpansion ? 'Yes' : 'No'), sortable: true, filterable: true },
 { columnId: 'pvCount', getValue: () => '', sortable: false, filterable: false },
 { columnId: 'hasPVs', getValue: (i) => (pvCounts && (pvCounts[i.name] ?? 0) > 0 ? 'Yes' : 'No'), sortable: false, filterable: true },
 { columnId: 'isDefault', getValue: (i) => (i.isDefault ? 'Yes' : 'No'), sortable: true, filterable: true },
 {
   columnId: 'age',
   getValue: (i) => i.age,
   sortValue: (i) => -(i.creationTimestamp ? Date.parse(i.creationTimestamp) : 0),
   sortable: true,
   filterable: false,
 },
 ],
 [pvCounts]
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
 const columnVisibility = useColumnVisibility({ tableId: 'storageclasses', columns: SC_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

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
 for (const key of selectedItems) {
 const name = key.startsWith('_/') ? key.slice(2) : key;
 await deleteSC.mutateAsync({ name });
 }
 toast.success(`Deleted ${selectedItems.size} storage class(es)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteSC.mutateAsync({ name: deleteDialog.item.name });
 toast.success(`StorageClass ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const allSCKeys = useMemo(() => filteredItems.map(sc => `_/${sc.name}`), [filteredItems]);

 const toggleSelection = (sc: StorageClass, event?: React.MouseEvent) => {
 const key = `_/${sc.name}`;
 if (event?.shiftKey) {
 multiSelect.toggleRange(key, allSCKeys);
 } else {
 multiSelect.toggle(key);
 }
 };

 const toggleAll = () => {
 if (multiSelect.isAllSelected(allSCKeys)) multiSelect.clearSelection();
 else multiSelect.selectAll(allSCKeys);
 };

 const handleBulkDelete = async () => {
 return executeBulkOperation(Array.from(selectedItems), async (_key, _ns, name) => {
 await deleteSC.mutateAsync({ name });
 });
 };

 const handleBulkLabel = async (label: string) => {
 return executeBulkOperation(Array.from(selectedItems), async (_key, _ns, name) => {
 await patchSC.mutateAsync({ name, patch: { metadata: { labels: { [label.split("=")[0]]: label.split("=")[1] } } } });
 });
 };

 const selectedResourceLabels = useMemo(() => {
 const map = new Map<string, Record<string, string>>();
 const rawItems = (data?.allItems ?? []) as Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
 for (const key of selectedItems) {
 const n = key.startsWith('_/') ? key.slice(2) : key;
 const raw = rawItems.find((r) => r.metadata.name === n);
 if (raw) map.set(key, raw.metadata.labels ?? {});
 }
 return map;
 }, [selectedItems, data?.allItems]);

 const isAllSelected = multiSelect.isAllSelected(allSCKeys);
 const isSomeSelected = multiSelect.isSomeSelected(allSCKeys);

 const pagination = {
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No storage classes',
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

 const exportConfig = {
 filenamePrefix: 'storageclasses',
 resourceLabel: 'StorageClasses',
 getExportData: (sc: StorageClass) => ({ name: sc.name, provisioner: sc.provisioner, reclaimPolicy: sc.reclaimPolicy, volumeBindingMode: sc.volumeBindingMode, allowVolumeExpansion: sc.allowVolumeExpansion, age: sc.age }),
 csvColumns: [
 { label: 'Name', getValue: (sc: StorageClass) => sc.name },
 { label: 'Provisioner', getValue: (sc: StorageClass) => sc.provisioner },
 { label: 'Reclaim Policy', getValue: (sc: StorageClass) => sc.reclaimPolicy },
 { label: 'Volume Binding', getValue: (sc: StorageClass) => sc.volumeBindingMode },
 { label: 'Age', getValue: (sc: StorageClass) => sc.age },
 ],
 };

 return (
 <>
 <PageLayout label="Storage Classes">
 <ListPageHeader
 icon={<StorageIcon className="h-6 w-6 text-primary" />}
 title="Storage Classes"
 resourceCount={filteredItems.length}
 subtitle="Cluster-scoped"
 demoMode={!isConnected}
 dataUpdatedAt={hookPagination?.dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create"
 onCreate={() => setShowCreateWizard(true)}
 actions={
 <>
 <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={(sc) => `_/${sc.name}`} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected storage classes' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
 {selectedItems.size > 0 && (
 <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
 <Trash2 className="h-4 w-4" />
 Delete
 </Button>
 )}
 </>
 }
 />

 <div className={cn('grid grid-cols-2 sm:grid-cols-5 gap-4', !isConnected && 'opacity-60')}>
 <ListPageStatCard
 label="Total Classes"
 value={stats.total}
 icon={Layers}
 iconColor="text-primary"
 selected={!hasActiveFilters}
 onClick={clearAllFilters}
 className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard
 label="Default"
 value={stats.defaultCount}
 icon={Layers}
 iconColor="text-emerald-600"
 valueClassName="text-emerald-600"
 selected={columnFilters.isDefault?.size === 1 && columnFilters.isDefault.has('Yes')}
 onClick={toggleDefaultFilter}
 className={cn(columnFilters.isDefault?.size === 1 && columnFilters.isDefault.has('Yes') && 'ring-2 ring-emerald-500')}
 isLoading={isLoading} />
 <ListPageStatCard
 label="With PVs"
 value={pvCounts ? stats.withPVs : '—'}
 icon={Layers}
 iconColor="text-muted-foreground"
 valueClassName={pvCounts && stats.withPVs > 0 ? 'text-muted-foreground' : undefined}
 selected={pvCounts != null && columnFilters.hasPVs?.size === 1 && columnFilters.hasPVs.has('Yes')}
 onClick={() => {
 if (!pvCounts) return;
 if (columnFilters.hasPVs?.size === 1 && columnFilters.hasPVs.has('Yes')) {
 setColumnFilter('hasPVs', null);
 } else {
 setColumnFilter('hasPVs', new Set(['Yes']));
 }
 }}
 className={cn(pvCounts != null && columnFilters.hasPVs?.size === 1 && columnFilters.hasPVs.has('Yes') && 'ring-2 ring-primary')}
 isLoading={isLoading} />
 <ListPageStatCard
 label="Provisioners"
 value={stats.provisioners}
 icon={Layers}
 iconColor="text-muted-foreground"
 selected={!hasActiveFilters}
 onClick={clearAllFilters}
 className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 </div>

 <BulkActionBar
 selectedCount={selectedItems.size}
 resourceName="storage class"
 resourceType="storageclasses"
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
 <Input placeholder="Search storage classes..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search storage classes" />
 </div>
 }
 />
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={SC_COLUMNS_FOR_VISIBILITY}
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
 <ResizableTableProvider tableId="storageclasses" columnConfig={SC_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 900 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="provisioner"><TableColumnHeaderWithFilterAndSort columnId="provisioner" label="Provisioner" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="reclaimPolicy"><TableColumnHeaderWithFilterAndSort columnId="reclaimPolicy" label="Reclaim Policy" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="volumeBindingMode"><TableColumnHeaderWithFilterAndSort columnId="volumeBindingMode" label="Volume Binding" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="allowVolumeExpansion"><TableColumnHeaderWithFilterAndSort columnId="allowVolumeExpansion" label="Expansion" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="pvCount" title="PV Count"><span className="text-xs font-medium text-muted-foreground">PVs</span></ResizableTableHead>
 <ResizableTableHead columnId="default"><TableColumnHeaderWithFilterAndSort columnId="isDefault" label="Default" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="provisioner" className="p-1.5"><TableFilterCell columnId="provisioner" label="Provisioner" distinctValues={distinctValuesByColumn.provisioner ?? []} selectedFilterValues={columnFilters.provisioner ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.provisioner} /></ResizableTableCell>
 <ResizableTableCell columnId="reclaimPolicy" className="p-1.5"><TableFilterCell columnId="reclaimPolicy" label="Reclaim Policy" distinctValues={distinctValuesByColumn.reclaimPolicy ?? []} selectedFilterValues={columnFilters.reclaimPolicy ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.reclaimPolicy} /></ResizableTableCell>
 <ResizableTableCell columnId="volumeBindingMode" className="p-1.5"><TableFilterCell columnId="volumeBindingMode" label="Volume Binding" distinctValues={distinctValuesByColumn.volumeBindingMode ?? []} selectedFilterValues={columnFilters.volumeBindingMode ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.volumeBindingMode} /></ResizableTableCell>
 <ResizableTableCell columnId="allowVolumeExpansion" className="p-1.5"><TableFilterCell columnId="allowVolumeExpansion" label="Expansion" distinctValues={['Yes', 'No']} selectedFilterValues={columnFilters.allowVolumeExpansion ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.allowVolumeExpansion} /></ResizableTableCell>
 <ResizableTableCell columnId="pvCount" className="p-1.5" />
 <ResizableTableCell columnId="default" className="p-1.5"><TableFilterCell columnId="isDefault" label="Default" distinctValues={['Yes', 'No']} selectedFilterValues={columnFilters.isDefault ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.isDefault} /></ResizableTableCell>
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={10} resourceName="storage classes" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={10} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : filteredItems.length === 0 ? (
 <TableRow>
 <TableCell colSpan={10} className="h-40 text-center">
 <TableEmptyState
 icon={<Layers className="h-8 w-8" />}
 title="No StorageClasses found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Define storage classes for dynamic volume provisioning.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create StorageClass"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((item, idx) => (
 <tr key={item.name} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(`_/${item.name}`) && 'bg-primary/5')}>
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(item, e); }}><Checkbox checked={selectedItems.has(`_/${item.name}`)} tabIndex={-1} aria-label={`Select ${item.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/storageclasses/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <Layers className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 {item.isDefault && <Badge variant="default" className="text-xs">Default</Badge>}
 </Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="provisioner" className="font-mono text-sm">{item.provisioner}</ResizableTableCell>
 <ResizableTableCell columnId="reclaimPolicy"><Badge variant="outline">{item.reclaimPolicy}</Badge></ResizableTableCell>
 <ResizableTableCell columnId="volumeBindingMode" className="text-sm">{item.volumeBindingMode}</ResizableTableCell>
 <ResizableTableCell columnId="allowVolumeExpansion"><Badge variant={item.allowVolumeExpansion ? 'default' : 'secondary'}>{item.allowVolumeExpansion ? 'Yes' : 'No'}</Badge></ResizableTableCell>
 <ResizableTableCell columnId="pvCount" className="font-mono text-sm">
 {pvCounts ? (pvCounts[item.name] ?? 0) : '—'}
 </ResizableTableCell>
 <ResizableTableCell columnId="default">
 <Badge variant={item.isDefault ? 'default' : 'outline'}>{item.isDefault ? 'Yes' : 'No'}</Badge>
 </ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="StorageClass actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem onClick={() => navigate(`/storageclasses/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/storageclasses/${item.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
 {!item.isDefault && isConnected && (
 <DropdownMenuItem
 className="gap-2"
 onClick={async () => {
 try {
 const DEFAULT_ANNO = 'storageclass.kubernetes.io/is-default-class';
 await patchSC.mutateAsync({
 name: item.name,
 namespace: '',
 patch: {
 metadata: {
 annotations: {
 [DEFAULT_ANNO]: 'true',
 },
 },
 },
 });
 const otherDefaults = items.filter((sc) => sc.isDefault && sc.name !== item.name);
 for (const sc of otherDefaults) {
 await patchSC.mutateAsync({
 name: sc.name,
 namespace: '',
 patch: {
 metadata: {
 annotations: {
 [DEFAULT_ANNO]: 'false',
 },
 },
 },
 });
 }
 toast.success(`"${item.name}" set as default StorageClass`);
 refetch();
 } catch (e) {
 toast.error(e instanceof Error ? e.message : 'Set as default failed');
 }
 }}
 >
 <Star className="h-4 w-4" /> Set as Default
 </DropdownMenuItem>
 )}
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}>Delete</DropdownMenuItem>
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
 </PageLayout>

 {showCreateWizard && <ResourceCreator resourceKind="StorageClass" defaultYaml={DEFAULT_YAMLS.StorageClass} onClose={() => setShowCreateWizard(false)} onApply={() => { toast.success('StorageClass created'); setShowCreateWizard(false); refetch(); }} />}
 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null, bulk: open ? deleteDialog.bulk : false })}
 resourceType="StorageClass"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name ?? '')}
 onConfirm={handleDelete}
 requireNameConfirmation={!deleteDialog.bulk}
 />
 </>
 );
}
