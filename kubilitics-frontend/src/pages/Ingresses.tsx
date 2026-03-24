import { useState, useMemo, useEffect } from 'react';
import { 
 Search, 
 Filter,
 RefreshCw, 
 MoreHorizontal,
 CheckCircle2,
 XCircle,
 Clock,
 Download,
 Globe,
 Loader2,
 WifiOff,
 Plus,
 Trash2,
 ChevronDown,
 CheckSquare,
 ExternalLink,
 Route,
 Lock,
 List,
 Layers,
 ChevronRight,
 FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from '@/components/ui/table';
import { ResizableTableProvider, ResizableTableHead, ResizableTableCell, type ResizableColumnConfig } from '@/components/ui/resizable-table';
import { ListPagination, PAGE_SIZE_OPTIONS, resourceTableRowClassName, ROW_MOTION, ListViewSegmentedControl, StatusPill, type StatusPillVariant } from '@/components/list';
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuTrigger,
 DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useK8sResourceList, useDeleteK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog } from '@/components/resources';
import { IngressWizard } from '@/components/wizards';
import { ResourceExportDropdown, ResourceCommandBar, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, AgeCell, TableEmptyState, ListPageLoadingShell, TableErrorState, CopyNameDropdownItem, NamespaceBadge, ResourceListTableToolbar } from '@/components/list';
import { IngressIcon } from '@/components/icons/KubernetesIcons';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { toast } from '@/components/ui/sonner';

interface K8sIngress extends KubernetesResource {
 spec?: {
 ingressClassName?: string;
 rules?: Array<{ host?: string; http?: { paths?: unknown[] } }>;
 tls?: Array<{ hosts?: string[] }>;
 defaultBackend?: { service?: { name?: string; port?: { number?: number; name?: string } } };
 };
 status?: {
 loadBalancer?: {
 ingress?: Array<{ ip?: string; hostname?: string }>;
 };
 };
}

interface Ingress {
 name: string;
 namespace: string;
 class: string;
 hosts: string;
 address: string;
 ports: string;
 tls: boolean;
 rulesCount: number;
 defaultBackend: string;
 age: string;
 creationTimestamp?: string;
 status: 'Healthy' | 'Degraded' | 'Error';
}

const INGRESSES_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'status', defaultWidth: 150, minWidth: 100 },
 { id: 'class', defaultWidth: 160, minWidth: 100 },
 { id: 'hosts', defaultWidth: 220, minWidth: 120 },
 { id: 'addresses', defaultWidth: 160, minWidth: 120 },
 { id: 'tls', defaultWidth: 100, minWidth: 70 },
 { id: 'rules', defaultWidth: 100, minWidth: 70 },
 { id: 'defaultBackend', defaultWidth: 160, minWidth: 100 },
 { id: 'requestsSec', defaultWidth: 100, minWidth: 70 },
 { id: 'errorRate', defaultWidth: 100, minWidth: 70 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const INGRESSES_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'status', label: 'Status' },
 { id: 'class', label: 'Class' },
 { id: 'hosts', label: 'Hosts' },
 { id: 'addresses', label: 'Addresses' },
 { id: 'tls', label: 'TLS' },
 { id: 'rules', label: 'Rules' },
 { id: 'defaultBackend', label: 'Default Backend' },
 { id: 'age', label: 'Age' },
];

const statusConfig = {
 Healthy: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-500/10' },
 Degraded: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-500/10' },
 Error: { icon: XCircle, color: 'text-rose-600', bg: 'bg-rose-500/10' },
};

const ingressStatusToVariant: Record<Ingress['status'], StatusPillVariant> = {
 Healthy: 'success',
 Degraded: 'warning',
 Error: 'error',
};

type ListView = 'flat' | 'byNamespace' | 'byIngressClass';

