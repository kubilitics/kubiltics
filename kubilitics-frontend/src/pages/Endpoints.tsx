import { useState, useMemo, useEffect } from 'react';
import { 
 Search, 
 Filter,
 RefreshCw, 
 MoreHorizontal,
 Download,
 Network,
 Loader2,
 WifiOff,
 ChevronDown,
 CheckSquare,
 ExternalLink,
 Link2,
 Plus,
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
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuTrigger,
 DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { useK8sResourceList, useDeleteK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { toast } from 'sonner';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { ResourceExportDropdown, ResourceCommandBar, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, ListPagination, PAGE_SIZE_OPTIONS, resourceTableRowClassName, ROW_MOTION, AgeCell, TableEmptyState, ListPageLoadingShell, TableErrorState, NamespaceBadge, ResourceListTableToolbar } from '@/components/list';
import { DeleteConfirmDialog } from '@/components/resources';
import { ResizableTableProvider, ResizableTableHead, ResizableTableCell, type ResizableColumnConfig } from '@/components/ui/resizable-table';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';

interface K8sEndpoint extends KubernetesResource {
 subsets?: Array<{
 addresses?: Array<{ ip: string; nodeName?: string; targetRef?: { name: string; namespace: string } }>;
 notReadyAddresses?: Array<{ ip: string }>;
 ports?: Array<{ port: number; name?: string; protocol?: string }>;
 }>;
}

interface Endpoint {
 name: string;
 namespace: string;
 endpoints: string;
 readyCount: number;
 notReadyCount: number;
 ports: string;
 age: string;
 creationTimestamp?: string;
}

const ENDPOINTS_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'readyCount', defaultWidth: 100, minWidth: 70 },
 { id: 'notReadyCount', defaultWidth: 100, minWidth: 70 },
 { id: 'totalAddresses', defaultWidth: 100, minWidth: 70 },
 { id: 'ports', defaultWidth: 160, minWidth: 100 },
 { id: 'service', defaultWidth: 160, minWidth: 100 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const ENDPOINTS_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'readyCount', label: 'Ready Addresses' },
 { id: 'notReadyCount', label: 'Not Ready Addresses' },
 { id: 'totalAddresses', label: 'Total' },
 { id: 'ports', label: 'Ports' },
 { id: 'service', label: 'Service' },
 { id: 'age', label: 'Age' },
];

