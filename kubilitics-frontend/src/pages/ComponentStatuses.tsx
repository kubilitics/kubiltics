import { useState, useMemo, useEffect } from 'react';
import {
 RefreshCw, MoreHorizontal, CheckCircle2, XCircle, Clock, Loader2, WifiOff,
 FileText, Search, Gauge, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ResizableTableProvider, ResizableTableHead, ResizableTableCell, type ResizableColumnConfig } from '@/components/ui/resizable-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
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
import { toast } from 'sonner';

interface ComponentStatusCondition {
 type: string;
 status: string;
 error?: string;
 message?: string;
}

interface ComponentStatusResource extends KubernetesResource {
 conditions?: ComponentStatusCondition[];
}

interface ComponentStatus {
 name: string;
 status: 'Healthy' | 'Unhealthy' | 'Unknown';
 message: string;
 error: string;
 age: string;
 creationTimestamp?: string;
}

const CS_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 220, minWidth: 120 },
 { id: 'status', defaultWidth: 120, minWidth: 80 },
 { id: 'message', defaultWidth: 280, minWidth: 120 },
 { id: 'error', defaultWidth: 200, minWidth: 100 },
 { id: 'age', defaultWidth: 90, minWidth: 56 },
];

const CS_COLUMNS_FOR_VISIBILITY = [
 { id: 'status', label: 'Status' },
 { id: 'message', label: 'Message' },
 { id: 'error', label: 'Error' },
 { id: 'age', label: 'Age' },
];

function transformCS(resource: ComponentStatusResource): ComponentStatus {
 const conditions = resource.conditions ?? [];
 const isHealthy = conditions.length > 0 && conditions.every((c) => c.status === 'True');
 const hasConditions = conditions.length > 0;

 let status: ComponentStatus['status'] = 'Unknown';
 if (hasConditions) status = isHealthy ? 'Healthy' : 'Unhealthy';

 const firstCondition = conditions[0];
 const message = firstCondition?.message ?? '-';
 const error = firstCondition?.error ?? '-';

 return {
 name: resource.metadata.name,
 status,
 message,
 error,
 age: calculateAge(resource.metadata.creationTimestamp),
 creationTimestamp: resource.metadata?.creationTimestamp,
 };
}

const csStatusToVariant: Record<ComponentStatus['status'], StatusPillVariant> = {
 Healthy: 'success',
 Unhealthy: 'error',
 Unknown: 'muted',
};

const csStatusIcon: Record<ComponentStatus['status'], React.ComponentType<{ className?: string }>> = {
 Healthy: CheckCircle2,
 Unhealthy: XCircle,
 Unknown: Clock,
};

