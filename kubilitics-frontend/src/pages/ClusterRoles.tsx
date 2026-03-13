import { useState, useMemo, useEffect } from 'react';
import { ShieldCheck, Search, RefreshCw, MoreHorizontal,
 WifiOff, Plus, ChevronDown, CheckSquare, Trash2 } from 'lucide-react';
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
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
 ResourceCommandBar,
 ClusterScopedScope,
 ResourceExportDropdown,
 ListPagination,
 ListPageStatCard,
 ListPageHeader,
 TableColumnHeaderWithFilterAndSort,
 resourceTableRowClassName,
 ROW_MOTION,
 PAGE_SIZE_OPTIONS,
 AgeCell,
 TableEmptyState, ListPageLoadingShell, TableErrorState,
 CopyNameDropdownItem,
 ResourceListTableToolbar,
 TableFilterCell,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';

interface ClusterRoleRule {
 apiGroups?: string[];
 resources?: string[];
 resourceNames?: string[];
 verbs?: string[];
 nonResourceURLs?: string[];
}

interface AggregationRule {
 clusterRoleSelectors?: Array<{ matchLabels?: Record<string, string>; matchExpressions?: unknown[] }>;
}

interface ClusterRoleResource extends KubernetesResource {
 rules?: ClusterRoleRule[];
 aggregationRule?: AggregationRule;
}

const READ_ONLY_VERBS = new Set(['get', 'list', 'watch']);

interface ClusterRoleRow {
 name: string;
 rulesCount: number;
 apiGroups: string;
 resources: string;
 verbs: string;
 verbsList: string[];
 nonResourceURLsCount: number;
 aggregation: string;
 bindings: string;
 age: string;
 creationTimestamp?: string;
 isSystem: boolean;
 isAggregated: boolean;
 hasWildcardVerb: boolean;
 isReadOnly: boolean;
}

function getUniqueApiGroups(rules: ClusterRoleRule[]): string[] {
 const set = new Set<string>();
 (rules || []).forEach((r) => (r.apiGroups || []).forEach((g) => set.add(g || '')));
 return Array.from(set).filter(Boolean);
}

function getUniqueResources(rules: ClusterRoleRule[]): string[] {
 const set = new Set<string>();
 (rules || []).forEach((r) => (r.resources || []).forEach((res) => set.add(res)));
 return Array.from(set).filter(Boolean);
}

function getUniqueVerbs(rules: ClusterRoleRule[]): string[] {
 const set = new Set<string>();
 (rules || []).forEach((r) => (r.verbs || []).forEach((v) => set.add(v)));
 return Array.from(set).filter(Boolean);
}

function countNonResourceURLs(rules: ClusterRoleRule[]): number {
 return (rules || []).reduce((acc, r) => acc + (r.nonResourceURLs?.length ?? 0), 0);
}

function aggregationLabel(agg?: AggregationRule): string {
 if (!agg?.clusterRoleSelectors?.length) return '–';
 const first = agg.clusterRoleSelectors[0];
 const labels = first?.matchLabels;
 if (labels && Object.keys(labels).length) {
 const parts = Object.entries(labels).map(([k, v]) => `${k}=${v}`);
 return parts.join(', ') + (agg.clusterRoleSelectors.length > 1 ? '…' : '');
 }
 return 'Yes';
}

function transformClusterRole(r: ClusterRoleResource): ClusterRoleRow {
 const rules = r.rules || [];
 const apiGroups = getUniqueApiGroups(rules);
 const resources = getUniqueResources(rules);
 const verbs = getUniqueVerbs(rules);
 const verbsList = verbs.map((v) => v.toLowerCase());
 const hasWildcardVerb = verbsList.includes('*');
 const isReadOnly = !hasWildcardVerb && verbsList.length > 0 && verbsList.every((v) => READ_ONLY_VERBS.has(v));
 const nonResourceURLsCount = countNonResourceURLs(rules);
 const name = r.metadata.name;
 return {
 name,
 rulesCount: rules.length,
 apiGroups: apiGroups.length ? apiGroups.slice(0, 3).join(', ') + (apiGroups.length > 3 ? '…' : '') : '–',
 resources: resources.length ? resources.slice(0, 4).join(', ') + (resources.length > 4 ? '…' : '') : '–',
 verbs: verbs.length ? verbs.join(', ') : '–',
 verbsList,
 nonResourceURLsCount,
 aggregation: r.aggregationRule ? aggregationLabel(r.aggregationRule) : '–',
 bindings: '–',
 age: calculateAge(r.metadata.creationTimestamp),
 creationTimestamp: r.metadata?.creationTimestamp,
 isSystem: name.startsWith('system:'),
 isAggregated: !!r.aggregationRule,
 hasWildcardVerb,
 isReadOnly,
 };
}

