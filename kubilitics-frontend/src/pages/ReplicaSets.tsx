import { useState, useMemo, useEffect } from 'react';
import { 
 Search, Filter, RefreshCw, MoreHorizontal, CheckCircle2, XCircle, Clock, Loader2, WifiOff,
 ChevronDown, ChevronRight, CheckSquare, Trash2, Scale, Layers, Plus, FileText, List, GitBranch, EyeOff,
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
import { useK8sResourceList, useDeleteK8sResource, usePatchK8sResource, useCreateK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog, ScaleDialog, MetricBar, parseCpu, parseMemory, calculatePodResourceMax } from '@/components/resources';
import { ResourceExportDropdown, ListViewSegmentedControl, ListPagination, PAGE_SIZE_OPTIONS, ResourceCommandBar, resourceTableRowClassName, ROW_MOTION, StatusPill, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, AgeCell, TableEmptyState, TableErrorState, ListPageLoadingShell, NamespaceBadge, ResourceListTableToolbar } from '@/components/list';
import type { StatusPillVariant } from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useWorkloadMetricsMap } from '@/hooks/useWorkloadMetricsMap';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { toast } from '@/components/ui/sonner';
import { Card, CardContent } from '@/components/ui/card';
import { ReplicaSetIcon } from '@/components/icons/KubernetesIcons';

interface ReplicaSetResource extends KubernetesResource {
 spec: { 
 replicas: number;
 template?: { 
 spec?: { 
 containers?: Array<{ 
 name: string; 
 image: string;
 resources?: {
 requests?: { cpu?: string; memory?: string };
 limits?: { cpu?: string; memory?: string };
 };
 }> 
 } 
 };
 };
 status: { replicas?: number; readyReplicas?: number; availableReplicas?: number };
}

interface ReplicaSet {
 name: string;
 namespace: string;
 status: 'Healthy' | 'Progressing' | 'Degraded';
 desired: number;
 current: number;
 ready: number;
 owner: string;
 ownerKind: string;
 age: string;
 creationTimestamp?: string;
 cpu: string;
 memory: string;
}

const REPLICASETS_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'status', defaultWidth: 150, minWidth: 100 },
 { id: 'desired', defaultWidth: 100, minWidth: 70 },
 { id: 'current', defaultWidth: 100, minWidth: 70 },
 { id: 'ready', defaultWidth: 100, minWidth: 70 },
 { id: 'owner', defaultWidth: 160, minWidth: 100 },
 { id: 'cpu', defaultWidth: 130, minWidth: 90 },
 { id: 'memory', defaultWidth: 130, minWidth: 90 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const REPLICASETS_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'status', label: 'Status' },
 { id: 'desired', label: 'Desired' },
 { id: 'current', label: 'Current' },
 { id: 'ready', label: 'Ready' },
 { id: 'owner', label: 'Owner' },
 { id: 'cpu', label: 'CPU' },
 { id: 'memory', label: 'Memory' },
 { id: 'age', label: 'Age' },
];

const statusConfig = {
 Healthy: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-500/10' },
 Progressing: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-500/10' },
 Degraded: { icon: XCircle, color: 'text-rose-600', bg: 'bg-rose-500/10' },
};

const replicaSetStatusToVariant: Record<ReplicaSet['status'], StatusPillVariant> = {
 Healthy: 'success',
 Progressing: 'warning',
 Degraded: 'error',
};

function transformResource(resource: ReplicaSetResource): ReplicaSet {
 const desired = resource.spec?.replicas || 0;
 const current = resource.status?.replicas || 0;
 const ready = resource.status?.readyReplicas || 0;
 let status: ReplicaSet['status'] = 'Healthy';
 if (ready === 0 && desired > 0) status = 'Degraded';
 else if (ready < desired) status = 'Progressing';
 const ownerRefs = (resource.metadata as unknown as Record<string, unknown>).ownerReferences as Array<{kind: string}> | undefined;
 const deploymentOwner = ownerRefs?.find((r: {kind: string}) => r.kind === 'Deployment');
 const ownerRef = deploymentOwner ?? ownerRefs?.[0];
 return { name: resource.metadata.name, namespace: resource.metadata.namespace || 'default', status, desired, current, ready, owner: ownerRef?.name || '-', ownerKind: ownerRef?.kind || '', age: calculateAge(resource.metadata.creationTimestamp), creationTimestamp: resource.metadata?.creationTimestamp, cpu: '-', memory: '-' };
}

