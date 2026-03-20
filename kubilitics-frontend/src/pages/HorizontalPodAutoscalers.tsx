import { useState, useMemo, useEffect } from 'react';
import { Scale, Search, RefreshCw, MoreHorizontal,
 WifiOff, Plus, ChevronDown, Filter, List, Layers, CheckSquare, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
 NamespaceBadge,
 ResourceListTableToolbar,
 TableFilterCell,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { getDetailPath } from '@/utils/resourceKindMapper';

interface HPAResource extends KubernetesResource {
 spec?: {
 scaleTargetRef?: { kind?: string; name?: string };
 minReplicas?: number;
 maxReplicas?: number;
 metrics?: Array<{ type?: string; resource?: { name?: string; target?: { averageUtilization?: number } } }>;
 };
 status?: {
 currentReplicas?: number;
 desiredReplicas?: number;
 currentMetrics?: Array<{ resource?: { name?: string; current?: { averageUtilization?: number } } }>;
 lastScaleTime?: string;
 conditions?: Array<{ type?: string; status?: string; reason?: string }>;
 };
}

interface HPARow {
 name: string;
 namespace: string;
 targetKind: string;
 targetName: string;
 minReplicas: number;
 maxReplicas: number;
 currentReplicas: number;
 desiredReplicas: number;
 cpuTarget: string;
 cpuCurrent: string;
 customMetricsCount: number;
 lastScale: string;
 age: string;
 creationTimestamp?: string;
 isScaling: boolean;
 scalingUp: boolean;
 scalingDown: boolean;
 atMax: boolean;
 atMin: boolean;
 scalingLimited: boolean;
 minMaxReplicas: string;
}

function transformHPA(h: HPAResource): HPARow {
 const ref = h.spec?.scaleTargetRef;
 const targetKind = ref?.kind ?? '–';
 const targetName = ref?.name ?? '–';
 const minReplicas = h.spec?.minReplicas ?? 1;
 const maxReplicas = h.spec?.maxReplicas ?? 1;
 const currentReplicas = h.status?.currentReplicas ?? 0;
 const desiredReplicas = h.status?.desiredReplicas ?? currentReplicas;
 const cpuMetric = h.spec?.metrics?.find((m) => m.resource?.name === 'cpu')?.resource?.target?.averageUtilization;
 const currentCpu = h.status?.currentMetrics?.find((m) => m.resource?.name === 'cpu')?.resource?.current?.averageUtilization;
 const customMetricsCount = (h.spec?.metrics ?? []).filter((m) => m.type !== 'Resource' || (m.resource?.name && m.resource.name !== 'cpu' && m.resource.name !== 'memory')).length;
 const scalingLimited = (h.status?.conditions ?? []).some((c) => c.type === 'ScalingLimited' && c.status === 'True');
 const isScaling = currentReplicas !== desiredReplicas;
 return {
 name: h.metadata.name,
 namespace: h.metadata.namespace || 'default',
 targetKind,
 targetName,
 minReplicas,
 maxReplicas,
 minMaxReplicas: `${minReplicas}/${maxReplicas}`,
 currentReplicas,
 desiredReplicas,
 cpuTarget: cpuMetric != null ? `${cpuMetric}%` : '–',
 cpuCurrent: currentCpu != null ? `${currentCpu}%` : '–',
 customMetricsCount,
 lastScale: h.status?.lastScaleTime ? calculateAge(h.status.lastScaleTime) : '–',
 age: calculateAge(h.metadata.creationTimestamp),
 creationTimestamp: h.metadata?.creationTimestamp,
 isScaling,
 scalingUp: isScaling && desiredReplicas > currentReplicas,
 scalingDown: isScaling && desiredReplicas < currentReplicas,
 atMax: desiredReplicas >= maxReplicas && maxReplicas > 0,
 atMin: desiredReplicas <= minReplicas,
 scalingLimited,
 };
}

const HPA_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'target', defaultWidth: 160, minWidth: 100 },
 { id: 'minMaxReplicas', defaultWidth: 100, minWidth: 70 },
 { id: 'current', defaultWidth: 100, minWidth: 70 },
 { id: 'cpuTarget', defaultWidth: 130, minWidth: 90 },
 { id: 'cpuCurrent', defaultWidth: 130, minWidth: 90 },
 { id: 'lastScale', defaultWidth: 160, minWidth: 100 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const HPA_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'target', label: 'Target' },
 { id: 'minMaxReplicas', label: 'Min/Max Replicas' },
 { id: 'current', label: 'Current Replicas' },
 { id: 'cpuTarget', label: 'Target CPU' },
 { id: 'cpuCurrent', label: 'Current CPU' },
 { id: 'lastScale', label: 'Last Scale Time' },
 { id: 'age', label: 'Age' },
];