const CLUSTER_ROLE_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 200, minWidth: 100 },
 { id: 'rules', defaultWidth: 80, minWidth: 50 },
 { id: 'apiGroups', defaultWidth: 140, minWidth: 80 },
 { id: 'resources', defaultWidth: 160, minWidth: 90 },
 { id: 'verbs', defaultWidth: 140, minWidth: 80 },
 { id: 'nonResourceURLs', defaultWidth: 100, minWidth: 60 },
 { id: 'aggregation', defaultWidth: 120, minWidth: 60 },
 { id: 'bindings', defaultWidth: 80, minWidth: 50 },
 { id: 'age', defaultWidth: 90, minWidth: 56 },
];

const CLUSTERROLES_COLUMNS_FOR_VISIBILITY = [
 { id: 'rules', label: 'Rules' },
 { id: 'apiGroups', label: 'API Groups' },
 { id: 'resources', label: 'Resources' },
 { id: 'verbs', label: 'Verbs' },
 { id: 'nonResourceURLs', label: 'Non-Resource URLs' },
 { id: 'aggregation', label: 'Aggregation' },
 { id: 'bindings', label: 'Bindings' },
 { id: 'age', label: 'Age' },
];

export default function ClusterRoles() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, refetch, pagination: hookPagination } = usePaginatedResourceList<ClusterRoleResource>('clusterroles');
 const deleteResource = useDeleteK8sResource('clusterroles');

 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: ClusterRoleRow | null; bulk?: boolean }>({ open: false, item: null });
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [showCreator, setShowCreator] = useState(false);
 const [searchQuery, setSearchQuery] = useState('');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const allItems = (data?.allItems ?? []) as ClusterRoleResource[];
 const items: ClusterRoleRow[] = useMemo(() => (isConnected ? allItems.map(transformClusterRole) : []), [isConnected, allItems]);

 const tableConfig: ColumnConfig<ClusterRoleRow>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'permissionLevel', getValue: (i) => i.hasWildcardVerb ? 'Admin' : i.isReadOnly ? 'Read-Only' : 'Custom', sortable: true, filterable: true },
 { columnId: 'rules', getValue: (i) => i.rulesCount, sortable: true, filterable: false, compare: (a, b) => a.rulesCount - b.rulesCount },
 { columnId: 'apiGroups', getValue: (i) => i.apiGroups, sortable: true, filterable: false },
 { columnId: 'resources', getValue: (i) => i.resources, sortable: true, filterable: false },
 { columnId: 'verbs', getValue: (i) => i.verbs, sortable: true, filterable: false },
 { columnId: 'nonResourceURLs', getValue: (i) => i.nonResourceURLsCount, sortable: true, filterable: false, compare: (a, b) => a.nonResourceURLsCount - b.nonResourceURLsCount },
 { columnId: 'aggregation', getValue: (i) => i.aggregation, sortable: true, filterable: false },
 { columnId: 'bindings', getValue: (i) => i.bindings, sortable: true, filterable: false },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(items, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'clusterroles', columns: CLUSTERROLES_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const searchFiltered = useMemo(() => {
 if (!searchQuery.trim()) return filteredItems;
 const q = searchQuery.toLowerCase();
 return filteredItems.filter((r) => r.name.toLowerCase().includes(q) || r.verbs.toLowerCase().includes(q) || r.aggregation.toLowerCase().includes(q) || r.verbsList.some((v) => v.includes(q)));
 }, [filteredItems, searchQuery]);

 const stats = useMemo(() => {
 const total = items.length;
 const admin = items.filter((r) => r.hasWildcardVerb).length;
 const readOnly = items.filter((r) => r.isReadOnly).length;
 const custom = items.filter((r) => !r.hasWildcardVerb && !r.isReadOnly).length;
 return { total, admin, readOnly, custom };
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
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No cluster roles',
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
 toast.success(`Deleted ${selectedItems.size} cluster role(s)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name });
 toast.success(`Cluster role ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const toggleSelection = (r: ClusterRoleRow) => {
 const next = new Set(selectedItems);
 if (next.has(r.name)) next.delete(r.name);
 else next.add(r.name);
 setSelectedItems(next);
 };
 const toggleAll = () => {
 if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
 else setSelectedItems(new Set(itemsOnPage.map((r) => r.name)));
 };
 const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
 const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

 const exportConfig = {
 filenamePrefix: 'cluster-roles',
 resourceLabel: 'Cluster Roles',
 getExportData: (r: ClusterRoleRow) => ({ name: r.name, rules: r.rulesCount, apiGroups: r.apiGroups, resources: r.resources, verbs: r.verbs, aggregation: r.aggregation, age: r.age }),
 csvColumns: [
 { label: 'Name', getValue: (r: ClusterRoleRow) => r.name },
 { label: 'Rules', getValue: (r: ClusterRoleRow) => r.rulesCount },
 { label: 'Age', getValue: (r: ClusterRoleRow) => r.age },
 ],
 };

 if (showCreator) {
 return (
 <ResourceCreator
 resourceKind="ClusterRole"
 defaultYaml={DEFAULT_YAMLS.ClusterRole}
 onClose={() => setShowCreator(false)}
 onApply={() => {
 toast.success('ClusterRole created');
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
 icon={<ShieldCheck className="h-6 w-6 text-primary" />}
 title="Cluster Roles"
 resourceCount={searchFiltered.length}
 subtitle="Cluster-scoped"
 demoMode={!isConnected}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create"
 onCreate={() => setShowCreator(true)}
 actions={
 <>
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => r.name} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected cluster roles' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
 <ListPageStatCard label="Total" value={stats.total} icon={ShieldCheck} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Admin" value={stats.admin} icon={ShieldCheck} iconColor="text-destructive" valueClassName="text-destructive" selected={columnFilters.permissionLevel?.size === 1 && columnFilters.permissionLevel.has('Admin')} onClick={() => setColumnFilter('permissionLevel', new Set(['Admin']))} className={cn(columnFilters.permissionLevel?.size === 1 && columnFilters.permissionLevel.has('Admin') && 'ring-2 ring-destructive')} isLoading={isLoading} />
 <ListPageStatCard label="Read-Only" value={stats.readOnly} icon={ShieldCheck} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.permissionLevel?.size === 1 && columnFilters.permissionLevel.has('Read-Only')} onClick={() => setColumnFilter('permissionLevel', new Set(['Read-Only']))} className={cn(columnFilters.permissionLevel?.size === 1 && columnFilters.permissionLevel.has('Read-Only') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard label="Custom" value={stats.custom} icon={ShieldCheck} iconColor="text-muted-foreground" selected={columnFilters.permissionLevel?.size === 1 && columnFilters.permissionLevel.has('Custom')} onClick={() => setColumnFilter('permissionLevel', new Set(['Custom']))} className={cn(columnFilters.permissionLevel?.size === 1 && columnFilters.permissionLevel.has('Custom') && 'ring-2 ring-muted-foreground')} isLoading={isLoading} />
 </div>

 {/* Bulk Actions Bar */}
 {selectedItems.size > 0 && (
 <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
 <Badge variant="secondary" className="gap-1.5">
 <CheckSquare className="h-3.5 w-3.5" />
 {selectedItems.size} selected
 </Badge>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => r.name} config={exportConfig} selectionLabel="Selected cluster roles" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
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
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 globalFilterBar={
 <ResourceCommandBar
 scope={<ClusterScopedScope />}
 search={
 <div className="relative w-full min-w-0">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input placeholder="Search cluster roles..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search cluster roles" />
 </div>
 }
 />
 }
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={CLUSTERROLES_COLUMNS_FOR_VISIBILITY}
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
 <ResizableTableProvider tableId="clusterroles" columnConfig={CLUSTER_ROLE_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 1000 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="rules"><TableColumnHeaderWithFilterAndSort columnId="rules" label="Rules" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="apiGroups"><TableColumnHeaderWithFilterAndSort columnId="apiGroups" label="API Groups" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="resources"><TableColumnHeaderWithFilterAndSort columnId="resources" label="Resources" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="verbs"><TableColumnHeaderWithFilterAndSort columnId="verbs" label="Verbs" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="nonResourceURLs"><TableColumnHeaderWithFilterAndSort columnId="nonResourceURLs" label="Non-Resource URLs" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="aggregation"><TableColumnHeaderWithFilterAndSort columnId="aggregation" label="Aggregation" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="bindings"><TableColumnHeaderWithFilterAndSort columnId="bindings" label="Bindings" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="rules" className="p-1.5"><TableFilterCell columnId="permissionLevel" label="Permission Level" distinctValues={distinctValuesByColumn.permissionLevel ?? []} selectedFilterValues={columnFilters.permissionLevel ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.permissionLevel} /></ResizableTableCell>
 <ResizableTableCell columnId="apiGroups" className="p-1.5" />
 <ResizableTableCell columnId="resources" className="p-1.5" />
 <ResizableTableCell columnId="verbs" className="p-1.5" />
 <ResizableTableCell columnId="nonResourceURLs" className="p-1.5" />
 <ResizableTableCell columnId="aggregation" className="p-1.5" />
 <ResizableTableCell columnId="bindings" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={12} resourceName="cluster roles" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={12} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : searchFiltered.length === 0 ? (
 <TableRow>
 <TableCell colSpan={12} className="h-40 text-center">
 <TableEmptyState
 icon={<ShieldCheck className="h-8 w-8" />}
 title="No ClusterRoles found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Define cluster-scoped RBAC roles.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create ClusterRole"
 onCreate={() => setShowCreator(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((r, idx) => (
 <tr key={r.name} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(r.name) && 'bg-primary/5')}>
 <TableCell><Checkbox checked={selectedItems.has(r.name)} onCheckedChange={() => toggleSelection(r)} aria-label={`Select ${r.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/clusterroles/${r.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <ShieldCheck className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{r.name}</span>
 </Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="rules" className="font-mono text-sm">{r.rulesCount}</ResizableTableCell>
 <ResizableTableCell columnId="apiGroups" className="text-muted-foreground text-sm truncate" title={r.apiGroups}>{r.apiGroups}</ResizableTableCell>
 <ResizableTableCell columnId="resources" className="text-muted-foreground text-sm truncate" title={r.resources}>{r.resources}</ResizableTableCell>
 <ResizableTableCell columnId="verbs">
 <div className="flex flex-wrap gap-1 max-w-[200px]">
 {r.verbsList.length > 0 ? r.verbsList.slice(0, 6).map((v) => (
 <Badge key={v} variant={v === '*' ? 'destructive' : 'secondary'} className="text-xs font-mono">{v}</Badge>
 )) : <span className="text-muted-foreground">–</span>}
 {r.verbsList.length > 6 && <Badge variant="outline" className="text-xs">+{r.verbsList.length - 6}</Badge>}
 </div>
 </ResizableTableCell>
 <ResizableTableCell columnId="nonResourceURLs" className="text-muted-foreground text-sm">{r.nonResourceURLsCount || '–'}</ResizableTableCell>
 <ResizableTableCell columnId="aggregation" className="text-muted-foreground text-sm truncate" title={r.aggregation}>{r.aggregation}</ResizableTableCell>
 <ResizableTableCell columnId="bindings" className="text-muted-foreground">{r.bindings}</ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={r.age} timestamp={r.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="Cluster role actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <CopyNameDropdownItem name={r.name} />
 <DropdownMenuItem onClick={() => navigate(`/clusterroles/${r.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/clusterroles/${r.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteDialog({ open: true, item: r })} disabled={!isConnected}>Delete</DropdownMenuItem>
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
 resourceType="ClusterRole"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name || '')}
 onConfirm={handleDelete}
 requireNameConfirmation={!deleteDialog.bulk}
 />
 </>
 );
}