type ListView = 'flat' | 'byNamespace' | 'byOwner';

export default function ReplicaSets() {
 const navigate = useNavigate();
 const [searchQuery, setSearchQuery] = useState('');
 const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: ReplicaSet | null; bulk?: boolean }>({ open: false, item: null });
 const [scaleDialog, setScaleDialog] = useState<{ open: boolean; item: ReplicaSet | null }>({ open: false, item: null });
 const [listView, setListView] = useState<ListView>('flat');
 const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [activeOnly, setActiveOnly] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<ReplicaSetResource>('replicasets', undefined, { limit: 5000 });
 const deleteResource = useDeleteK8sResource('replicasets');
 const patchReplicaSet = usePatchK8sResource('replicasets');
 const createResource = useCreateK8sResource('replicasets');

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const items: ReplicaSet[] = isConnected && data ? (data.items ?? []).map(transformResource) : [];

 const stats = useMemo(() => ({
 total: items.length,
 active: items.filter(i => i.desired > 0).length,
 scaledToZero: items.filter(i => i.desired === 0).length,
 mismatched: items.filter(i => i.ready !== i.desired).length,
 }), [items]);
 const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map(i => i.namespace)))], [items]);

 const itemsAfterSearchAndNs = useMemo(() => {
 return items.filter((item) => {
 const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.namespace.toLowerCase().includes(searchQuery.toLowerCase());
 const matchesNamespace = selectedNamespace === 'all' || item.namespace === selectedNamespace;
 const matchesActive = !activeOnly || item.desired > 0;
 return matchesSearch && matchesNamespace && matchesActive;
 });
 }, [items, searchQuery, selectedNamespace, activeOnly]);

 const replicaSetsTableConfig: ColumnConfig<ReplicaSet>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: true },
 { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
 { columnId: 'status', getValue: (i) => i.status, sortable: true, filterable: true },
 { columnId: 'scale', getValue: (i) => (i.desired > 0 ? 'Active' : 'Scaled to zero'), sortable: true, filterable: true },
 { columnId: 'desired', getValue: (i) => i.desired, sortable: true, filterable: false },
 { columnId: 'current', getValue: (i) => i.current, sortable: true, filterable: false },
 { columnId: 'ready', getValue: (i) => i.ready, sortable: true, filterable: false },
 { columnId: 'owner', getValue: (i) => i.owner, sortable: true, filterable: true },
 { columnId: 'cpu', getValue: (i) => i.cpu, sortable: true, filterable: false },
 { columnId: 'memory', getValue: (i) => i.memory, sortable: true, filterable: false },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearchAndNs, { columns: replicaSetsTableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });

 const columnVisibility = useColumnVisibility({
 tableId: 'replicasets',
 columns: REPLICASETS_COLUMNS_FOR_VISIBILITY,
 alwaysVisible: ['name'],
 });

 const totalFiltered = filteredItems.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredItems.slice(start, start + pageSize);

 const metricsEntries = useMemo(
 () => itemsOnPage.map((i) => ({ namespace: i.namespace, name: i.name })),
 [itemsOnPage]
 );
 const { metricsMap } = useWorkloadMetricsMap('replicaset', metricsEntries);

 // Calculate resource max values from replicaset pod template container limits/requests
 const replicasetResourceMaxMap = useMemo(() => {
 const m: Record<string, { cpuMax?: number; memoryMax?: number }> = {};
 if (data?.items) {
 data.items.forEach((rsResource) => {
 const key = `${rsResource.metadata.namespace}/${rsResource.metadata.name}`;
 const containers = rsResource.spec?.template?.spec?.containers || [];
 const cpuMax = calculatePodResourceMax(containers, 'cpu');
 const memoryMax = calculatePodResourceMax(containers, 'memory');
 if (cpuMax !== undefined || memoryMax !== undefined) {
 m[key] = { cpuMax, memoryMax };
 }
 });
 }
 return m;
 }, [data?.items]);

 const groupedOnPage = useMemo(() => {
 if ((listView !== 'byNamespace' && listView !== 'byOwner') || itemsOnPage.length === 0) return [];
 const map = new Map<string, ReplicaSet[]>();
 for (const item of itemsOnPage) {
 const groupKey = listView === 'byOwner' ? (item.owner !== '-' ? item.owner : '(no owner)') : item.namespace;
 const list = map.get(groupKey) ?? [];
 list.push(item);
 map.set(groupKey, list);
 }
 const prefix = listView === 'byOwner' ? 'owner' : 'ns';
 return Array.from(map.entries())
 .map(([label, list]) => ({ groupKey: `${prefix}:${label}`, label, list }))
 .sort((a, b) => a.label.localeCompare(b.label));
 }, [listView, itemsOnPage]);

 useEffect(() => {
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [safePageIndex, pageIndex]);

 const handlePageSizeChange = (size: number) => {
 setPageSize(size);
 setPageIndex(0);
 };

 const pagination = {
 rangeLabel: totalFiltered > 0
 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}`
 : 'No replicasets',
 hasPrev: safePageIndex > 0,
 hasNext: start + pageSize < totalFiltered,
 onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
 onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
 currentPage: safePageIndex + 1,
 totalPages: Math.max(1, totalPages),
 onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
 };

 const toggleGroup = (groupKey: string) => {
 setCollapsedGroups((prev) => {
 const next = new Set(prev);
 if (next.has(groupKey)) next.delete(groupKey);
 else next.add(groupKey);
 return next;
 });
 };

 const handleDelete = async () => {
 if (!isConnected) {
 toast.error('Connect cluster to delete replicasets');
 setDeleteDialog({ open: false, item: null });
 return;
 }
 if (deleteDialog.bulk && selectedItems.size > 0) {
 for (const key of selectedItems) {
 const [ns, n] = key.split('/');
 if (n && ns) await deleteResource.mutateAsync({ name: n, namespace: ns });
 }
 toast.success(`Deleted ${selectedItems.size} replicaset(s)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
 toast.success(`ReplicaSet ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 };

 const replicaSetExportConfig = {
 filenamePrefix: 'replicasets',
 resourceLabel: 'replicasets',
 getExportData: (r: ReplicaSet) => ({ name: r.name, namespace: r.namespace, status: r.status, desired: r.desired, current: r.current, ready: r.ready, owner: r.owner, age: r.age, cpu: r.cpu, memory: r.memory }),
 csvColumns: [
 { label: 'Name', getValue: (r: ReplicaSet) => r.name },
 { label: 'Namespace', getValue: (r: ReplicaSet) => r.namespace },
 { label: 'Status', getValue: (r: ReplicaSet) => r.status },
 { label: 'Desired', getValue: (r: ReplicaSet) => r.desired },
 { label: 'Current', getValue: (r: ReplicaSet) => r.current },
 { label: 'Ready', getValue: (r: ReplicaSet) => r.ready },
 { label: 'Owner', getValue: (r: ReplicaSet) => r.owner },
 { label: 'CPU', getValue: (r: ReplicaSet) => r.cpu },
 { label: 'Memory', getValue: (r: ReplicaSet) => r.memory },
 { label: 'Age', getValue: (r: ReplicaSet) => r.age },
 ],
 toK8sYaml: (r: ReplicaSet) => `---
apiVersion: apps/v1
kind: ReplicaSet
metadata:
 name: ${r.name}
 namespace: ${r.namespace}
spec:
 replicas: ${r.desired}
 selector:
 matchLabels: {}
 template:
 metadata:
 labels: {}
 spec:
 containers: []
`,
 };

 const toggleSelection = (item: ReplicaSet) => { const key = `${item.namespace}/${item.name}`; const newSel = new Set(selectedItems); if (newSel.has(key)) newSel.delete(key); else newSel.add(key); setSelectedItems(newSel); };
 const toggleAll = () => { if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set()); else setSelectedItems(new Set(itemsOnPage.map(i => `${i.namespace}/${i.name}`))); };

 const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
 const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

 return (
 <div className="space-y-6" role="main" aria-label="ReplicaSets Resources">
 <ListPageHeader
 icon={<ReplicaSetIcon className="h-6 w-6 text-primary" />}
 title="ReplicaSets"
 resourceCount={totalFiltered}
 subtitle={namespaces.length > 1 ? `across ${namespaces.length - 1} namespaces` : undefined}
 demoMode={!isConnected}
 dataUpdatedAt={dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create ReplicaSet"
 onCreate={() => setShowCreateWizard(true)}
 actions={
 <>
 <ResourceExportDropdown
 items={filteredItems}
 selectedKeys={selectedItems}
 getKey={(i) => `${i.namespace}/${i.name}`}
 config={replicaSetExportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected replicasets' : 'All visible replicasets'}
 onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
 />
 <Button variant={activeOnly ? 'default' : 'outline'} size="sm" className="press-effect gap-2 h-9" onClick={() => setActiveOnly((v) => !v)} title="Show only active ReplicaSets">
 {activeOnly ? <EyeOff className="h-4 w-4" /> : <GitBranch className="h-4 w-4" />}
 Active Only
 </Button>
 </>
 }
 />

 {selectedItems.size > 0 && (
 <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
 <div className="flex items-center gap-3"><Badge variant="secondary" className="gap-1.5"><CheckSquare className="h-3.5 w-3.5" />{selectedItems.size} selected</Badge><Button variant="ghost" size="sm" onClick={() => setSelectedItems(new Set())}>Clear</Button></div>
 <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}><Trash2 className="h-4 w-4" />Delete</Button>
 </div>
 )}

 <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
 <ListPageStatCard label="Total ReplicaSets" value={stats.total} icon={ReplicaSetIcon} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Active" value={stats.active} icon={CheckCircle2} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.scale?.size === 1 && columnFilters.scale.has('Active')} onClick={() => setColumnFilter('scale', new Set(['Active']))} className={cn(columnFilters.scale?.size === 1 && columnFilters.scale.has('Active') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard label="Scaled to Zero" value={stats.scaledToZero} icon={Clock} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.scale?.size === 1 && columnFilters.scale.has('Scaled to zero')} onClick={() => setColumnFilter('scale', new Set(['Scaled to zero']))} className={cn(columnFilters.scale?.size === 1 && columnFilters.scale.has('Scaled to zero') && 'ring-2 ring-amber-500')} isLoading={isLoading} />
 <ListPageStatCard label="Mismatched" value={stats.mismatched} icon={XCircle} iconColor="text-rose-600" valueClassName="text-rose-600" selected={columnFilters.status?.size === 2 && columnFilters.status?.has('Progressing') && columnFilters.status?.has('Degraded')} onClick={() => setColumnFilter('status', new Set(['Progressing', 'Degraded']))} className={cn(columnFilters.status?.size === 2 && columnFilters.status?.has('Progressing') && columnFilters.status?.has('Degraded') && 'ring-2 ring-rose-500')} isLoading={isLoading} />
 </div>

 <ResourceListTableToolbar
 globalFilterBar={
 <ResourceCommandBar
 scope={
 <div className="w-full min-w-0">
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="outline" className="w-full min-w-0 h-10 gap-2 justify-between truncate rounded-lg border border-border bg-background font-medium shadow-sm hover:bg-muted/50 hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary/20">
 <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
 <span className="truncate">{selectedNamespace === 'all' ? 'All Namespaces' : selectedNamespace}</span>
 <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
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
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
 <Input
 placeholder="Search replicasets..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all"
 aria-label="Search replicasets"
 />
 </div>
 }
 structure={
 <ListViewSegmentedControl
 value={listView}
 onChange={(v) => setListView(v as ListView)}
 options={[
 { id: 'flat', label: 'Flat', icon: List },
 { id: 'byNamespace', label: 'By Namespace', icon: Layers },
 { id: 'byOwner', label: 'By Owner Deployment', icon: GitBranch },
 ]}
 label=""
 ariaLabel="List structure"
 />
 }
 footer={<span className="text-xs text-muted-foreground">{listView === 'flat' ? 'flat list' : listView === 'byOwner' ? 'grouped by owner deployment' : 'grouped by namespace'}</span>}
 className="mb-0"
 />
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={REPLICASETS_COLUMNS_FOR_VISIBILITY}
 visibleColumns={columnVisibility.visibleColumns}
 onColumnToggle={columnVisibility.setColumnVisible}
 isLoading={isLoading && isConnected}
 footer={
 <div className="flex flex-col gap-2">
 <div className="flex items-center justify-between flex-wrap gap-2">
 <div className="flex items-center gap-3">
 <span className="text-sm text-muted-foreground">{pagination.rangeLabel}</span>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="outline" size="sm" className="gap-2">
 {pageSize} per page
 <ChevronDown className="h-4 w-4 opacity-50" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="start">
 {PAGE_SIZE_OPTIONS.map((size) => (
 <DropdownMenuItem key={size} onClick={() => handlePageSizeChange(size)} className={cn(pageSize === size && 'bg-accent')}>
 {size} per page
 </DropdownMenuItem>
 ))}
 </DropdownMenuContent>
 </DropdownMenu>
 </div>
 <ListPagination
 hasPrev={pagination.hasPrev}
 hasNext={pagination.hasNext}
 onPrev={pagination.onPrev}
 onNext={pagination.onNext}
 rangeLabel={undefined}
 currentPage={pagination.currentPage}
 totalPages={pagination.totalPages}
 onPageChange={pagination.onPageChange}
 dataUpdatedAt={dataUpdatedAt}
 isFetching={isFetching}
 />
 </div>
 </div>
 }
 >
 <ResizableTableProvider tableId="replicasets" columnConfig={REPLICASETS_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 1600 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all replicasets" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name">
 <TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="namespace">
 <TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="status">
 <TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="desired">
 <TableColumnHeaderWithFilterAndSort columnId="desired" label="Desired" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="current">
 <TableColumnHeaderWithFilterAndSort columnId="current" label="Current" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="ready">
 <TableColumnHeaderWithFilterAndSort columnId="ready" label="Ready" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="owner">
 <TableColumnHeaderWithFilterAndSort columnId="owner" label="Owner" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="cpu" title="CPU">
 <TableColumnHeaderWithFilterAndSort columnId="cpu" label="CPU" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="memory" title="Memory">
 <TableColumnHeaderWithFilterAndSort columnId="memory" label="Memory" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="age">
 <TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5">
 <TableFilterCell columnId="name" label="Name" distinctValues={distinctValuesByColumn.name ?? []} selectedFilterValues={columnFilters.name ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.name} />
 </ResizableTableCell>
 <ResizableTableCell columnId="namespace" className="p-1.5">
 <TableFilterCell
 columnId="namespace"
 label="Namespace"
 distinctValues={distinctValuesByColumn.namespace ?? []}
 selectedFilterValues={columnFilters.namespace ?? new Set()}
 onFilterChange={setColumnFilter}
 valueCounts={valueCountsByColumn.namespace}
 />
 </ResizableTableCell>
 <ResizableTableCell columnId="status" className="p-1.5">
 <TableFilterCell
 columnId="status"
 label="Status"
 distinctValues={distinctValuesByColumn.status ?? []}
 selectedFilterValues={columnFilters.status ?? new Set()}
 onFilterChange={setColumnFilter}
 valueCounts={valueCountsByColumn.status}
 />
 </ResizableTableCell>
 <ResizableTableCell columnId="desired" className="p-1.5" />
 <ResizableTableCell columnId="current" className="p-1.5" />
 <ResizableTableCell columnId="ready" className="p-1.5" />
 <ResizableTableCell columnId="owner" className="p-1.5">
 <TableFilterCell columnId="owner" label="Owner" distinctValues={distinctValuesByColumn.owner ?? []} selectedFilterValues={columnFilters.owner ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.owner} />
 </ResizableTableCell>
 <ResizableTableCell columnId="cpu" className="p-1.5" />
 <ResizableTableCell columnId="memory" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={12} resourceName="replica sets" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={12} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : itemsOnPage.length === 0 ? (
 <TableRow>
 <TableCell colSpan={12} className="h-40 text-center">
 <TableEmptyState
 icon={<Layers className="h-8 w-8" />}
 title="No ReplicaSets found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'ReplicaSets are often created by Deployments; create one manually if needed.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create ReplicaSet"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : (listView === 'flat') ? itemsOnPage.map((item, idx) => {
 const StatusIcon = statusConfig[item.status]?.icon || Clock;
 const key = `${item.namespace}/${item.name}`;
 const isSelected = selectedItems.has(key);
 const cpuVal = metricsMap[key]?.cpu ?? '-';
 const memVal = metricsMap[key]?.memory ?? '-';
 const cpuNum = parseCpu(cpuVal);
 const memNum = parseMemory(memVal);
 const cpuDataPoints = cpuNum != null ? Array(12).fill(cpuNum) : undefined;
 const memDataPoints = memNum != null ? Array(12).fill(memNum) : undefined;
 return (
 <tr key={key} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
 <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(item)} /></TableCell>
 <ResizableTableCell columnId="name"><Link to={`/replicasets/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate"><ReplicaSetIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="truncate">{item.name}</span></Link></ResizableTableCell>
 <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} className="font-normal truncate block w-fit max-w-full" /></ResizableTableCell>
 <ResizableTableCell columnId="status"><StatusPill label={item.status} variant={replicaSetStatusToVariant[item.status]} icon={StatusIcon} /></ResizableTableCell>
 <ResizableTableCell columnId="desired" className="font-mono text-sm">{item.desired}</ResizableTableCell>
 <ResizableTableCell columnId="current" className="font-mono text-sm">{item.current}</ResizableTableCell>
 <ResizableTableCell columnId="ready" className="font-mono text-sm">{item.ready}</ResizableTableCell>
 <ResizableTableCell columnId="owner">
 {item.ownerKind === 'Deployment' && item.owner !== '-' ? (
 <Link to={`/deployments/${item.namespace}/${item.owner}`} className="text-primary hover:underline text-xs font-mono truncate block max-w-full">{item.owner}</Link>
 ) : item.owner !== '-' ? (
 <Badge variant="secondary" className="font-mono text-xs truncate block w-fit max-w-full">{item.owner}</Badge>
 ) : (
 <span className="text-muted-foreground text-xs">—</span>
 )}
 </ResizableTableCell>
 <ResizableTableCell columnId="cpu">
 <MetricBar value={cpuVal} kind="cpu" />
 </ResizableTableCell>
 <ResizableTableCell columnId="memory">
 <MetricBar value={memVal} kind="memory" />
 </ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="press-effect h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem onClick={() => setScaleDialog({ open: true, item })} className="gap-2"><Scale className="h-4 w-4" />Scale</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/replicasets/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />View YAML</DropdownMenuItem>
 <DropdownMenuSeparator /><DropdownMenuItem className="gap-2 text-rose-600" onClick={() => setDeleteDialog({ open: true, item })}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </tr>
 );
 }) : groupedOnPage.flatMap((group) => {
 const isCollapsed = collapsedGroups.has(group.groupKey);
 const row = (item: ReplicaSet, idx: number) => {
 const StatusIcon = statusConfig[item.status]?.icon || Clock;
 const key = `${item.namespace}/${item.name}`;
 const isSelected = selectedItems.has(key);
 const cpuVal = metricsMap[key]?.cpu ?? '-';
 const memVal = metricsMap[key]?.memory ?? '-';
 const cpuNum = parseCpu(cpuVal);
 const memNum = parseMemory(memVal);
 const cpuDataPoints = cpuNum != null ? Array(12).fill(cpuNum) : undefined;
 const memDataPoints = memNum != null ? Array(12).fill(memNum) : undefined;
 return (
 <tr key={key} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
 <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(item)} /></TableCell>
 <ResizableTableCell columnId="name"><Link to={`/replicasets/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate"><ReplicaSetIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="truncate">{item.name}</span></Link></ResizableTableCell>
 <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} className="font-normal truncate block w-fit max-w-full" /></ResizableTableCell>
 <ResizableTableCell columnId="status"><StatusPill label={item.status} variant={replicaSetStatusToVariant[item.status]} icon={StatusIcon} /></ResizableTableCell>
 <ResizableTableCell columnId="desired" className="font-mono text-sm">{item.desired}</ResizableTableCell>
 <ResizableTableCell columnId="current" className="font-mono text-sm">{item.current}</ResizableTableCell>
 <ResizableTableCell columnId="ready" className="font-mono text-sm">{item.ready}</ResizableTableCell>
 <ResizableTableCell columnId="owner">
 {item.ownerKind === 'Deployment' && item.owner !== '-' ? (
 <Link to={`/deployments/${item.namespace}/${item.owner}`} className="text-primary hover:underline text-xs font-mono truncate block max-w-full">{item.owner}</Link>
 ) : item.owner !== '-' ? (
 <Badge variant="secondary" className="font-mono text-xs truncate block w-fit max-w-full">{item.owner}</Badge>
 ) : (
 <span className="text-muted-foreground text-xs">—</span>
 )}
 </ResizableTableCell>
 <ResizableTableCell columnId="cpu">
 <MetricBar value={cpuVal} kind="cpu" max={replicasetResourceMaxMap[key]?.cpuMax} />
 </ResizableTableCell>
 <ResizableTableCell columnId="memory">
 <MetricBar value={memVal} kind="memory" max={replicasetResourceMaxMap[key]?.memoryMax} />
 </ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="press-effect h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem onClick={() => setScaleDialog({ open: true, item })} className="gap-2"><Scale className="h-4 w-4" />Scale</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/replicasets/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />View YAML</DropdownMenuItem>
 <DropdownMenuSeparator /><DropdownMenuItem className="gap-2 text-rose-600" onClick={() => setDeleteDialog({ open: true, item })}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </tr>
 );
 };
 return [
 <TableRow key={group.groupKey} className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-b border-border" onClick={() => toggleGroup(group.groupKey)}>
 <TableCell colSpan={12} className="py-2 font-medium">
 <div className="flex items-center gap-2 font-medium">
 {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
 {listView === 'byOwner' ? 'Owner: ' : 'Namespace: '}{group.label}
 <span className="text-muted-foreground font-normal">({group.list.length})</span>
 </div>
 </TableCell>
 </TableRow>,
 ...(isCollapsed ? [] : group.list.map((item, idx) => row(item, idx))),
 ];
 })}
 </TableBody>
 </Table>
 </ResizableTableProvider>
 </ResourceListTableToolbar>

 <DeleteConfirmDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })} resourceType="ReplicaSet" resourceName={deleteDialog.bulk ? `${selectedItems.size} replicasets` : (deleteDialog.item?.name || '')} namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace} onConfirm={handleDelete} requireNameConfirmation={!deleteDialog.bulk} />
 {scaleDialog.item && (
 <ScaleDialog
 open={scaleDialog.open}
 onOpenChange={(open) => setScaleDialog({ open, item: open ? scaleDialog.item : null })}
 resourceType="ReplicaSet"
 resourceName={scaleDialog.item.name}
 namespace={scaleDialog.item.namespace}
 currentReplicas={scaleDialog.item.desired}
 onScale={async (r) => {
 if (!isConnected) { toast.error('Connect cluster to scale'); return; }
 try {
 await patchReplicaSet.mutateAsync({ name: scaleDialog.item!.name, namespace: scaleDialog.item!.namespace, patch: { spec: { replicas: r } } });
 toast.success(`Scaled ${scaleDialog.item?.name} to ${r} replicas`);
 setScaleDialog({ open: false, item: null });
 refetch();
 } catch (e) {
 toast.error(e instanceof Error ? e.message : 'Failed to scale');
 }
 }}
 />
 )}
 {showCreateWizard && (
 <ResourceCreator
 resourceKind="ReplicaSet"
 defaultYaml={DEFAULT_YAMLS.ReplicaSet}
 onClose={() => setShowCreateWizard(false)}
 onApply={async (yaml) => {
 if (!isConnected) { toast.error('Connect cluster to create ReplicaSet'); return; }
 try {
 await createResource.mutateAsync({ yaml });
 toast.success('ReplicaSet created successfully');
 setShowCreateWizard(false);
 refetch();
 } catch (e) {
 toast.error(e instanceof Error ? e.message : 'Failed to create');
 throw e;
 }
 }}
 />
 )}
 </div>
 );
}
