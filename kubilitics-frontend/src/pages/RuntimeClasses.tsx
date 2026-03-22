import { useState, useMemo, useEffect } from 'react';
import {
 RefreshCw, MoreHorizontal, CheckCircle2, XCircle, Clock, Loader2, WifiOff, Plus,
 Trash2, FileText, Search, FolderCog, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ResizableTableProvider, ResizableTableHead, ResizableTableCell, type ResizableColumnConfig } from '@/components/ui/resizable-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { useK8sResourceList, useDeleteK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog } from '@/components/resources';
import {
 ResourceCommandBar, ClusterScopedScope, ResourceExportDropdown,
 StatusPill, resourceTableRowClassName, ROW_MOTION, ListPagination, ListPageStatCard,
 TableColumnHeaderWithFilterAndSort, PAGE_SIZE_OPTIONS,
 AgeCell, TableEmptyState, TableErrorState, ListPageLoadingShell, ResourceListTableToolbar,
 TableFilterCell,
 type StatusPillVariant,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { ResourceCreator } from '@/components/editor';
import { toast } from 'sonner';

interface RuntimeClassResource extends KubernetesResource {
 handler?: string;
 overhead?: {
 podFixed?: {
 cpu?: string;
 memory?: string;
 };
 };
 scheduling?: {
 nodeSelector?: Record<string, string>;
 tolerations?: unknown[];
 };
}

type RuntimeClassCategory = 'With Overhead' | 'With Scheduling' | 'Standard';

interface RuntimeClass {
 name: string;
 handler: string;
 overheadCpu: string;
 overheadMemory: string;
 schedulingCount: number;
 age: string;
 creationTimestamp?: string;
 hasOverhead: boolean;
 hasScheduling: boolean;
 category: RuntimeClassCategory;
}

const RC_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'handler', defaultWidth: 160, minWidth: 100 },
 { id: 'overheadCpu', defaultWidth: 130, minWidth: 90 },
 { id: 'overheadMemory', defaultWidth: 130, minWidth: 90 },
 { id: 'scheduling', defaultWidth: 160, minWidth: 100 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const RC_COLUMNS_FOR_VISIBILITY = [
 { id: 'handler', label: 'Handler' },
 { id: 'overheadCpu', label: 'Overhead CPU' },
 { id: 'overheadMemory', label: 'Overhead Memory' },
 { id: 'scheduling', label: 'Scheduling' },
 { id: 'age', label: 'Age' },
];

function transformRuntimeClass(resource: RuntimeClassResource): RuntimeClass {
 const overheadCpu = resource.overhead?.podFixed?.cpu ?? '-';
 const overheadMemory = resource.overhead?.podFixed?.memory ?? '-';
 const nodeSelector = resource.scheduling?.nodeSelector ?? {};
 const schedulingCount = Object.keys(nodeSelector).length;
 const hasOverhead = overheadCpu !== '-' || overheadMemory !== '-';
 const hasScheduling = schedulingCount > 0;
 let category: RuntimeClassCategory = 'Standard';
 if (hasOverhead) category = 'With Overhead';
 else if (hasScheduling) category = 'With Scheduling';

 return {
 name: resource.metadata.name,
 handler: resource.handler ?? '-',
 overheadCpu,
 overheadMemory,
 schedulingCount,
 age: calculateAge(resource.metadata.creationTimestamp),
 creationTimestamp: resource.metadata?.creationTimestamp,
 hasOverhead,
 hasScheduling,
 category,
 };
}

const RuntimeClassYaml = `apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
 name: ''
handler: ''
`;

export default function RuntimeClasses() {
 const navigate = useNavigate();
 const [searchQuery, setSearchQuery] = useState('');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: RuntimeClass | null; bulk?: boolean }>({ open: false, item: null });
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<RuntimeClassResource>('runtimeclasses', undefined, { limit: 5000 });
 const deleteResource = useDeleteK8sResource('runtimeclasses');

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const items: RuntimeClass[] = isConnected && data
 ? (data.items ?? []).map(transformRuntimeClass)
 : [];

 const stats = useMemo(() => ({
 total: items.length,
 withOverhead: items.filter((i) => i.hasOverhead).length,
 withScheduling: items.filter((i) => i.hasScheduling).length,
 standard: items.filter((i) => !i.hasOverhead && !i.hasScheduling).length,
 }), [items]);

 const itemsAfterSearch = useMemo(() =>
 items.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
 item.handler.toLowerCase().includes(searchQuery.toLowerCase())),
 [items, searchQuery]);

 const rcColumnConfig: ColumnConfig<RuntimeClass>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'handler', getValue: (i) => i.handler, sortable: true, filterable: false },
 { columnId: 'overheadCpu', getValue: (i) => i.overheadCpu, sortable: false, filterable: false },
 { columnId: 'overheadMemory', getValue: (i) => i.overheadMemory, sortable: false, filterable: false },
 { columnId: 'scheduling', getValue: (i) => i.schedulingCount, sortable: true, filterable: false },
 { columnId: 'category', getValue: (i) => i.category, sortable: false, filterable: true },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearch, { columns: rcColumnConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'runtimeclasses', columns: RC_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const totalFiltered = filteredItems.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredItems.slice(start, start + pageSize);

 useEffect(() => {
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [safePageIndex, pageIndex]);

 const setCategoryFilter = (value: RuntimeClassCategory | null) => {
 setColumnFilter('category', value == null ? null : new Set([value]));
 };

 const toggleSelection = (item: RuntimeClass) => {
 const newSel = new Set(selectedItems);
 if (newSel.has(item.name)) newSel.delete(item.name); else newSel.add(item.name);
 setSelectedItems(newSel);
 };

 const toggleAll = () => {
 if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
 else setSelectedItems(new Set(itemsOnPage.map((i) => i.name)));
 };

 const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
 const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

 const handleDelete = async () => {
 if (!isConnected) { toast.error('Connect cluster to delete runtime classes'); return; }
 if (deleteDialog.bulk && selectedItems.size > 0) {
 for (const name of selectedItems) {
 await deleteResource.mutateAsync({ name, namespace: '' });
 }
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: '' });
 }
 setDeleteDialog({ open: false, item: null });
 };

 const exportConfig = {
 filenamePrefix: 'runtimeclasses',
 resourceLabel: 'runtime classes',
 getExportData: (d: RuntimeClass) => ({ name: d.name, handler: d.handler, overheadCpu: d.overheadCpu, overheadMemory: d.overheadMemory, schedulingCount: d.schedulingCount, age: d.age }),
 csvColumns: [
 { label: 'Name', getValue: (d: RuntimeClass) => d.name },
 { label: 'Handler', getValue: (d: RuntimeClass) => d.handler },
 { label: 'Overhead CPU', getValue: (d: RuntimeClass) => d.overheadCpu },
 { label: 'Overhead Memory', getValue: (d: RuntimeClass) => d.overheadMemory },
 { label: 'Scheduling', getValue: (d: RuntimeClass) => d.schedulingCount },
 { label: 'Age', getValue: (d: RuntimeClass) => d.age },
 ],
 toK8sYaml: (d: RuntimeClass) => `---
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
 name: ${d.name}
handler: ${d.handler}
`,
 };

 const pagination = {
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No runtime classes',
 hasPrev: safePageIndex > 0,
 hasNext: start + pageSize < totalFiltered,
 onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
 onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
 currentPage: safePageIndex + 1,
 totalPages: Math.max(1, totalPages),
 onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
 dataUpdatedAt,
 isFetching,
 };

 return (
 <div className="space-y-6">
 <div className="flex items-center justify-between flex-wrap gap-4">
 <div className="flex items-center gap-3 flex-wrap">
 <div className="p-2.5 rounded-xl bg-primary/10"><FolderCog className="h-6 w-6 text-primary" /></div>
 <div>
 <h1 className="text-2xl font-semibold tracking-tight">Runtime Classes</h1>
 <p className="text-sm text-muted-foreground">
 {filteredItems.length} runtime classes (cluster-scoped)
 {!isConnected && <span className="ml-2 inline-flex items-center gap-1 text-amber-600"><WifiOff className="h-3 w-3" /> Connect cluster</span>}
 </p>
 </div>
 {selectedItems.size > 0 && (
 <div className="flex items-center gap-2 ml-2 pl-2 border-l border-border">
 <span className="text-sm text-muted-foreground">{selectedItems.size} selected</span>
 <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelectedItems(new Set())}>Clear</Button>
 </div>
 )}
 </div>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown
 items={filteredItems}
 selectedKeys={selectedItems}
 getKey={(i) => i.name}
 config={exportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected runtime classes' : 'All visible'}
 onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
 />
 {selectedItems.size > 0 && (
 <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}><Trash2 className="h-4 w-4" />Delete</Button>
 )}
 <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => refetch()} disabled={isLoading}>{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</Button>
 <Button className="gap-2" onClick={() => setShowCreateWizard(true)}><Plus className="h-4 w-4" />Create</Button>
 </div>
 </div>

 <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
 <ListPageStatCard label="Total" value={stats.total} icon={FolderCog} iconColor="text-primary" selected={!columnFilters.category?.size} onClick={() => setCategoryFilter(null)} className={cn(!columnFilters.category?.size && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="With Overhead" value={stats.withOverhead} icon={CheckCircle2} iconColor="text-purple-500" valueClassName="text-purple-600" selected={columnFilters.category?.size === 1 && columnFilters.category.has('With Overhead')} onClick={() => setCategoryFilter(columnFilters.category?.has('With Overhead') ? null : 'With Overhead')} className={cn(columnFilters.category?.size === 1 && columnFilters.category.has('With Overhead') && 'ring-2 ring-purple-500')} isLoading={isLoading} />
 <ListPageStatCard label="With Scheduling" value={stats.withScheduling} icon={Clock} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.category?.size === 1 && columnFilters.category.has('With Scheduling')} onClick={() => setCategoryFilter(columnFilters.category?.has('With Scheduling') ? null : 'With Scheduling')} className={cn(columnFilters.category?.size === 1 && columnFilters.category.has('With Scheduling') && 'ring-2 ring-amber-500')} isLoading={isLoading} />
 <ListPageStatCard label="Standard" value={stats.standard} icon={XCircle} iconColor="text-muted-foreground" valueClassName="text-muted-foreground" selected={columnFilters.category?.size === 1 && columnFilters.category.has('Standard')} onClick={() => setCategoryFilter(columnFilters.category?.has('Standard') ? null : 'Standard')} className={cn(columnFilters.category?.size === 1 && columnFilters.category.has('Standard') && 'ring-2 ring-muted-foreground')} isLoading={isLoading} />
 </div>

 <ResourceListTableToolbar
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 globalFilterBar={
 <ResourceCommandBar
 scope={<ClusterScopedScope />}
 search={
 <div className="relative w-full min-w-0">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input placeholder="Search runtime classes..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all" />
 </div>
 }
 />
 }
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
 <ListPagination hasPrev={pagination.hasPrev} hasNext={pagination.hasNext} onPrev={pagination.onPrev} onNext={pagination.onNext} rangeLabel={undefined} currentPage={pagination.currentPage} totalPages={pagination.totalPages} onPageChange={pagination.onPageChange} dataUpdatedAt={pagination.dataUpdatedAt} isFetching={pagination.isFetching} />
 </div>
 }
 >
 <ResizableTableProvider tableId="runtimeclasses" columnConfig={RC_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 850 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="handler"><TableColumnHeaderWithFilterAndSort columnId="handler" label="Handler" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="overheadCpu"><TableColumnHeaderWithFilterAndSort columnId="overheadCpu" label="Overhead CPU" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="overheadMemory"><TableColumnHeaderWithFilterAndSort columnId="overheadMemory" label="Overhead Memory" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="scheduling"><TableColumnHeaderWithFilterAndSort columnId="scheduling" label="Scheduling" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="handler" className="p-1.5" />
 <ResizableTableCell columnId="overheadCpu" className="p-1.5" />
 <ResizableTableCell columnId="overheadMemory" className="p-1.5" />
 <ResizableTableCell columnId="scheduling" className="p-1.5"><TableFilterCell columnId="category" label="Category" distinctValues={distinctValuesByColumn.category ?? []} selectedFilterValues={columnFilters.category ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.category} /></ResizableTableCell>
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={8} resourceName="runtime classes" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={8} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : !isConnected ? (
 <TableRow><TableCell colSpan={8} className="h-32 text-center"><div className="flex flex-col items-center gap-2"><WifiOff className="h-8 w-8 opacity-50" /><p className="text-sm text-muted-foreground">Connect cluster to view runtime classes</p></div></TableCell></TableRow>
 ) : itemsOnPage.length === 0 ? (
 <TableRow>
 <TableCell colSpan={8} className="h-40 text-center">
 <TableEmptyState
 icon={<FolderCog className="h-8 w-8" />}
 title="No runtime classes found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Define runtime classes for different container runtimes (e.g. Kata, gVisor).'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create RuntimeClass"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((item, idx) => {
 const isSelected = selectedItems.has(item.name);
 return (
 <tr key={item.name} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
 <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(item)} /></TableCell>
 <ResizableTableCell columnId="name">
 <span className="font-medium flex items-center gap-2 truncate cursor-pointer text-primary hover:underline" onClick={() => navigate(`/runtimeclasses/${item.name}`)}>
 <FolderCog className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 </span>
 </ResizableTableCell>
 <ResizableTableCell columnId="handler">
 {item.handler !== '-' ? (
 <Badge variant="secondary" className="font-mono text-xs">{item.handler}</Badge>
 ) : <span className="text-muted-foreground text-xs">-</span>}
 </ResizableTableCell>
 <ResizableTableCell columnId="overheadCpu" className="font-mono text-xs">{item.overheadCpu}</ResizableTableCell>
 <ResizableTableCell columnId="overheadMemory" className="font-mono text-xs">{item.overheadMemory}</ResizableTableCell>
 <ResizableTableCell columnId="scheduling">
 {item.schedulingCount > 0 ? (
 <Badge variant="outline" className="font-mono text-xs">{item.schedulingCount} selector{item.schedulingCount !== 1 ? 's' : ''}</Badge>
 ) : <span className="text-muted-foreground text-xs">-</span>}
 </ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem onClick={() => navigate(`/runtimeclasses/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/runtimeclasses/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-rose-600" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </tr>
 );
 })
 )}
 </TableBody>
 </Table>
 </ResizableTableProvider>
 </ResourceListTableToolbar>

 {showCreateWizard && (
 <ResourceCreator
 resourceKind="RuntimeClass"
 defaultYaml={RuntimeClassYaml}
 onClose={() => setShowCreateWizard(false)}
 onApply={async (yaml) => {
 if (!isConnected) { toast.error('Connect cluster to create runtime classes'); return; }
 toast.success('RuntimeClass created successfully');
 setShowCreateWizard(false);
 refetch();
 }}
 />
 )}

 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
 resourceType="RuntimeClass"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} runtime classes` : (deleteDialog.item?.name || '')}
 namespace={undefined}
 onConfirm={handleDelete}
 />
 </div>
 );
}