export default function ComponentStatuses() {
 const navigate = useNavigate();
 const [searchQuery, setSearchQuery] = useState('');
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<ComponentStatusResource>('componentstatuses', undefined, { limit: 5000 });

 const items: ComponentStatus[] = isConnected && data
 ? (data.items ?? []).map(transformCS)
 : [];

 const stats = useMemo(() => ({
 total: items.length,
 healthy: items.filter((i) => i.status === 'Healthy').length,
 unhealthy: items.filter((i) => i.status === 'Unhealthy').length,
 unknown: items.filter((i) => i.status === 'Unknown').length,
 }), [items]);

 const itemsAfterSearch = useMemo(() =>
 items.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase())),
 [items, searchQuery]);

 const csColumnConfig: ColumnConfig<ComponentStatus>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'status', getValue: (i) => i.status, sortable: true, filterable: true },
 { columnId: 'message', getValue: (i) => i.message, sortable: true, filterable: false },
 { columnId: 'error', getValue: (i) => i.error, sortable: true, filterable: false },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearch, { columns: csColumnConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'componentstatuses', columns: CS_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const totalFiltered = filteredItems.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredItems.slice(start, start + pageSize);

 useEffect(() => {
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [safePageIndex, pageIndex]);

 const toggleSelection = (item: ComponentStatus) => {
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

 const exportConfig = {
 filenamePrefix: 'componentstatuses',
 resourceLabel: 'component statuses',
 getExportData: (d: ComponentStatus) => ({ name: d.name, status: d.status, message: d.message, error: d.error, age: d.age }),
 csvColumns: [
 { label: 'Name', getValue: (d: ComponentStatus) => d.name },
 { label: 'Status', getValue: (d: ComponentStatus) => d.status },
 { label: 'Message', getValue: (d: ComponentStatus) => d.message },
 { label: 'Error', getValue: (d: ComponentStatus) => d.error },
 { label: 'Age', getValue: (d: ComponentStatus) => d.age },
 ],
 toK8sYaml: (d: ComponentStatus) => `---
apiVersion: v1
kind: ComponentStatus
metadata:
 name: ${d.name}
`,
 };

 const pagination = {
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No component statuses',
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
 <div className="p-2.5 rounded-xl bg-primary/10"><Gauge className="h-6 w-6 text-primary" /></div>
 <div>
 <h1 className="text-2xl font-semibold tracking-tight">Component Statuses</h1>
 <p className="text-sm text-muted-foreground">
 {filteredItems.length} control plane components (cluster-scoped)
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
 selectionLabel={selectedItems.size > 0 ? 'Selected component statuses' : 'All visible'}
 onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
 />
 <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => refetch()} disabled={isLoading}>{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</Button>
 </div>
 </div>

 <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
 <ListPageStatCard label="Total" value={stats.total} icon={Gauge} iconColor="text-primary" selected={!columnFilters.status?.size} onClick={() => setColumnFilter('status', null)} className={cn(!columnFilters.status?.size && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Healthy" value={stats.healthy} icon={CheckCircle2} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Healthy')} onClick={() => setColumnFilter('status', new Set(['Healthy']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Healthy') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard label="Unhealthy" value={stats.unhealthy} icon={XCircle} iconColor="text-rose-600" valueClassName="text-rose-600" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Unhealthy')} onClick={() => setColumnFilter('status', new Set(['Unhealthy']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Unhealthy') && 'ring-2 ring-rose-500')} isLoading={isLoading} />
 <ListPageStatCard label="Unknown" value={stats.unknown} icon={Clock} iconColor="text-muted-foreground" valueClassName="text-muted-foreground" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Unknown')} onClick={() => setColumnFilter('status', new Set(['Unknown']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Unknown') && 'ring-2 ring-muted-foreground')} isLoading={isLoading} />
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
 <Input placeholder="Search component statuses..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all" />
 </div>
 }
 />
 }
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={CS_COLUMNS_FOR_VISIBILITY}
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
 <ResizableTableProvider tableId="componentstatuses" columnConfig={CS_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 910 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 {columnVisibility.isColumnVisible('status') && <ResizableTableHead columnId="status"><TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('message') && <ResizableTableHead columnId="message"><TableColumnHeaderWithFilterAndSort columnId="message" label="Message" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('error') && <ResizableTableHead columnId="error"><TableColumnHeaderWithFilterAndSort columnId="error" label="Error" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 {columnVisibility.isColumnVisible('status') && <ResizableTableCell columnId="status" className="p-1.5"><TableFilterCell columnId="status" label="Status" distinctValues={distinctValuesByColumn.status ?? []} selectedFilterValues={columnFilters.status ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.status} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('message') && <ResizableTableCell columnId="message" className="p-1.5" />}
 {columnVisibility.isColumnVisible('error') && <ResizableTableCell columnId="error" className="p-1.5" />}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
 <TableCell className="w-12" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={7} resourceName="component statuses" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={7} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : !isConnected ? (
 <TableRow><TableCell colSpan={7} className="h-32 text-center"><div className="flex flex-col items-center gap-2"><WifiOff className="h-8 w-8 opacity-50" /><p className="text-sm text-muted-foreground">Connect cluster to view component statuses</p></div></TableCell></TableRow>
 ) : filteredItems.length === 0 ? (
 <TableRow>
 <TableCell colSpan={7} className="h-40 text-center">
 <TableEmptyState
 icon={<Gauge className="h-8 w-8" />}
 title="No component statuses found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'ComponentStatus is deprecated; cluster components report health via other APIs.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((item, idx) => {
 const isSelected = selectedItems.has(item.name);
 const StatusIcon = csStatusIcon[item.status];
 return (
 <tr key={item.name} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
 <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(item)} /></TableCell>
 <ResizableTableCell columnId="name">
 <span className="font-medium flex items-center gap-2 truncate cursor-pointer text-primary hover:underline" onClick={() => navigate(`/componentstatuses/${item.name}`)}>
 <Gauge className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 </span>
 </ResizableTableCell>
 {columnVisibility.isColumnVisible('status') && <ResizableTableCell columnId="status"><StatusPill label={item.status} variant={csStatusToVariant[item.status]} icon={StatusIcon} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('message') && <ResizableTableCell columnId="message" className="text-xs text-muted-foreground truncate max-w-[280px]" title={item.message}>{item.message}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('error') && <ResizableTableCell columnId="error" className="font-mono text-xs text-muted-foreground truncate max-w-[200px]" title={item.error}>{item.error}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>}
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem onClick={() => navigate(`/componentstatuses/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/componentstatuses/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
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
 </div>
 );
}
