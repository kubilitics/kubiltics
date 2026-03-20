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
import { usePaginatedResourceList, useDeleteK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog } from '@/components/resources';
import { toast } from 'sonner';

interface BGPPeer {
 name: string;
 namespace: string;
 peerAddress: string;
 peerASN: string;
 myASN: string;
 age: string;
 creationTimestamp?: string;
}

interface K8sBGPPeer extends KubernetesResource {
 spec?: { peerAddress?: string; peerASN?: number; myASN?: number };
}

function mapPeer(p: K8sBGPPeer): BGPPeer {
 return {
 name: p.metadata?.name ?? '',
 namespace: p.metadata?.namespace ?? '',
 peerAddress: p.spec?.peerAddress ?? '—',
 peerASN: p.spec?.peerASN != null ? String(p.spec.peerASN) : '—',
 myASN: p.spec?.myASN != null ? String(p.spec.myASN) : '—',
 age: calculateAge(p.metadata?.creationTimestamp),
 creationTimestamp: p.metadata?.creationTimestamp,
 };
}

const PEER_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'peerAddress', defaultWidth: 160, minWidth: 120 },
 { id: 'peerASN', defaultWidth: 100, minWidth: 70 },
 { id: 'myASN', defaultWidth: 100, minWidth: 70 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const PEER_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'peerAddress', label: 'Peer Address' },
 { id: 'peerASN', label: 'Peer ASN' },
 { id: 'myASN', label: 'My ASN' },
 { id: 'age', label: 'Age' },
];