export default function HorizontalPodAutoscalers() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, refetch, pagination: hookPagination } = usePaginatedResourceList<HPAResource>('horizontalpodautoscalers');
 const deleteResource = useDeleteK8sResource('horizontalpodautoscalers');

 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: HPARow | null; bulk?: boolean }>({ open: false, item: null });
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [showCreator, setShowCreator] = useState(false);
 const [searchQuery, setSearchQuery] = useState('');
 const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
 const [listView, setListView] = useState<'flat' | 'byNamespace'>('flat');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const allItems = (data?.allItems ?? []) as HPAResource[];
 const items: HPARow[] = useMemo(() => (isConnected ? allItems.map(transformHPA) : []), [isConnected, allItems]);

 const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.namespace)))], [items]);
 const itemsAfterNs = useMemo(
 () => (selectedNamespace === 'all' ? items : items.filter((i) => i.namespace === selectedNamespace)),
 [items, selectedNamespace]
 );

 const tableConfig: ColumnConfig<HPARow>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
 { columnId: 'scalingStatus', getValue: (i) => i.scalingUp ? 'Scaling Up' : i.scalingDown ? 'Scaling Down' : i.atMax ? 'At Max' : i.atMin ? 'At Min' : 'Stable', sortable: true, filterable: true },
 { columnId: 'target', getValue: (i) => `${i.targetKind}/${i.targetName}`, sortable: true, filterable: false },
 { columnId: 'minMaxReplicas', getValue: (i) => i.minMaxReplicas, sortable: true, filterable: false, compare: (a, b) => a.minReplicas - b.minReplicas || a.maxReplicas - b.maxReplicas },
 { columnId: 'current', getValue: (i) => i.currentReplicas, sortable: true, filterable: false, compare: (a, b) => a.currentReplicas - b.currentReplicas },
 { columnId: 'cpuTarget', getValue: (i) => i.cpuTarget, sortable: true, filterable: false },
 { columnId: 'cpuCurrent', getValue: (i) => i.cpuCurrent, sortable: true, filterable: false },
 { columnId: 'lastScale', getValue: (i) => i.lastScale, sortable: true, filterable: false },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterNs, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'horizontalpodautoscalers', columns: HPA_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const searchFiltered = useMemo(() => {
 if (!searchQuery.trim()) return filteredItems;
 const q = searchQuery.toLowerCase();
 return filteredItems.filter((i) => i.name.toLowerCase().includes(q) || i.namespace.toLowerCase().includes(q) || i.targetName.toLowerCase().includes(q));
 }, [filteredItems, searchQuery]);

 const stats = useMemo(() => {
 const total = items.length;
 const scalingUp = items.filter((i) => i.scalingUp).length;
 const scalingDown = items.filter((i) => i.scalingDown).length;
 const atMin = items.filter((i) => i.atMin).length;
 const atMax = items.filter((i) => i.atMax).length;
 return { total, scalingUp, scalingDown, atMin, atMax };
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
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No HPAs',
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
 toast.success(`Deleted ${selectedItems.size} HPA(s)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
 toast.success(`HPA ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const toggleSelection = (r: HPARow) => {
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
 filenamePrefix: 'hpa',
 resourceLabel: 'Horizontal Pod Autoscalers',
 getExportData: (r: HPARow) => ({ name: r.name, namespace: r.namespace, target: `${r.targetKind}/${r.targetName}`, currentReplicas: r.currentReplicas, desiredReplicas: r.desiredReplicas, cpuTarget: r.cpuTarget, age: r.age }),
 csvColumns: [
 { label: 'Name', getValue: (r: HPARow) => r.name },
 { label: 'Namespace', getValue: (r: HPARow) => r.namespace },
 { label: 'Target', getValue: (r: HPARow) => `${r.targetKind}/${r.targetName}` },
 { label: 'Current/Desired', getValue: (r: HPARow) => `${r.currentReplicas}/${r.desiredReplicas}` },
 { label: 'Age', getValue: (r: HPARow) => r.age },
 ],
 };

 const targetLink = (r: HPARow): string => {
 const path = getDetailPath(r.targetKind, r.targetName, r.namespace);
 return path ?? '#';
 };

 if (showCreator) {
 return (
 <ResourceCreator
 resourceKind="HorizontalPodAutoscaler"
 defaultYaml={DEFAULT_YAMLS.HorizontalPodAutoscaler}
 onClose={() => setShowCreator(false)}
 onApply={() => { toast.success('HPA created'); setShowCreator(false); refetch(); }}
 />
 );
 }

 return (
 <>
 <div className="space-y-6">
 <ListPageHeader
 icon={<Scale className="h-6 w-6 text-primary" />}
 title="Horizontal Pod Autoscalers"
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
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => `${r.namespace}/${r.name}`} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected HPAs' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
 <ListPageStatCard label="Total" value={stats.total} icon={Scale} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Scaling Up" value={stats.scalingUp} icon={Scale} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.scalingStatus?.size === 1 && columnFilters.scalingStatus.has('Scaling Up')} onClick={() => setColumnFilter('scalingStatus', new Set(['Scaling Up']))} className={cn(columnFilters.scalingStatus?.size === 1 && columnFilters.scalingStatus.has('Scaling Up') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard label="Scaling Down" value={stats.scalingDown} icon={Scale} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.scalingStatus?.size === 1 && columnFilters.scalingStatus.has('Scaling Down')} onClick={() => setColumnFilter('scalingStatus', new Set(['Scaling Down']))} className={cn(columnFilters.scalingStatus?.size === 1 && columnFilters.scalingStatus.has('Scaling Down') && 'ring-2 ring-amber-600')} isLoading={isLoading} />
 <ListPageStatCard label="At Min" value={stats.atMin} icon={Scale} iconColor="text-muted-foreground" selected={columnFilters.scalingStatus?.size === 1 && columnFilters.scalingStatus.has('At Min')} onClick={() => setColumnFilter('scalingStatus', new Set(['At Min']))} className={cn(columnFilters.scalingStatus?.size === 1 && columnFilters.scalingStatus.has('At Min') && 'ring-2 ring-muted-foreground')} isLoading={isLoading} />
 <ListPageStatCard label="At Max" value={stats.atMax} icon={Scale} iconColor="text-muted-foreground" selected={columnFilters.scalingStatus?.size === 1 && columnFilters.scalingStatus.has('At Max')} onClick={() => setColumnFilter('scalingStatus', new Set(['At Max']))} className={cn(columnFilters.scalingStatus?.size === 1 && columnFilters.scalingStatus.has('At Max') && 'ring-2 ring-muted-foreground')} isLoading={isLoading} />
 </div>

 {/* Bulk Actions Bar */}
 {selectedItems.size > 0 && (
 <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
 <Badge variant="secondary" className="gap-1.5">
 <CheckSquare className="h-3.5 w-3.5" />
 {selectedItems.size} selected
 </Badge>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => `${r.namespace}/${r.name}`} config={exportConfig} selectionLabel="Selected HPAs" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
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
 <Input placeholder="Search HPAs..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search HPAs" />
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
 columns={HPA_COLUMNS_FOR_VISIBILITY}
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
 <ResizableTableProvider tableId="horizontalpodautoscalers" columnConfig={HPA_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 980 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="target"><TableColumnHeaderWithFilterAndSort columnId="target" label="Target" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="minMaxReplicas"><TableColumnHeaderWithFilterAndSort columnId="minMaxReplicas" label="Min/Max Replicas" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="current"><TableColumnHeaderWithFilterAndSort columnId="current" label="Current Replicas" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="cpuTarget"><TableColumnHeaderWithFilterAndSort columnId="cpuTarget" label="Target CPU" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="cpuCurrent"><TableColumnHeaderWithFilterAndSort columnId="cpuCurrent" label="Current CPU" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="lastScale"><TableColumnHeaderWithFilterAndSort columnId="lastScale" label="Last Scale Time" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="namespace" className="p-1.5"><TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} /></ResizableTableCell>
 <ResizableTableCell columnId="target" className="p-1.5" />
 <ResizableTableCell columnId="minMaxReplicas" className="p-1.5" />
 <ResizableTableCell columnId="current" className="p-1.5"><TableFilterCell columnId="scalingStatus" label="Scaling Status" distinctValues={distinctValuesByColumn.scalingStatus ?? []} selectedFilterValues={columnFilters.scalingStatus ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.scalingStatus} /></ResizableTableCell>
 <ResizableTableCell columnId="cpuTarget" className="p-1.5" />
 <ResizableTableCell columnId="cpuCurrent" className="p-1.5" />
 <ResizableTableCell columnId="lastScale" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={12} resourceName="autoscalers" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={12} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : searchFiltered.length === 0 ? (
 <TableRow>
 <TableCell colSpan={12} className="h-40 text-center">
 <TableEmptyState
 icon={<Scale className="h-8 w-8" />}
 title="No HPAs found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Create an HPA to scale workloads by CPU or custom metrics.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create HPA"
 onCreate={() => setShowCreator(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((r, idx) => (
 <tr key={`${r.namespace}/${r.name}`} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(`${r.namespace}/${r.name}`) && 'bg-primary/5')}>
 <TableCell><Checkbox checked={selectedItems.has(`${r.namespace}/${r.name}`)} onCheckedChange={() => toggleSelection(r)} aria-label={`Select ${r.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/horizontalpodautoscalers/${r.namespace}/${r.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
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
 <ResizableTableCell columnId="minMaxReplicas" className="font-mono text-sm tabular-nums">{r.minMaxReplicas}</ResizableTableCell>
 <ResizableTableCell columnId="current">
 <div className="flex items-center gap-2 min-w-0">
 <Progress
 value={r.maxReplicas > 0 ? Math.round((r.currentReplicas / r.maxReplicas) * 100) : 0}
 className="h-1.5 w-12 flex-shrink-0"
 />
 <span className="font-mono text-sm tabular-nums">{r.currentReplicas}</span>
 </div>
 </ResizableTableCell>
 <ResizableTableCell columnId="cpuTarget" className="text-muted-foreground font-mono text-sm">{r.cpuTarget}</ResizableTableCell>
 <ResizableTableCell columnId="cpuCurrent" className="text-muted-foreground font-mono text-sm">{r.cpuCurrent}</ResizableTableCell>
 <ResizableTableCell columnId="lastScale" className="text-muted-foreground text-sm whitespace-nowrap">{r.lastScale}</ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={r.age} timestamp={r.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="HPA actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem onClick={() => navigate(`/horizontalpodautoscalers/${r.namespace}/${r.name}`)} className="gap-2">View Details</DropdownMenuItem>
 {r.targetName !== '–' && <DropdownMenuItem onClick={() => navigate(targetLink(r))} className="gap-2">View Target Workload</DropdownMenuItem>}
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/horizontalpodautoscalers/${r.namespace}/${r.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
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
 resourceType="HorizontalPodAutoscaler"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name || '')}
 namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace}
 onConfirm={handleDelete}
 requireNameConfirmation={!deleteDialog.bulk}
 />
 </>
 );
}
