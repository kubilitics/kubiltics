import { useState, useMemo, useEffect } from 'react';
import { Activity, Search, RefreshCw, MoreHorizontal,
 WifiOff, ChevronDown, Plus, Filter, List, Layers, CheckSquare, Trash2 } from 'lucide-react';
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
 TableFilterCell,
 resourceTableRowClassName,
 ROW_MOTION,
 PAGE_SIZE_OPTIONS,
 AgeCell,
 TableEmptyState, ListPageLoadingShell, TableErrorState,
 CopyNameDropdownItem,
 ResourceListTableToolbar,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';

interface LeaseResource extends KubernetesResource {
 spec?: {
 holderIdentity?: string;
 leaseDurationSeconds?: number;
 acquireTime?: string;
 renewTime?: string;
 leaseTransitions?: number;
 };
}

interface Lease {
 id: string;
 name: string;
 namespace: string;
 holder: string;
 duration: string;
 age: string;
 creationTimestamp?: string;
 acquireTime: string;
 renewTime: string;
 leaseType: string;
 isHeld: boolean;
 isExpired: boolean;
}

function inferLeaseType(name: string, namespace: string): string {
 if (namespace === 'kube-system' && (name.startsWith('kube-') || name.includes('controller') || name.includes('scheduler'))) {
 return 'Leader election';
 }
 if (namespace === 'kube-node-lease') return 'Kubelet';
 return 'Custom';
}

function transformLease(item: LeaseResource): Lease {
 const holder = item.spec?.holderIdentity ?? '';
 const renewTime = item.spec?.renewTime;
 const now = Date.now();
 const renewMs = renewTime ? new Date(renewTime).getTime() : 0;
 const durationSec = item.spec?.leaseDurationSeconds;
 const isExpired = durationSec != null && renewMs > 0 && now - renewMs > durationSec * 1000;
 return {
 id: item.metadata.uid,
 name: item.metadata.name,
 namespace: item.metadata.namespace || 'default',
 holder: holder || '–',
 duration: durationSec != null ? `${durationSec}s` : '–',
 age: calculateAge(item.metadata.creationTimestamp),
 creationTimestamp: item.metadata?.creationTimestamp,
 acquireTime: item.spec?.acquireTime ? formatLeaseTime(item.spec.acquireTime) : '–',
 renewTime: item.spec?.renewTime ? formatLeaseTime(item.spec.renewTime) : '–',
 leaseType: inferLeaseType(item.metadata.name, item.metadata.namespace || ''),
 isHeld: !!holder,
 isExpired,
 };
}

function formatLeaseTime(iso: string): string {
 if (!iso) return '–';
 try {
 const d = new Date(iso);
 return d.toISOString();
 } catch {
 return iso;
 }
}

const LEASE_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'holder', defaultWidth: 160, minWidth: 100 },
 { id: 'acquireTime', defaultWidth: 160, minWidth: 100 },
 { id: 'renewTime', defaultWidth: 160, minWidth: 100 },
 { id: 'leaseType', defaultWidth: 160, minWidth: 100 },
 { id: 'duration', defaultWidth: 100, minWidth: 70 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const LEASE_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'holder', label: 'Holder' },
 { id: 'acquireTime', label: 'Acquire Time' },
 { id: 'renewTime', label: 'Renew Time' },
 { id: 'leaseType', label: 'Lease Type' },
 { id: 'duration', label: 'Duration' },
 { id: 'age', label: 'Age' },
];

