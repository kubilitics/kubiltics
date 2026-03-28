import { useState, useMemo, useEffect } from 'react';
import {
 Search, RefreshCw, MoreHorizontal, Loader2, Network, ChevronDown, CheckSquare, Trash2, FileText,
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
import { ResourceCommandBar, ResourceExportDropdown, ListPagination, PAGE_SIZE_OPTIONS, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, resourceTableRowClassName, ROW_MOTION, AgeCell, TableEmptyState, TableErrorState, ListPageLoadingShell, CopyNameDropdownItem, NamespaceBadge, ResourceListTableToolbar } from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { usePaginatedResourceList, useDeleteK8sResource, usePatchK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog, BulkActionBar, executeBulkOperation } from '@/components/resources';
import { toast } from '@/components/ui/sonner';
import { useMultiSelect } from '@/hooks/useMultiSelect';

interface IPAddressPool {
 name: string;
 namespace: string;
 addresses: string;
 assigned: string;
 available: string;
 age: string;
 creationTimestamp?: string;
}

interface K8sIPAddressPool extends KubernetesResource {
 spec?: { addresses?: string[]; autoAssign?: boolean };
 status?: { assignedIPv4?: number; assignedIPv6?: number; availableIPv4?: number; availableIPv6?: number };
}

function mapPool(p: K8sIPAddressPool): IPAddressPool {
 const addrs = p.spec?.addresses ?? [];
 const a4 = p.status?.assignedIPv4 ?? 0;
 const a6 = p.status?.assignedIPv6 ?? 0;
 const v4 = p.status?.availableIPv4 ?? 0;
 const v6 = p.status?.availableIPv6 ?? 0;
 const assigned = a4 + a6 > 0 ? `${a4 + a6}` : '—';
 const available = v4 + v6 > 0 ? `${v4 + v6}` : '—';
 return {
 name: p.metadata?.name ?? '',
 namespace: p.metadata?.namespace ?? '',
 addresses: addrs.length ? (addrs.length > 2 ? `${addrs.slice(0, 2).join(', ')} +${addrs.length - 2}` : addrs.join(', ')) : '—',
 assigned,
 available,
 age: calculateAge(p.metadata?.creationTimestamp),
 creationTimestamp: p.metadata?.creationTimestamp,
 };
}

const POOL_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'addresses', defaultWidth: 260, minWidth: 120 },
 { id: 'assigned', defaultWidth: 100, minWidth: 70 },
 { id: 'available', defaultWidth: 100, minWidth: 70 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const POOL_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'addresses', label: 'Addresses' },
 { id: 'assigned', label: 'Assigned' },
 { id: 'available', label: 'Available' },
 { id: 'age', label: 'Age' },
];

