import { useState, useMemo, useEffect } from 'react';
import {
 RefreshCw, MoreHorizontal, CheckCircle2, XCircle, Clock, Loader2, WifiOff, Plus,
 Trash2, FileText, Search, Filter, Layers, ChevronDown, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ResizableTableProvider, ResizableTableHead, ResizableTableCell, type ResizableColumnConfig } from '@/components/ui/resizable-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { useK8sResourceList, useDeleteK8sResource, useCreateK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog } from '@/components/resources';
import {
 ResourceCommandBar, ResourceExportDropdown, ListViewSegmentedControl, ListPageHeader,
 StatusPill, resourceTableRowClassName, ROW_MOTION, ListPagination, ListPageStatCard,
 TableColumnHeaderWithFilterAndSort, TableFilterCell, PAGE_SIZE_OPTIONS,
 AgeCell, TableEmptyState, TableErrorState, ListPageLoadingShell,
 NamespaceBadge, CopyNameDropdownItem, ResourceListTableToolbar,
 type StatusPillVariant,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { toast } from 'sonner';

interface RCResource extends KubernetesResource {
 spec: {
 replicas?: number;
 selector?: Record<string, string>;
 };
 status: {
 replicas?: number;
 readyReplicas?: number;
 availableReplicas?: number;
 };
}

interface ReplicationController {
 name: string;
 namespace: string;
 status: 'Ready' | 'Degraded' | 'Scaled-to-Zero';
 readyFraction: string;
 readyPct: number;
 current: number;
 available: number;
 selector: string;
 age: string;
 creationTimestamp?: string;
 desiredReplicas: number;
}

const RC_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 200, minWidth: 120 },
 { id: 'namespace', defaultWidth: 130, minWidth: 80 },
 { id: 'status', defaultWidth: 120, minWidth: 80 },
 { id: 'ready', defaultWidth: 130, minWidth: 90 },
 { id: 'current', defaultWidth: 80, minWidth: 56 },
 { id: 'available', defaultWidth: 90, minWidth: 56 },
 { id: 'selector', defaultWidth: 200, minWidth: 100 },
 { id: 'age', defaultWidth: 90, minWidth: 56 },
];

const RC_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'status', label: 'Status' },
 { id: 'ready', label: 'Ready' },
 { id: 'current', label: 'Current' },
 { id: 'available', label: 'Available' },
 { id: 'selector', label: 'Selector' },
 { id: 'age', label: 'Age' },
];

function transformRC(resource: RCResource): ReplicationController {
 const desired = resource.spec?.replicas ?? 0;
 const ready = resource.status?.readyReplicas ?? 0;
 const available = resource.status?.availableReplicas ?? 0;
 const current = resource.status?.replicas ?? 0;

 let status: ReplicationController['status'] = 'Ready';
 if (desired === 0) status = 'Scaled-to-Zero';
 else if (ready < desired) status = 'Degraded';

 const selectorEntries = Object.entries(resource.spec?.selector ?? {});
 const selector = selectorEntries.length
 ? selectorEntries.map(([k, v]) => `${k}=${v}`).join(', ')
 : '-';

 const readyPct = desired > 0 ? Math.round((ready / desired) * 100) : 0;

 return {
 name: resource.metadata.name,
 namespace: resource.metadata.namespace || 'default',
 status,
 readyFraction: `${ready}/${desired}`,
 readyPct,
 current,
 available,
 selector,
 age: calculateAge(resource.metadata.creationTimestamp),
 creationTimestamp: resource.metadata?.creationTimestamp,
 desiredReplicas: desired,
 };
}

const rcStatusToVariant: Record<ReplicationController['status'], StatusPillVariant> = {
 Ready: 'success',
 Degraded: 'error',
 'Scaled-to-Zero': 'muted',
};

const rcStatusIcon: Record<ReplicationController['status'], React.ComponentType<{ className?: string }>> = {
 Ready: CheckCircle2,
 Degraded: XCircle,
 'Scaled-to-Zero': Clock,
};

type ListView = 'flat' | 'byNamespace';

