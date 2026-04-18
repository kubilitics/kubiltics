import { useState, useMemo, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import {
 RefreshCw, MoreHorizontal, CheckCircle2, XCircle, Clock, Loader2, WifiOff, Plus,
 Trash2, FileText, Search, FileCode, ChevronDown,
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
import { useK8sResourceList, useDeleteK8sResource, usePatchK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog, BulkActionBar, executeBulkOperation } from '@/components/resources';
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
import { toast } from '@/components/ui/sonner';

interface CRDVersion {
 name: string;
 served?: boolean;
 storage?: boolean;
}

interface CRDCondition {
 type: string;
 status: string;
 reason?: string;
 message?: string;
}

interface CRDResource extends KubernetesResource {
 spec?: {
 group?: string;
 scope?: string;
 names?: {
 kind?: string;
 plural?: string;
 singular?: string;
 };
 versions?: CRDVersion[];
 };
 status?: {
 conditions?: CRDCondition[];
 acceptedNames?: { kind?: string };
 };
}

interface CustomResourceDefinition {
 name: string;
 group: string;
 kind: string;
 scope: 'Namespaced' | 'Cluster';
 versionsCount: number;
 storageVersion: string;
 established: boolean;
 age: string;
 creationTimestamp?: string;
}

const CRD_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 300, minWidth: 150 },
 { id: 'group', defaultWidth: 220, minWidth: 120 },
 { id: 'kind', defaultWidth: 160, minWidth: 100 },
 { id: 'scope', defaultWidth: 160, minWidth: 100 },
 { id: 'version', defaultWidth: 160, minWidth: 100 },
 { id: 'versions', defaultWidth: 100, minWidth: 70 },
 { id: 'established', defaultWidth: 140, minWidth: 100 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const CRD_COLUMNS_FOR_VISIBILITY = [
 { id: 'group', label: 'Group' },
 { id: 'kind', label: 'Kind' },
 { id: 'scope', label: 'Scope' },
 { id: 'version', label: 'Version' },
 { id: 'versions', label: 'Served' },
 { id: 'established', label: 'Established' },
 { id: 'age', label: 'Age' },
];

function transformCRD(resource: CRDResource): CustomResourceDefinition {
 const spec = resource.spec ?? {};
 const group = spec.group ?? '-';
 const kind = spec.names?.kind ?? '-';
 const scope = spec.scope === 'Namespaced' ? 'Namespaced' : 'Cluster';
 const versions = spec.versions ?? [];
 const servedVersions = versions.filter((v) => v.served !== false);
 const versionsCount = servedVersions.length;
 const storageVer = versions.find((v) => v.storage === true);
 const storageVersion = storageVer?.name ?? (versions[0]?.name ?? '-');

 const conditions = resource.status?.conditions ?? [];
 const established = conditions.some(
 (c) => c.type === 'Established' && c.status === 'True'
 );

 return {
 name: resource.metadata.name,
 group,
 kind,
 scope,
 versionsCount,
 storageVersion,
 established,
 age: calculateAge(resource.metadata.creationTimestamp),
 creationTimestamp: resource.metadata?.creationTimestamp,
 };
}

const CRDYaml = `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
 name: ''
spec:
 group: ''
 versions:
 - name: v1
 served: true
 storage: true
 schema:
 openAPIV3Schema:
 type: object
 properties:
 spec:
 type: object
 scope: Namespaced
 names:
 plural: ''
 singular: ''
 kind: ''
 shortNames: []
`;

export default function CustomResourceDefinitions() {
 const navigate = useNavigate();
 const [searchQuery, setSearchQuery] = useState('');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: CustomResourceDefinition | null; bulk?: boolean }>({ open: false, item: null });
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const multiSelect = useMultiSelect();
 const selectedItems = multiSelect.selectedIds;
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<CRDResource>('customresourcedefinitions', undefined, { limit: 5000 });
 const deleteResource = useDeleteK8sResource('customresourcedefinitions');
 const patchCRD = usePatchK8sResource('customresourcedefinitions');

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const items: CustomResourceDefinition[] = isConnected && data
 ? (data.items ?? []).map(transformCRD)
 : [];

 const stats = useMemo(() => ({
 total: items.length,
 established: items.filter((i) => i.established).length,
 notEstablished: items.filter((i) => !i.established).length,
 customGroups: new Set(items.map((i) => i.group).filter((g) => g !== '-')).size,
 }), [items]);

 const itemsAfterSearch = useMemo(() =>
 items.filter((item) =>
 item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
 item.group.toLowerCase().includes(searchQuery.toLowerCase()) ||
 item.kind.toLowerCase().includes(searchQuery.toLowerCase())
 ),
 [items, searchQuery]);

 const crdColumnConfig: ColumnConfig<CustomResourceDefinition>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'group', getValue: (i) => i.group, sortable: true, filterable: true },
 { columnId: 'hasCustomGroup', getValue: (i) => (i.group !== '-' ? 'Yes' : 'No'), sortable: false, filterable: true },
 { columnId: 'kind', getValue: (i) => i.kind, sortable: true, filterable: false },
 { columnId: 'scope', getValue: (i) => i.scope, sortable: true, filterable: true },
 { columnId: 'version', getValue: (i) => i.storageVersion, sortable: true, filterable: false },
 { columnId: 'versions', getValue: (i) => i.versionsCount, sortable: true, filterable: false },
 { columnId: 'established', getValue: (i) => String(i.established), sortable: true, filterable: true },
 {
   columnId: 'age',
   getValue: (i) => i.age,
   sortValue: (i) => -(i.creationTimestamp ? Date.parse(i.creationTimestamp) : 0),
   sortable: true,
   filterable: false,
 },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearch, { columns: crdColumnConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'customresourcedefinitions', columns: CRD_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const totalFiltered = filteredItems.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredItems.slice(start, start + pageSize);

 useEffect(() => {
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [safePageIndex, pageIndex]);

 const allItemKeys = useMemo(() => itemsOnPage.map((i) => i.name), [itemsOnPage]);

 const toggleSelection = (item: CustomResourceDefinition, event?: React.MouseEvent) => {
 if (event?.shiftKey) {
 multiSelect.toggleRange(item.name, allItemKeys);
 } else {
 multiSelect.toggle(item.name);
 }
 };

 const toggleAll = () => {
 if (multiSelect.isAllSelected(allItemKeys)) multiSelect.clearSelection();
 else multiSelect.selectAll(allItemKeys);
 };

 const isAllSelected = multiSelect.isAllSelected(allItemKeys);
 const isSomeSelected = multiSelect.isSomeSelected(allItemKeys);

 const handleDelete = async () => {
 if (!isConnected) { toast.error('Connect cluster to delete CRDs'); return; }
 if (deleteDialog.bulk && selectedItems.size > 0) {
 for (const name of selectedItems) {
 await deleteResource.mutateAsync({ name, namespace: '' });
 }
 multiSelect.clearSelection();
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: '' });
 }
 setDeleteDialog({ open: false, item: null });
 };

 const handleBulkDelete = async () => {
 return executeBulkOperation(Array.from(selectedItems).map((n) => `_/${n}`), async (_key, _ns, name) => {
 await deleteResource.mutateAsync({ name, namespace: '' });
 });
 };

 const handleBulkLabel = async (label: string) => {
 return executeBulkOperation(Array.from(selectedItems).map((n) => `_/${n}`), async (_key, _ns, name) => {
 await patchCRD.mutateAsync({ name, patch: { metadata: { labels: { [label.split("=")[0]]: label.split("=")[1] } } } });
 });
 };

 const selectedResourceLabels = useMemo(() => {
 const map = new Map<string, Record<string, string>>();
 const rawItems = (data?.allItems ?? []) as Array<{ metadata: { name: string; labels?: Record<string, string> } }>;
 for (const n of selectedItems) {
 const raw = rawItems.find((r) => r.metadata.name === n);
 if (raw) map.set(n, raw.metadata.labels ?? {});
 }
 return map;
 }, [selectedItems, data?.allItems]);

 const exportConfig = {
 filenamePrefix: 'customresourcedefinitions',
 resourceLabel: 'custom resource definitions',
 getExportData: (d: CustomResourceDefinition) => ({ name: d.name, group: d.group, kind: d.kind, scope: d.scope, versions: d.versionsCount, established: d.established, age: d.age }),
 csvColumns: [
 { label: 'Name', getValue: (d: CustomResourceDefinition) => d.name },
 { label: 'Group', getValue: (d: CustomResourceDefinition) => d.group },
 { label: 'Kind', getValue: (d: CustomResourceDefinition) => d.kind },
 { label: 'Scope', getValue: (d: CustomResourceDefinition) => d.scope },
 { label: 'Versions', getValue: (d: CustomResourceDefinition) => d.versionsCount },
 { label: 'Established', getValue: (d: CustomResourceDefinition) => String(d.established) },
 { label: 'Age', getValue: (d: CustomResourceDefinition) => d.age },
 ],
 toK8sYaml: (d: CustomResourceDefinition) => `---
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
 name: ${d.name}
spec:
 group: ${d.group}
 scope: ${d.scope}
 names:
 kind: ${d.kind}
`,
 };

 return (
 <PageLayout label="Custom Resource Definitions">
 <div className="flex items-center justify-between flex-wrap gap-4">
 <div className="flex items-center gap-3 flex-wrap">
 <div className="p-2.5 rounded-xl bg-primary/10"><FileCode className="h-6 w-6 text-primary" /></div>
 <div>
 <h1 className="text-2xl font-semibold tracking-tight">Custom Resource Definitions</h1>
 <p className="text-sm text-muted-foreground">
 {filteredItems.length} CRDs (cluster-scoped)
 {!isConnected && <span className="ml-2 inline-flex items-center gap-1 text-amber-600"><WifiOff className="h-3 w-3" /> Connect cluster</span>}
 </p>
 </div>
 {selectedItems.size > 0 && (
 <div className="flex items-center gap-2 ml-2 pl-2 border-l border-border">
 <span className="text-sm text-muted-foreground">{selectedItems.size} selected</span>
 <Button variant="ghost" size="sm" className="h-8" onClick={() => multiSelect.clearSelection()}>Clear</Button>
 </div>
 )}
 </div>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown
 items={filteredItems}
 selectedKeys={selectedItems}
 getKey={(i) => i.name}
 config={exportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected CRDs' : 'All visible'}
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
 <ListPageStatCard label="Total" value={stats.total} icon={FileCode} iconColor="text-primary" selected={!hasActiveFilters} onClick={() => clearAllFilters()} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Established" value={stats.established} icon={CheckCircle2} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.established?.size === 1 && columnFilters.established.has('true')} onClick={() => setColumnFilter('established', columnFilters.established?.has('true') ? null : new Set(['true']))} className={cn(columnFilters.established?.size === 1 && columnFilters.established.has('true') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard label="Not Established" value={stats.notEstablished} icon={XCircle} iconColor="text-rose-600" valueClassName="text-rose-600" selected={columnFilters.established?.size === 1 && columnFilters.established.has('false')} onClick={() => setColumnFilter('established', columnFilters.established?.has('false') ? null : new Set(['false']))} className={cn(columnFilters.established?.size === 1 && columnFilters.established.has('false') && 'ring-2 ring-rose-500')} isLoading={isLoading} />
 <ListPageStatCard
 label="Custom Groups"
 value={stats.customGroups}
 icon={Clock}
 iconColor="text-amber-600"
 valueClassName="text-amber-600"
 selected={columnFilters.hasCustomGroup?.size === 1 && columnFilters.hasCustomGroup.has('Yes')}
 onClick={() =>
 setColumnFilter(
 'hasCustomGroup',
 columnFilters.hasCustomGroup?.size === 1 && columnFilters.hasCustomGroup.has('Yes') ? null : new Set(['Yes'])
 )
 }
 className={cn(columnFilters.hasCustomGroup?.size === 1 && columnFilters.hasCustomGroup.has('Yes') && 'ring-2 ring-amber-500')}
 isLoading={isLoading} />
 </div>

 <BulkActionBar
 selectedCount={selectedItems.size}
 resourceName="CRD"
 resourceType="customresourcedefinitions"
 onClearSelection={() => multiSelect.clearSelection()}
 onBulkDelete={handleBulkDelete}
 onBulkLabel={handleBulkLabel}
 />

 <ResourceListTableToolbar
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 globalFilterBar={
 <ResourceCommandBar
 scope={<ClusterScopedScope />}
 search={
 <div className="relative w-full min-w-0">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input placeholder="Search CRDs..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all" />
 </div>
 }
 />
 }
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={CRD_COLUMNS_FOR_VISIBILITY}
 visibleColumns={columnVisibility.visibleColumns}
 onColumnToggle={columnVisibility.setColumnVisible}
 isLoading={isLoading && isConnected}
 footer={
 <div className="flex items-center justify-between flex-wrap gap-2">
 <div className="flex items-center gap-3">
 <span className="text-sm text-muted-foreground">{totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No CRDs'}</span>
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
 <ListPagination hasPrev={safePageIndex > 0} hasNext={start + pageSize < totalFiltered} onPrev={() => setPageIndex((i) => Math.max(0, i - 1))} onNext={() => setPageIndex((i) => Math.min(totalPages - 1, i + 1))} rangeLabel={undefined} currentPage={safePageIndex + 1} totalPages={Math.max(1, totalPages)} onPageChange={(p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1)))} dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} />
 </div>
 }
 >
 <ResizableTableProvider tableId="customresourcedefinitions" columnConfig={CRD_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 1150 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 {columnVisibility.isColumnVisible('group') && <ResizableTableHead columnId="group"><TableColumnHeaderWithFilterAndSort columnId="group" label="Group" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('kind') && <ResizableTableHead columnId="kind"><TableColumnHeaderWithFilterAndSort columnId="kind" label="Kind" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('scope') && <ResizableTableHead columnId="scope"><TableColumnHeaderWithFilterAndSort columnId="scope" label="Scope" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('version') && <ResizableTableHead columnId="version"><TableColumnHeaderWithFilterAndSort columnId="version" label="Version" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('versions') && <ResizableTableHead columnId="versions"><TableColumnHeaderWithFilterAndSort columnId="versions" label="Served" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('established') && <ResizableTableHead columnId="established"><TableColumnHeaderWithFilterAndSort columnId="established" label="Established" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 {columnVisibility.isColumnVisible('group') && <ResizableTableCell columnId="group" className="p-1.5" />}
 {columnVisibility.isColumnVisible('kind') && <ResizableTableCell columnId="kind" className="p-1.5" />}
 {columnVisibility.isColumnVisible('scope') && <ResizableTableCell columnId="scope" className="p-1.5"><TableFilterCell columnId="scope" label="Scope" distinctValues={distinctValuesByColumn.scope ?? []} selectedFilterValues={columnFilters.scope ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.scope} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('version') && <ResizableTableCell columnId="version" className="p-1.5" />}
 {columnVisibility.isColumnVisible('versions') && <ResizableTableCell columnId="versions" className="p-1.5" />}
 {columnVisibility.isColumnVisible('established') && <ResizableTableCell columnId="established" className="p-1.5"><TableFilterCell columnId="established" label="Established" distinctValues={distinctValuesByColumn.established ?? []} selectedFilterValues={columnFilters.established ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.established} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
 <TableCell className="w-12" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={9} resourceName="CRDs" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={9} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : !isConnected ? (
 <TableRow><TableCell colSpan={9} className="h-32 text-center"><div className="flex flex-col items-center gap-2"><WifiOff className="h-8 w-8 opacity-50" /><p className="text-sm text-muted-foreground">Connect cluster to view custom resource definitions</p></div></TableCell></TableRow>
 ) : itemsOnPage.length === 0 ? (
 <TableRow>
 <TableCell colSpan={9} className="h-40 text-center">
 <TableEmptyState
 icon={<FileCode className="h-8 w-8" />}
 title="No custom resource definitions found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Define custom resources to extend the Kubernetes API.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create CRD"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((item, idx) => {
 const isSelected = selectedItems.has(item.name);
 return (
 <tr key={item.name} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(item, e); }}><Checkbox checked={isSelected} tabIndex={-1} /></TableCell>
 <ResizableTableCell columnId="name">
 <button className="font-medium flex items-center gap-2 truncate cursor-pointer text-primary hover:underline bg-transparent border-none p-0 text-left" onClick={() => navigate(`/customresourcedefinitions/${item.name}`)}>
 <FileCode className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 </button>
 </ResizableTableCell>
 {columnVisibility.isColumnVisible('group') && <ResizableTableCell columnId="group" className="font-mono text-xs text-muted-foreground truncate" title={item.group}>{item.group}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('kind') && <ResizableTableCell columnId="kind">{item.kind !== '-' ? (<Link to={`/customresources?crd=${encodeURIComponent(item.name)}`} className="font-mono text-xs truncate block w-fit max-w-full text-primary hover:underline">{item.kind}</Link>) : <span className="text-muted-foreground text-xs">-</span>}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('scope') && <ResizableTableCell columnId="scope"><Badge variant={item.scope === 'Namespaced' ? 'outline' : 'secondary'} className="text-xs">{item.scope}</Badge></ResizableTableCell>}
 {columnVisibility.isColumnVisible('version') && <ResizableTableCell columnId="version" className="font-mono text-xs">{item.storageVersion}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('versions') && <ResizableTableCell columnId="versions"><Badge variant="outline" className="font-mono text-xs">{item.versionsCount}</Badge></ResizableTableCell>}
 {columnVisibility.isColumnVisible('established') && <ResizableTableCell columnId="established"><Badge variant={item.established ? 'default' : 'destructive'} className="text-xs">{item.established ? 'Yes' : 'No'}</Badge></ResizableTableCell>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>}
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem onClick={() => navigate(`/customresourcedefinitions/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/customresources?crd=${encodeURIComponent(item.name)}`)} className="gap-2">View Instances</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/customresourcedefinitions/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
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
 resourceKind="CustomResourceDefinition"
 defaultYaml={CRDYaml}
 onClose={() => setShowCreateWizard(false)}
 onApply={async (yaml) => {
 if (!isConnected) { toast.error('Connect cluster to create CRDs'); return; }
 toast.success('CustomResourceDefinition created successfully');
 setShowCreateWizard(false);
 refetch();
 }}
 />
 )}

 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
 resourceType="CustomResourceDefinition"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} CRDs` : (deleteDialog.item?.name || '')}
 namespace={undefined}
 onConfirm={handleDelete}
 />
 </PageLayout>
 );
}