export default function Endpoints() {
 const navigate = useNavigate();
 const [searchQuery, setSearchQuery] = useState('');
 const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: Endpoint | null; bulk?: boolean }>({ open: false, item: null });
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);
 const [showTableFilters, setShowTableFilters] = useState(false);

 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<K8sEndpoint>('endpoints', undefined, { limit: 5000 });
 const deleteResource = useDeleteK8sResource('endpoints');

 const endpoints: Endpoint[] = isConnected && data?.items
 ? data.items.map((ep) => {
 let readyCount = 0;
 let notReadyCount = 0;
 const endpointsList: string[] = [];
 const portsList: string[] = [];
 
 ep.subsets?.forEach(subset => {
 readyCount += subset.addresses?.length || 0;
 notReadyCount += subset.notReadyAddresses?.length || 0;
 
 subset.addresses?.forEach(addr => {
 subset.ports?.forEach(port => {
 endpointsList.push(`${addr.ip}:${port.port}`);
 });
 });
 
 subset.ports?.forEach(port => {
 portsList.push(`${port.port}/${port.protocol || 'TCP'}`);
 });
 });
 
 return {
 name: ep.metadata.name,
 namespace: ep.metadata.namespace || 'default',
 endpoints: endpointsList.slice(0, 3).join(', ') + (endpointsList.length > 3 ? ` (+${endpointsList.length - 3})` : '') || '<none>',
 readyCount,
 notReadyCount,
 ports: [...new Set(portsList)].join(', ') || '-',
 age: calculateAge(ep.metadata.creationTimestamp),
 creationTimestamp: ep.metadata?.creationTimestamp,
 };
 })
 : [];

 const stats = useMemo(() => ({
 total: endpoints.length,
 healthy: endpoints.filter((e) => e.notReadyCount === 0 && e.readyCount > 0).length,
 degraded: endpoints.filter((e) => e.notReadyCount > 0 && e.readyCount > 0).length,
 empty: endpoints.filter((e) => e.readyCount === 0).length,
 }), [endpoints]);

 const namespaces = useMemo(() => {
 return ['all', ...Array.from(new Set(endpoints.map(e => e.namespace)))];
 }, [endpoints]);

 const itemsAfterSearchAndNs = useMemo(() => {
 return endpoints.filter(ep => {
 const matchesSearch = ep.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
 ep.namespace.toLowerCase().includes(searchQuery.toLowerCase()) ||
 ep.endpoints.includes(searchQuery);
 const matchesNamespace = selectedNamespace === 'all' || ep.namespace === selectedNamespace;
 return matchesSearch && matchesNamespace;
 });
 }, [endpoints, searchQuery, selectedNamespace]);

 const endpointsTableConfig: ColumnConfig<Endpoint>[] = useMemo(() => [
 { columnId: 'name', getValue: (e) => e.name, sortable: true, filterable: false },
 { columnId: 'namespace', getValue: (e) => e.namespace, sortable: true, filterable: true },
 { columnId: 'healthStatus', getValue: (e) => e.notReadyCount === 0 && e.readyCount > 0 ? 'Healthy' : e.notReadyCount > 0 && e.readyCount > 0 ? 'Degraded' : 'Empty', sortable: true, filterable: true },
 { columnId: 'readyCount', getValue: (e) => e.readyCount, sortable: true, filterable: false },
 { columnId: 'notReadyCount', getValue: (e) => e.notReadyCount, sortable: true, filterable: false },
 { columnId: 'age', getValue: (e) => e.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredEndpoints, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearchAndNs, { columns: endpointsTableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'endpoints', columns: ENDPOINTS_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const totalFiltered = filteredEndpoints.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredEndpoints.slice(start, start + pageSize);

 useEffect(() => {
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [safePageIndex, pageIndex]);

 const endpointExportConfig = {
 filenamePrefix: 'endpoints',
 resourceLabel: 'endpoints',
 getExportData: (e: Endpoint) => ({ name: e.name, namespace: e.namespace, endpoints: e.endpoints, readyCount: e.readyCount, notReadyCount: e.notReadyCount, ports: e.ports, age: e.age }),
 csvColumns: [
 { label: 'Name', getValue: (e: Endpoint) => e.name },
 { label: 'Namespace', getValue: (e: Endpoint) => e.namespace },
 { label: 'Endpoints', getValue: (e: Endpoint) => e.endpoints },
 { label: 'Ready', getValue: (e: Endpoint) => e.readyCount },
 { label: 'Not Ready', getValue: (e: Endpoint) => e.notReadyCount },
 { label: 'Ports', getValue: (e: Endpoint) => e.ports },
 { label: 'Age', getValue: (e: Endpoint) => e.age },
 ],
 toK8sYaml: (e: Endpoint) => `---
apiVersion: v1
kind: Endpoints
metadata:
 name: ${e.name}
 namespace: ${e.namespace}
subsets: []
`,
 };

 const toggleSelection = (item: Endpoint) => {
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
 if (selectedItems.size === filteredEndpoints.length) {
 setSelectedItems(new Set());
 } else {
 setSelectedItems(new Set(filteredEndpoints.map(e => `${e.namespace}/${e.name}`)));
 }
 };

 const isAllSelected = filteredEndpoints.length > 0 && selectedItems.size === filteredEndpoints.length;
 const isSomeSelected = selectedItems.size > 0 && selectedItems.size < filteredEndpoints.length;

 const handleDelete = async () => {
 try {
 if (deleteDialog.bulk && selectedItems.size > 0) {
 for (const key of selectedItems) {
 const [ns, n] = key.split('/');
 if (n && ns) await deleteResource.mutateAsync({ name: n, namespace: ns });
 }
 toast.success(`Deleted ${selectedItems.size} endpoint(s)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
 toast.success('Endpoint deleted');
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 } catch (e) {
 toast.error(e instanceof Error ? e.message : 'Delete failed');
 }
 };

 return (
 <>
 <div className="space-y-6">
 <ListPageHeader
 icon={<Network className="h-6 w-6 text-primary" />}
 title="Endpoints"
 resourceCount={filteredEndpoints.length}
 subtitle={namespaces.length > 1 ? `across ${namespaces.length - 1} namespaces` : undefined}
 demoMode={!isConnected}
 dataUpdatedAt={dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create Endpoint"
 onCreate={() => setShowCreateWizard(true)}
 actions={
 <>
 <ResourceExportDropdown
 items={filteredEndpoints}
 selectedKeys={selectedItems}
 getKey={(e) => `${e.namespace}/${e.name}`}
 config={endpointExportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected endpoints' : 'All visible endpoints'}
 onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
 />
 {selectedItems.size > 0 && (
 <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
 <Trash2 className="h-3.5 w-3.5" />
 Delete {selectedItems.size} selected
 </Button>
 )}
 </>
 }
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
 items={filteredEndpoints}
 selectedKeys={selectedItems}
 getKey={(e) => `${e.namespace}/${e.name}`}
 config={endpointExportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected endpoints' : 'All visible endpoints'}
 onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
 triggerLabel={selectedItems.size > 0 ? `Export (${selectedItems.size})` : 'Export'}
 />
 <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
 <Trash2 className="h-3.5 w-3.5" />
 Delete selected
 </Button>
 <Button variant="ghost" size="sm" onClick={() => setSelectedItems(new Set())}>
 Clear
 </Button>
 </div>
 </div>
 )}

 {/* Stats Cards - Design 3.4: Total, Healthy, Degraded, Empty */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 <ListPageStatCard size="sm" label="Total Endpoints" value={stats.total} selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard size="sm" label="Healthy" value={stats.healthy} valueClassName="text-emerald-600" selected={columnFilters.healthStatus?.size === 1 && columnFilters.healthStatus.has('Healthy')} onClick={() => setColumnFilter('healthStatus', new Set(['Healthy']))} className={cn(columnFilters.healthStatus?.size === 1 && columnFilters.healthStatus.has('Healthy') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard size="sm" label="Degraded" value={stats.degraded} valueClassName="text-amber-600" selected={columnFilters.healthStatus?.size === 1 && columnFilters.healthStatus.has('Degraded')} onClick={() => setColumnFilter('healthStatus', new Set(['Degraded']))} className={cn(columnFilters.healthStatus?.size === 1 && columnFilters.healthStatus.has('Degraded') && 'ring-2 ring-amber-500')} isLoading={isLoading} />
 <ListPageStatCard size="sm" label="Empty" value={stats.empty} valueClassName="text-rose-600" selected={columnFilters.healthStatus?.size === 1 && columnFilters.healthStatus.has('Empty')} onClick={() => setColumnFilter('healthStatus', new Set(['Empty']))} className={cn(columnFilters.healthStatus?.size === 1 && columnFilters.healthStatus.has('Empty') && 'ring-2 ring-rose-500')} isLoading={isLoading} />
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
 placeholder="Search endpoints by name, namespace, or IP..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all"
 aria-label="Search endpoints"
 />
 </div>
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
 columns={ENDPOINTS_COLUMNS_FOR_VISIBILITY}
 visibleColumns={columnVisibility.visibleColumns}
 onColumnToggle={columnVisibility.setColumnVisible}
 isLoading={isLoading && isConnected}
 footer={
 <div className="flex items-center justify-between flex-wrap gap-2">
 <div className="flex items-center gap-3">
 <span className="text-sm text-muted-foreground">{totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No endpoints'}</span>
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
 <ResizableTableProvider tableId="kubilitics-resizable-table-endpoints" columnConfig={ENDPOINTS_TABLE_COLUMNS}>
 <div className="border border-border rounded-xl overflow-x-auto bg-card">
 <Table className="table-fixed" style={{ minWidth: 960 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-12">
 <Checkbox checked={isAllSelected} onCheckedChange={toggleAllSelection} aria-label="Select all" className={isSomeSelected ? 'opacity-50' : ''} />
 </TableHead>
 <ResizableTableHead columnId="name">
 <TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="namespace">
 <TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="readyCount">
 <TableColumnHeaderWithFilterAndSort columnId="readyCount" label="Ready Addresses" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="notReadyCount">
 <TableColumnHeaderWithFilterAndSort columnId="notReadyCount" label="Not Ready Addresses" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="totalAddresses">Total</ResizableTableHead>
 <ResizableTableHead columnId="ports">Ports</ResizableTableHead>
 <ResizableTableHead columnId="service">Service</ResizableTableHead>
 <ResizableTableHead columnId="age">
 <TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <TableHead className="w-12"></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-12 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="namespace" className="p-1.5">
 <TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} />
 </ResizableTableCell>
 <ResizableTableCell columnId="readyCount" className="p-1.5" />
 <ResizableTableCell columnId="notReadyCount" className="p-1.5" />
 <ResizableTableCell columnId="totalAddresses" className="p-1.5" />
 <ResizableTableCell columnId="ports" className="p-1.5" />
 <ResizableTableCell columnId="service" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={11} resourceName="endpoints" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={11} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : itemsOnPage.length === 0 ? (
 <TableRow>
 <TableCell colSpan={11} className="h-40 text-center">
 <TableEmptyState
 icon={<Network className="h-8 w-8" />}
 title="No endpoints found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Endpoints are usually created by Services; create one manually if needed.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create Endpoint"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((ep, idx) => {
 const isSelected = selectedItems.has(`${ep.namespace}/${ep.name}`);
 return (
 <tr
 key={`${ep.namespace}/${ep.name}`}
 className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}
 >
 <TableCell>
 <Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(ep)} aria-label={`Select ${ep.name}`} />
 </TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/endpoints/${ep.namespace}/${ep.name}`} className="font-medium text-primary hover:underline truncate block">{ep.name}</Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={ep.namespace} /></ResizableTableCell>
 <ResizableTableCell columnId="readyCount">
 <span className={cn('font-mono', ep.readyCount > 0 ? 'text-emerald-600' : 'text-muted-foreground')}>{ep.readyCount}</span>
 </ResizableTableCell>
 <ResizableTableCell columnId="notReadyCount">
 <span className={cn('font-mono', ep.notReadyCount > 0 ? 'text-rose-600' : 'text-muted-foreground')}>{ep.notReadyCount}</span>
 </ResizableTableCell>
 <ResizableTableCell columnId="totalAddresses"><span className="font-mono">{ep.readyCount + ep.notReadyCount}</span></ResizableTableCell>
 <ResizableTableCell columnId="ports"><span className="font-mono text-xs truncate block">{ep.ports}</span></ResizableTableCell>
 <ResizableTableCell columnId="service"><Link to={`/services/${ep.namespace}/${ep.name}`} className="text-primary hover:underline text-sm truncate block font-medium">{ep.name}</Link></ResizableTableCell>
 <ResizableTableCell columnId="age"><AgeCell age={ep.age} timestamp={ep.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end">
 <DropdownMenuItem onClick={() => navigate(`/endpoints/${ep.namespace}/${ep.name}`)}><ExternalLink className="h-4 w-4 mr-2" />View Details</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/services/${ep.namespace}/${ep.name}`)}><Link2 className="h-4 w-4 mr-2" />View Service</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/endpoints/${ep.namespace}/${ep.name}?tab=yaml`)}><Download className="h-4 w-4 mr-2" />Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteDialog({ open: true, item: ep })}><Trash2 className="h-4 w-4 mr-2" />Delete</DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </tr>
 );
 })
 )}
 </TableBody>
 </Table>
 </div>
 </ResizableTableProvider>
 </ResourceListTableToolbar>
 </div>

 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
 resourceType="Endpoint"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} endpoints` : (deleteDialog.item?.name || '')}
 namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace}
 onConfirm={handleDelete}
 requireNameConfirmation={!deleteDialog.bulk}
 />

 {showCreateWizard && (
 <ResourceCreator
 resourceKind="Endpoints"
 defaultYaml={DEFAULT_YAMLS.Endpoints}
 onClose={() => setShowCreateWizard(false)}
 onApply={() => { toast.success('Endpoints created successfully (demo mode)'); setShowCreateWizard(false); refetch(); }}
 />
 )}
 </>
 );
}