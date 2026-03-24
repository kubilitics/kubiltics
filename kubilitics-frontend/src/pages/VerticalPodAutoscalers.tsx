import { useState, useMemo, useEffect } from 'react';
import { Scale, Search, RefreshCw, MoreHorizontal,
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
import { toast } from '@/components/ui/sonner';
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
 NamespaceBadge,
 ResourceListTableToolbar,
 TableFilterCell,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { getDetailPath } from '@/utils/resourceKindMapper';

interface VPAResource extends KubernetesResource {
 spec?: {
 targetRef?: { kind?: string; name?: string };
 updatePolicy?: { updateMode?: string };
 };
 status?: {
 recommendation?: { containerRecommendations?: Array<{ lowerBound?: Record<string, string>; target?: Record<string, string>; upperBound?: Record<string, string> }> };
 };
}

interface VPARow {
 name: string;
 namespace: string;
 targetKind: string;
 targetName: string;
 updateMode: string;
 cpuRecommendation: string;
 memoryRecommendation: string;
 cpuTarget: string;
 memoryTarget: string;
 age: string;
 creationTimestamp?: string;
 updateModeOff: boolean;
 updateModeAuto: boolean;
 hasRecommendation: boolean;
}

function transformVPA(v: VPAResource): VPARow {
 const ref = v.spec?.targetRef;
 const rec = v.status?.recommendation?.containerRecommendations?.[0];
 const mode = v.spec?.updatePolicy?.updateMode ?? 'Auto';
 const cpuRec = rec ? `${rec.lowerBound?.cpu ?? '–'}-${rec.target?.cpu ?? '–'}-${rec.upperBound?.cpu ?? '–'}`.replace(/^–-|–$/g, '–') : '–';
 const memRec = rec ? `${rec.lowerBound?.memory ?? '–'}-${rec.target?.memory ?? '–'}-${rec.upperBound?.memory ?? '–'}`.replace(/^–-|–$/g, '–') : '–';
 const cpuTarget = rec?.target?.cpu ?? '–';
 const memoryTarget = rec?.target?.memory ?? '–';
 return {
 name: v.metadata.name,
 namespace: v.metadata.namespace || 'default',
 targetKind: ref?.kind ?? '–',
 targetName: ref?.name ?? '–',
 updateMode: mode,
 cpuRecommendation: cpuRec,
 memoryRecommendation: memRec,
 cpuTarget,
 memoryTarget,
 age: calculateAge(v.metadata.creationTimestamp),
 creationTimestamp: v.metadata?.creationTimestamp,
 updateModeOff: mode === 'Off',
 updateModeAuto: mode === 'Auto',
 hasRecommendation: !!rec,
 };
}

const VPA_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'target', defaultWidth: 160, minWidth: 100 },
 { id: 'updateMode', defaultWidth: 160, minWidth: 100 },
 { id: 'cpuRec', defaultWidth: 130, minWidth: 90 },
 { id: 'memoryRec', defaultWidth: 130, minWidth: 90 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const VPA_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'target', label: 'Target' },
 { id: 'updateMode', label: 'Mode' },
 { id: 'cpuRec', label: 'CPU Recommendation' },
 { id: 'memoryRec', label: 'Memory Recommendation' },
 { id: 'age', label: 'Age' },
];

