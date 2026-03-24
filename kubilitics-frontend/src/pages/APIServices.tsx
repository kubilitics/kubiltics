import { useState, useMemo, useEffect } from 'react';
import { FileCode, Search, RefreshCw, MoreHorizontal,
 WifiOff, ChevronDown, CheckSquare, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { usePaginatedResourceList, useDeleteK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog } from '@/components/resources';
import { StatusPill } from '@/components/list';
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
 TableFilterCell,
 resourceTableRowClassName,
 ROW_MOTION,
 PAGE_SIZE_OPTIONS,
 AgeCell,
 TableEmptyState, ListPageLoadingShell, TableErrorState,
 ResourceListTableToolbar,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';

interface APIServiceResource extends KubernetesResource {
 spec?: {
 service?: { namespace?: string; name?: string };
 group?: string;
 version?: string;
 insecureSkipTLSVerify?: boolean;
 };
 status?: {
 conditions?: Array<{ type: string; status: string }>;
 };
}

interface APIService {
 id: string;
 name: string;
 service: string;
 group: string;
 version: string;
 status: string;
 age: string;
 creationTimestamp?: string;
 insecureSkipTLS: boolean;
}

function transformAPIService(item: APIServiceResource): APIService {
 const condition = item.status?.conditions?.find((c) => c.type === 'Available');
 return {
 id: item.metadata.uid,
 name: item.metadata.name,
 service: item.spec?.service ? `${item.spec.service.namespace}/${item.spec.service.name}` : 'Local',
 group: item.spec?.group || '',
 version: item.spec?.version || '-',
 status: condition?.status === 'True' ? 'Available' : 'Unavailable',
 age: calculateAge(item.metadata.creationTimestamp),
 creationTimestamp: item.metadata?.creationTimestamp,
 insecureSkipTLS: !!item.spec?.insecureSkipTLSVerify,
 };
}

const API_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'service', defaultWidth: 160, minWidth: 100 },
 { id: 'group', defaultWidth: 220, minWidth: 120 },
 { id: 'version', defaultWidth: 160, minWidth: 100 },
 { id: 'status', defaultWidth: 150, minWidth: 100 },
 { id: 'insecureSkipTLS', defaultWidth: 160, minWidth: 100 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const API_COLUMNS_FOR_VISIBILITY = [
 { id: 'service', label: 'Service' },
 { id: 'group', label: 'Group' },
 { id: 'version', label: 'Version' },
 { id: 'status', label: 'Status' },
 { id: 'insecureSkipTLS', label: 'Insecure Skip TLS' },
 { id: 'age', label: 'Age' },
];

export default function APIServices() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, refetch, pagination: hookPagination } = usePaginatedResourceList<APIServiceResource>('apiservices');
 const deleteResource = useDeleteK8sResource('apiservices');

 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: APIService | null; bulk?: boolean }>({ open: false, item: null });
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [searchQuery, setSearchQuery] = useState('');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const allItems = useMemo(() => (data?.allItems ?? []) as APIServiceResource[], [data?.allItems]);
 const items: APIService[] = useMemo(() => (isConnected ? allItems.map(transformAPIService) : []), [isConnected, allItems]);

 const tableConfig: ColumnConfig<APIService>[] = useMemo(
 () => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'service', getValue: (i) => i.service, sortable: true, filterable: false },
 { columnId: 'group', getValue: (i) => i.group, sortable: true, filterable: false },
 { columnId: 'version', getValue: (i) => i.version, sortable: true, filterable: false },
 { columnId: 'status', getValue: (i) => i.status, sortable: true, filterable: true },
 { columnId: 'insecureSkipTLS', getValue: (i) => (i.insecureSkipTLS ? 'Yes' : 'No'), sortable: true, filterable: false },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ],
 []
 );

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(items, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'apiservices', columns: API_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const searchFiltered = useMemo(() => {
 if (!searchQuery.trim()) return filteredItems;
 const q = searchQuery.toLowerCase();
 return filteredItems.filter((i) => i.name.toLowerCase().includes(q) || i.group.toLowerCase().includes(q) || i.service.toLowerCase().includes(q));
 }, [filteredItems, searchQuery]);

 const stats = useMemo(() => {
 const total = items.length;
 const available = items.filter((i) => i.status === 'Available').length;
 const unavailable = items.filter((i) => i.status !== 'Available').length;
 const local = items.filter((i) => i.service === 'Local').length;
 return { total, available, unavailable, local };
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
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No API services',
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
 toast.success(`Deleted ${selectedItems.size} API service(s)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name });
 toast.success(`API service ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const toggleSelection = (item: APIService) => {
 const next = new Set(selectedItems);
 if (next.has(item.name)) next.delete(item.name);
 else next.add(item.name);
 setSelectedItems(next);
 };
 const toggleAll = () => {
 if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
 else setSelectedItems(new Set(itemsOnPage.map((i) => i.name)));
 };
 const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
 const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

 const exportConfig = {
 filenamePrefix: 'apiservices',
 resourceLabel: 'API Services',
 getExportData: (i: APIService) => ({ name: i.name, service: i.service, group: i.group, version: i.version, status: i.status, insecureSkipTLS: i.insecureSkipTLS, age: i.age }),
 csvColumns: [
 { label: 'Name', getValue: (i: APIService) => i.name },
 { label: 'Service', getValue: (i: APIService) => i.service },
 { label: 'Group', getValue: (i: APIService) => i.group },
 { label: 'Version', getValue: (i: APIService) => i.version },
 { label: 'Status', getValue: (i: APIService) => i.status },
 { label: 'Insecure Skip TLS', getValue: (i: APIService) => (i.insecureSkipTLS ? 'Yes' : 'No') },
 { label: 'Age', getValue: (i: APIService) => i.age },
 ],
 };

 return (
 <>
 <div className="space-y-6">
 <ListPageHeader
 icon={<FileCode className="h-6 w-6 text-primary" />}
 title="API Services"
 resourceCount={searchFiltered.length}
 subtitle="Cluster-scoped"
 demoMode={!isConnected}
 dataUpdatedAt={hookPagination?.dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create"
 onCreate={() => setShowCreateWizard(true)}
 actions={
 <>
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(i) => i.name} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected API services' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
 <ListPageStatCard label="Total API Services" value={stats.total} icon={FileCode} iconColor="text-primary" isLoading={isLoading} />
 <ListPageStatCard label="Available" value={stats.available} icon={FileCode} iconColor="text-emerald-600" isLoading={isLoading} />
 <ListPageStatCard label="Unavailable" value={stats.unavailable} icon={FileCode} iconColor="text-rose-600" isLoading={isLoading} />
 <ListPageStatCard label="Local" value={stats.local} icon={FileCode} iconColor="text-muted-foreground" isLoading={isLoading} />
 </div>

 {/* Bulk Actions Bar */}
 {selectedItems.size > 0 && (
 <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
 <Badge variant="secondary" className="gap-1.5">
 <CheckSquare className="h-3.5 w-3.5" />
 {selectedItems.size} selected
 </Badge>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(i) => i.name} config={exportConfig} selectionLabel="Selected API services" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
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
 <Input placeholder="Search API services..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search API services" />
 </div>
 }
 />
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={API_COLUMNS_FOR_VISIBILITY}
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
 <ResizableTableProvider tableId="apiservices" columnConfig={API_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 800 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 {columnVisibility.isColumnVisible('service') && <ResizableTableHead columnId="service"><TableColumnHeaderWithFilterAndSort columnId="service" label="Service" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('group') && <ResizableTableHead columnId="group"><TableColumnHeaderWithFilterAndSort columnId="group" label="Group" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('version') && <ResizableTableHead columnId="version"><TableColumnHeaderWithFilterAndSort columnId="version" label="Version" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('status') && <ResizableTableHead columnId="status"><TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('insecureSkipTLS') && <ResizableTableHead columnId="insecureSkipTLS"><TableColumnHeaderWithFilterAndSort columnId="insecureSkipTLS" label="Insecure Skip TLS" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 {columnVisibility.isColumnVisible('service') && <ResizableTableCell columnId="service" className="p-1.5" />}
 {columnVisibility.isColumnVisible('group') && <ResizableTableCell columnId="group" className="p-1.5" />}
 {columnVisibility.isColumnVisible('version') && <ResizableTableCell columnId="version" className="p-1.5" />}
 {columnVisibility.isColumnVisible('status') && <ResizableTableCell columnId="status" className="p-1.5"><TableFilterCell columnId="status" label="Status" distinctValues={distinctValuesByColumn.status ?? []} selectedFilterValues={columnFilters.status ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.status} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('insecureSkipTLS') && <ResizableTableCell columnId="insecureSkipTLS" className="p-1.5" />}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={10} resourceName="API services" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={10} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : searchFiltered.length === 0 ? (
 <TableRow>
 <TableCell colSpan={10} className="h-40 text-center">
 <TableEmptyState
 icon={<FileCode className="h-8 w-8" />}
 title="No API services found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Get started by creating an APIService to register extension APIs.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create APIService"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((item, idx) => (
 <tr key={item.id} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(item.name) && 'bg-primary/5')}>
 <TableCell><Checkbox checked={selectedItems.has(item.name)} onCheckedChange={() => toggleSelection(item)} aria-label={`Select ${item.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/apiservices/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <FileCode className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 </Link>
 </ResizableTableCell>
 {columnVisibility.isColumnVisible('service') && <ResizableTableCell columnId="service" className="font-mono text-sm">{item.service}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('group') && <ResizableTableCell columnId="group" className="text-muted-foreground">{item.group || '–'}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('version') && <ResizableTableCell columnId="version" className="font-mono text-sm">{item.version}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('status') && <ResizableTableCell columnId="status"><StatusPill label={item.status} variant={item.status === 'Available' ? 'success' : 'error'} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('insecureSkipTLS') && <ResizableTableCell columnId="insecureSkipTLS">{item.insecureSkipTLS ? 'Yes' : 'No'}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>}
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="API Service actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem onClick={() => navigate(`/apiservices/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/apiservices/${item.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
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
 </div>

 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null, bulk: open ? deleteDialog.bulk : false })}
 resourceType="APIService"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name || '')}
 onConfirm={handleDelete}
 requireNameConfirmation={!deleteDialog.bulk}
 />

 {showCreateWizard && (
 <ResourceCreator
 resourceKind="APIService"
 defaultYaml={DEFAULT_YAMLS.APIService}
 onClose={() => setShowCreateWizard(false)}
 onApply={(_yaml) => {
 toast.success('APIService created');
 setShowCreateWizard(false);
 refetch();
 }}
 />
 )}
 </>
 );
}
