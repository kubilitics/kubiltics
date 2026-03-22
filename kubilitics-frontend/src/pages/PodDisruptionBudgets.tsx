import { useState, useMemo, useEffect } from 'react';
import { Shield, Search, RefreshCw, MoreHorizontal,
 WifiOff, Plus, ChevronDown, Filter, List, Layers, CheckSquare, Trash2 } from 'lucide-react';
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
 TableEmptyState, ListPageLoadingShell, TableErrorState,
 CopyNameDropdownItem,
 NamespaceBadge,
 ResourceListTableToolbar,
 TableFilterCell,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';

interface PDBResource extends KubernetesResource {
 spec?: {
 minAvailable?: number | string;
 maxUnavailable?: number | string;
 selector?: { matchLabels?: Record<string, string> };
 };
 status?: {
 currentHealthy?: number;
 desiredHealthy?: number;
 disruptionsAllowed?: number;
 expectedPods?: number;
 };
}

interface PDBRow {
 name: string;
 namespace: string;
 minAvailable: string;
 maxUnavailable: string;
 currentHealthy: number;
 desiredHealthy: number;
 disruptionsAllowed: number;
 expectedPods: number;
 selectorSummary: string;
 age: string;
 creationTimestamp?: string;
 satisfied: boolean;
 blocking: boolean;
}

function transformPDB(p: PDBResource): PDBRow {
 const minAv = p.spec?.minAvailable;
 const maxUnav = p.spec?.maxUnavailable;
 const currentHealthy = p.status?.currentHealthy ?? 0;
 const desiredHealthy = p.status?.desiredHealthy ?? 0;
 const disruptionsAllowed = p.status?.disruptionsAllowed ?? 0;
 const expectedPods = p.status?.expectedPods ?? 0;
 const labels = p.spec?.selector?.matchLabels ?? {};
 const selectorSummary = Object.keys(labels).length > 0
 ? Object.entries(labels)
 .slice(0, 2)
 .map(([k, v]) => `${k}=${v}`)
 .join(', ') + (Object.keys(labels).length > 2 ? '…' : '')
 : '–';
 return {
 name: p.metadata.name,
 namespace: p.metadata.namespace || 'default',
 minAvailable: minAv != null && minAv !== '' ? String(minAv) : '–',
 maxUnavailable: maxUnav != null && maxUnav !== '' ? String(maxUnav) : '–',
 currentHealthy,
 desiredHealthy,
 disruptionsAllowed,
 expectedPods,
 selectorSummary,
 age: calculateAge(p.metadata.creationTimestamp),
 creationTimestamp: p.metadata?.creationTimestamp,
 satisfied: disruptionsAllowed > 0 || (currentHealthy >= desiredHealthy && desiredHealthy > 0),
 blocking: disruptionsAllowed === 0 && desiredHealthy > 0,
 };
}

const PDB_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'minAvailable', defaultWidth: 100, minWidth: 70 },
 { id: 'maxUnavailable', defaultWidth: 100, minWidth: 70 },
 { id: 'currentHealthy', defaultWidth: 100, minWidth: 70 },
 { id: 'desiredHealthy', defaultWidth: 100, minWidth: 70 },
 { id: 'disruptionsAllowed', defaultWidth: 100, minWidth: 70 },
 { id: 'selector', defaultWidth: 220, minWidth: 120 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const PDB_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'minAvailable', label: 'Min Available' },
 { id: 'maxUnavailable', label: 'Max Unavailable' },
 { id: 'currentHealthy', label: 'Current Healthy' },
 { id: 'desiredHealthy', label: 'Desired Healthy' },
 { id: 'disruptionsAllowed', label: 'Disruptions Allowed' },
 { id: 'selector', label: 'Target' },
 { id: 'age', label: 'Age' },
];

