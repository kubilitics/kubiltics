import { useState, useMemo, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Shield, Search, RefreshCw, MoreHorizontal,
 WifiOff, Plus, ChevronDown, Filter, List, Layers, CheckSquare, Trash2 } from 'lucide-react';
import { useMultiSelect } from '@/hooks/useMultiSelect';
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
import { usePaginatedResourceList, useDeleteK8sResource, usePatchK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { DeleteConfirmDialog, BulkActionBar, executeBulkOperation } from '@/components/resources';
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
 resourceTableRowClassName,
 ROW_MOTION,
 PAGE_SIZE_OPTIONS,
 AgeCell,
 TableEmptyState, ListPageLoadingShell, TableErrorState,
 NamespaceBadge,
 CopyNameDropdownItem,
 ResourceListTableToolbar,
 TableFilterCell,
 StatusPill,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';

interface RoleRule {
 apiGroups?: string[];
 resources?: string[];
 resourceNames?: string[];
 verbs?: string[];
}

interface RoleResource extends KubernetesResource {
 rules?: RoleRule[];
}

const READ_ONLY_VERBS = new Set(['get', 'list', 'watch']);

interface Role {
 name: string;
 namespace: string;
 rulesCount: number;
 apiGroups: string;
 resources: string;
 verbs: string;
 verbsList: string[];
 bindings: string;
 age: string;
 creationTimestamp?: string;
 hasWildcardVerb: boolean;
 isReadOnly: boolean;
}

function getUniqueApiGroups(rules: RoleRule[]): string[] {
 const set = new Set<string>();
 (rules || []).forEach((r) => (r.apiGroups || []).forEach((g) => set.add(g || '')));
 return Array.from(set).filter(Boolean);
}

function getUniqueResources(rules: RoleRule[]): string[] {
 const set = new Set<string>();
 (rules || []).forEach((r) => (r.resources || []).forEach((res) => set.add(res)));
 return Array.from(set).filter(Boolean);
}

function getUniqueVerbs(rules: RoleRule[]): string[] {
 const set = new Set<string>();
 (rules || []).forEach((r) => (r.verbs || []).forEach((v) => set.add(v)));
 return Array.from(set).filter(Boolean);
}

function transformRole(r: RoleResource): Role {
 const rules = r.rules || [];
 const apiGroups = getUniqueApiGroups(rules);
 const resources = getUniqueResources(rules);
 const verbs = getUniqueVerbs(rules);
 const verbsList = verbs.map((v) => v.toLowerCase());
 const hasWildcardVerb = verbsList.includes('*');
 const isReadOnly = !hasWildcardVerb && verbsList.length > 0 && verbsList.every((v) => READ_ONLY_VERBS.has(v));
 return {
 name: r.metadata.name,
 namespace: r.metadata.namespace || 'default',
 rulesCount: rules.length,
 apiGroups: apiGroups.length ? apiGroups.slice(0, 3).join(', ') + (apiGroups.length > 3 ? '…' : '') : '–',
 resources: resources.length ? resources.slice(0, 4).join(', ') + (resources.length > 4 ? '…' : '') : '–',
 verbs: verbs.length ? verbs.join(', ') : '–',
 verbsList,
 bindings: '–',
 age: calculateAge(r.metadata.creationTimestamp),
 creationTimestamp: r.metadata?.creationTimestamp,
 hasWildcardVerb,
 isReadOnly,
 };
}

const ROLE_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'status', defaultWidth: 100, minWidth: 80 },
 { id: 'rules', defaultWidth: 100, minWidth: 70 },
 { id: 'apiGroups', defaultWidth: 160, minWidth: 100 },
 { id: 'resources', defaultWidth: 160, minWidth: 100 },
 { id: 'verbs', defaultWidth: 160, minWidth: 100 },
 { id: 'bindings', defaultWidth: 100, minWidth: 70 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const ROLES_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'status', label: 'Status' },
 { id: 'rules', label: 'Rules' },
 { id: 'apiGroups', label: 'API Groups' },
 { id: 'resources', label: 'Resources' },
 { id: 'verbs', label: 'Verbs' },
 { id: 'bindings', label: 'Bindings' },
 { id: 'age', label: 'Age' },
];

