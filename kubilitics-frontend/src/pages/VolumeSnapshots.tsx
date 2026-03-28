import { useState, useMemo, useEffect } from 'react';
import {
 Search, Filter, RefreshCw, MoreHorizontal, CheckCircle2, XCircle, Clock, Loader2, WifiOff, Plus,
 ChevronDown, ChevronRight, CheckSquare, Trash2, FileText, List, Layers, Camera,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ResizableTableProvider, ResizableTableHead, ResizableTableCell, type ResizableColumnConfig } from '@/components/ui/resizable-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { useK8sResourceList, useDeleteK8sResource, useCreateK8sResource, usePatchK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog, BulkActionBar, executeBulkOperation } from '@/components/resources';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import {
 ResourceCommandBar, ResourceExportDropdown, ListViewSegmentedControl, ListPagination, PAGE_SIZE_OPTIONS,
 ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, AgeCell, TableEmptyState, TableErrorState, ListPageLoadingShell,
 CopyNameDropdownItem, NamespaceBadge, resourceTableRowClassName, ROW_MOTION, StatusPill, ResourceListTableToolbar,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import type { StatusPillVariant } from '@/components/list';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { toast } from '@/components/ui/sonner';
import { VolumeSnapshotIcon } from '@/components/icons/KubernetesIcons';

interface VolumeSnapshotResource extends KubernetesResource {
 spec?: {
 source?: { persistentVolumeClaimName?: string; volumeSnapshotContentName?: string };
 volumeSnapshotClassName?: string;
 };
 status?: {
 readyToUse?: boolean;
 boundVolumeSnapshotContentName?: string;
 restoreSize?: string;
 creationTime?: string;
 error?: { message?: string };
 };
}

interface VolumeSnapshot {
 name: string;
 namespace: string;
 status: 'Ready' | 'Pending' | 'Failed';
 sourcePVC: string;
 snapshotClass: string;
 restoreSize: string;
 creationTime: string;
 age: string;
 creationTimestamp?: string;
}

const VS_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'status', defaultWidth: 150, minWidth: 100 },
 { id: 'sourcePVC', defaultWidth: 220, minWidth: 120 },
 { id: 'snapshotClass', defaultWidth: 160, minWidth: 100 },
 { id: 'restoreSize', defaultWidth: 130, minWidth: 90 },
 { id: 'creationTime', defaultWidth: 160, minWidth: 100 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const VS_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'status', label: 'Status' },
 { id: 'sourcePVC', label: 'Source PVC' },
 { id: 'snapshotClass', label: 'Snapshot Class' },
 { id: 'restoreSize', label: 'Restore Size' },
 { id: 'creationTime', label: 'Creation Time' },
 { id: 'age', label: 'Age' },
];

const vsStatusToVariant: Record<VolumeSnapshot['status'], StatusPillVariant> = {
 Ready: 'success',
 Pending: 'warning',
 Failed: 'destructive',
};

const vsStatusIcon: Record<VolumeSnapshot['status'], React.ComponentType<{ className?: string }>> = {
 Ready: CheckCircle2,
 Pending: Clock,
 Failed: XCircle,
};

function transformVS(resource: VolumeSnapshotResource): VolumeSnapshot {
 const spec = resource.spec ?? {};
 const status = resource.status ?? {};
 const source = spec.source ?? {};
 const pvcName = source.persistentVolumeClaimName ?? source.volumeSnapshotContentName ?? '-';
 const snapshotClass = spec.volumeSnapshotClassName ?? '-';
 const restoreSize = status.restoreSize ?? '-';
 const creationTime = status.creationTime ?? resource.metadata?.creationTimestamp ?? '-';
 let vsStatus: VolumeSnapshot['status'] = 'Pending';
 if (status.error?.message) vsStatus = 'Failed';
 else if (status.readyToUse === true) vsStatus = 'Ready';

 return {
 name: resource.metadata.name,
 namespace: resource.metadata.namespace ?? 'default',
 status: vsStatus,
 sourcePVC: pvcName,
 snapshotClass,
 restoreSize,
 creationTime,
 age: calculateAge(resource.metadata.creationTimestamp),
 creationTimestamp: resource.metadata?.creationTimestamp,
 };
}

type ListView = 'flat' | 'byNamespace';

