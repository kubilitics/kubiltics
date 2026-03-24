import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, Search, RefreshCw, MoreHorizontal, Loader2, WifiOff, ChevronDown, CheckCircle2, AlertTriangle, XCircle, ExternalLink } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { usePaginatedResourceList } from '@/hooks/useKubernetes';
import { getEvents, type BackendEvent } from '@/services/backendApiClient';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import {
 ResourceCommandBar,
 ListPagination,
 ListPageStatCard,
 ListPageLoadingShell,
 TableColumnHeaderWithFilterAndSort,
 TableErrorState,
 TableFilterCell,
 resourceTableRowClassName,
 ROW_MOTION,
 PAGE_SIZE_OPTIONS,
 ResourceListTableToolbar,
 VirtualTableBody,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { getDetailPath, normalizeKindForTopology } from '@/utils/resourceKindMapper';

const typeConfig = {
 Normal: { icon: CheckCircle2, color: 'text-muted-foreground', bg: 'bg-muted' },
 Warning: { icon: AlertTriangle, color: 'text-orange-500', bg: 'bg-orange-500/15' },
 Error: { icon: XCircle, color: 'text-destructive', bg: 'bg-destructive/10' },
};

function formatEventTime(iso: string): string {
 if (!iso) return '–';
 try {
 const d = new Date(iso);
 const now = Date.now();
 const diffMs = now - d.getTime();
 const sec = Math.floor(diffMs / 1000);
 const min = Math.floor(sec / 60);
 const h = Math.floor(min / 60);
 const d_ = Math.floor(h / 24);
 if (d_ > 0) return `${d_}d ago`;
 if (h > 0) return `${h}h ago`;
 if (min > 0) return `${min}m ago`;
 return `${sec}s ago`;
 } catch {
 return iso;
 }
}

interface EventRow {
 id: string;
 name: string;
 eventNamespace: string;
 type: 'Normal' | 'Warning' | 'Error';
 reason: string;
 message: string;
 objectKind: string;
 objectName: string;
 objectNamespace: string;
 source: string;
 count: number;
 firstSeen: string;
 lastSeen: string;
}

function backendEventToRow(ev: BackendEvent): EventRow {
 return {
 id: ev.id,
 name: ev.name || ev.id,
 eventNamespace: ev.event_namespace ?? ev.namespace ?? '',
 type: (ev.type === 'Warning' || ev.type === 'Error' ? ev.type : 'Normal') as 'Normal' | 'Warning' | 'Error',
 reason: ev.reason || '–',
 message: ev.message || '–',
 objectKind: ev.resource_kind || '–',
 objectName: ev.resource_name || '–',
 objectNamespace: ev.namespace || '',
 source: ev.source_component || '–',
 count: typeof ev.count === 'number' ? ev.count : 1,
 firstSeen: formatEventTime(ev.first_timestamp),
 lastSeen: formatEventTime(ev.last_timestamp),
 };
}

const EVENTS_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'type', defaultWidth: 160, minWidth: 100 },
 { id: 'reason', defaultWidth: 160, minWidth: 100 },
 { id: 'message', defaultWidth: 300, minWidth: 150 },
 { id: 'involved', defaultWidth: 260, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'source', defaultWidth: 160, minWidth: 100 },
 { id: 'count', defaultWidth: 100, minWidth: 70 },
 { id: 'firstSeen', defaultWidth: 110, minWidth: 80 },
 { id: 'lastSeen', defaultWidth: 110, minWidth: 80 },
];

const EVENTS_COLUMNS_FOR_VISIBILITY = [
 { id: 'reason', label: 'Reason' },
 { id: 'message', label: 'Message' },
 { id: 'involved', label: 'Involved Object' },
 { id: 'namespace', label: 'Namespace' },
 { id: 'source', label: 'Source' },
 { id: 'count', label: 'Count' },
 { id: 'firstSeen', label: 'First Seen' },
 { id: 'lastSeen', label: 'Last Seen' },
];