export default function Roles() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, refetch, pagination: hookPagination } = usePaginatedResourceList<RoleResource>('roles');
 const deleteResource = useDeleteK8sResource('roles');

 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: Role | null; bulk?: boolean }>({ open: false, item: null });
 const multiSelect = useMultiSelect();
 const selectedItems = multiSelect.selectedIds;
 const patchResource = usePatchK8sResource('roles');
 const [showCreator, setShowCreator] = useState(false);
 const [searchQuery, setSearchQuery] = useState('');
 const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
 const [listView, setListView] = useState<'flat' | 'byNamespace'>('flat');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const allItems = (data?.allItems ?? []) as RoleResource[];
 const items: Role[] = useMemo(() => (isConnected ? allItems.map(transformRole) : []), [isConnected, allItems]);

 const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.namespace)))], [items]);
 const itemsAfterNs = useMemo(() => (selectedNamespace === 'all' ? items : items.filter((i) => i.namespace === selectedNamespace)), [items, selectedNamespace]);

 const tableConfig: ColumnConfig<Role>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
 { columnId: 'permissionLevel', getValue: (i) => i.hasWildcardVerb ? 'Admin' : i.isReadOnly ? 'Read-Only' : 'Custom', sortable: true, filterable: true },
 { columnId: 'rules', getValue: (i) => i.rulesCount, sortable: true, filterable: false, compare: (a, b) => a.rulesCount - b.rulesCount },
 { columnId: 'apiGroups', getValue: (i) => i.apiGroups, sortable: true, filterable: false },
 { columnId: 'resources', getValue: (i) => i.resources, sortable: true, filterable: false },
 { columnId: 'verbs', getValue: (i) => i.verbs, sortable: true, filterable: false },
 { columnId: 'bindings', getValue: (i) => i.bindings, sortable: true, filterable: false },
 {
   columnId: 'age',
   getValue: (i) => i.age,
   sortValue: (i) => -(i.creationTimestamp ? Date.parse(i.creationTimestamp) : 0),
   sortable: true,
   filterable: false,
 },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterNs, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'roles', columns: ROLES_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const searchFiltered = useMemo(() => {
 if (!searchQuery.trim()) return filteredItems;
 const q = searchQuery.toLowerCase();
 return filteredItems.filter((r) => r.name.toLowerCase().includes(q) || r.namespace.toLowerCase().includes(q) || r.verbs.toLowerCase().includes(q));
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
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No roles',
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
 toast.success(`Deleted ${selectedItems.size} role(s)`);
 multiSelect.clearSelection();
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
 toast.success(`Role ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const allItemKeys = useMemo(() => itemsOnPage.map((r) => `${r.namespace}/${r.name}`), [itemsOnPage]);

 const toggleSelection = (r: Role, event?: React.MouseEvent) => {
 const key = `${r.namespace}/${r.name}`;
 if (event?.shiftKey) {
 multiSelect.toggleRange(key, allItemKeys);
 } else {
 multiSelect.toggle(key);
 }
 };
 const toggleAll = () => {
 if (multiSelect.isAllSelected(allItemKeys)) multiSelect.clearSelection();
 else multiSelect.selectAll(allItemKeys);
 };
 const isAllSelected = multiSelect.isAllSelected(allItemKeys);
 const isSomeSelected = multiSelect.isSomeSelected(allItemKeys);

 const handleBulkDelete = async () => {
 return executeBulkOperation(Array.from(selectedItems), async (_key, ns, name) => {
 await deleteResource.mutateAsync({ name, namespace: ns });
 });
 };

 const handleBulkLabel = async (label: string) => {
 return executeBulkOperation(Array.from(selectedItems), async (_key, ns, name) => {
 await patchResource.mutateAsync({ name, namespace: ns, patch: { metadata: { labels: { [label.split("=")[0]]: label.split("=")[1] } } } });
 });
 };

 const selectedResourceLabels = useMemo(() => {
 const map = new Map<string, Record<string, string>>();
 const rawItems = (data?.allItems ?? []) as Array<{ metadata: { name: string; namespace?: string; labels?: Record<string, string> } }>;
 for (const key of selectedItems) {
 const [ns, n] = key.split('/');
 const raw = rawItems.find((r) => r.metadata.namespace === ns && r.metadata.name === n);
 if (raw) map.set(key, raw.metadata.labels ?? {});
 }
 return map;
 }, [selectedItems, data?.allItems]);

 const exportConfig = {
 filenamePrefix: 'roles',
 resourceLabel: 'Roles',
 getExportData: (r: Role) => ({ name: r.name, namespace: r.namespace, rules: r.rulesCount, apiGroups: r.apiGroups, resources: r.resources, verbs: r.verbs, age: r.age }),
 csvColumns: [
 { label: 'Name', getValue: (r: Role) => r.name },
 { label: 'Namespace', getValue: (r: Role) => r.namespace },
 { label: 'Rules', getValue: (r: Role) => r.rulesCount },
 { label: 'Age', getValue: (r: Role) => r.age },
 ],
 };

 if (showCreator) {
 return (
 <ResourceCreator
 resourceKind="Role"
 defaultYaml={DEFAULT_YAMLS.Role}
 onClose={() => setShowCreator(false)}
 onApply={() => {
 toast.success('Role created');
 setShowCreator(false);
 refetch();
 }}
 />
 );
 }

 return (
 <>
 <PageLayout label="Roles">
 <ListPageHeader
 icon={<Shield className="h-6 w-6 text-primary" />}
 title="Roles"
 resourceCount={searchFiltered.length}
 subtitle={items.length > 0 ? `across ${new Set(items.map((r) => r.namespace)).size} namespaces` : undefined}
 demoMode={!isConnected}
 dataUpdatedAt={hookPagination?.dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create"
 onCreate={() => setShowCreator(true)}
 actions={
 <>
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => `${r.namespace}/${r.name}`} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected roles' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
 <ListPageStatCard label="Total" value={stats.total} icon={Shield} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Admin" value={stats.admin} icon={Shield} iconColor="text-destructive" valueClassName="text-destructive" selected={columnFilters.permissionLevel?.size === 1 && columnFilters.permissionLevel.has('Admin')} onClick={() => setColumnFilter('permissionLevel', new Set(['Admin']))} className={cn(columnFilters.permissionLevel?.size === 1 && columnFilters.permissionLevel.has('Admin') && 'ring-2 ring-destructive')} isLoading={isLoading} />
 <ListPageStatCard label="Read-Only" value={stats.readOnly} icon={Shield} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.permissionLevel?.size === 1 && columnFilters.permissionLevel.has('Read-Only')} onClick={() => setColumnFilter('permissionLevel', new Set(['Read-Only']))} className={cn(columnFilters.permissionLevel?.size === 1 && columnFilters.permissionLevel.has('Read-Only') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard label="Custom" value={stats.custom} icon={Shield} iconColor="text-muted-foreground" selected={columnFilters.permissionLevel?.size === 1 && columnFilters.permissionLevel.has('Custom')} onClick={() => setColumnFilter('permissionLevel', new Set(['Custom']))} className={cn(columnFilters.permissionLevel?.size === 1 && columnFilters.permissionLevel.has('Custom') && 'ring-2 ring-muted-foreground')} isLoading={isLoading} />
 </div>

 <BulkActionBar
 selectedCount={selectedItems.size}
 resourceName="role"
 resourceType="roles"
 onClearSelection={() => multiSelect.clearSelection()}
 onBulkDelete={handleBulkDelete}
 onBulkLabel={handleBulkLabel}
 />

 <ResourceListTableToolbar
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
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
 <Input placeholder="Search roles..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search roles" />
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
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={ROLES_COLUMNS_FOR_VISIBILITY}
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
 <ResizableTableProvider tableId="roles" columnConfig={ROLE_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 950 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="status"><TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="rules"><TableColumnHeaderWithFilterAndSort columnId="rules" label="Rules" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="apiGroups"><TableColumnHeaderWithFilterAndSort columnId="apiGroups" label="API Groups" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="resources"><TableColumnHeaderWithFilterAndSort columnId="resources" label="Resources" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="verbs"><TableColumnHeaderWithFilterAndSort columnId="verbs" label="Verbs" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="bindings"><TableColumnHeaderWithFilterAndSort columnId="bindings" label="Bindings" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="namespace" className="p-1.5"><TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} /></ResizableTableCell>
 <ResizableTableCell columnId="status" className="p-1.5" />
 <ResizableTableCell columnId="rules" className="p-1.5"><TableFilterCell columnId="permissionLevel" label="Permission Level" distinctValues={distinctValuesByColumn.permissionLevel ?? []} selectedFilterValues={columnFilters.permissionLevel ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.permissionLevel} /></ResizableTableCell>
 <ResizableTableCell columnId="apiGroups" className="p-1.5" />
 <ResizableTableCell columnId="resources" className="p-1.5" />
 <ResizableTableCell columnId="verbs" className="p-1.5" />
 <ResizableTableCell columnId="bindings" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={10} resourceName="roles" isLoading={isLoading} onRetry={() => refetch()} />
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
 icon={<Shield className="h-8 w-8" />}
 title="No Roles found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Define namespace-scoped RBAC roles.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create Role"
 onCreate={() => setShowCreator(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((r, idx) => (
 <tr key={`${r.namespace}/${r.name}`} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(`${r.namespace}/${r.name}`) && 'bg-primary/5')}>
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(r, e); }}><Checkbox checked={selectedItems.has(`${r.namespace}/${r.name}`)} tabIndex={-1} aria-label={`Select ${r.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/roles/${r.namespace}/${r.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <Shield className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{r.name}</span>
 </Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={r.namespace} /></ResizableTableCell>
 <ResizableTableCell columnId="status"><StatusPill variant="success" label="Active" /></ResizableTableCell>
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
 <ResizableTableCell columnId="bindings" className="text-muted-foreground">{r.bindings}</ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={r.age} timestamp={r.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="Role actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <CopyNameDropdownItem name={r.name} namespace={r.namespace} />
 <DropdownMenuItem onClick={() => navigate(`/roles/${r.namespace}/${r.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/roles/${r.namespace}/${r.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
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
 </PageLayout>

 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null, bulk: open ? deleteDialog.bulk : false })}
 resourceType="Role"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name || '')}
 namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace}
 onConfirm={handleDelete}
 requireNameConfirmation={!deleteDialog.bulk}
 />
 </>
 );
}
