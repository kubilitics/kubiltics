import { useState, useMemo, useEffect } from 'react';
import { Link2, Search, RefreshCw, MoreHorizontal,
 WifiOff, Plus, ChevronDown, Globe, CheckSquare, Trash2 } from 'lucide-react';
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

interface Subject {
 kind: string;
 name: string;
 namespace?: string;
}

interface ClusterRoleBindingResource extends KubernetesResource {
 roleRef?: { kind?: string; name?: string; apiGroup?: string };
 subjects?: Subject[];
}

interface ClusterRoleBindingRow {
 name: string;
 clusterRoleName: string;
 subjectsSummary: string;
 subjectsTooltip: string;
 subjectKinds: string[];
 subjectCount: number;
 age: string;
 creationTimestamp?: string;
 hasUser: boolean;
 hasGroup: boolean;
 hasServiceAccount: boolean;
}

function transformClusterRoleBinding(r: ClusterRoleBindingResource): ClusterRoleBindingRow {
 const subjects = r.subjects || [];
 const roleName = r.roleRef?.name || '–';
 const kinds = [...new Set(subjects.map((s) => s.kind || 'Unknown'))];
 const summary = subjects.length
 ? subjects.slice(0, 2).map((s) => (s.namespace ? `${s.kind}/${s.namespace}/${s.name}` : `${s.kind}/${s.name}`)).join(', ') + (subjects.length > 2 ? '…' : '')
 : '–';
 const subjectsTooltip = subjects.length
 ? subjects.map((s) => (s.namespace ? `${s.kind}/${s.namespace}/${s.name}` : `${s.kind}/${s.name}`)).join('\n')
 : '';
 return {
 name: r.metadata.name,
 clusterRoleName: roleName,
 subjectsSummary: summary,
 subjectsTooltip,
 subjectKinds: kinds,
 subjectCount: subjects.length,
 age: calculateAge(r.metadata.creationTimestamp),
 creationTimestamp: r.metadata?.creationTimestamp,
 hasUser: subjects.some((s) => s.kind === 'User'),
 hasGroup: subjects.some((s) => s.kind === 'Group'),
 hasServiceAccount: subjects.some((s) => s.kind === 'ServiceAccount'),
 };
}

const CLUSTER_ROLE_BINDING_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 200, minWidth: 100 },
 { id: 'clusterRole', defaultWidth: 160, minWidth: 90 },
 { id: 'subjects', defaultWidth: 220, minWidth: 100 },
 { id: 'subjectKinds', defaultWidth: 140, minWidth: 90 },
 { id: 'subjectCount', defaultWidth: 90, minWidth: 50 },
 { id: 'scope', defaultWidth: 110, minWidth: 80 },
 { id: 'age', defaultWidth: 90, minWidth: 56 },
];

const CLUSTERROLEBINDINGS_COLUMNS_FOR_VISIBILITY = [
 { id: 'clusterRole', label: 'Cluster Role' },
 { id: 'subjects', label: 'Subjects' },
 { id: 'subjectKinds', label: 'Subject Kinds' },
 { id: 'subjectCount', label: 'Subject Count' },
 { id: 'scope', label: 'Scope' },
 { id: 'age', label: 'Age' },
];