export default function PodDisruptionBudgets() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, refetch, pagination: hookPagination } = usePaginatedResourceList<PDBResource>('poddisruptionbudgets');
 const deleteResource = useDeleteK8sResource('poddisruptionbudgets');

 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: PDBRow | null; bulk?: boolean }>({ open: false, item: null });
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [showCreator, setShowCreator] = useState(false);
 const [searchQuery, setSearchQuery] = useState('');
 const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
 const [listView, setListView] = useState<'flat' | 'byNamespace'>('flat');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const allItems = useMemo(() => (data?.allItems ?? []) as PDBResource[], [data?.allItems]);
 const items: PDBRow[] = useMemo(() => (isConnected ? allItems.map(transformPDB) : []), [isConnected, allItems]);

 const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.namespace)))], [items]);
 const itemsAfterNs = useMemo(() => (selectedNamespace === 'all' ? items : items.filter((i) => i.namespace === selectedNamespace)), [items, selectedNamespace]);

 const tableConfig: ColumnConfig<PDBRow>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
 { columnId: 'disruptionStatus', getValue: (i) => i.disruptionsAllowed > 0 ? 'Allowing Disruptions' : i.blocking ? 'Blocking Disruptions' : 'No Disruptions Allowed', sortable: true, filterable: true },
 { columnId: 'minAvailable', getValue: (i) => i.minAvailable, sortable: true, filterable: false },
 { columnId: 'maxUnavailable', getValue: (i) => i.maxUnavailable, sortable: true, filterable: false },
 { columnId: 'currentHealthy', getValue: (i) => i.currentHealthy, sortable: true, filterable: false, compare: (a, b) => a.currentHealthy - b.currentHealthy },
 { columnId: 'desiredHealthy', getValue: (i) => i.desiredHealthy, sortable: true, filterable: false, compare: (a, b) => a.desiredHealthy - b.desiredHealthy },
 { columnId: 'disruptionsAllowed', getValue: (i) => i.disruptionsAllowed, sortable: true, filterable: false, compare: (a, b) => a.disruptionsAllowed - b.disruptionsAllowed },
 { columnId: 'selector', getValue: (i) => i.selectorSummary, sortable: true, filterable: false },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterNs, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'poddisruptionbudgets', columns: PDB_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const searchFiltered = useMemo(() => {
 if (!searchQuery.trim()) return filteredItems;
 const q = searchQuery.toLowerCase();
 return filteredItems.filter((i) => i.name.toLowerCase().includes(q) || i.namespace.toLowerCase().includes(q) || i.selectorSummary.toLowerCase().includes(q));
 }, [filteredItems, searchQuery]);

 const stats = useMemo(() => {
 const total = items.length;
 const allowingDisruptions = items.filter((i) => i.disruptionsAllowed > 0).length;
 const blockingDisruptions = items.filter((i) => i.blocking).length;
 const noDisruptionsAllowed = items.filter((i) => i.disruptionsAllowed === 0).length;
 return { total, allowingDisruptions, blockingDisruptions, noDisruptionsAllowed };
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
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No PDBs',
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
 toast.success(`Deleted ${selectedItems.size} PDB(s)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
 toast.success(`PDB ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const toggleSelection = (r: PDBRow) => {
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
 filenamePrefix: 'pdb',
 resourceLabel: 'Pod Disruption Budgets',
 getExportData: (r: PDBRow) => ({ name: r.name, namespace: r.namespace, minAvailable: r.minAvailable, maxUnavailable: r.maxUnavailable, disruptionsAllowed: r.disruptionsAllowed, age: r.age }),
 csvColumns: [
 { label: 'Name', getValue: (r: PDBRow) => r.name },
 { label: 'Namespace', getValue: (r: PDBRow) => r.namespace },
 { label: 'Min Available', getValue: (r: PDBRow) => r.minAvailable },
 { label: 'Max Unavailable', getValue: (r: PDBRow) => r.maxUnavailable },
 { label: 'Disruptions Allowed', getValue: (r: PDBRow) => String(r.disruptionsAllowed) },
 { label: 'Age', getValue: (r: PDBRow) => r.age },
 ],
 };

 if (showCreator) {
 return (
 <ResourceCreator
 resourceKind="PodDisruptionBudget"
 defaultYaml={DEFAULT_YAMLS.PodDisruptionBudget}
 onClose={() => setShowCreator(false)}
 onApply={() => { toast.success('PDB created'); setShowCreator(false); refetch(); }}
 />
 );
 }

 return (
 <>
 <div className="space-y-6">
 <ListPageHeader
 icon={<Shield className="h-6 w-6 text-primary" />}
 title="Pod Disruption Budgets"
 resourceCount={searchFiltered.length}
 subtitle={namespaces.length > 1 ? `across ${namespaces.length - 1} namespaces` : undefined}
 demoMode={!isConnected}
 dataUpdatedAt={hookPagination?.dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create"
 onCreate={() => setShowCreator(true)}
 actions={
 <>
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => `${r.namespace}/${r.name}`} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected PDBs' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
 <ListPageStatCard label="Total" value={stats.total} icon={Shield} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Allowing Disruptions" value={stats.allowingDisruptions} icon={Shield} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.disruptionStatus?.size === 1 && columnFilters.disruptionStatus.has('Allowing Disruptions')} onClick={() => setColumnFilter('disruptionStatus', columnFilters.disruptionStatus?.has('Allowing Disruptions') ? null : new Set(['Allowing Disruptions']))} className={cn(columnFilters.disruptionStatus?.size === 1 && columnFilters.disruptionStatus.has('Allowing Disruptions') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard label="Blocking Disruptions" value={stats.blockingDisruptions} icon={Shield} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.disruptionStatus?.size === 1 && columnFilters.disruptionStatus.has('Blocking Disruptions')} onClick={() => setColumnFilter('disruptionStatus', columnFilters.disruptionStatus?.has('Blocking Disruptions') ? null : new Set(['Blocking Disruptions']))} className={cn(columnFilters.disruptionStatus?.size === 1 && columnFilters.disruptionStatus.has('Blocking Disruptions') && 'ring-2 ring-amber-600')} isLoading={isLoading} />
 <ListPageStatCard label="No Disruptions Allowed" value={stats.noDisruptionsAllowed} icon={Shield} iconColor="text-destructive" valueClassName="text-destructive" selected={columnFilters.disruptionStatus?.size === 1 && columnFilters.disruptionStatus.has('No Disruptions Allowed')} onClick={() => setColumnFilter('disruptionStatus', columnFilters.disruptionStatus?.has('No Disruptions Allowed') ? null : new Set(['No Disruptions Allowed']))} className={cn(columnFilters.disruptionStatus?.size === 1 && columnFilters.disruptionStatus.has('No Disruptions Allowed') && 'ring-2 ring-destructive')} isLoading={isLoading} />
 </div>

 {/* Bulk Actions Bar */}
 {selectedItems.size > 0 && (
 <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
 <Badge variant="secondary" className="gap-1.5">
 <CheckSquare className="h-3.5 w-3.5" />
 {selectedItems.size} selected
 </Badge>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => `${r.namespace}/${r.name}`} config={exportConfig} selectionLabel="Selected PDBs" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
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
 <Input placeholder="Search PDBs..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search PDBs" />
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
 columns={PDB_COLUMNS_FOR_VISIBILITY}
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
 <ResizableTableProvider tableId="poddisruptionbudgets" columnConfig={PDB_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 950 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="minAvailable"><TableColumnHeaderWithFilterAndSort columnId="minAvailable" label="Min Available" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="maxUnavailable"><TableColumnHeaderWithFilterAndSort columnId="maxUnavailable" label="Max Unavailable" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="currentHealthy"><TableColumnHeaderWithFilterAndSort columnId="currentHealthy" label="Current Healthy" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="desiredHealthy"><TableColumnHeaderWithFilterAndSort columnId="desiredHealthy" label="Desired Healthy" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="disruptionsAllowed"><TableColumnHeaderWithFilterAndSort columnId="disruptionsAllowed" label="Disruptions Allowed" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="selector"><TableColumnHeaderWithFilterAndSort columnId="selector" label="Target" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="namespace" className="p-1.5"><TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} /></ResizableTableCell>
 <ResizableTableCell columnId="minAvailable" className="p-1.5"><TableFilterCell columnId="disruptionStatus" label="Disruption Status" distinctValues={distinctValuesByColumn.disruptionStatus ?? []} selectedFilterValues={columnFilters.disruptionStatus ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.disruptionStatus} /></ResizableTableCell>
 <ResizableTableCell columnId="maxUnavailable" className="p-1.5" />
 <ResizableTableCell columnId="currentHealthy" className="p-1.5" />
 <ResizableTableCell columnId="desiredHealthy" className="p-1.5" />
 <ResizableTableCell columnId="disruptionsAllowed" className="p-1.5" />
 <ResizableTableCell columnId="selector" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={11} resourceName="pod disruption budgets" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={11} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : searchFiltered.length === 0 ? (
 <TableRow>
 <TableCell colSpan={11} className="h-40 text-center">
 <TableEmptyState
 icon={<Shield className="h-8 w-8" />}
 title="No PDBs found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Create a PDB to limit voluntary disruptions of workloads.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create PDB"
 onCreate={() => setShowCreator(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((r, idx) => (
 <tr key={`${r.namespace}/${r.name}`} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(`${r.namespace}/${r.name}`) && 'bg-primary/5')}>
 <TableCell><Checkbox checked={selectedItems.has(`${r.namespace}/${r.name}`)} onCheckedChange={() => toggleSelection(r)} aria-label={`Select ${r.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/poddisruptionbudgets/${r.namespace}/${r.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <Shield className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{r.name}</span>
 </Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={r.namespace} /></ResizableTableCell>
 <ResizableTableCell columnId="minAvailable" className="font-mono text-sm">{r.minAvailable}</ResizableTableCell>
 <ResizableTableCell columnId="maxUnavailable" className="font-mono text-sm">{r.maxUnavailable}</ResizableTableCell>
 <ResizableTableCell columnId="currentHealthy" className="font-mono text-sm tabular-nums">{r.currentHealthy}</ResizableTableCell>
 <ResizableTableCell columnId="desiredHealthy" className="font-mono text-sm tabular-nums">{r.desiredHealthy}</ResizableTableCell>
 <ResizableTableCell columnId="disruptionsAllowed">
 {r.disruptionsAllowed === 0 ? (
 <Badge variant="destructive" className="font-mono tabular-nums">0</Badge>
 ) : (
 <span className="font-mono text-sm tabular-nums">{r.disruptionsAllowed}</span>
 )}
 </ResizableTableCell>
 <ResizableTableCell columnId="selector" className="text-muted-foreground text-xs truncate font-mono" title={r.selectorSummary}>{r.selectorSummary}</ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={r.age} timestamp={r.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="PDB actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <CopyNameDropdownItem name={r.name} namespace={r.namespace} />
 <DropdownMenuItem onClick={() => navigate(`/poddisruptionbudgets/${r.namespace}/${r.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/namespaces/${r.namespace}`)} className="gap-2">View Namespace</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/poddisruptionbudgets/${r.namespace}/${r.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
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
 </div>

 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null, bulk: open ? deleteDialog.bulk : false })}
 resourceType="PodDisruptionBudget"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name || '')}
 namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace}
 onConfirm={handleDelete}
 requireNameConfirmation={!deleteDialog.bulk}
 />
 </>
 );
}