export default function BGPPeers() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = usePaginatedResourceList<K8sBGPPeer>('bgppeers');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: BGPPeer | null; bulk?: boolean }>({ open: false, item: null });
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [searchQuery, setSearchQuery] = useState('');
 const [namespaceFilter, setNamespaceFilter] = useState<string>('');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);
 const deletePeer = useDeleteK8sResource('bgppeers');

 const allItems = (data?.allItems ?? []) as K8sBGPPeer[];
 const items: BGPPeer[] = useMemo(() => (isConnected ? allItems.map(mapPeer) : []), [isConnected, allItems]);

 const namespaces = useMemo(() => [...new Set(items.map((i) => i.namespace).filter(Boolean))].sort(), [items]);

 const stats = useMemo(() => ({ total: items.length }), [items]);

 const itemsFiltered = useMemo(() => {
 let out = items;
 if (namespaceFilter) out = out.filter((i) => i.namespace === namespaceFilter);
 if (searchQuery) {
 const q = searchQuery.toLowerCase();
 out = out.filter((i) =>
 i.name.toLowerCase().includes(q) ||
 i.namespace.toLowerCase().includes(q) ||
 i.peerAddress.toLowerCase().includes(q)
 );
 }
 return out;
 }, [items, namespaceFilter, searchQuery]);

 const tableConfig: ColumnConfig<BGPPeer>[] = useMemo(
 () => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
 { columnId: 'peerAddress', getValue: (i) => i.peerAddress, sortable: true, filterable: false },
 { columnId: 'peerASN', getValue: (i) => i.peerASN, sortable: true, filterable: false },
 { columnId: 'myASN', getValue: (i) => i.myASN, sortable: true, filterable: false },
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
 const columnVisibility = useColumnVisibility({ tableId: 'bgppeers', columns: PEER_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

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
 const [ns, name] = key.split('::');
 await deletePeer.mutateAsync({ name, namespace: ns });
 }
 toast.success(`Deleted ${selectedItems.size} BGP peer(s)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deletePeer.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
 toast.success(`BGPPeer ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const itemKey = (i: BGPPeer) => `${i.namespace}::${i.name}`;
 const toggleSelection = (i: BGPPeer) => {
 const next = new Set(selectedItems);
 const k = itemKey(i);
 if (next.has(k)) next.delete(k);
 else next.add(k);
 setSelectedItems(next);
 };
 const toggleAll = () => {
 if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
 else setSelectedItems(new Set(itemsOnPage.map(itemKey)));
 };
 const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
 const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

 const pagination = {
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No BGP peers',
 hasPrev: safePageIndex > 0,
 hasNext: start + pageSize < totalFiltered,
 onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
 onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
 currentPage: safePageIndex + 1,
 totalPages: Math.max(1, totalPages),
 onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
 };

 const exportConfig = {
 filenamePrefix: 'bgppeers',
 resourceLabel: 'BGPPeers',
 getExportData: (v: BGPPeer) => ({ name: v.name, namespace: v.namespace, peerAddress: v.peerAddress, peerASN: v.peerASN, myASN: v.myASN, age: v.age }),
 csvColumns: [
 { label: 'Name', getValue: (v) => v.name },
 { label: 'Namespace', getValue: (v) => v.namespace },
 { label: 'Peer Address', getValue: (v) => v.peerAddress },
 { label: 'Peer ASN', getValue: (v) => v.peerASN },
 { label: 'My ASN', getValue: (v) => v.myASN },
 { label: 'Age', getValue: (v) => v.age },
 ],
 toK8sYaml: () => 'BGPPeers configure MetalLB BGP sessions to external routers.',
 };

 return (
 <div className="space-y-6">
 <ListPageHeader
 icon={<Network className="h-6 w-6 text-primary" />}
 title="BGP Peers"
 resourceCount={filteredItems.length}
 subtitle="MetalLB · BGP router connections"
 demoMode={!isConnected}
 dataUpdatedAt={dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 actions={
 <>
 <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={itemKey} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected peers' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
 <ListPageStatCard label="Total" value={stats.total} icon={Network} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 </div>

 {selectedItems.size > 0 && (
 <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
 <Badge variant="secondary" className="gap-1.5">
 <CheckSquare className="h-3.5 w-3.5" />
 {selectedItems.size} selected
 </Badge>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={itemKey} config={exportConfig} selectionLabel="Selected peers" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
 <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
 <Trash2 className="h-3.5 w-3.5" />
 Delete selected
 </Button>
 <Button variant="ghost" size="sm" onClick={() => setSelectedItems(new Set())}>Clear</Button>
 </div>
 </div>
 )}

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
 <Input placeholder="Search BGP peers..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search BGP peers" />
 </div>
 }
 />
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={PEER_COLUMNS_FOR_VISIBILITY}
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
 <ResizableTableProvider tableId="bgppeers" columnConfig={PEER_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 720 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 {columnVisibility.isColumnVisible('namespace') && <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('peerAddress') && <ResizableTableHead columnId="peerAddress"><TableColumnHeaderWithFilterAndSort columnId="peerAddress" label="Peer Address" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('peerASN') && <ResizableTableHead columnId="peerASN"><TableColumnHeaderWithFilterAndSort columnId="peerASN" label="Peer ASN" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('myASN') && <ResizableTableHead columnId="myASN"><TableColumnHeaderWithFilterAndSort columnId="myASN" label="My ASN" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 {columnVisibility.isColumnVisible('namespace') && <ResizableTableCell columnId="namespace" className="p-1.5"><TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('peerAddress') && <ResizableTableCell columnId="peerAddress" className="p-1.5" />}
 {columnVisibility.isColumnVisible('peerASN') && <ResizableTableCell columnId="peerASN" className="p-1.5" />}
 {columnVisibility.isColumnVisible('myASN') && <ResizableTableCell columnId="myASN" className="p-1.5" />}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={9} resourceName="BGP peers" isLoading={isLoading} onRetry={() => refetch()} />
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
 title="No BGP Peers found"
 subtitle={searchQuery || hasActiveFilters || namespaceFilter ? 'Clear filters to see resources.' : 'Install MetalLB and create BGPPeer resources for BGP mode.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters || namespaceFilter)}
 onClearFilters={() => { setSearchQuery(''); setNamespaceFilter(''); clearAllFilters(); }}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((item, idx) => (
 <tr key={itemKey(item)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(itemKey(item)) && 'bg-primary/5')}>
 <TableCell><Checkbox checked={selectedItems.has(itemKey(item))} onCheckedChange={() => toggleSelection(item)} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/bgppeers/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <Network className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate font-mono text-sm">{item.name}</span>
 </Link>
 </ResizableTableCell>
 {columnVisibility.isColumnVisible('namespace') && <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('peerAddress') && <ResizableTableCell columnId="peerAddress" className="font-mono text-sm">{item.peerAddress}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('peerASN') && <ResizableTableCell columnId="peerASN">{item.peerASN}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('myASN') && <ResizableTableCell columnId="myASN">{item.myASN}</ResizableTableCell>}
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
 <DropdownMenuItem onClick={() => navigate(`/bgppeers/${item.namespace}/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/bgppeers/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
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
 resourceType="BGPPeer"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} BGP peers` : (deleteDialog.item?.name || '')}
 namespace={deleteDialog.item?.namespace}
 onConfirm={handleDelete}
 />
 </div>
 );
}