export default function ReplicationControllers() {
 const navigate = useNavigate();
 const [searchQuery, setSearchQuery] = useState('');
 const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: ReplicationController | null; bulk?: boolean }>({ open: false, item: null });
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [listView, setListView] = useState<ListView>('flat');
 const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<RCResource>('replicationcontrollers', undefined, { limit: 5000 });
 const deleteResource = useDeleteK8sResource('replicationcontrollers');
 const createResource = useCreateK8sResource('replicationcontrollers');

 const items: ReplicationController[] = isConnected && data
 ? (data.items ?? []).map(transformRC)
 : [];

 const stats = useMemo(() => ({
 total: items.length,
 ready: items.filter((i) => i.status === 'Ready').length,
 degraded: items.filter((i) => i.status === 'Degraded').length,
 scaledToZero: items.filter((i) => i.status === 'Scaled-to-Zero').length,
 }), [items]);

 const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.namespace))).sort()], [items]);

 const itemsAfterSearchAndNs = useMemo(() =>
 items.filter((item) => {
 const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
 item.namespace.toLowerCase().includes(searchQuery.toLowerCase());
 const matchesNs = selectedNamespace === 'all' || item.namespace === selectedNamespace;
 return matchesSearch && matchesNs;
 }), [items, searchQuery, selectedNamespace]);

 const rcColumnConfig: ColumnConfig<ReplicationController>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
 { columnId: 'status', getValue: (i) => i.status, sortable: true, filterable: true },
 { columnId: 'ready', getValue: (i) => i.readyFraction, sortable: true, filterable: false, compare: (a, b) => a.readyPct - b.readyPct },
 { columnId: 'current', getValue: (i) => i.current, sortable: true, filterable: false },
 { columnId: 'available', getValue: (i) => i.available, sortable: true, filterable: false },
 { columnId: 'selector', getValue: (i) => i.selector, sortable: true, filterable: false },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearchAndNs, { columns: rcColumnConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'replicationcontrollers', columns: RC_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const totalFiltered = filteredItems.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredItems.slice(start, start + pageSize);

 useEffect(() => {
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [safePageIndex, pageIndex]);

 const groupedOnPage = useMemo(() => {
 if (listView !== 'byNamespace' || itemsOnPage.length === 0) return [];
 const map = new Map<string, ReplicationController[]>();
 for (const item of itemsOnPage) {
 const list = map.get(item.namespace) ?? [];
 list.push(item);
 map.set(item.namespace, list);
 }
 return Array.from(map.entries())
 .map(([label, rcs]) => ({ groupKey: `ns:${label}`, label, rcs }))
 .sort((a, b) => a.label.localeCompare(b.label));
 }, [listView, itemsOnPage]);

 const toggleGroup = (groupKey: string) => {
 setCollapsedGroups((prev) => {
 const next = new Set(prev);
 if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
 return next;
 });
 };

 const toggleSelection = (item: ReplicationController) => {
 const key = `${item.namespace}/${item.name}`;
 const newSel = new Set(selectedItems);
 if (newSel.has(key)) newSel.delete(key); else newSel.add(key);
 setSelectedItems(newSel);
 };

 const toggleAll = () => {
 if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
 else setSelectedItems(new Set(itemsOnPage.map((i) => `${i.namespace}/${i.name}`)));
 };

 const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
 const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

 const handleDelete = async () => {
 if (!isConnected) { toast.error('Connect cluster to delete replication controllers'); return; }
 if (deleteDialog.bulk && selectedItems.size > 0) {
 for (const key of selectedItems) {
 const [ns, n] = key.split('/');
 await deleteResource.mutateAsync({ name: n, namespace: ns });
 }
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
 }
 setDeleteDialog({ open: false, item: null });
 };

 const exportConfig = {
 filenamePrefix: 'replicationcontrollers',
 resourceLabel: 'replication controllers',
 getExportData: (d: ReplicationController) => ({ name: d.name, namespace: d.namespace, status: d.status, ready: d.readyFraction, current: d.current, available: d.available, age: d.age }),
 csvColumns: [
 { label: 'Name', getValue: (d: ReplicationController) => d.name },
 { label: 'Namespace', getValue: (d: ReplicationController) => d.namespace },
 { label: 'Status', getValue: (d: ReplicationController) => d.status },
 { label: 'Ready', getValue: (d: ReplicationController) => d.readyFraction },
 { label: 'Current', getValue: (d: ReplicationController) => d.current },
 { label: 'Available', getValue: (d: ReplicationController) => d.available },
 { label: 'Age', getValue: (d: ReplicationController) => d.age },
 ],
 toK8sYaml: (d: ReplicationController) => `---
apiVersion: v1
kind: ReplicationController
metadata:
 name: ${d.name}
 namespace: ${d.namespace}
spec:
 replicas: ${d.desiredReplicas}
 selector: {}
 template:
 metadata:
 labels: {}
 spec:
 containers: []
`,
 };

 const pagination = {
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No replication controllers',
 hasPrev: safePageIndex > 0,
 hasNext: start + pageSize < totalFiltered,
 onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
 onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
 currentPage: safePageIndex + 1,
 totalPages: Math.max(1, totalPages),
 onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
 };

 const renderRow = (item: ReplicationController, idx: number) => {
 const key = `${item.namespace}/${item.name}`;
 const isSelected = selectedItems.has(key);
 const StatusIcon = rcStatusIcon[item.status];
 return (
 <tr key={key} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
 <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(item)} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/replicationcontrollers/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <Layers className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 </Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} className="font-normal truncate block w-fit max-w-full" /></ResizableTableCell>
 <ResizableTableCell columnId="status"><StatusPill label={item.status} variant={rcStatusToVariant[item.status]} icon={StatusIcon} /></ResizableTableCell>
 <ResizableTableCell columnId="ready">
 <div className="flex items-center gap-2 min-w-0">
 <Progress value={item.readyPct} className="h-1.5 w-10 flex-shrink-0" />
 <span className="font-mono text-sm tabular-nums">{item.readyFraction}</span>
 </div>
 </ResizableTableCell>
 <ResizableTableCell columnId="current" className="font-mono text-sm">{item.current}</ResizableTableCell>
 <ResizableTableCell columnId="available" className="font-mono text-sm">{item.available}</ResizableTableCell>
 <ResizableTableCell columnId="selector" className="font-mono text-xs truncate max-w-[200px]" title={item.selector}>{item.selector}</ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <CopyNameDropdownItem name={item.name} namespace={item.namespace} />
 <DropdownMenuItem onClick={() => navigate(`/replicationcontrollers/${item.namespace}/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/replicationcontrollers/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-[hsl(0,72%,51%)]" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </tr>
 );
 };

 return (
 <div className="space-y-6">
 <Alert className="border-amber-500/50 bg-amber-500/10">
 <AlertTriangle className="h-4 w-4 text-amber-500" />
 <AlertTitle className="text-amber-600">Deprecated Resource</AlertTitle>
 <AlertDescription className="text-amber-600/80">
 ReplicationControllers are deprecated. Consider migrating to Deployments or ReplicaSets for improved rolling update capabilities and declarative management.
 </AlertDescription>
 </Alert>

 <ListPageHeader
 icon={<Layers className="h-6 w-6 text-primary" />}
 title="Replication Controllers"
 resourceCount={filteredItems.length}
 subtitle={namespaces.length > 1 ? `across ${namespaces.length - 1} namespaces` : undefined}
 demoMode={!isConnected}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create"
 onCreate={() => setShowCreateWizard(true)}
 actions={
 <>
 <ResourceExportDropdown
 items={filteredItems}
 selectedKeys={selectedItems}
 getKey={(i) => `${i.namespace}/${i.name}`}
 config={exportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected replication controllers' : 'All visible'}
 onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
 />
 {selectedItems.size > 0 && (
 <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}><Trash2 className="h-4 w-4" />Delete</Button>
 )}
 </>
 }
 leftExtra={selectedItems.size > 0 ? (
 <div className="flex items-center gap-2 ml-2 pl-2 border-l border-border">
 <span className="text-sm text-muted-foreground">{selectedItems.size} selected</span>
 <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelectedItems(new Set())}>Clear</Button>
 </div>
 ) : undefined}
 />

 <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
 <ListPageStatCard label="Total" value={stats.total} icon={Layers} iconColor="text-primary" selected={!columnFilters.status?.size} onClick={() => setColumnFilter('status', null)} className={cn(!columnFilters.status?.size && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Ready" value={stats.ready} icon={CheckCircle2} iconColor="text-[hsl(142,76%,36%)]" valueClassName="text-[hsl(142,76%,36%)]" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Ready')} onClick={() => setColumnFilter('status', new Set(['Ready']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Ready') && 'ring-2 ring-[hsl(142,76%,36%)]')} isLoading={isLoading} />
 <ListPageStatCard label="Degraded" value={stats.degraded} icon={XCircle} iconColor="text-[hsl(0,72%,51%)]" valueClassName="text-[hsl(0,72%,51%)]" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Degraded')} onClick={() => setColumnFilter('status', new Set(['Degraded']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Degraded') && 'ring-2 ring-[hsl(0,72%,51%)]')} isLoading={isLoading} />
 <ListPageStatCard label="Scaled-to-Zero" value={stats.scaledToZero} icon={Clock} iconColor="text-muted-foreground" valueClassName="text-muted-foreground" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Scaled-to-Zero')} onClick={() => setColumnFilter('status', new Set(['Scaled-to-Zero']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Scaled-to-Zero') && 'ring-2 ring-muted-foreground')} isLoading={isLoading} />
 </div>

 <ResourceListTableToolbar
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
 <Input placeholder="Search replication controllers..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all" />
 </div>
 }
 structure={
 <ListViewSegmentedControl
 value={listView}
 onChange={(v) => setListView(v as ListView)}
 options={[
 { id: 'flat', label: 'Flat' },
 { id: 'byNamespace', label: 'By Namespace' },
 ]}
 label=""
 ariaLabel="List structure"
 />
 }
 />
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={RC_COLUMNS_FOR_VISIBILITY}
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
 <DropdownMenuItem key={size} onClick={() => { setPageSize(size); setPageIndex(0); }} className={cn(pageSize === size && 'bg-accent')}>{size} per page</DropdownMenuItem>
 ))}
 </DropdownMenuContent>
 </DropdownMenu>
 </div>
 <ListPagination hasPrev={pagination.hasPrev} hasNext={pagination.hasNext} onPrev={pagination.onPrev} onNext={pagination.onNext} rangeLabel={undefined} currentPage={pagination.currentPage} totalPages={pagination.totalPages} onPageChange={pagination.onPageChange} dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} />
 </div>
 }
 >
 <ResizableTableProvider tableId="replicationcontrollers" columnConfig={RC_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 1020 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="status"><TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="ready"><TableColumnHeaderWithFilterAndSort columnId="ready" label="Ready" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="current"><TableColumnHeaderWithFilterAndSort columnId="current" label="Current" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="available"><TableColumnHeaderWithFilterAndSort columnId="available" label="Available" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="selector"><TableColumnHeaderWithFilterAndSort columnId="selector" label="Selector" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="namespace" className="p-1.5">
 <TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} />
 </ResizableTableCell>
 <ResizableTableCell columnId="status" className="p-1.5">
 <TableFilterCell columnId="status" label="Status" distinctValues={distinctValuesByColumn.status ?? []} selectedFilterValues={columnFilters.status ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.status} />
 </ResizableTableCell>
 <ResizableTableCell columnId="ready" className="p-1.5" />
 <ResizableTableCell columnId="current" className="p-1.5" />
 <ResizableTableCell columnId="available" className="p-1.5" />
 <ResizableTableCell columnId="selector" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={10} resourceName="replication controllers" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={10} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : !isConnected ? (
 <TableRow><TableCell colSpan={10} className="h-32 text-center"><div className="flex flex-col items-center gap-2"><WifiOff className="h-8 w-8 opacity-50" /><p className="text-sm text-muted-foreground">Connect cluster to view replication controllers</p></div></TableCell></TableRow>
 ) : filteredItems.length === 0 ? (
 <TableRow>
 <TableCell colSpan={10} className="h-40 text-center">
 <TableEmptyState
 icon={<Layers className="h-8 w-8" />}
 title="No replication controllers found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'ReplicationController is the legacy workload API; consider Deployments.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create ReplicationController"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : listView === 'flat' ? (
 itemsOnPage.map((item, idx) => renderRow(item, idx))
 ) : (
 groupedOnPage.flatMap((group) => {
 const isCollapsed = collapsedGroups.has(group.groupKey);
 return [
 <TableRow key={group.groupKey} className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-b border-border/60 transition-all duration-200" onClick={() => toggleGroup(group.groupKey)}>
 <TableCell colSpan={10} className="py-2">
 <div className="flex items-center gap-2 font-medium">
 {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
 Namespace: {group.label}
 <span className="text-muted-foreground font-normal">({group.rcs.length})</span>
 </div>
 </TableCell>
 </TableRow>,
 ...(isCollapsed ? [] : group.rcs.map((item, idx) => renderRow(item, idx))),
 ];
 })
 )}
 </TableBody>
 </Table>
 </ResizableTableProvider>
 </ResourceListTableToolbar>

 {showCreateWizard && (
 <ResourceCreator
 resourceKind="ReplicationController"
 defaultYaml={DEFAULT_YAMLS.ReplicationController}
 onClose={() => setShowCreateWizard(false)}
 onApply={async (yaml) => {
 if (!isConnected) { toast.error('Connect cluster to create replication controllers'); return; }
 try {
 await createResource.mutateAsync({ yaml });
 toast.success('ReplicationController created successfully');
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
 resourceType="ReplicationController"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} replication controllers` : (deleteDialog.item?.name || '')}
 namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace}
 onConfirm={handleDelete}
 />
 </div>
 );
}