export default function VerticalPodAutoscalers() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, refetch, pagination: hookPagination } = usePaginatedResourceList<VPAResource>('verticalpodautoscalers');
 const deleteResource = useDeleteK8sResource('verticalpodautoscalers');

 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: VPARow | null; bulk?: boolean }>({ open: false, item: null });
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [showCreator, setShowCreator] = useState(false);
 const [searchQuery, setSearchQuery] = useState('');
 const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
 const [listView, setListView] = useState<'flat' | 'byNamespace'>('flat');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const allItems = (data?.allItems ?? []) as VPAResource[];
 const items: VPARow[] = useMemo(() => (isConnected ? allItems.map(transformVPA) : []), [isConnected, allItems]);

 const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.namespace)))], [items]);
 const itemsAfterNs = useMemo(() => (selectedNamespace === 'all' ? items : items.filter((i) => i.namespace === selectedNamespace)), [items, selectedNamespace]);

 const tableConfig: ColumnConfig<VPARow>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
 { columnId: 'target', getValue: (i) => `${i.targetKind}/${i.targetName}`, sortable: true, filterable: false },
 { columnId: 'updateMode', getValue: (i) => i.updateMode, sortable: true, filterable: true },
 { columnId: 'cpuRec', getValue: (i) => i.cpuTarget, sortable: true, filterable: false },
 { columnId: 'memoryRec', getValue: (i) => i.memoryTarget, sortable: true, filterable: false },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterNs, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'verticalpodautoscalers', columns: VPA_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const searchFiltered = useMemo(() => {
 if (!searchQuery.trim()) return filteredItems;
 const q = searchQuery.toLowerCase();
 return filteredItems.filter((i) => i.name.toLowerCase().includes(q) || i.namespace.toLowerCase().includes(q) || i.targetName.toLowerCase().includes(q));
 }, [filteredItems, searchQuery]);

 const stats = useMemo(() => {
 const total = items.length;
 const autoMode = items.filter((i) => i.updateModeAuto).length;
 const offMode = items.filter((i) => i.updateModeOff).length;
 const withRecommendations = items.filter((i) => i.hasRecommendation).length;
 return { total, autoMode, offMode, withRecommendations };
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
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No VPAs',
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
 toast.success(`Deleted ${selectedItems.size} VPA(s)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
 toast.success(`VPA ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const toggleSelection = (r: VPARow) => {
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
 filenamePrefix: 'vpa',
 resourceLabel: 'Vertical Pod Autoscalers',
 getExportData: (r: VPARow) => ({ name: r.name, namespace: r.namespace, target: `${r.targetKind}/${r.targetName}`, updateMode: r.updateMode, cpuRecommendation: r.cpuTarget, memoryRecommendation: r.memoryTarget, age: r.age }),
 csvColumns: [
 { label: 'Name', getValue: (r: VPARow) => r.name },
 { label: 'Namespace', getValue: (r: VPARow) => r.namespace },
 { label: 'Update Mode', getValue: (r: VPARow) => r.updateMode },
 { label: 'Age', getValue: (r: VPARow) => r.age },
 ],
 };

 const targetLink = (r: VPARow): string => getDetailPath(r.targetKind, r.targetName, r.namespace) ?? '#';

 if (showCreator) {
 return (
 <ResourceCreator
 resourceKind="VerticalPodAutoscaler"
 defaultYaml={DEFAULT_YAMLS.VerticalPodAutoscaler}
 onClose={() => setShowCreator(false)}
 onApply={() => { toast.success('VPA created'); setShowCreator(false); refetch(); }}
 />
 );
 }

 return (
 <>
 <div className="space-y-6">
 <ListPageHeader
 icon={<Scale className="h-6 w-6 text-primary" />}
 title="Vertical Pod Autoscalers"
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
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => `${r.namespace}/${r.name}`} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected VPAs' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
 <ListPageStatCard label="Total" value={stats.total} icon={Scale} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Auto Mode" value={stats.autoMode} icon={Scale} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.updateMode?.size === 1 && columnFilters.updateMode.has('Auto')} onClick={() => setColumnFilter('updateMode', new Set(['Auto']))} className={cn(columnFilters.updateMode?.size === 1 && columnFilters.updateMode.has('Auto') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard label="Off Mode" value={stats.offMode} icon={Scale} iconColor="text-muted-foreground" selected={columnFilters.updateMode?.size === 1 && columnFilters.updateMode.has('Off')} onClick={() => setColumnFilter('updateMode', new Set(['Off']))} className={cn(columnFilters.updateMode?.size === 1 && columnFilters.updateMode.has('Off') && 'ring-2 ring-muted-foreground')} isLoading={isLoading} />
 <ListPageStatCard label="With Recommendations" value={stats.withRecommendations} icon={Scale} iconColor="text-blue-500" valueClassName="text-blue-500" isLoading={isLoading} />
 </div>

 {/* Bulk Actions Bar */}
 {selectedItems.size > 0 && (
 <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
 <Badge variant="secondary" className="gap-1.5">
 <CheckSquare className="h-3.5 w-3.5" />
 {selectedItems.size} selected
 </Badge>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => `${r.namespace}/${r.name}`} config={exportConfig} selectionLabel="Selected VPAs" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
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
 <Input placeholder="Search VPAs..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search VPAs" />
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
 columns={VPA_COLUMNS_FOR_VISIBILITY}
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
 <ResizableTableProvider tableId="verticalpodautoscalers" columnConfig={VPA_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 850 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="target"><TableColumnHeaderWithFilterAndSort columnId="target" label="Target" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="updateMode"><TableColumnHeaderWithFilterAndSort columnId="updateMode" label="Mode" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="cpuRec"><TableColumnHeaderWithFilterAndSort columnId="cpuRec" label="CPU Recommendation" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="memoryRec"><TableColumnHeaderWithFilterAndSort columnId="memoryRec" label="Memory Recommendation" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="namespace" className="p-1.5"><TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} /></ResizableTableCell>
 <ResizableTableCell columnId="target" className="p-1.5" />
 <ResizableTableCell columnId="updateMode" className="p-1.5"><TableFilterCell columnId="updateMode" label="Update Mode" distinctValues={distinctValuesByColumn.updateMode ?? []} selectedFilterValues={columnFilters.updateMode ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.updateMode} /></ResizableTableCell>
 <ResizableTableCell columnId="cpuRec" className="p-1.5" />
 <ResizableTableCell columnId="memoryRec" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={9} resourceName="autoscalers" isLoading={isLoading} onRetry={() => refetch()} />
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
 icon={<Scale className="h-8 w-8" />}
 title="No VPAs found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Create a VPA to automatically adjust pod CPU/memory requests.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create VPA"
 onCreate={() => setShowCreator(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((r, idx) => (
 <tr key={`${r.namespace}/${r.name}`} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(`${r.namespace}/${r.name}`) && 'bg-primary/5')}>
 <TableCell><Checkbox checked={selectedItems.has(`${r.namespace}/${r.name}`)} onCheckedChange={() => toggleSelection(r)} aria-label={`Select ${r.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/verticalpodautoscalers/${r.namespace}/${r.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <Scale className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{r.name}</span>
 </Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={r.namespace} /></ResizableTableCell>
 <ResizableTableCell columnId="target">
 {r.targetName !== '–' ? (
 <Link to={targetLink(r)} className="font-mono text-sm text-primary hover:underline truncate block">{r.targetKind}/{r.targetName}</Link>
 ) : (
 <span className="text-muted-foreground">–</span>
 )}
 </ResizableTableCell>
 <ResizableTableCell columnId="updateMode">
 <Badge variant={r.updateMode === 'Auto' ? 'default' : r.updateMode === 'Off' ? 'secondary' : 'outline'}>{r.updateMode}</Badge>
 </ResizableTableCell>
 <ResizableTableCell columnId="cpuRec" className="font-mono text-sm" title={r.cpuRecommendation !== r.cpuTarget ? r.cpuRecommendation : undefined}>{r.cpuTarget}</ResizableTableCell>
 <ResizableTableCell columnId="memoryRec" className="font-mono text-sm" title={r.memoryRecommendation !== r.memoryTarget ? r.memoryRecommendation : undefined}>{r.memoryTarget}</ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={r.age} timestamp={r.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="VPA actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem onClick={() => navigate(`/verticalpodautoscalers/${r.namespace}/${r.name}`)} className="gap-2">View Details</DropdownMenuItem>
 {r.targetName !== '–' && <DropdownMenuItem onClick={() => navigate(targetLink(r))} className="gap-2">View Target</DropdownMenuItem>}
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/verticalpodautoscalers/${r.namespace}/${r.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
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
 resourceType="VerticalPodAutoscaler"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name || '')}
 namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace}
 onConfirm={handleDelete}
 requireNameConfirmation={!deleteDialog.bulk}
 />
 </>
 );
}