export default function Events() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
 const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
 const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
 const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
 const clusterId = currentClusterId ?? null;
 const useBackend = isBackendConfigured() && !!clusterId;

 const [namespaceFilter, setNamespaceFilter] = useState<string>('all');
 const [searchQuery, setSearchQuery] = useState('');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [autoRefresh, setAutoRefresh] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const nsParam = namespaceFilter === 'all' ? '*' : namespaceFilter;
 const eventsQuery = useQuery({
 queryKey: ['events', clusterId, nsParam],
 queryFn: () => getEvents(backendBaseUrl, clusterId!, { namespace: nsParam, limit: 300 }),
 enabled: useBackend && !!clusterId,
 refetchInterval: autoRefresh ? 10_000 : false,
 });

 const { data: namespacesData } = usePaginatedResourceList('namespaces');
 const namespaceOptions = useMemo(() => {
 const items = (namespacesData?.allItems ?? []) as Array<{ metadata: { name: string } }>;
 return ['all', ...items.map((r) => r.metadata.name).filter(Boolean)];
 }, [namespacesData?.allItems]);

 const rawRows: EventRow[] = useMemo(() => (eventsQuery.data ?? []).map(backendEventToRow), [eventsQuery.data]);

 const searchFiltered = useMemo(() => {
 if (!searchQuery.trim()) return rawRows;
 const q = searchQuery.toLowerCase();
 return rawRows.filter(
 (e) =>
 e.reason.toLowerCase().includes(q) ||
 e.message.toLowerCase().includes(q) ||
 e.objectName.toLowerCase().includes(q) ||
 e.objectKind.toLowerCase().includes(q)
 );
 }, [rawRows, searchQuery]);

 const tableConfig: ColumnConfig<EventRow>[] = useMemo(
 () => [
 { columnId: 'type', getValue: (i) => i.type, sortable: true, filterable: true },
 { columnId: 'reason', getValue: (i) => i.reason, sortable: true, filterable: true },
 { columnId: 'message', getValue: (i) => i.message, sortable: true, filterable: false },
 { columnId: 'involved', getValue: (i) => `${i.objectKind}/${i.objectNamespace}/${i.objectName}`, sortable: true, filterable: false },
 { columnId: 'namespace', getValue: (i) => i.eventNamespace, sortable: true, filterable: false },
 { columnId: 'source', getValue: (i) => i.source, sortable: true, filterable: false },
 { columnId: 'count', getValue: (i) => i.count, sortable: true, filterable: false, compare: (a, b) => a.count - b.count },
 { columnId: 'firstSeen', getValue: (i) => i.firstSeen, sortable: true, filterable: false },
 { columnId: 'lastSeen', getValue: (i) => i.lastSeen, sortable: true, filterable: false },
 ],
 []
 );

 const { filteredAndSortedItems: filteredRows, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter: setColumnFilterRaw, sortKey, sortOrder, setSort, clearAllFilters: clearAllFiltersRaw, hasActiveFilters } = useTableFiltersAndSort(searchFiltered, { columns: tableConfig, defaultSortKey: 'lastSeen', defaultSortOrder: 'desc' });
 const columnVisibility = useColumnVisibility({ tableId: 'events', columns: EVENTS_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['type'] });

 // Wrap filter setters to reset page index on any filter change
 const setColumnFilter = useCallback((...args: Parameters<typeof setColumnFilterRaw>) => { setPageIndex(0); setColumnFilterRaw(...args); }, [setColumnFilterRaw]);
 const clearAllFilters = useCallback(() => { setPageIndex(0); clearAllFiltersRaw(); }, [clearAllFiltersRaw]);

 // Reset page index when search or namespace changes
 useEffect(() => { setPageIndex(0); }, [searchQuery, namespaceFilter]);

 const typeFilterActive = columnFilters.type != null && columnFilters.type.size > 0;
 const typeFilterValue = typeFilterActive && columnFilters.type!.size === 1 ? Array.from(columnFilters.type!)[0] as 'Normal' | 'Warning' | 'Error' : 'all';
 const reasonFilterActive = columnFilters.reason != null && columnFilters.reason.size > 0;

 const stats = useMemo(() => {
 const total = rawRows.length;
 const warning = rawRows.filter((e) => e.type === 'Warning').length;
 const errors = rawRows.filter((e) => e.type === 'Error').length;
 const resourcesAffected = new Set(rawRows.map((e) => `${e.objectKind}/${e.objectNamespace}/${e.objectName}`)).size;
 return { total, warning, errors, resourcesAffected };
 }, [rawRows]);

 // Real pagination over filteredRows
 const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
 // Clamp pageIndex if filters reduce the total pages
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);

 const paginatedRows = useMemo(() => {
 const start = safePageIndex * pageSize;
 return filteredRows.slice(start, start + pageSize);
 }, [filteredRows, safePageIndex, pageSize]);

 const rangeStart = safePageIndex * pageSize + 1;
 const rangeEnd = Math.min((safePageIndex + 1) * pageSize, filteredRows.length);

 const pagination = {
 rangeLabel: filteredRows.length === 0
 ? '0 events'
 : `${rangeStart}–${rangeEnd} of ${filteredRows.length} events`,
 hasPrev: safePageIndex > 0,
 hasNext: safePageIndex < totalPages - 1,
 onPrev: () => setPageIndex((p) => Math.max(0, p - 1)),
 onNext: () => setPageIndex((p) => Math.min(totalPages - 1, p + 1)),
 currentPage: safePageIndex + 1,
 totalPages,
 onPageChange: (page: number) => setPageIndex(page - 1),
 dataUpdatedAt: eventsQuery.dataUpdatedAt,
 isFetching: eventsQuery.isFetching,
 };

 const tableContainerRef = useRef<HTMLDivElement>(null);
 const isLoading = eventsQuery.isLoading;
 const isError = eventsQuery.isError;

 return (
 <div className="space-y-6">
 <div className="flex items-center justify-between flex-wrap gap-4">
 <div className="flex items-center gap-3 flex-wrap">
 <div className="p-2.5 rounded-xl bg-primary/10">
 <Bell className="h-6 w-6 text-primary" />
 </div>
 <div>
 <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
 <p className="text-sm text-muted-foreground">
 Cluster events from all namespaces
 {!isConnected && (
 <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
 <WifiOff className="h-3 w-3" /> Connect cluster
 </span>
 )}
 </p>
 </div>
 </div>
 <Button
 variant={autoRefresh ? 'default' : 'outline'}
 size="sm"
 className="h-9 gap-2"
 onClick={() => setAutoRefresh((v) => !v)}
 title={autoRefresh ? 'Live updates on (every 10s) — click to disable' : 'Enable live updates (poll every 10s)'}
 >
 <RefreshCw className={cn('h-4 w-4', autoRefresh && 'animate-spin')} />
 {autoRefresh ? 'Live (10s)' : 'Live Updates'}
 </Button>
 <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => eventsQuery.refetch()} disabled={eventsQuery.isLoading}>
 {eventsQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
 </Button>
 </div>

 <div className={cn('grid grid-cols-2 sm:grid-cols-4 gap-4', !isConnected && 'opacity-60')}>
 <ListPageStatCard label="Total" value={stats.total} icon={Bell} iconColor="text-primary" selected={!typeFilterActive} onClick={() => setColumnFilter('type', null)} className={cn(!typeFilterActive && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Warnings" value={stats.warning} icon={AlertTriangle} iconColor="text-orange-500" valueClassName="text-orange-500" selected={typeFilterValue === 'Warning'} onClick={() => setColumnFilter('type', typeFilterValue === 'Warning' ? null : new Set(['Warning']))} className={cn(typeFilterValue === 'Warning' && 'ring-2 ring-orange-500')} isLoading={isLoading} />
 <ListPageStatCard label="Errors" value={stats.errors} icon={XCircle} iconColor="text-destructive" valueClassName="text-destructive" selected={typeFilterValue === 'Error'} onClick={() => setColumnFilter('type', typeFilterValue === 'Error' ? null : new Set(['Error']))} className={cn(typeFilterValue === 'Error' && 'ring-2 ring-destructive')} isLoading={isLoading} />
 <ListPageStatCard label="Resources Affected" value={stats.resourcesAffected} icon={Bell} iconColor="text-muted-foreground" selected={!typeFilterActive && !reasonFilterActive} onClick={() => { setColumnFilter('type', null); setColumnFilter('reason', null); }} className={cn(!typeFilterActive && !reasonFilterActive && 'ring-2 ring-primary')} isLoading={isLoading} />
 </div>

 <ResourceListTableToolbar
 globalFilterBar={
 <>
 <ResourceCommandBar
 scope={
 <Select value={namespaceFilter} onValueChange={setNamespaceFilter}>
 <SelectTrigger className="w-[180px] h-10 rounded-lg border border-border bg-background text-sm font-medium shadow-sm">
 <SelectValue placeholder="Namespace" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All namespaces</SelectItem>
 {namespaceOptions.filter((n) => n !== 'all').map((ns) => (
 <SelectItem key={ns} value={ns}>{ns}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 }
 search={
 <div className="relative w-full min-w-0">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input
 placeholder="Search events..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20"
 aria-label="Search events"
 />
 </div>
 }
 />
 <div className="flex flex-wrap gap-2 items-center px-4 py-2">
 <span className="text-sm text-muted-foreground">Type:</span>
 <Button variant={!typeFilterActive ? 'secondary' : 'ghost'} size="sm" onClick={() => setColumnFilter('type', null)}>All</Button>
 <Button variant={typeFilterValue === 'Normal' ? 'secondary' : 'ghost'} size="sm" onClick={() => setColumnFilter('type', typeFilterValue === 'Normal' ? null : new Set(['Normal']))}>Normal</Button>
 <Button variant={typeFilterValue === 'Warning' ? 'secondary' : 'ghost'} size="sm" onClick={() => setColumnFilter('type', typeFilterValue === 'Warning' ? null : new Set(['Warning']))}>Warning</Button>
 <Button variant={typeFilterValue === 'Error' ? 'secondary' : 'ghost'} size="sm" onClick={() => setColumnFilter('type', typeFilterValue === 'Error' ? null : new Set(['Error']))}>Error</Button>
 </div>
 </>
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={EVENTS_COLUMNS_FOR_VISIBILITY}
 visibleColumns={columnVisibility.visibleColumns}
 onColumnToggle={columnVisibility.setColumnVisible}
 isLoading={isLoading && isConnected}
 footer={
 <div className="flex items-center justify-between flex-wrap gap-2">
 <div className="flex items-center gap-3">
 <span className="text-sm text-muted-foreground">{pagination.rangeLabel}</span>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="outline" size="sm" className="gap-2">
 {pageSize} per page
 <ChevronDown className="h-4 w-4 opacity-50" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="start">
 {PAGE_SIZE_OPTIONS.filter((s) => s <= 100).map((size) => (
 <DropdownMenuItem key={size} onClick={() => { setPageSize(size); setPageIndex(0); }} className={cn(pageSize === size && 'bg-accent')}>
 {size} per page
 </DropdownMenuItem>
 ))}
 </DropdownMenuContent>
 </DropdownMenu>
 </div>
 <ListPagination hasPrev={pagination.hasPrev} hasNext={pagination.hasNext} onPrev={pagination.onPrev} onNext={pagination.onNext} rangeLabel={undefined} currentPage={pagination.currentPage} totalPages={pagination.totalPages} onPageChange={pagination.onPageChange} dataUpdatedAt={pagination.dataUpdatedAt} isFetching={pagination.isFetching} />
 </div>
 }
 >
 <ResizableTableProvider tableId="events" columnConfig={EVENTS_TABLE_COLUMNS}>
 <div className="rounded-md border relative flex flex-col h-[calc(100vh-220px)] overflow-hidden">
 <div className="overflow-auto flex-1 relative" ref={tableContainerRef}>
 <Table className="table-fixed" style={{ minWidth: 1000 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <ResizableTableHead columnId="type"><TableColumnHeaderWithFilterAndSort columnId="type" label="Type" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <ResizableTableHead columnId="reason"><TableColumnHeaderWithFilterAndSort columnId="reason" label="Reason" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <ResizableTableHead columnId="message"><TableColumnHeaderWithFilterAndSort columnId="message" label="Message" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <ResizableTableHead columnId="involved"><TableColumnHeaderWithFilterAndSort columnId="involved" label="Involved Object" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <ResizableTableHead columnId="source"><TableColumnHeaderWithFilterAndSort columnId="source" label="Source" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <ResizableTableHead columnId="count"><TableColumnHeaderWithFilterAndSort columnId="count" label="Count" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <ResizableTableHead columnId="firstSeen"><TableColumnHeaderWithFilterAndSort columnId="firstSeen" label="First Seen" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <ResizableTableHead columnId="lastSeen"><TableColumnHeaderWithFilterAndSort columnId="lastSeen" label="Last Seen" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <ResizableTableCell columnId="type" className="p-1.5"><TableFilterCell columnId="type" label="Type" distinctValues={distinctValuesByColumn.type ?? []} selectedFilterValues={columnFilters.type ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.type} /></ResizableTableCell>
 <ResizableTableCell columnId="reason" className="p-1.5"><TableFilterCell columnId="reason" label="Reason" distinctValues={distinctValuesByColumn.reason ?? []} selectedFilterValues={columnFilters.reason ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.reason} /></ResizableTableCell>
 <ResizableTableCell columnId="message" className="p-1.5" />
 <ResizableTableCell columnId="involved" className="p-1.5" />
 <ResizableTableCell columnId="namespace" className="p-1.5" />
 <ResizableTableCell columnId="source" className="p-1.5" />
 <ResizableTableCell columnId="count" className="p-1.5" />
 <ResizableTableCell columnId="firstSeen" className="p-1.5" />
 <ResizableTableCell columnId="lastSeen" className="p-1.5" />
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 {isLoading && isConnected && !isError ? (
 <TableBody>
 <ListPageLoadingShell columnCount={10} resourceName="events" isLoading={isLoading} onRetry={() => eventsQuery.refetch()} />
 </TableBody>
 ) : isError ? (
 <TableBody>
 <TableRow>
 <TableCell colSpan={10} className="h-40 text-center">
 <TableErrorState onRetry={() => eventsQuery.refetch()} />
 </TableCell>
 </TableRow>
 </TableBody>
 ) : (
 <VirtualTableBody
 data={paginatedRows}
 tableContainerRef={tableContainerRef}
 rowHeight={48}
 renderRow={(ev) => {
 const config = typeConfig[ev.type];
 const EventIcon = config.icon;
 const canonicalKind = ev.objectKind && ev.objectKind !== '–' ? normalizeKindForTopology(ev.objectKind) : '';
 const detailPath = canonicalKind ? getDetailPath(canonicalKind, ev.objectName, ev.objectNamespace) : null;
 return (
 <tr
 key={ev.id}
 className={resourceTableRowClassName}
 >
 <ResizableTableCell columnId="type">
 <Link to={`/events/${encodeURIComponent(ev.eventNamespace)}/${encodeURIComponent(ev.name)}`} className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 hover:opacity-90', config.bg)}>
 <EventIcon className={cn('h-3.5 w-3.5', config.color)} />
 <span className="text-xs font-medium">{ev.type}</span>
 </Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="reason" className="font-medium">{ev.reason}</ResizableTableCell>
 <ResizableTableCell columnId="message" className="text-muted-foreground truncate max-w-[200px]" title={ev.message}>{ev.message}</ResizableTableCell>
 <ResizableTableCell columnId="involved">
 {detailPath ? (
 <Link to={detailPath} className="font-mono text-sm text-primary hover:underline flex items-center gap-1 truncate">
 {ev.objectKind}/{ev.objectName}
 <ExternalLink className="h-3 w-3 flex-shrink-0" />
 </Link>
 ) : (
 <span className="font-mono text-sm text-muted-foreground">{ev.objectKind}/{ev.objectName}</span>
 )}
 </ResizableTableCell>
 <ResizableTableCell columnId="namespace" className="text-muted-foreground">{ev.eventNamespace || '–'}</ResizableTableCell>
 <ResizableTableCell columnId="source" className="text-muted-foreground">{ev.source}</ResizableTableCell>
 <ResizableTableCell columnId="count" className="font-mono text-sm">{ev.count}</ResizableTableCell>
 <ResizableTableCell columnId="firstSeen" className="text-muted-foreground whitespace-nowrap">{ev.firstSeen}</ResizableTableCell>
 <ResizableTableCell columnId="lastSeen" className="text-muted-foreground whitespace-nowrap">{ev.lastSeen}</ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="Event actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem onClick={() => navigate(`/events/${encodeURIComponent(ev.eventNamespace)}/${encodeURIComponent(ev.name)}`)} className="gap-2">
 View Details
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/events/${encodeURIComponent(ev.eventNamespace)}/${encodeURIComponent(ev.name)}?tab=yaml`)} className="gap-2">
 Download YAML
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </tr>
 );
 }}
 />
 )}
 </Table>
 </div>
 </div>
 </ResizableTableProvider>
 </ResourceListTableToolbar >
 </div>
 );
}