export default function Leases() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, refetch, pagination: hookPagination } = usePaginatedResourceList<LeaseResource>('leases');
 const deleteResource = useDeleteK8sResource('leases');

 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: Lease | null; bulk?: boolean }>({ open: false, item: null });
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [showCreator, setShowCreator] = useState(false);
 const [searchQuery, setSearchQuery] = useState('');
 const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
 const [listView, setListView] = useState<'flat' | 'byNamespace'>('flat');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const allItems = useMemo(() => (data?.allItems ?? []) as LeaseResource[], [data?.allItems]);
 const items: Lease[] = useMemo(() => (isConnected ? allItems.map(transformLease) : []), [isConnected, allItems]);

 const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.namespace)))], [items]);
 const itemsAfterNs = useMemo(() => (selectedNamespace === 'all' ? items : items.filter((i) => i.namespace === selectedNamespace)), [items, selectedNamespace]);

 const tableConfig: ColumnConfig<Lease>[] = useMemo(
 () => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
 { columnId: 'holder', getValue: (i) => i.holder, sortable: true, filterable: false },
 { columnId: 'acquireTime', getValue: (i) => i.acquireTime, sortable: true, filterable: false },
 { columnId: 'renewTime', getValue: (i) => i.renewTime, sortable: true, filterable: false },
 { columnId: 'leaseType', getValue: (i) => i.leaseType, sortable: true, filterable: true },
 { columnId: 'leaseState', getValue: (i) => i.isExpired ? 'Expired' : i.isHeld ? 'Held' : 'Free', sortable: true, filterable: true },
 { columnId: 'duration', getValue: (i) => i.duration, sortable: true, filterable: false },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ],
 []
 );

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterNs, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'leases', columns: LEASE_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const searchFiltered = useMemo(() => {
 if (!searchQuery.trim()) return filteredItems;
 const q = searchQuery.toLowerCase();
 return filteredItems.filter((i) => i.name.toLowerCase().includes(q) || i.namespace.toLowerCase().includes(q) || i.holder.toLowerCase().includes(q));
 }, [filteredItems, searchQuery]);

 const stats = useMemo(() => {
 const total = items.length;
 const held = items.filter((i) => i.isHeld).length;
 const expired = items.filter((i) => i.isExpired).length;
 const leaderElection = items.filter((i) => i.leaseType === 'Leader election').length;
 return { total, held, expired, leaderElection };
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
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No leases',
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
 toast.success(`Deleted ${selectedItems.size} lease(s)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
 toast.success(`Lease ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const toggleSelection = (item: Lease) => {
 const key = `${item.namespace}/${item.name}`;
 const next = new Set(selectedItems);
 if (next.has(key)) next.delete(key);
 else next.add(key);
 setSelectedItems(next);
 };
 const toggleAll = () => {
 if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
 else setSelectedItems(new Set(itemsOnPage.map((i) => `${i.namespace}/${i.name}`)));
 };
 const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
 const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

 const exportConfig = {
 filenamePrefix: 'leases',
 resourceLabel: 'Leases',
 getExportData: (i: Lease) => ({ name: i.name, namespace: i.namespace, holder: i.holder, duration: i.duration, acquireTime: i.acquireTime, renewTime: i.renewTime, leaseType: i.leaseType, age: i.age }),
 csvColumns: [
 { label: 'Name', getValue: (i: Lease) => i.name },
 { label: 'Namespace', getValue: (i: Lease) => i.namespace },
 { label: 'Holder', getValue: (i: Lease) => i.holder },
 { label: 'Acquire Time', getValue: (i: Lease) => i.acquireTime },
 { label: 'Renew Time', getValue: (i: Lease) => i.renewTime },
 { label: 'Lease Type', getValue: (i: Lease) => i.leaseType },
 { label: 'Age', getValue: (i: Lease) => i.age },
 ],
 };

 if (showCreator) {
 return (
 <ResourceCreator
 resourceKind="Lease"
 defaultYaml={DEFAULT_YAMLS.Lease}
 onClose={() => setShowCreator(false)}
 onApply={() => {
 toast.success('Lease created');
 setShowCreator(false);
 refetch();
 }}
 />
 );
 }

 return (
 <>
 <div className="space-y-6">
 <ListPageHeader
 icon={<Activity className="h-6 w-6 text-primary" />}
 title="Leases"
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
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(i) => `${i.namespace}/${i.name}`} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected leases' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
 <ListPageStatCard label="Total Leases" value={stats.total} icon={Activity} iconColor="text-primary" isLoading={isLoading} />
 <ListPageStatCard label="Held" value={stats.held} icon={Activity} iconColor="text-emerald-600" isLoading={isLoading} />
 <ListPageStatCard label="Expired" value={stats.expired} icon={Activity} iconColor="text-rose-600" isLoading={isLoading} />
 <ListPageStatCard label="Leader Election" value={stats.leaderElection} icon={Activity} iconColor="text-muted-foreground" isLoading={isLoading} />
 </div>

 {/* Bulk Actions Bar */}
 {selectedItems.size > 0 && (
 <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
 <Badge variant="secondary" className="gap-1.5">
 <CheckSquare className="h-3.5 w-3.5" />
 {selectedItems.size} selected
 </Badge>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(i) => `${i.namespace}/${i.name}`} config={exportConfig} selectionLabel="Selected leases" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
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
 <Input placeholder="Search leases..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search leases" />
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
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={LEASE_COLUMNS_FOR_VISIBILITY}
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
 <ResizableTableProvider tableId="leases" columnConfig={LEASE_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 1000 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="holder"><TableColumnHeaderWithFilterAndSort columnId="holder" label="Holder" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="acquireTime"><TableColumnHeaderWithFilterAndSort columnId="acquireTime" label="Acquire Time" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="renewTime"><TableColumnHeaderWithFilterAndSort columnId="renewTime" label="Renew Time" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="leaseType"><TableColumnHeaderWithFilterAndSort columnId="leaseType" label="Lease Type" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="duration"><TableColumnHeaderWithFilterAndSort columnId="duration" label="Duration" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="namespace" className="p-1.5"><TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} /></ResizableTableCell>
 <ResizableTableCell columnId="holder" className="p-1.5" />
 <ResizableTableCell columnId="acquireTime" className="p-1.5" />
 <ResizableTableCell columnId="renewTime" className="p-1.5" />
 <ResizableTableCell columnId="leaseType" className="p-1.5"><TableFilterCell columnId="leaseType" label="Lease Type" distinctValues={distinctValuesByColumn.leaseType ?? []} selectedFilterValues={columnFilters.leaseType ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.leaseType} /></ResizableTableCell>
 <ResizableTableCell columnId="duration" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={10} resourceName="leases" isLoading={isLoading} onRetry={() => refetch()} />
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
 icon={<Activity className="h-8 w-8" />}
 title="No Leases found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Leases are used by control-plane components for leader election.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create Lease"
 onCreate={() => setShowCreator(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((item, idx) => (
 <tr key={item.id} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(`${item.namespace}/${item.name}`) && 'bg-primary/5')}>
 <TableCell><Checkbox checked={selectedItems.has(`${item.namespace}/${item.name}`)} onCheckedChange={() => toggleSelection(item)} aria-label={`Select ${item.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/leases/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <Activity className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 </Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="namespace">{item.namespace}</ResizableTableCell>
 <ResizableTableCell columnId="holder" className="font-mono text-sm">{item.holder}</ResizableTableCell>
 <ResizableTableCell columnId="acquireTime" className="text-muted-foreground text-sm whitespace-nowrap">{item.acquireTime}</ResizableTableCell>
 <ResizableTableCell columnId="renewTime" className="text-muted-foreground text-sm whitespace-nowrap">{item.renewTime}</ResizableTableCell>
 <ResizableTableCell columnId="leaseType">{item.leaseType}</ResizableTableCell>
 <ResizableTableCell columnId="duration" className="font-mono text-sm">{item.duration}</ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="Lease actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <CopyNameDropdownItem name={item.name} namespace={item.namespace} />
 <DropdownMenuItem onClick={() => navigate(`/leases/${item.namespace}/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/leases/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
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
 resourceType="Lease"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item ? `${deleteDialog.item.namespace}/${deleteDialog.item.name}` : '')}
 namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace}
 onConfirm={handleDelete}
 requireNameConfirmation={!deleteDialog.bulk}
 />
 </>
 );
}