export default function VolumeSnapshots() {
 const navigate = useNavigate();
 const [searchQuery, setSearchQuery] = useState('');
 const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: VolumeSnapshot | null; bulk?: boolean }>({ open: false, item: null });
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [listView, setListView] = useState<ListView>('flat');
 const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
 const multiSelect = useMultiSelect();
 const selectedItems = multiSelect.selectedIds;
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<VolumeSnapshotResource>('volumesnapshots', undefined, { limit: 5000 });
 const deleteResource = useDeleteK8sResource('volumesnapshots');
 const createResource = useCreateK8sResource('volumesnapshots');
 const patchResource = usePatchK8sResource('volumesnapshots');

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const items: VolumeSnapshot[] = isConnected && data ? (data.items ?? []).map(transformVS) : [];

 const stats = useMemo(() => ({
 total: items.length,
 ready: items.filter((i) => i.status === 'Ready').length,
 pending: items.filter((i) => i.status === 'Pending').length,
 failed: items.filter((i) => i.status === 'Failed').length,
 }), [items]);

 const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.namespace))).sort()], [items]);

 const itemsAfterSearchAndNs = useMemo(() =>
 items.filter((item) => {
 const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
 item.namespace.toLowerCase().includes(searchQuery.toLowerCase()) ||
 item.sourcePVC.toLowerCase().includes(searchQuery.toLowerCase());
 const matchesNs = selectedNamespace === 'all' || item.namespace === selectedNamespace;
 return matchesSearch && matchesNs;
 }), [items, searchQuery, selectedNamespace]);

 const vsColumnConfig: ColumnConfig<VolumeSnapshot>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
 { columnId: 'status', getValue: (i) => i.status, sortable: true, filterable: true },
 { columnId: 'sourcePVC', getValue: (i) => i.sourcePVC, sortable: true, filterable: false },
 { columnId: 'snapshotClass', getValue: (i) => i.snapshotClass, sortable: true, filterable: false },
 { columnId: 'restoreSize', getValue: (i) => i.restoreSize, sortable: true, filterable: false },
 { columnId: 'creationTime', getValue: (i) => i.creationTime, sortable: true, filterable: false },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearchAndNs, { columns: vsColumnConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'volumesnapshots', columns: VS_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

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
 const map = new Map<string, VolumeSnapshot[]>();
 for (const item of itemsOnPage) {
 const list = map.get(item.namespace) ?? [];
 list.push(item);
 map.set(item.namespace, list);
 }
 return Array.from(map.entries())
 .map(([label, list]) => ({ groupKey: `ns:${label}`, label, list }))
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

 const allKeys = useMemo(() => itemsOnPage.map(i => `${i.namespace}/${i.name}`), [itemsOnPage]);

 const toggleSelection = (item: VolumeSnapshot, event?: React.MouseEvent) => {
 const key = `${item.namespace}/${item.name}`;
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
 await deleteResource.mutateAsync({ name, namespace: ns });
 });
 };

 const handleBulkLabel = async (label: string) => {
 return executeBulkOperation(Array.from(selectedItems), async (_key, ns, name) => {
 await patchResource.mutateAsync({
 name,
 namespace: ns,
 patch: { metadata: { labels: { [label.split("=")[0]]: label.split("=")[1] } } },
 });
 });
 };

 const handleDelete = async () => {
 if (!isConnected) { toast.error('Connect cluster to delete volume snapshots'); return; }
 if (deleteDialog.bulk && selectedItems.size > 0) {
 for (const key of selectedItems) {
 const [ns, n] = key.split('/');
 if (ns && n) await deleteResource.mutateAsync({ name: n, namespace: ns });
 }
 toast.success(`Deleted ${selectedItems.size} volume snapshot(s)`);
 multiSelect.clearSelection();
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
 toast.success(`VolumeSnapshot ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 };

 const exportConfig = {
 filenamePrefix: 'volumesnapshots',
 resourceLabel: 'volume snapshots',
 getExportData: (d: VolumeSnapshot) => ({ name: d.name, namespace: d.namespace, status: d.status, sourcePVC: d.sourcePVC, snapshotClass: d.snapshotClass, restoreSize: d.restoreSize, age: d.age }),
 csvColumns: [
 { label: 'Name', getValue: (d: VolumeSnapshot) => d.name },
 { label: 'Namespace', getValue: (d: VolumeSnapshot) => d.namespace },
 { label: 'Status', getValue: (d: VolumeSnapshot) => d.status },
 { label: 'Source PVC', getValue: (d: VolumeSnapshot) => d.sourcePVC },
 { label: 'Snapshot Class', getValue: (d: VolumeSnapshot) => d.snapshotClass },
 { label: 'Restore Size', getValue: (d: VolumeSnapshot) => d.restoreSize },
 { label: 'Age', getValue: (d: VolumeSnapshot) => d.age },
 ],
 toK8sYaml: (d: VolumeSnapshot) => `---
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
 name: ${d.name}
 namespace: ${d.namespace}
spec:
 source:
 persistentVolumeClaimName: ""
 volumeSnapshotClassName: ""
`,
 };

 const pagination = {
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No volume snapshots',
 hasPrev: safePageIndex > 0,
 hasNext: start + pageSize < totalFiltered,
 onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
 onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
 currentPage: safePageIndex + 1,
 totalPages: Math.max(1, totalPages),
 onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
 };

 const renderRow = (item: VolumeSnapshot, idx: number) => {
 const key = `${item.namespace}/${item.name}`;
 const isSelected = selectedItems.has(key);
 const StatusIcon = vsStatusIcon[item.status];
 const sourceIsPVC = item.sourcePVC !== '-' && !item.sourcePVC.includes('snapshotcontent');
 return (
 <tr key={key} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(item, e); }}><Checkbox checked={isSelected} tabIndex={-1} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/volumesnapshots/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <VolumeSnapshotIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 </Link>
 </ResizableTableCell>
 {columnVisibility.isColumnVisible('namespace') && <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} className="font-normal truncate block w-fit max-w-full" /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('status') && <ResizableTableCell columnId="status"><StatusPill label={item.status} variant={vsStatusToVariant[item.status]} icon={StatusIcon} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('sourcePVC') && (
 <ResizableTableCell columnId="sourcePVC">
 {sourceIsPVC ? (
 <Link to={`/persistentvolumeclaims/${item.namespace}/${item.sourcePVC}`} className="text-primary hover:underline truncate block">{item.sourcePVC}</Link>
 ) : (
 <span className="text-muted-foreground truncate block">{item.sourcePVC}</span>
 )}
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('snapshotClass') && <ResizableTableCell columnId="snapshotClass" className="font-mono text-sm truncate" title={item.snapshotClass}>{item.snapshotClass}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('restoreSize') && <ResizableTableCell columnId="restoreSize" className="font-mono text-sm">{item.restoreSize}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('creationTime') && <ResizableTableCell columnId="creationTime" className="text-muted-foreground text-sm">{item.creationTime !== '-' ? new Date(item.creationTime).toLocaleString() : '-'}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>}
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <CopyNameDropdownItem name={item.name} namespace={item.namespace} />
 <DropdownMenuItem onClick={() => navigate(`/volumesnapshots/${item.namespace}/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/volumesnapshots/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-rose-600" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </tr>
 );
 };

 return (
 <div className="space-y-6">
 <ListPageHeader
 icon={<VolumeSnapshotIcon className="h-6 w-6 text-primary" />}
 title="Volume Snapshots"
 resourceCount={filteredItems.length}
 subtitle={namespaces.length > 1 ? `across ${namespaces.length - 1} namespaces` : undefined}
 demoMode={!isConnected}
 dataUpdatedAt={dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create VolumeSnapshot"
 onCreate={() => setShowCreateWizard(true)}
 actions={
 <>
 <ResourceExportDropdown
 items={filteredItems}
 selectedKeys={selectedItems}
 getKey={(i) => `${i.namespace}/${i.name}`}
 config={exportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected volume snapshots' : 'All visible'}
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
 <ListPageStatCard label="Total" value={stats.total} icon={Camera} iconColor="text-primary" selected={!columnFilters.status?.size} onClick={() => setColumnFilter('status', null)} className={cn(!columnFilters.status?.size && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Ready" value={stats.ready} icon={CheckCircle2} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Ready')} onClick={() => setColumnFilter('status', new Set(['Ready']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Ready') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard label="Pending" value={stats.pending} icon={Clock} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Pending')} onClick={() => setColumnFilter('status', new Set(['Pending']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Pending') && 'ring-2 ring-amber-500')} isLoading={isLoading} />
 <ListPageStatCard label="Failed" value={stats.failed} icon={XCircle} iconColor="text-rose-600" valueClassName="text-rose-600" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Failed')} onClick={() => setColumnFilter('status', new Set(['Failed']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Failed') && 'ring-2 ring-rose-500')} isLoading={isLoading} />
 </div>

 <BulkActionBar
 selectedCount={selectedItems.size}
 resourceName="volume snapshot"
 resourceType="volumesnapshots"
 onClearSelection={() => multiSelect.clearSelection()}
 onBulkDelete={handleBulkDelete}
 onBulkLabel={handleBulkLabel}
 />

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
 <Input placeholder="Search volume snapshots..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all" />
 </div>
 }
 structure={<ListViewSegmentedControl value={listView} onChange={(v) => setListView(v as ListView)} options={[{ id: 'flat', label: 'Flat', icon: List }, { id: 'byNamespace', label: 'By Namespace', icon: Layers }]} label="" ariaLabel="List structure" />}
 />
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={VS_COLUMNS_FOR_VISIBILITY}
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
 <ResizableTableProvider tableId="volumesnapshots" columnConfig={VS_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 1240 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 {columnVisibility.isColumnVisible('namespace') && <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('status') && <ResizableTableHead columnId="status"><TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('sourcePVC') && <ResizableTableHead columnId="sourcePVC"><TableColumnHeaderWithFilterAndSort columnId="sourcePVC" label="Source PVC" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('snapshotClass') && <ResizableTableHead columnId="snapshotClass"><TableColumnHeaderWithFilterAndSort columnId="snapshotClass" label="Snapshot Class" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('restoreSize') && <ResizableTableHead columnId="restoreSize"><TableColumnHeaderWithFilterAndSort columnId="restoreSize" label="Restore Size" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('creationTime') && <ResizableTableHead columnId="creationTime"><TableColumnHeaderWithFilterAndSort columnId="creationTime" label="Creation Time" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 {columnVisibility.isColumnVisible('namespace') && <ResizableTableCell columnId="namespace" className="p-1.5"><TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('status') && <ResizableTableCell columnId="status" className="p-1.5"><TableFilterCell columnId="status" label="Status" distinctValues={distinctValuesByColumn.status ?? []} selectedFilterValues={columnFilters.status ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.status} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('sourcePVC') && <ResizableTableCell columnId="sourcePVC" className="p-1.5" />}
 {columnVisibility.isColumnVisible('snapshotClass') && <ResizableTableCell columnId="snapshotClass" className="p-1.5" />}
 {columnVisibility.isColumnVisible('restoreSize') && <ResizableTableCell columnId="restoreSize" className="p-1.5" />}
 {columnVisibility.isColumnVisible('creationTime') && <ResizableTableCell columnId="creationTime" className="p-1.5" />}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={11} resourceName="volume snapshots" isLoading={isLoading} onRetry={() => refetch()} />
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
 icon={<Camera className="h-8 w-8" />}
 title="No Volume Snapshots found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Volume Snapshots require the CSI snapshot controller. Create one from a PVC.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create VolumeSnapshot"
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
 <TableRow key={group.groupKey} className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-b border-border/60" onClick={() => toggleGroup(group.groupKey)}>
 <TableCell colSpan={11} className="py-2">
 <div className="flex items-center gap-2 font-medium">
 {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
 Namespace: {group.label}
 <span className="text-muted-foreground font-normal">({group.list.length})</span>
 </div>
 </TableCell>
 </TableRow>,
 ...(isCollapsed ? [] : group.list.map((item, idx) => renderRow(item, idx))),
 ];
 })
 )}
 </TableBody>
 </Table>
 </ResizableTableProvider>
 </ResourceListTableToolbar>

 {showCreateWizard && (
 <ResourceCreator
 resourceKind="VolumeSnapshot"
 defaultYaml={DEFAULT_YAMLS.VolumeSnapshot}
 onClose={() => setShowCreateWizard(false)}
 onApply={async (yaml) => {
 if (!isConnected) { toast.error('Connect cluster to create volume snapshot'); return; }
 try {
 await createResource.mutateAsync({ yaml });
 toast.success('VolumeSnapshot created successfully');
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
 resourceType="VolumeSnapshot"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} volume snapshots` : (deleteDialog.item?.name || '')}
 namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace}
 onConfirm={handleDelete}
 />
 </div>
 );
}