export default function Ingresses() {
 const navigate = useNavigate();
 const [searchParams] = useSearchParams();
 const filterByClass = searchParams.get('class') ?? '';
 const [searchQuery, setSearchQuery] = useState('');
 const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: Ingress | null; bulk?: boolean }>({ open: false, item: null });
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [listView, setListView] = useState<ListView>('flat');
 const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
 const [showTableFilters, setShowTableFilters] = useState(false);

 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<K8sIngress>('ingresses', undefined, { limit: 5000 });
 const deleteResource = useDeleteK8sResource('ingresses');

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const ingresses: Ingress[] = isConnected && data?.items
 ? (data.items as K8sIngress[]).map((ing) => {
 const hosts = ing.spec?.rules?.map((r) => r.host).filter(Boolean).join(', ') || '*';
 const lbIngress = ing.status?.loadBalancer?.ingress?.[0];
 const address = lbIngress?.ip || lbIngress?.hostname || '<pending>';
 const hasTLS = (ing.spec?.tls?.length ?? 0) > 0;
 const rulesCount = ing.spec?.rules?.length ?? 0;
 const defaultBackend = ing.spec?.defaultBackend?.service
 ? `${ing.spec.defaultBackend.service.name}:${ing.spec.defaultBackend.service.port?.number ?? ing.spec.defaultBackend.service.port?.name ?? '-'}`
 : '-';
 return {
 name: ing.metadata.name,
 namespace: ing.metadata.namespace || 'default',
 class: ing.spec?.ingressClassName ?? '-',
 hosts,
 address,
 ports: hasTLS ? '80, 443' : '80',
 tls: hasTLS,
 rulesCount,
 defaultBackend,
 age: calculateAge(ing.metadata.creationTimestamp),
 creationTimestamp: ing.metadata?.creationTimestamp,
 status: address === '<pending>' ? 'Degraded' as const : 'Healthy' as const,
 };
 })
 : [];

 const stats = useMemo(() => ({
 total: ingresses.length,
 healthy: ingresses.filter(i => i.status === 'Healthy').length,
 degraded: ingresses.filter(i => i.status === 'Degraded' || i.status === 'Error').length,
 tlsEnabled: ingresses.filter(i => i.tls).length,
 tlsExpiring: 0,
 }), [ingresses]);

 const namespaces = useMemo(() => {
 return ['all', ...Array.from(new Set(ingresses.map(i => i.namespace)))];
 }, [ingresses]);

 const itemsAfterSearchAndNs = useMemo(() => {
 return ingresses.filter(ing => {
 const matchesSearch = ing.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
 ing.namespace.toLowerCase().includes(searchQuery.toLowerCase()) ||
 ing.hosts.toLowerCase().includes(searchQuery.toLowerCase());
 const matchesNamespace = selectedNamespace === 'all' || ing.namespace === selectedNamespace;
 const matchesClass = !filterByClass || ing.class === filterByClass;
 return matchesSearch && matchesNamespace && matchesClass;
 });
 }, [ingresses, searchQuery, selectedNamespace, filterByClass]);

 const ingressesTableConfig: ColumnConfig<Ingress>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
 { columnId: 'status', getValue: (i) => i.status, sortable: true, filterable: true },
 { columnId: 'class', getValue: (i) => i.class, sortable: true, filterable: true },
 { columnId: 'hosts', getValue: (i) => i.hosts, sortable: true, filterable: false },
 { columnId: 'address', getValue: (i) => i.address, sortable: true, filterable: false },
 { columnId: 'tls', getValue: (i) => (i.tls ? 'Yes' : 'No'), sortable: true, filterable: true },
 { columnId: 'tlsExpiring', getValue: () => 'No', sortable: false, filterable: true },
 { columnId: 'rulesCount', getValue: (i) => i.rulesCount, sortable: true, filterable: false },
 { columnId: 'defaultBackend', getValue: (i) => i.defaultBackend, sortable: true, filterable: false },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredIngresses, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearchAndNs, { columns: ingressesTableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });

 const columnVisibility = useColumnVisibility({ tableId: 'ingresses', columns: INGRESSES_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);
 const totalFiltered = filteredIngresses.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredIngresses.slice(start, start + pageSize);

 useEffect(() => {
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [safePageIndex, pageIndex]);

 const groupedOnPage = useMemo(() => {
 if (listView === 'flat' || itemsOnPage.length === 0) return [];
 const groupByKey = listView === 'byIngressClass' ? (ing: Ingress) => (ing.class && ing.class !== '-' ? ing.class : 'No Class') : (ing: Ingress) => ing.namespace;
 const labelPrefix = listView === 'byIngressClass' ? 'Class: ' : 'Namespace: ';
 const map = new Map<string, Ingress[]>();
 for (const ing of itemsOnPage) {
 const k = groupByKey(ing);
 const list = map.get(k) ?? [];
 list.push(ing);
 map.set(k, list);
 }
 return Array.from(map.entries())
 .map(([label, ingresses]) => ({ groupKey: `${listView}:${label}`, label: `${labelPrefix}${label}`, ingresses }))
 .sort((a, b) => a.label.localeCompare(b.label));
 }, [listView, itemsOnPage]);

 const toggleGroup = (groupKey: string) => {
 setCollapsedGroups((prev) => {
 const next = new Set(prev);
 if (next.has(groupKey)) next.delete(groupKey);
 else next.add(groupKey);
 return next;
 });
 };

 const handleDelete = async () => {
 if (deleteDialog.bulk && selectedItems.size > 0) {
 for (const key of selectedItems) {
 const [namespace, name] = key.split('/');
 if (isConnected) {
 await deleteResource.mutateAsync({ name, namespace });
 }
 }
 toast.success(`Deleted ${selectedItems.size} ingresses`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 if (isConnected) {
 await deleteResource.mutateAsync({
 name: deleteDialog.item.name,
 namespace: deleteDialog.item.namespace,
 });
 } else {
 toast.success(`Ingress ${deleteDialog.item.name} deleted (demo mode)`);
 }
 }
 setDeleteDialog({ open: false, item: null });
 };

 const ingressExportConfig = {
 filenamePrefix: 'ingresses',
 resourceLabel: 'ingresses',
 getExportData: (i: Ingress) => ({ name: i.name, namespace: i.namespace, class: i.class, hosts: i.hosts, address: i.address, ports: i.ports, tls: i.tls, age: i.age, status: i.status }),
 csvColumns: [
 { label: 'Name', getValue: (i: Ingress) => i.name },
 { label: 'Namespace', getValue: (i: Ingress) => i.namespace },
 { label: 'Class', getValue: (i: Ingress) => i.class },
 { label: 'Hosts', getValue: (i: Ingress) => i.hosts },
 { label: 'Address', getValue: (i: Ingress) => i.address },
 { label: 'Ports', getValue: (i: Ingress) => i.ports },
 { label: 'TLS', getValue: (i: Ingress) => (i.tls ? 'Yes' : 'No') },
 { label: 'Age', getValue: (i: Ingress) => i.age },
 { label: 'Status', getValue: (i: Ingress) => i.status },
 ],
 toK8sYaml: (i: Ingress) => `---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
 name: ${i.name}
 namespace: ${i.namespace}
spec:
 ingressClassName: ${i.class}
 rules: []
 tls: []
`,
 };

 const toggleSelection = (item: Ingress) => {
 const key = `${item.namespace}/${item.name}`;
 const newSelection = new Set(selectedItems);
 if (newSelection.has(key)) {
 newSelection.delete(key);
 } else {
 newSelection.add(key);
 }
 setSelectedItems(newSelection);
 };

 const toggleAllSelection = () => {
 const keys = itemsOnPage.map((i) => `${i.namespace}/${i.name}`);
 const allSelected = keys.length > 0 && keys.every((k) => selectedItems.has(k));
 if (allSelected) {
 const next = new Set(selectedItems);
 keys.forEach((k) => next.delete(k));
 setSelectedItems(next);
 } else {
 const next = new Set(selectedItems);
 keys.forEach((k) => next.add(k));
 setSelectedItems(next);
 }
 };

 const isAllSelected = itemsOnPage.length > 0 && itemsOnPage.every((i) => selectedItems.has(`${i.namespace}/${i.name}`));
 const isSomeSelected = selectedItems.size > 0 && !isAllSelected;

 return (
 <div className="space-y-6">
 <ListPageHeader
 icon={<IngressIcon className="h-6 w-6 text-primary" />}
 title="Ingresses"
 resourceCount={filteredIngresses.length}
 subtitle={namespaces.length > 1 ? `across ${namespaces.length - 1} namespaces` : undefined}
 demoMode={!isConnected}
 dataUpdatedAt={dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create Ingress"
 onCreate={() => setShowCreateWizard(true)}
 actions={
 <>
 <ResourceExportDropdown
 items={filteredIngresses}
 selectedKeys={selectedItems}
 getKey={(i) => `${i.namespace}/${i.name}`}
 config={ingressExportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected ingresses' : 'All visible ingresses'}
 onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
 />
 {selectedItems.size > 0 && (
 <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
 <Trash2 className="h-4 w-4" />
 Delete
 </Button>
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

 {/* Bulk Actions Bar */}
 {selectedItems.size > 0 && (
 <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg"
 >
 <Badge variant="secondary" className="gap-1.5">
 <CheckSquare className="h-3.5 w-3.5" />
 {selectedItems.size} selected
 </Badge>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown
 items={filteredIngresses}
 selectedKeys={selectedItems}
 getKey={(i) => `${i.namespace}/${i.name}`}
 config={ingressExportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected ingresses' : 'All visible ingresses'}
 onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
 triggerLabel={selectedItems.size > 0 ? `Export (${selectedItems.size})` : 'Export'}
 />
 <Button 
 variant="destructive" 
 size="sm" 
 className="gap-1.5"
 onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}
 >
 <Trash2 className="h-3.5 w-3.5" />
 Delete Selected
 </Button>
 <Button variant="ghost" size="sm" onClick={() => setSelectedItems(new Set())}>
 Clear
 </Button>
 </div>
 </div>
 )}

 {/* Stats Cards - with icons like Deployments */}
 <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
 <ListPageStatCard label="Total" value={stats.total} icon={Route} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Healthy" value={stats.healthy} icon={CheckCircle2} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.status?.size === 1 && columnFilters.status?.has('Healthy')} onClick={() => setColumnFilter('status', new Set(['Healthy']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status?.has('Healthy') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard label="Degraded" value={stats.degraded} icon={Clock} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.status?.size === 1 && (columnFilters.status?.has('Degraded') || columnFilters.status?.has('Error'))} onClick={() => setColumnFilter('status', new Set(['Degraded']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status?.has('Degraded') && 'ring-2 ring-amber-500')} isLoading={isLoading} />
 <ListPageStatCard label="TLS Enabled" value={stats.tlsEnabled} icon={Lock} iconColor="text-green-600" valueClassName="text-green-600" selected={columnFilters.tls?.size === 1 && columnFilters.tls?.has('Yes')} onClick={() => { if (columnFilters.tls?.size === 1 && columnFilters.tls?.has('Yes')) setColumnFilter('tls', null); else setColumnFilter('tls', new Set(['Yes'])); }} className={cn(columnFilters.tls?.size === 1 && columnFilters.tls?.has('Yes') && 'ring-2 ring-green-600')} isLoading={isLoading} />
 <ListPageStatCard label="TLS Expiring" value={stats.tlsExpiring} icon={Clock} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.tlsExpiring?.size === 1 && columnFilters.tlsExpiring?.has('Yes')} onClick={() => { if (columnFilters.tlsExpiring?.size === 1 && columnFilters.tlsExpiring?.has('Yes')) setColumnFilter('tlsExpiring', null); else setColumnFilter('tlsExpiring', new Set(['Yes'])); }} className={cn(columnFilters.tlsExpiring?.size === 1 && columnFilters.tlsExpiring?.has('Yes') && 'ring-2 ring-amber-500')} isLoading={isLoading} />
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
 <DropdownMenuContent align="start">
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
 placeholder="Search ingresses by name, namespace, or host..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all"
 aria-label="Search ingresses"
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
 { id: 'byIngressClass', label: 'By Class', icon: Route },
 ]}
 label=""
 ariaLabel="List structure"
 />
 }
 footer={hasActiveFilters || searchQuery ? (
 <Button variant="link" size="sm" className="text-muted-foreground h-auto p-0" onClick={() => { setSearchQuery(''); clearAllFilters(); }}>Clear filters</Button>
 ) : undefined}
 />
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={INGRESSES_COLUMNS_FOR_VISIBILITY}
 visibleColumns={columnVisibility.visibleColumns}
 onColumnToggle={columnVisibility.setColumnVisible}
 isLoading={isLoading && isConnected}
 footer={
 <div className="flex items-center justify-between flex-wrap gap-2">
 <div className="flex items-center gap-3">
 <span className="text-sm text-muted-foreground">{totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No ingresses'}</span>
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
 <ListPagination hasPrev={safePageIndex > 0} hasNext={start + pageSize < totalFiltered} onPrev={() => setPageIndex((i) => Math.max(0, i - 1))} onNext={() => setPageIndex((i) => Math.min(totalPages - 1, i + 1))} currentPage={safePageIndex + 1} totalPages={Math.max(1, totalPages)} onPageChange={(p) => setPageIndex(Math.max(0, p - 1))} dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} />
 </div>
 }
 >
 <ResizableTableProvider tableId="kubilitics-resizable-table-ingresses" columnConfig={INGRESSES_TABLE_COLUMNS}>
 <div className="border border-border rounded-xl overflow-x-auto bg-card">
 <Table className="table-fixed" style={{ minWidth: 1580 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-12">
 <Checkbox
 checked={isAllSelected}
 onCheckedChange={toggleAllSelection}
 aria-label="Select all"
 className={isSomeSelected ? 'opacity-50' : ''}
 />
 </TableHead>
 <ResizableTableHead columnId="name">
 <TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="namespace">
 <TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="status">
 <TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="class">
 <TableColumnHeaderWithFilterAndSort columnId="class" label="Class" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="hosts">
 <TableColumnHeaderWithFilterAndSort columnId="hosts" label="Hosts" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="addresses">
 <TableColumnHeaderWithFilterAndSort columnId="address" label="Addresses" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="tls">
 <TableColumnHeaderWithFilterAndSort columnId="tls" label="TLS" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="rules">
 <TableColumnHeaderWithFilterAndSort columnId="rulesCount" label="Rules" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="defaultBackend">
 <TableColumnHeaderWithFilterAndSort columnId="defaultBackend" label="Default Backend" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="requestsSec">Requests/s</ResizableTableHead>
 <ResizableTableHead columnId="errorRate">Error Rate</ResizableTableHead>
 <ResizableTableHead columnId="age">
 <TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-12 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="namespace" className="p-1.5">
 <TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} />
 </ResizableTableCell>
 <ResizableTableCell columnId="status" className="p-1.5">
 <TableFilterCell columnId="status" label="Status" distinctValues={distinctValuesByColumn.status ?? []} selectedFilterValues={columnFilters.status ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.status} />
 </ResizableTableCell>
 <ResizableTableCell columnId="class" className="p-1.5">
 <TableFilterCell columnId="class" label="Class" distinctValues={distinctValuesByColumn.class ?? []} selectedFilterValues={columnFilters.class ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.class} />
 </ResizableTableCell>
 <ResizableTableCell columnId="hosts" className="p-1.5" />
 <ResizableTableCell columnId="addresses" className="p-1.5" />
 <ResizableTableCell columnId="tls" className="p-1.5">
 <TableFilterCell columnId="tls" label="TLS" distinctValues={distinctValuesByColumn.tls ?? []} selectedFilterValues={columnFilters.tls ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.tls} />
 </ResizableTableCell>
 <ResizableTableCell columnId="rules" className="p-1.5" />
 <ResizableTableCell columnId="defaultBackend" className="p-1.5" />
 <ResizableTableCell columnId="requestsSec" className="p-1.5" />
 <ResizableTableCell columnId="errorRate" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={14} resourceName="ingresses" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={14} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : filteredIngresses.length === 0 ? (
 <TableRow>
 <TableCell colSpan={14} className="h-40 text-center">
 <TableEmptyState
 icon={<Route className="h-8 w-8" />}
 title="No Ingresses found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Create an Ingress to expose Services with HTTP(S) routing.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create Ingress"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : listView === 'flat' ? (
 itemsOnPage.map((ing, idx) => {
 const StatusIcon = statusConfig[ing.status].icon;
 const isSelected = selectedItems.has(`${ing.namespace}/${ing.name}`);
 return (
 <tr
 key={`${ing.namespace}/${ing.name}`}
 className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}
 >
 <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(ing)} aria-label={`Select ${ing.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/ingresses/${ing.namespace}/${ing.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate"><Route className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="truncate">{ing.name}</span></Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={ing.namespace} className="font-normal truncate block w-fit max-w-full" /></ResizableTableCell>
 <ResizableTableCell columnId="status"><StatusPill label={ing.status} variant={ingressStatusToVariant[ing.status]} icon={StatusIcon} /></ResizableTableCell>
 <ResizableTableCell columnId="class"><Badge variant="secondary" className="font-mono text-xs truncate block w-fit max-w-full">{ing.class}</Badge></ResizableTableCell>
 <ResizableTableCell columnId="hosts"><span className="font-mono text-sm truncate block" title={ing.hosts}>{ing.hosts}</span></ResizableTableCell>
 <ResizableTableCell columnId="addresses"><span className={cn('font-mono text-sm truncate block', ing.address === '<pending>' && 'text-amber-600')}>{ing.address}</span></ResizableTableCell>
 <ResizableTableCell columnId="tls">{ing.tls ? <Lock className="h-4 w-4 text-green-600" /> : <span className="text-muted-foreground">—</span>}</ResizableTableCell>
 <ResizableTableCell columnId="rules" className="font-mono text-sm">{ing.rulesCount}</ResizableTableCell>
 <ResizableTableCell columnId="defaultBackend"><span className="font-mono text-xs truncate block" title={ing.defaultBackend}>{ing.defaultBackend}</span></ResizableTableCell>
 <ResizableTableCell columnId="requestsSec">
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="text-muted-foreground text-sm cursor-help">—</span>
 </TooltipTrigger>
 <TooltipContent side="top" className="text-xs max-w-56">
 Requires ingress controller metrics (e.g. Prometheus + NGINX Ingress controller)
 </TooltipContent>
 </Tooltip>
 </ResizableTableCell>
 <ResizableTableCell columnId="errorRate">
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="text-muted-foreground text-sm cursor-help">—</span>
 </TooltipTrigger>
 <TooltipContent side="top" className="text-xs max-w-56">
 Requires ingress controller metrics (e.g. Prometheus + NGINX Ingress controller)
 </TooltipContent>
 </Tooltip>
 </ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={ing.age} timestamp={ing.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Ingress actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-52">
 <CopyNameDropdownItem name={ing.name} namespace={ing.namespace} />
 <DropdownMenuItem onClick={() => navigate(`/ingresses/${ing.namespace}/${ing.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/ingresses/${ing.namespace}/${ing.name}?tab=routing`)} className="gap-2"><Route className="h-4 w-4" />Test Routes</DropdownMenuItem>
 {ing.tls && <DropdownMenuItem onClick={() => navigate(`/ingresses/${ing.namespace}/${ing.name}?tab=tls`)} className="gap-2"><Lock className="h-4 w-4" />View Certificate</DropdownMenuItem>}
 <DropdownMenuItem onClick={() => { const u = ing.address !== '<pending>' ? `https://${ing.hosts.split(',')[0]?.trim() || ing.address}` : null; if (u) window.open(u, '_blank'); else toast.info('No address yet'); }} className="gap-2"><ExternalLink className="h-4 w-4" />Open in Browser</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/ingresses/${ing.namespace}/${ing.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-rose-600" onClick={() => setDeleteDialog({ open: true, item: ing })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </tr>
 );
 })
 ) : (
 groupedOnPage.flatMap((group) => {
 const isCollapsed = collapsedGroups.has(group.groupKey);
 return [
 <TableRow key={group.groupKey} className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-b border-border/60 transition-all duration-200" onClick={() => toggleGroup(group.groupKey)}>
 <TableCell colSpan={14} className="py-2">
 <div className="flex items-center gap-2 font-medium">
 {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
 Namespace: {group.label}
 <span className="text-muted-foreground font-normal">({group.ingresses.length})</span>
 </div>
 </TableCell>
 </TableRow>,
 ...(isCollapsed ? [] : group.ingresses.map((ing, idx) => {
 const StatusIcon = statusConfig[ing.status].icon;
 const isSelected = selectedItems.has(`${ing.namespace}/${ing.name}`);
 return (
 <tr key={`${ing.namespace}/${ing.name}`} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
 <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(ing)} aria-label={`Select ${ing.name}`} /></TableCell>
 <ResizableTableCell columnId="name"><Link to={`/ingresses/${ing.namespace}/${ing.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate"><Route className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="truncate">{ing.name}</span></Link></ResizableTableCell>
 <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={ing.namespace} className="font-normal truncate block w-fit max-w-full" /></ResizableTableCell>
 <ResizableTableCell columnId="status"><StatusPill label={ing.status} variant={ingressStatusToVariant[ing.status]} icon={StatusIcon} /></ResizableTableCell>
 <ResizableTableCell columnId="class"><Badge variant="secondary" className="font-mono text-xs truncate block w-fit max-w-full">{ing.class}</Badge></ResizableTableCell>
 <ResizableTableCell columnId="hosts"><span className="font-mono text-sm truncate block" title={ing.hosts}>{ing.hosts}</span></ResizableTableCell>
 <ResizableTableCell columnId="addresses"><span className={cn('font-mono text-sm truncate block', ing.address === '<pending>' && 'text-amber-600')}>{ing.address}</span></ResizableTableCell>
 <ResizableTableCell columnId="tls">{ing.tls ? <Lock className="h-4 w-4 text-green-600" /> : <span className="text-muted-foreground">—</span>}</ResizableTableCell>
 <ResizableTableCell columnId="rules" className="font-mono text-sm">{ing.rulesCount}</ResizableTableCell>
 <ResizableTableCell columnId="defaultBackend"><span className="font-mono text-xs truncate block" title={ing.defaultBackend}>{ing.defaultBackend}</span></ResizableTableCell>
 <ResizableTableCell columnId="requestsSec">
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="text-muted-foreground text-sm cursor-help">—</span>
 </TooltipTrigger>
 <TooltipContent side="top" className="text-xs max-w-56">
 Requires ingress controller metrics (e.g. Prometheus + NGINX Ingress controller)
 </TooltipContent>
 </Tooltip>
 </ResizableTableCell>
 <ResizableTableCell columnId="errorRate">
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="text-muted-foreground text-sm cursor-help">—</span>
 </TooltipTrigger>
 <TooltipContent side="top" className="text-xs max-w-56">
 Requires ingress controller metrics (e.g. Prometheus + NGINX Ingress controller)
 </TooltipContent>
 </Tooltip>
 </ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={ing.age} timestamp={ing.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="Ingress actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-52">
 <CopyNameDropdownItem name={ing.name} namespace={ing.namespace} />
 <DropdownMenuItem onClick={() => navigate(`/ingresses/${ing.namespace}/${ing.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/ingresses/${ing.namespace}/${ing.name}?tab=routing`)} className="gap-2"><Route className="h-4 w-4" />Test Routes</DropdownMenuItem>
 {ing.tls && <DropdownMenuItem onClick={() => navigate(`/ingresses/${ing.namespace}/${ing.name}?tab=tls`)} className="gap-2"><Lock className="h-4 w-4" />View Certificate</DropdownMenuItem>}
 <DropdownMenuItem onClick={() => { const u = ing.address !== '<pending>' ? `https://${ing.hosts.split(',')[0]?.trim() || ing.address}` : null; if (u) window.open(u, '_blank'); else toast.info('No address yet'); }} className="gap-2"><ExternalLink className="h-4 w-4" />Open in Browser</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/ingresses/${ing.namespace}/${ing.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-rose-600" onClick={() => setDeleteDialog({ open: true, item: ing })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </tr>
 );
 })),
 ];
 })
 )}
 </TableBody>
 </Table>
 </div>
 </ResizableTableProvider>
 </ResourceListTableToolbar>

 {/* Create Wizard */}
 {showCreateWizard && (
 <IngressWizard
 onClose={() => setShowCreateWizard(false)}
 onSubmit={() => { setShowCreateWizard(false); refetch(); }}
 />
 )}

 {/* Delete Dialog */}
 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
 resourceType="Ingress"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} ingresses` : deleteDialog.item?.name || ''}
 namespace={deleteDialog.item?.namespace}
 onConfirm={handleDelete}
 />
 </div>
 );
}