export default function ClusterRoleBindings() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, refetch, pagination: hookPagination } = usePaginatedResourceList<ClusterRoleBindingResource>('clusterrolebindings');
 const deleteResource = useDeleteK8sResource('clusterrolebindings');

 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: ClusterRoleBindingRow | null; bulk?: boolean }>({ open: false, item: null });
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [showCreator, setShowCreator] = useState(false);
 const [searchQuery, setSearchQuery] = useState('');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const allItems = (data?.allItems ?? []) as ClusterRoleBindingResource[];
 const items: ClusterRoleBindingRow[] = useMemo(() => (isConnected ? allItems.map(transformClusterRoleBinding) : []), [isConnected, allItems]);

 const tableConfig: ColumnConfig<ClusterRoleBindingRow>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'clusterRole', getValue: (i) => i.clusterRoleName, sortable: true, filterable: false },
 { columnId: 'subjects', getValue: (i) => i.subjectsSummary, sortable: true, filterable: false },
 { columnId: 'subjectKinds', getValue: (i) => i.subjectKinds.join(', '), sortable: true, filterable: true },
 { columnId: 'subjectCount', getValue: (i) => i.subjectCount, sortable: true, filterable: false, compare: (a, b) => a.subjectCount - b.subjectCount },
 { columnId: 'scope', getValue: () => '–', sortable: false, filterable: false },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(items, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'clusterrolebindings', columns: CLUSTERROLEBINDINGS_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const searchFiltered = useMemo(() => {
 if (!searchQuery.trim()) return filteredItems;
 const q = searchQuery.toLowerCase();
 return filteredItems.filter((r) =>
 r.name.toLowerCase().includes(q) ||
 r.clusterRoleName.toLowerCase().includes(q) ||
 r.subjectsSummary.toLowerCase().includes(q)
 );
 }, [filteredItems, searchQuery]);

 const stats = useMemo(() => {
 const total = items.length;
 const withUserSubjects = items.filter((r) => r.hasUser).length;
 const withGroupSubjects = items.filter((r) => r.hasGroup).length;
 const serviceAccountSubjects = items.filter((r) => r.hasServiceAccount).length;
 return { total, withUserSubjects, withGroupSubjects, serviceAccountSubjects };
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
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No cluster role bindings',
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
 toast.success(`Deleted ${selectedItems.size} cluster role binding(s)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name });
 toast.success(`Cluster role binding ${deleteDialog.item.name} deleted`);
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 };

 const toggleSelection = (r: ClusterRoleBindingRow) => {
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
 filenamePrefix: 'cluster-role-bindings',
 resourceLabel: 'Cluster Role Bindings',
 getExportData: (r: ClusterRoleBindingRow) => ({ name: r.name, clusterRole: r.clusterRoleName, subjectCount: r.subjectCount, age: r.age }),
 csvColumns: [
 { label: 'Name', getValue: (r: ClusterRoleBindingRow) => r.name },
 { label: 'Cluster Role', getValue: (r: ClusterRoleBindingRow) => r.clusterRoleName },
 { label: 'Subject Count', getValue: (r: ClusterRoleBindingRow) => r.subjectCount },
 { label: 'Age', getValue: (r: ClusterRoleBindingRow) => r.age },
 ],
 };

 if (showCreator) {
 return (
 <ResourceCreator
 resourceKind="ClusterRoleBinding"
 defaultYaml={DEFAULT_YAMLS.ClusterRoleBinding}
 onClose={() => setShowCreator(false)}
 onApply={() => {
 toast.success('ClusterRoleBinding created');
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
 icon={<Link2 className="h-6 w-6 text-primary" />}
 title="Cluster Role Bindings"
 resourceCount={searchFiltered.length}
 subtitle="Cluster-scoped"
 demoMode={!isConnected}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create"
 onCreate={() => setShowCreator(true)}
 actions={
 <>
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => r.name} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected cluster role bindings' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
 <ListPageStatCard label="Total" value={stats.total} icon={Link2} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="With User subjects" value={stats.withUserSubjects} icon={Link2} iconColor="text-blue-500" valueClassName="text-blue-500" selected={columnFilters.subjectKinds?.size === 1 && columnFilters.subjectKinds.has('User')} onClick={() => setColumnFilter('subjectKinds', new Set(['User']))} className={cn(columnFilters.subjectKinds?.size === 1 && columnFilters.subjectKinds.has('User') && 'ring-2 ring-blue-500')} isLoading={isLoading} />
 <ListPageStatCard label="With Group subjects" value={stats.withGroupSubjects} icon={Link2} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.subjectKinds?.size === 1 && columnFilters.subjectKinds.has('Group')} onClick={() => setColumnFilter('subjectKinds', new Set(['Group']))} className={cn(columnFilters.subjectKinds?.size === 1 && columnFilters.subjectKinds.has('Group') && 'ring-2 ring-amber-500')} isLoading={isLoading} />
 <ListPageStatCard label="Service Account subjects" value={stats.serviceAccountSubjects} icon={Link2} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.subjectKinds?.size === 1 && columnFilters.subjectKinds.has('ServiceAccount')} onClick={() => setColumnFilter('subjectKinds', new Set(['ServiceAccount']))} className={cn(columnFilters.subjectKinds?.size === 1 && columnFilters.subjectKinds.has('ServiceAccount') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 </div>

 {/* Bulk Actions Bar */}
 {selectedItems.size > 0 && (
 <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
 <Badge variant="secondary" className="gap-1.5">
 <CheckSquare className="h-3.5 w-3.5" />
 {selectedItems.size} selected
 </Badge>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(r) => r.name} config={exportConfig} selectionLabel="Selected cluster role bindings" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
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
 <Input placeholder="Search cluster role bindings..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search cluster role bindings" />
 </div>
 }
 />
 }
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={CLUSTERROLEBINDINGS_COLUMNS_FOR_VISIBILITY}
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
 <ResizableTableProvider tableId="clusterrolebindings" columnConfig={CLUSTER_ROLE_BINDING_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 900 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="clusterRole"><TableColumnHeaderWithFilterAndSort columnId="clusterRole" label="Cluster Role" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="subjects"><TableColumnHeaderWithFilterAndSort columnId="subjects" label="Subjects" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="subjectKinds"><TableColumnHeaderWithFilterAndSort columnId="subjectKinds" label="Subject Kinds" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="subjectCount"><TableColumnHeaderWithFilterAndSort columnId="subjectCount" label="Subject Count" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="scope"><TableColumnHeaderWithFilterAndSort columnId="scope" label="Scope" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="clusterRole" className="p-1.5" />
 <ResizableTableCell columnId="subjects" className="p-1.5" />
 <ResizableTableCell columnId="subjectKinds" className="p-1.5"><TableFilterCell columnId="subjectKinds" label="Subject Kinds" distinctValues={distinctValuesByColumn.subjectKinds ?? []} selectedFilterValues={columnFilters.subjectKinds ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.subjectKinds} /></ResizableTableCell>
 <ResizableTableCell columnId="subjectCount" className="p-1.5" />
 <ResizableTableCell columnId="scope" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={9} resourceName="cluster role bindings" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={9} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : searchFiltered.length === 0 ? (
 <TableRow>
 <TableCell colSpan={9} className="h-40 text-center">
 <TableEmptyState
 icon={<Link2 className="h-8 w-8" />}
 title="No ClusterRoleBindings found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Bind ClusterRoles to subjects for cluster-scoped access.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create ClusterRoleBinding"
 onCreate={() => setShowCreator(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((r, idx) => (
 <tr key={r.name} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(r.name) && 'bg-primary/5')}>
 <TableCell><Checkbox checked={selectedItems.has(r.name)} onCheckedChange={() => toggleSelection(r)} aria-label={`Select ${r.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/clusterrolebindings/${r.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <Link2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{r.name}</span>
 </Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="clusterRole">
 <Link to={`/clusterroles/${r.clusterRoleName}`} className="text-primary hover:underline font-mono text-sm truncate block">{r.clusterRoleName}</Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="subjects" className="text-muted-foreground text-sm" title={r.subjectsTooltip || undefined}>
 <span className="font-mono">{r.subjectCount}</span>
 {r.subjectCount > 0 && <span className="ml-1 text-muted-foreground">subject{r.subjectCount !== 1 ? 's' : ''}</span>}
 </ResizableTableCell>
 <ResizableTableCell columnId="subjectKinds">
 <div className="flex flex-wrap gap-1">
 {r.hasUser && <Badge variant="outline" className="text-xs">User</Badge>}
 {r.hasGroup && <Badge variant="outline" className="text-xs">Group</Badge>}
 {r.hasServiceAccount && <Badge variant="outline" className="text-xs">ServiceAccount</Badge>}
 {!r.hasUser && !r.hasGroup && !r.hasServiceAccount && <span className="text-muted-foreground">–</span>}
 </div>
 </ResizableTableCell>
 <ResizableTableCell columnId="subjectCount" className="font-mono text-sm">{r.subjectCount}</ResizableTableCell>
 <ResizableTableCell columnId="scope">
 <Badge variant="secondary" className="gap-1"><Globe className="h-3 w-3" /> Cluster-wide</Badge>
 </ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={r.age} timestamp={r.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="Cluster role binding actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <CopyNameDropdownItem name={r.name} />
 <DropdownMenuItem onClick={() => navigate(`/clusterrolebindings/${r.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/clusterrolebindings/${r.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
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
 resourceType="ClusterRoleBinding"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name || '')}
 onConfirm={handleDelete}
 requireNameConfirmation={!deleteDialog.bulk}
 />
 </>
 );
}
