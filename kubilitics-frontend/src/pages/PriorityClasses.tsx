import { useState, useMemo, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { AlertTriangle, Search, RefreshCw, MoreHorizontal,
 WifiOff, Plus, ChevronDown, CheckSquare, Trash2 } from 'lucide-react';
import { useMultiSelect } from '@/hooks/useMultiSelect';
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
import { usePaginatedResourceList, useDeleteK8sResource, usePatchK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { DeleteConfirmDialog, BulkActionBar, executeBulkOperation } from '@/components/resources';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import {
 ResourceCommandBar,
 ClusterScopedScope,
 ResourceExportDropdown,
 ListPagination,
 ListPageStatCard,
 ListPageHeader,
 TableColumnHeaderWithFilterAndSort,
 resourceTableRowClassName,
 ROW_MOTION,
 PAGE_SIZE_OPTIONS,
 AgeCell,
 TableEmptyState, ListPageLoadingShell, TableErrorState,
 ResourceListTableToolbar,
 TableFilterCell,
 StatusPill,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';

interface PriorityClassResource extends KubernetesResource {
 value?: number;
 globalDefault?: boolean;
 preemptionPolicy?: string;
 description?: string;
}

interface PriorityClassRow {
 name: string;
 value: number;
 globalDefault: boolean;
 preemptionPolicy: string;
 podsUsing: string;
 description: string;
 age: string;
 creationTimestamp?: string;
 isSystem: boolean;
 preemptionEnabled: boolean;
}

const SYSTEM_PRIORITY_NAMES = ['system-node-critical', 'system-cluster-critical'];

function transformPriorityClass(r: PriorityClassResource): PriorityClassRow {
 const name = r.metadata.name;
 const preemptionPolicy = r.preemptionPolicy || 'PreemptLowerPriority';
 return {
 name,
 value: typeof r.value === 'number' ? r.value : 0,
 globalDefault: !!r.globalDefault,
 preemptionPolicy,
 podsUsing: '–',
 description: (r.description || '').slice(0, 60) + ((r.description?.length ?? 0) > 60 ? '…' : ''),
 age: calculateAge(r.metadata.creationTimestamp),
 creationTimestamp: r.metadata?.creationTimestamp,
 isSystem: SYSTEM_PRIORITY_NAMES.includes(name),
 preemptionEnabled: preemptionPolicy !== 'Never',
 };
}

const PRIORITY_CLASS_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'status', defaultWidth: 100, minWidth: 80 },
 { id: 'value', defaultWidth: 100, minWidth: 70 },
 { id: 'globalDefault', defaultWidth: 100, minWidth: 70 },
 { id: 'preemptionPolicy', defaultWidth: 160, minWidth: 100 },
 { id: 'podsUsing', defaultWidth: 100, minWidth: 70 },
 { id: 'description', defaultWidth: 300, minWidth: 150 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const PRIORITY_CLASS_COLUMNS_FOR_VISIBILITY = [
 { id: 'status', label: 'Status' },
 { id: 'value', label: 'Value' },
 { id: 'globalDefault', label: 'Global Default' },
 { id: 'preemptionPolicy', label: 'Preemption Policy' },
 { id: 'podsUsing', label: 'Pods Using' },
 { id: 'description', label: 'Description' },
 { id: 'age', label: 'Age' },
];

export default function PriorityClasses() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, refetch, pagination: hookPagination } = usePaginatedResourceList<PriorityClassResource>('priorityclasses');
 const deleteResource = useDeleteK8sResource('priorityclasses');

 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: PriorityClassRow | null; bulk?: boolean }>({ open: false, item: null });
 const multiSelect = useMultiSelect();
 const selectedItems = multiSelect.selectedIds;
 const patchPC = usePatchK8sResource('priorityclasses');
 const [showCreator, setShowCreator] = useState(false);
 const [searchQuery, setSearchQuery] = useState('');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const allItems = (data?.allItems ?? []) as PriorityClassResource[];
 const items: PriorityClassRow[] = useMemo(() => (isConnected ? allItems.map(transformPriorityClass) : []), [isConnected, allItems]);

 const tableConfig: ColumnConfig<PriorityClassRow>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'value', getValue: (i) => i.value, sortable: true, filterable: false, compare: (a, b) => a.value - b.value },
 { columnId: 'globalDefault', getValue: (i) => (i.globalDefault ? 'Yes' : 'No'), sortable: true, filterable: true },
 { columnId: 'preemptionPolicy', getValue: (i) => i.preemptionPolicy, sortable: true, filterable: true },
 { columnId: 'isSystem', getValue: (i) => (i.isSystem ? 'Yes' : 'No'), sortable: false, filterable: true },
 { columnId: 'preemptionEnabled', getValue: (i) => (i.preemptionEnabled ? 'Yes' : 'No'), sortable: false, filterable: true },
 { columnId: 'podsUsing', getValue: (i) => i.podsUsing, sortable: true, filterable: false },
 { columnId: 'description', getValue: (i) => i.description, sortable: true, filterable: false },
 {
   columnId: 'age',
   getValue: (i) => i.age,
   sortValue: (i) => -(i.creationTimestamp ? Date.parse(i.creationTimestamp) : 0),
   sortable: true,
   filterable: false,
 },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(items, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'priorityclasses', columns: PRIORITY_CLASS_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const toggleStatFilter = (columnId: 'isSystem' | 'globalDefault' | 'preemptionEnabled', value: string) => {
 const current = columnFilters[columnId];
 if (current?.size === 1 && current.has(value)) {
 setColumnFilter(columnId, null);
 } else {
 setColumnFilter(columnId, new Set([value]));
 }
 };

 const searchFiltered = useMemo(() => {
 if (!searchQuery.trim()) return filteredItems;
 const q = searchQuery.toLowerCase();
 return filteredItems.filter((r) =>
 r.name.toLowerCase().includes(q) ||
 r.description.toLowerCase().includes(q) ||
 r.preemptionPolicy.toLowerCase().includes(q)
 );
 }, [filteredItems, searchQuery]);

 const stats = useMemo(() => {
 const total = items.length;
 const systemClasses = items.filter((r) => r.isSystem).length;
 const defaultCount = items.filter((r) => r.globalDefault).length;
 const preemptionEnabled = items.filter((r) => r.preemptionEnabled).length;
 return { total, systemClasses, defaultCount, preemptionEnabled };
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
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No priority classes',
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
 for (const name of selectedItems) {
 await deleteResource.mutateAsync({ name });
 }
 toast.success(`Deleted ${selectedItems.size} priority class(es)`);
 multiSelect.clearSelection();
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name });
 toast.success(`Priority class ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const allItemKeys = useMemo(() => itemsOnPage.map((r) => r.name), [itemsOnPage]);

 const toggleSelection = (r: PriorityClassRow, event?: React.MouseEvent) => {
 if (event?.shiftKey) {
 multiSelect.toggleRange(r.name, allItemKeys);
 } else {
 multiSelect.toggle(r.name);
 }
 };
 const toggleAll = () => {
 if (multiSelect.isAllSelected(allItemKeys)) multiSelect.clearSelection();
 else multiSelect.selectAll(allItemKeys);
 };
 const isAllSelected = multiSelect.isAllSelected(allItemKeys);
 const isSomeSelected = multiSelect.isSomeSelected(allItemKeys);

 const handleBulkDelete = async () => {
 return executeBulkOperation(Array.from(selectedItems).map((n) => `_/${n}`), async (_key, _ns, name) => {
 await deleteResource.mutateAsync({ name });
 });
 };

 const handleBulkLabel = async (label: string) => {
 return executeBulkOperation(Array.from(selectedItems).map((n) => `_/${n}`), async (_key, _ns, name) => {
 await patchPC.mutateAsync({ name, patch: { metadata: { labels: { [label.split("=")[0]]: label.split("=")[1] } } } });
 });
 };

 const selectedResourceLabels = useMemo(() => {
 const map = new Map<string, Record<string, string>>();
 const rawItems = (data?.allItems ?? []) as Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
 for (const n of selectedItems) {
 const raw = rawItems.find((r) => r.metadata.name === n);
 if (raw) map.set(n, raw.metadata.labels ?? {});
 }
 return map;
 }, [selectedItems, data?.allItems]);

 const exportConfig = {
 filenamePrefix: 'priority-classes',
 resourceLabel: 'Priority Classes',
 getExportData: (r: PriorityClassRow) => ({ name: r.name, value: r.value, globalDefault: r.globalDefault, preemptionPolicy: r.preemptionPolicy, age: r.age }),
 csvColumns: [
 { label: 'Name', getValue: (r: PriorityClassRow) => r.name },
 { label: 'Value', getValue: (r: PriorityClassRow) => r.value },
 { label: 'Global Default', getValue: (r: PriorityClassRow) => (r.globalDefault ? 'Yes' : 'No') },
 { label: 'Preemption Policy', getValue: (r: PriorityClassRow) => r.preemptionPolicy },
 { label: 'Age', getValue: (r: PriorityClassRow) => r.age },
 ],
 };

 if (showCreator) {
 return (
 <ResourceCreator
 resourceKind="PriorityClass"
 defaultYaml={DEFAULT_YAMLS.PriorityClass}
 onClose={() => setShowCreator(false)}
 onApply={() => {
 toast.success('PriorityClass created');
 setShowCreator(false);
 refetch();
 }}
 />
 );
 }

 return (
 <>
 <PageLayout label="Priority Classes">
 <ListPageHeader
 icon={<AlertTriangle className="h-6 w-6 text-primary" />}
 title="Priority Classes"
 resourceCount={searchFiltered.length}
 subtitle="Cluster-scoped"
 demoMode={!isConnected}
 dataUpdatedAt={hookPagination?.dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create"
 onCreate={() => setShowCreator(true)}
 actions={
 <>
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => r.name} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected priority classes' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
 <ListPageStatCard
 label="Total Priority Classes"
 value={stats.total}
 icon={AlertTriangle}
 iconColor="text-primary"
 selected={!hasActiveFilters}
 onClick={clearAllFilters}
 className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard
 label="System Classes"
 value={stats.systemClasses}
 icon={AlertTriangle}
 iconColor="text-muted-foreground"
 valueClassName={stats.systemClasses > 0 ? 'text-muted-foreground' : undefined}
 selected={columnFilters.isSystem?.size === 1 && columnFilters.isSystem.has('Yes')}
 onClick={() => toggleStatFilter('isSystem', 'Yes')}
 className={cn(columnFilters.isSystem?.size === 1 && columnFilters.isSystem.has('Yes') && 'ring-2 ring-primary')}
 isLoading={isLoading} />
 <ListPageStatCard
 label="Default"
 value={stats.defaultCount}
 icon={AlertTriangle}
 iconColor="text-emerald-600"
 valueClassName={stats.defaultCount > 0 ? 'text-emerald-600' : undefined}
 selected={columnFilters.globalDefault?.size === 1 && columnFilters.globalDefault.has('Yes')}
 onClick={() => toggleStatFilter('globalDefault', 'Yes')}
 className={cn(columnFilters.globalDefault?.size === 1 && columnFilters.globalDefault.has('Yes') && 'ring-2 ring-emerald-500')}
 isLoading={isLoading} />
 <ListPageStatCard
 label="Preemption Enabled"
 value={stats.preemptionEnabled}
 icon={AlertTriangle}
 iconColor="text-muted-foreground"
 valueClassName={stats.preemptionEnabled > 0 ? 'text-muted-foreground' : undefined}
 selected={columnFilters.preemptionEnabled?.size === 1 && columnFilters.preemptionEnabled.has('Yes')}
 onClick={() => toggleStatFilter('preemptionEnabled', 'Yes')}
 className={cn(columnFilters.preemptionEnabled?.size === 1 && columnFilters.preemptionEnabled.has('Yes') && 'ring-2 ring-primary')}
 isLoading={isLoading} />
 </div>

 <BulkActionBar
 selectedCount={selectedItems.size}
 resourceName="priority class"
 resourceType="priorityclasses"
 onClearSelection={() => multiSelect.clearSelection()}
 onBulkDelete={handleBulkDelete}
 onBulkLabel={handleBulkLabel}
 />

 <ResourceListTableToolbar
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 globalFilterBar={
 <ResourceCommandBar
 scope={<ClusterScopedScope />}
 search={
 <div className="relative w-full min-w-0">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input placeholder="Search priority classes..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search priority classes" />
 </div>
 }
 />
 }
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={PRIORITY_CLASS_COLUMNS_FOR_VISIBILITY}
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
 <ResizableTableProvider tableId="priorityclasses" columnConfig={PRIORITY_CLASS_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 850 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <ResizableTableHead columnId="status"><TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <ResizableTableHead columnId="value"><TableColumnHeaderWithFilterAndSort columnId="value" label="Value" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <ResizableTableHead columnId="globalDefault"><TableColumnHeaderWithFilterAndSort columnId="globalDefault" label="Global Default" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <ResizableTableHead columnId="preemptionPolicy"><TableColumnHeaderWithFilterAndSort columnId="preemptionPolicy" label="Preemption Policy" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <ResizableTableHead columnId="podsUsing"><TableColumnHeaderWithFilterAndSort columnId="podsUsing" label="Pods Using" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <ResizableTableHead columnId="description"><TableColumnHeaderWithFilterAndSort columnId="description" label="Description" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="status" className="p-1.5" />
 <ResizableTableCell columnId="value" className="p-1.5" />
 <ResizableTableCell columnId="globalDefault" className="p-1.5"><TableFilterCell columnId="globalDefault" label="Global Default" distinctValues={distinctValuesByColumn.globalDefault ?? []} selectedFilterValues={columnFilters.globalDefault ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.globalDefault} /></ResizableTableCell>
 <ResizableTableCell columnId="preemptionPolicy" className="p-1.5"><TableFilterCell columnId="preemptionPolicy" label="Preemption Policy" distinctValues={distinctValuesByColumn.preemptionPolicy ?? []} selectedFilterValues={columnFilters.preemptionPolicy ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.preemptionPolicy} /></ResizableTableCell>
 <ResizableTableCell columnId="podsUsing" className="p-1.5" />
 <ResizableTableCell columnId="description" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={9} resourceName="priority classes" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={9} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : searchFiltered.length === 0 ? (
 <TableRow>
 <TableCell colSpan={9} className="h-40 text-center">
 <TableEmptyState
 icon={<AlertTriangle className="h-8 w-8" />}
 title="No PriorityClasses found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Define scheduling priority for pods.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create PriorityClass"
 onCreate={() => setShowCreator(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((r, idx) => (
 <tr key={r.name} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(r.name) && 'bg-primary/5')}>
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(r, e); }}><Checkbox checked={selectedItems.has(r.name)} tabIndex={-1} aria-label={`Select ${r.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/priorityclasses/${r.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <AlertTriangle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{r.name}</span>
 </Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="status"><StatusPill variant="success" label="Active" /></ResizableTableCell>
 <ResizableTableCell columnId="value" className="font-mono text-sm">{r.value}</ResizableTableCell>
 <ResizableTableCell columnId="globalDefault">{r.globalDefault ? 'Yes' : 'No'}</ResizableTableCell>
 <ResizableTableCell columnId="preemptionPolicy">
 <Badge variant={r.preemptionPolicy === 'Never' ? 'secondary' : 'default'}>{r.preemptionPolicy}</Badge>
 </ResizableTableCell>
 <ResizableTableCell columnId="podsUsing" className="text-muted-foreground">{r.podsUsing}</ResizableTableCell>
 <ResizableTableCell columnId="description" className="text-muted-foreground text-sm truncate" title={r.description}>{r.description || '–'}</ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={r.age} timestamp={r.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="Priority class actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem onClick={() => navigate(`/priorityclasses/${r.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/priorityclasses/${r.name}?tab=yaml`)} className="gap-2">Edit YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/priorityclasses/${r.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteDialog({ open: true, item: r })} disabled={!isConnected}>Delete</DropdownMenuItem>
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

 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null, bulk: open ? deleteDialog.bulk : false })}
 resourceType="PriorityClass"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name || '')}
 onConfirm={handleDelete}
 requireNameConfirmation={!deleteDialog.bulk}
 />
 </>
 );
}