export default function IPAddressPools() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = usePaginatedResourceList<K8sIPAddressPool>('ipaddresspools');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: IPAddressPool | null; bulk?: boolean }>({ open: false, item: null });
 const multiSelect = useMultiSelect();
 const selectedItems = multiSelect.selectedIds;
 const patchResource = usePatchK8sResource('ipaddresspools');
 const [searchQuery, setSearchQuery] = useState('');
 const [namespaceFilter, setNamespaceFilter] = useState<string>('');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);
 const deletePool = useDeleteK8sResource('ipaddresspools');

 const allItems = useMemo(() => (data?.allItems ?? []) as K8sIPAddressPool[], [data?.allItems]);
 const items: IPAddressPool[] = useMemo(() => (isConnected ? allItems.map(mapPool) : []), [isConnected, allItems]);

 const namespaces = useMemo(() => [...new Set(items.map((i) => i.namespace).filter(Boolean))].sort(), [items]);

 const stats = useMemo(() => ({
 total: items.length,
 withAssigned: items.filter((i) => i.assigned !== '—' && i.assigned !== '0').length,
 }), [items]);

 const itemsFiltered = useMemo(() => {
 let out = items;
 if (namespaceFilter) out = out.filter((i) => i.namespace === namespaceFilter);
 if (searchQuery) {
 const q = searchQuery.toLowerCase();
 out = out.filter((i) =>
 i.name.toLowerCase().includes(q) ||
 i.namespace.toLowerCase().includes(q) ||
 i.addresses.toLowerCase().includes(q)
 );
 }
 return out;
 }, [items, namespaceFilter, searchQuery]);

 const tableConfig: ColumnConfig<IPAddressPool>[] = useMemo(
 () => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
 { columnId: 'addresses', getValue: (i) => i.addresses, sortable: true, filterable: false },
 { columnId: 'assigned', getValue: (i) => i.assigned, sortable: true, filterable: false },
 { columnId: 'hasAssigned', getValue: (i) => (i.assigned !== '—' && i.assigned !== '0' ? 'Yes' : 'No'), sortable: false, filterable: true },
 { columnId: 'available', getValue: (i) => i.available, sortable: true, filterable: false },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ],
 []
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
 } = useTableFiltersAndSort(itemsFiltered, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'ipaddresspools', columns: POOL_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const totalFiltered = filteredItems.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredItems.slice(start, start + pageSize);

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
 const [ns, name] = key.split('/');
 await deletePool.mutateAsync({ name, namespace: ns });
 }
 toast.success(`Deleted ${selectedItems.size} IP address pool(s)`);
 multiSelect.clearSelection();
 } else if (deleteDialog.item) {
 await deletePool.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
 toast.success(`IPAddressPool ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const itemKey = (i: IPAddressPool) => `${i.namespace}/${i.name}`;
 const allKeys = useMemo(() => itemsOnPage.map(itemKey), [itemsOnPage]);

 const toggleSelection = (i: IPAddressPool, event?: React.MouseEvent) => {
 const key = itemKey(i);
 if (event?.shiftKey) {
 multiSelect.toggleRange(key, allKeys);
 } else {
 multiSelect.toggle(key);
 }
 };
 const toggleAll = () => {
 if (multiSelect.isAllSelected(allKeys)) multiSelect.clearSelection();
 else multiSelect.selectAll(allKeys);
 };
 const isAllSelected = multiSelect.isAllSelected(allKeys);
 const isSomeSelected = multiSelect.isSomeSelected(allKeys);

 const handleBulkDelete = async () => {
 return executeBulkOperation(Array.from(selectedItems), async (_key, ns, name) => {
 await deletePool.mutateAsync({ name, namespace: ns });
 });
 };

 const handleBulkLabel = async (label: string) => {
 return executeBulkOperation(Array.from(selectedItems), async (_key, ns, name) => {
 await patchResource.mutateAsync({ name, namespace: ns, patch: { metadata: { labels: { [label.split('=')[0]]: label.split('=')[1] } } } });
 });
 };

 const pagination = {
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No IP address pools',
 hasPrev: safePageIndex > 0,
 hasNext: start + pageSize < totalFiltered,
 onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
 onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
 currentPage: safePageIndex + 1,
 totalPages: Math.max(1, totalPages),
 onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
 };

 const exportConfig = {
 filenamePrefix: 'ipaddresspools',
 resourceLabel: 'IPAddressPools',
 getExportData: (v: IPAddressPool) => ({ name: v.name, namespace: v.namespace, addresses: v.addresses, assigned: v.assigned, available: v.available, age: v.age }),
 csvColumns: [
 { label: 'Name', getValue: (v) => v.name },
 { label: 'Namespace', getValue: (v) => v.namespace },
 { label: 'Addresses', getValue: (v) => v.addresses },
 { label: 'Assigned', getValue: (v) => v.assigned },
 { label: 'Available', getValue: (v) => v.available },
 { label: 'Age', getValue: (v) => v.age },
 ],
 toK8sYaml: () => 'IPAddressPools define MetalLB IP ranges for LoadBalancer services.',
 };

 return (
 <div className="space-y-6">
 <ListPageHeader
 icon={<Network className="h-6 w-6 text-primary" />}
 title="IP Address Pools"
 resourceCount={filteredItems.length}
 subtitle="MetalLB · IP ranges for LoadBalancer services"
 demoMode={!isConnected}
 dataUpdatedAt={dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 actions={
 <>
 <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={itemKey} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected pools' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
 <ListPageStatCard label="Total" value={stats.total} icon={Network} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard
 label="With Assigned IPs"
 value={stats.withAssigned}
 icon={Network}
 iconColor="text-muted-foreground"
 valueClassName={stats.withAssigned > 0 ? 'text-muted-foreground' : undefined}
 selected={columnFilters.hasAssigned?.size === 1 && columnFilters.hasAssigned.has('Yes')}
 onClick={() =>
 setColumnFilter(
 'hasAssigned',
 columnFilters.hasAssigned?.size === 1 && columnFilters.hasAssigned.has('Yes') ? null : new Set(['Yes'])
 )
 }
 className={cn(columnFilters.hasAssigned?.size === 1 && columnFilters.hasAssigned.has('Yes') && 'ring-2 ring-primary')}
 isLoading={isLoading} />
 </div>

 <BulkActionBar
 selectedCount={selectedItems.size}
 resourceName="IP address pool"
 resourceType="ipaddresspools"
 onClearSelection={() => multiSelect.clearSelection()}
 onBulkDelete={handleBulkDelete}
 onBulkLabel={handleBulkLabel}
 />

 <ResourceListTableToolbar
 globalFilterBar={
 <ResourceCommandBar
 scope={
 <div className="flex items-center gap-2">
 <span className="text-sm text-muted-foreground">Namespace</span>
 <select
 value={namespaceFilter}
 onChange={(e) => { setNamespaceFilter(e.target.value); setPageIndex(0); }}
 className="h-9 rounded-md border border-input bg-background px-3 text-sm"
 >
 <option value="">All</option>
 {namespaces.map((ns) => (
 <option key={ns} value={ns}>{ns}</option>
 ))}
 </select>
 </div>
 }
 search={
 <div className="relative w-full min-w-0">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input placeholder="Search IP address pools..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search IP address pools" />
 </div>
 }
 />
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={POOL_COLUMNS_FOR_VISIBILITY}
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
 <ListPagination hasPrev={pagination.hasPrev} hasNext={pagination.hasNext} onPrev={pagination.onPrev} onNext={pagination.onNext} rangeLabel={undefined} currentPage={pagination.currentPage} totalPages={pagination.totalPages} onPageChange={pagination.onPageChange} dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} />
 </div>
 }
 >
 <ResizableTableProvider tableId="ipaddresspools" columnConfig={POOL_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 800 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 {columnVisibility.isColumnVisible('namespace') && <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('addresses') && <ResizableTableHead columnId="addresses"><TableColumnHeaderWithFilterAndSort columnId="addresses" label="Addresses" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('assigned') && <ResizableTableHead columnId="assigned"><TableColumnHeaderWithFilterAndSort columnId="assigned" label="Assigned" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('available') && <ResizableTableHead columnId="available"><TableColumnHeaderWithFilterAndSort columnId="available" label="Available" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 {columnVisibility.isColumnVisible('namespace') && <ResizableTableCell columnId="namespace" className="p-1.5"><TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('addresses') && <ResizableTableCell columnId="addresses" className="p-1.5" />}
 {columnVisibility.isColumnVisible('assigned') && <ResizableTableCell columnId="assigned" className="p-1.5" />}
 {columnVisibility.isColumnVisible('available') && <ResizableTableCell columnId="available" className="p-1.5" />}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={9} resourceName="IP address pools" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={9} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : itemsOnPage.length === 0 ? (
 <TableRow>
 <TableCell colSpan={9} className="h-40 text-center">
 <TableEmptyState
 icon={<Network className="h-8 w-8" />}
 title="No IP Address Pools found"
 subtitle={searchQuery || hasActiveFilters || namespaceFilter ? 'Clear filters to see resources.' : 'Install MetalLB and create IPAddressPool resources for bare-metal LoadBalancer services.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters || namespaceFilter)}
 onClearFilters={() => { setSearchQuery(''); setNamespaceFilter(''); clearAllFilters(); }}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((item, idx) => (
 <tr key={itemKey(item)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(itemKey(item)) && 'bg-primary/5')}>
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(item, e); }}><Checkbox checked={selectedItems.has(itemKey(item))} tabIndex={-1} aria-label={`Select ${item.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/ipaddresspools/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <Network className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate font-mono text-sm">{item.name}</span>
 </Link>
 </ResizableTableCell>
 {columnVisibility.isColumnVisible('namespace') && <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('addresses') && <ResizableTableCell columnId="addresses" className="font-mono text-xs truncate max-w-[260px]" title={item.addresses}>{item.addresses}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('assigned') && <ResizableTableCell columnId="assigned">{item.assigned}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('available') && <ResizableTableCell columnId="available">{item.available}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>}
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <CopyNameDropdownItem name={item.name} />
 <DropdownMenuItem onClick={() => navigate(`/ipaddresspools/${item.namespace}/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/ipaddresspools/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-rose-600" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
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

 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
 resourceType="IPAddressPool"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} IP address pools` : (deleteDialog.item?.name || '')}
 namespace={deleteDialog.item?.namespace}
 onConfirm={handleDelete}
 />
 </div>
 );
}
