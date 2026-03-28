import { useState, useMemo, useEffect } from 'react';
import { 
 Search, 
 RefreshCw, 
 MoreHorizontal,
 Download,
 Route,
 Loader2,
 WifiOff,
 Plus,
 Trash2,
 CheckSquare,
 ExternalLink,
 Star,
 ChevronDown,
 ChevronRight,
 List,
 Layers,
 FileText,
 CheckCircle2,
} from 'lucide-react';
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
import { ResizableTableProvider, ResizableTableHead, ResizableTableCell, type ResizableColumnConfig } from '@/components/ui/resizable-table';
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuTrigger,
 DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { useK8sResourceList, useDeleteK8sResource, usePatchK8sResource, calculateAge } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog, BulkActionBar, executeBulkOperation } from '@/components/resources';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { IngressClassWizard } from '@/components/wizards';
import { ResourceExportDropdown, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, resourceTableRowClassName, ResourceCommandBar, ClusterScopedScope, ListPagination, PAGE_SIZE_OPTIONS, ListViewSegmentedControl, ROW_MOTION, AgeCell, TableEmptyState, ListPageLoadingShell, TableErrorState, CopyNameDropdownItem, ResourceListTableToolbar, StatusPill } from '@/components/list';
import { IngressIcon } from '@/components/icons/KubernetesIcons';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { toast } from '@/components/ui/sonner';

interface IngressClass {
 name: string;
 controller: string;
 isDefault: boolean;
 ingressesCount: number;
 parameters: string;
 age: string;
 creationTimestamp?: string;
}

const INGRESSCLASSES_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'status', defaultWidth: 100, minWidth: 80 },
 { id: 'controller', defaultWidth: 260, minWidth: 150 },
 { id: 'default', defaultWidth: 100, minWidth: 70 },
 { id: 'ingresses', defaultWidth: 100, minWidth: 70 },
 { id: 'parameters', defaultWidth: 160, minWidth: 100 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const INGRESSCLASSES_COLUMNS_FOR_VISIBILITY = [
 { id: 'status', label: 'Status' },
 { id: 'controller', label: 'Controller' },
 { id: 'default', label: 'Default' },
 { id: 'ingresses', label: 'Ingresses' },
 { id: 'parameters', label: 'Parameters' },
 { id: 'age', label: 'Age' },
];

type ListView = 'flat' | 'byController';

export default function IngressClasses() {
 const navigate = useNavigate();
 const [searchQuery, setSearchQuery] = useState('');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: IngressClass | null; bulk?: boolean }>({ open: false, item: null });
 const multiSelect = useMultiSelect();
 const selectedItems = multiSelect.selectedIds;
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);
 const [listView, setListView] = useState<ListView>('flat');
 const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useK8sResourceList('ingressclasses', undefined, { limit: 5000 });
 const { data: ingressesData } = useK8sResourceList<{ spec?: { ingressClassName?: string }; metadata?: { name: string } }>('ingresses', undefined, { limit: 5000 });
 const deleteResource = useDeleteK8sResource('ingressclasses');
 const patchResource = usePatchK8sResource('ingressclasses');

 const ingressCountByClass = useMemo(() => {
 const map = new Map<string, number>();
 (ingressesData?.items ?? []).forEach((ing: { spec?: { ingressClassName?: string }; metadata?: { name: string } }) => {
 const className = ing.spec?.ingressClassName ?? '';
 if (className) map.set(className, (map.get(className) ?? 0) + 1);
 });
 return map;
 }, [ingressesData?.items]);

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const ingressClasses: IngressClass[] = isConnected && data?.items
 ? (data.items as { metadata: { name: string; annotations?: Record<string, string>; creationTimestamp?: string }; spec?: { controller?: string; parameters?: { name?: string } } }[]).map((item) => ({
 name: item.metadata.name,
 controller: item.spec?.controller ?? '-',
 isDefault: item.metadata.annotations?.['ingressclass.kubernetes.io/is-default-class'] === 'true',
 ingressesCount: ingressCountByClass.get(item.metadata.name) ?? 0,
 parameters: item.spec?.parameters?.name ?? '-',
 age: calculateAge(item.metadata.creationTimestamp),
 creationTimestamp: item.metadata?.creationTimestamp,
 }))
 : [];

 const stats = useMemo(() => {
 const defaultClasses = ingressClasses.filter((ic) => ic.isDefault);
 const defaultCount = defaultClasses.length;
 const defaultLabel = defaultCount === 1 ? defaultClasses[0].name : String(defaultCount);
 return {
 total: ingressClasses.length,
 default: defaultLabel,
 active: ingressClasses.filter((ic) => ic.ingressesCount > 0).length,
 controllers: new Set(ingressClasses.map((ic) => ic.controller.split('/')[0])).size,
 };
 }, [ingressClasses]);

 const itemsAfterSearch = useMemo(() => {
 return ingressClasses.filter(ic =>
 ic.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
 ic.controller.toLowerCase().includes(searchQuery.toLowerCase())
 );
 }, [ingressClasses, searchQuery]);

 const ingressClassesTableConfig: ColumnConfig<IngressClass>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'controller', getValue: (i) => i.controller, sortable: true, filterable: true },
 { columnId: 'default', getValue: (i) => (i.isDefault ? 'Yes' : 'No'), sortable: true, filterable: true },
 { columnId: 'hasIngresses', getValue: (i) => i.ingressesCount > 0 ? 'Yes' : 'No', sortable: true, filterable: true },
 { columnId: 'ingresses', getValue: (i) => i.ingressesCount, sortable: true, filterable: false },
 { columnId: 'parameters', getValue: (i) => i.parameters, sortable: true, filterable: false },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredClasses, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearch, { columns: ingressClassesTableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'ingressclasses', columns: INGRESSCLASSES_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const totalFiltered = filteredClasses.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredClasses.slice(start, start + pageSize);

 useEffect(() => {
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [safePageIndex, pageIndex]);

 const groupedOnPage = useMemo(() => {
 if (listView !== 'byController' || itemsOnPage.length === 0) return [];
 const map = new Map<string, IngressClass[]>();
 for (const ic of itemsOnPage) {
 const controllerKey = ic.controller?.split('/')[0] ?? '-';
 const list = map.get(controllerKey) ?? [];
 list.push(ic);
 map.set(controllerKey, list);
 }
 return Array.from(map.entries())
 .map(([label, classes]) => ({ groupKey: `ctrl:${label}`, label, classes }))
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

 const handleDelete = async () => {
 if (deleteDialog.bulk && selectedItems.size > 0) {
 for (const name of selectedItems) {
 if (isConnected) {
 await deleteResource.mutateAsync({ name, namespace: '' });
 }
 }
 toast.success(`Deleted ${selectedItems.size} ingress classes`);
 multiSelect.clearSelection();
 } else if (deleteDialog.item) {
 if (isConnected) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: '' });
 } else {
 toast.success(`IngressClass ${deleteDialog.item.name} deleted (demo mode)`);
 }
 }
 setDeleteDialog({ open: false, item: null });
 };

 const ingressClassExportConfig = {
 filenamePrefix: 'ingressclasses',
 resourceLabel: 'ingress classes',
 getExportData: (ic: IngressClass) => ({ name: ic.name, controller: ic.controller, isDefault: ic.isDefault, ingressesCount: ic.ingressesCount, parameters: ic.parameters, age: ic.age }),
 csvColumns: [
 { label: 'Name', getValue: (ic: IngressClass) => ic.name },
 { label: 'Controller', getValue: (ic: IngressClass) => ic.controller },
 { label: 'Default', getValue: (ic: IngressClass) => (ic.isDefault ? 'Yes' : 'No') },
 { label: 'Parameters', getValue: (ic: IngressClass) => ic.parameters },
 { label: 'Age', getValue: (ic: IngressClass) => ic.age },
 ],
 toK8sYaml: (ic: IngressClass) => `---
apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
 name: ${ic.name}
spec:
 controller: ${ic.controller}
`,
 };

 const allKeys = useMemo(() => itemsOnPage.map(ic => ic.name), [itemsOnPage]);

 const toggleSelection = (item: IngressClass, event?: React.MouseEvent) => {
 const key = item.name;
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
 return executeBulkOperation(Array.from(selectedItems), async (key) => {
 await deleteResource.mutateAsync({ name: key, namespace: '' });
 });
 };

 const handleBulkLabel = async (label: string) => {
 return executeBulkOperation(Array.from(selectedItems), async (key) => {
 await patchResource.mutateAsync({
 name: key,
 namespace: '',
 patch: { metadata: { labels: { [label.split("=")[0]]: label.split("=")[1] } } },
 });
 });
 };

 const pagination = {
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No ingress classes',
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
 <ListPageHeader
 icon={<IngressIcon className="h-6 w-6 text-primary" />}
 title="Ingress Classes"
 resourceCount={filteredClasses.length}
 subtitle="Cluster-scoped"
 demoMode={!isConnected}
 dataUpdatedAt={dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create Class"
 onCreate={() => setShowCreateWizard(true)}
 actions={
 <>
 <ResourceExportDropdown
 items={filteredClasses}
 selectedKeys={selectedItems}
 getKey={(ic) => ic.name}
 config={ingressClassExportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected ingress classes' : 'All visible ingress classes'}
 onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
 />
 {selectedItems.size > 0 && (
 <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
 <Trash2 className="h-4 w-4" />
 Delete
 </Button>
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

 {/* Bulk Actions Bar */}
 {selectedItems.size > 0 && (
 <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg"
 >
 <Badge variant="secondary" className="gap-1.5">
 <CheckSquare className="h-3.5 w-3.5" />
 {selectedItems.size} selected
 </Badge>
 <div className="flex items-center gap-2">
 <ResourceExportDropdown
 items={filteredClasses}
 selectedKeys={selectedItems}
 getKey={(ic) => ic.name}
 config={ingressClassExportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected ingress classes' : 'All visible ingress classes'}
 onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
 triggerLabel={selectedItems.size > 0 ? `Export (${selectedItems.size})` : 'Export'}
 />
 <Button 
 variant="destructive" 
 size="sm" 
 className="gap-1.5"
 onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}
 >
 <Trash2 className="h-4 w-4" />
 Delete Selected
 </Button>
 <Button variant="ghost" size="sm" onClick={() => setSelectedItems(new Set())}>
 Clear
 </Button>
 </div>
 </div>
 )}

 {/* Stats Cards - with icons and click-to-filter like Ingresses */}
 <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
 <ListPageStatCard label="Total Classes" value={stats.total} icon={Route} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Default" value={stats.default} icon={Star} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.default?.size === 1 && columnFilters.default.has('Yes')} onClick={() => setColumnFilter('default', new Set(['Yes']))} className={cn(columnFilters.default?.size === 1 && columnFilters.default.has('Yes') && 'ring-2 ring-amber-500')} isLoading={isLoading} />
 <ListPageStatCard label="Active" value={stats.active} icon={CheckCircle2} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.hasIngresses?.size === 1 && columnFilters.hasIngresses.has('Yes')} onClick={() => setColumnFilter('hasIngresses', new Set(['Yes']))} className={cn(columnFilters.hasIngresses?.size === 1 && columnFilters.hasIngresses.has('Yes') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard label="Controllers" value={stats.controllers} valueClassName="text-blue-600" isLoading={isLoading} />
 </div>

 <BulkActionBar
 selectedCount={selectedItems.size}
 resourceName="ingress class"
 resourceType="ingressclasses"
 onClearSelection={() => multiSelect.clearSelection()}
 onBulkDelete={handleBulkDelete}
 onBulkLabel={handleBulkLabel}
 />

 <ResourceListTableToolbar
 globalFilterBar={
 <ResourceCommandBar
 scope={<ClusterScopedScope />}
 search={
 <div className="relative w-full min-w-0">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
 <Input
 placeholder="Search ingress classes by name or controller..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20"
 aria-label="Search ingress classes"
 />
 </div>
 }
 structure={
 <ListViewSegmentedControl
 value={listView}
 onChange={(v) => setListView(v as ListView)}
 options={[
 { id: 'flat', label: 'Flat', icon: List },
 { id: 'byController', label: 'By Controller', icon: Layers },
 ]}
 label=""
 ariaLabel="List structure"
 />
 }
 footer={hasActiveFilters || searchQuery ? (
 <Button variant="link" size="sm" className="text-muted-foreground h-auto p-0" onClick={() => { setSearchQuery(''); clearAllFilters(); }}>Clear filters</Button>
 ) : undefined}
 />
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={INGRESSCLASSES_COLUMNS_FOR_VISIBILITY}
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
 {PAGE_SIZE_OPTIONS.map((size) => (
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
 <ResizableTableProvider tableId="kubilitics-resizable-table-ingressclasses" columnConfig={INGRESSCLASSES_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 1020 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-12">
 <Checkbox
 checked={isAllSelected}
 onCheckedChange={toggleAll}
 aria-label="Select all"
 className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')}
 />
 </TableHead>
 <ResizableTableHead columnId="name">
 <TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="status">
 <TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="controller">
 <TableColumnHeaderWithFilterAndSort columnId="controller" label="Controller" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="default">Default</ResizableTableHead>
 <ResizableTableHead columnId="ingresses">Ingresses</ResizableTableHead>
 <ResizableTableHead columnId="parameters">Parameters</ResizableTableHead>
 <ResizableTableHead columnId="age">
 <TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-12 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="status" className="p-1.5" />
 <ResizableTableCell columnId="controller" className="p-1.5">
 <TableFilterCell columnId="controller" label="Controller" distinctValues={distinctValuesByColumn.controller ?? []} selectedFilterValues={columnFilters.controller ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.controller} />
 </ResizableTableCell>
 <ResizableTableCell columnId="default" className="p-1.5">
 <TableFilterCell columnId="default" label="Default" distinctValues={distinctValuesByColumn.default ?? []} selectedFilterValues={columnFilters.default ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.default} />
 </ResizableTableCell>
 <ResizableTableCell columnId="ingresses" className="p-1.5">
 <TableFilterCell columnId="hasIngresses" label="Has Ingresses" distinctValues={distinctValuesByColumn.hasIngresses ?? []} selectedFilterValues={columnFilters.hasIngresses ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.hasIngresses} />
 </ResizableTableCell>
 <ResizableTableCell columnId="parameters" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={8} resourceName="ingress classes" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={8} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : filteredClasses.length === 0 ? (
 <TableRow>
 <TableCell colSpan={8} className="h-40 text-center">
 <TableEmptyState
 icon={<Route className="h-8 w-8" />}
 title="No IngressClasses found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Define IngressClasses to configure ingress controllers.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create IngressClass"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : listView === 'flat' ? (
 itemsOnPage.map((ic, idx) => {
 const isSelected = selectedItems.has(ic.name);
 return (
 <tr
 key={ic.name}
 className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}
 >
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(ic, e); }}><Checkbox checked={isSelected} tabIndex={-1} aria-label={`Select ${ic.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/ingressclasses/${ic.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate"><Route className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="truncate">{ic.name}</span></Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="status"><StatusPill variant={ic.isDefault ? 'info' : 'success'} label={ic.isDefault ? 'Default' : 'Active'} /></ResizableTableCell>
 <ResizableTableCell columnId="controller"><span className="font-mono text-sm truncate block">{ic.controller}</span></ResizableTableCell>
 <ResizableTableCell columnId="default">{ic.isDefault ? <Badge variant="default" className="text-xs">Yes</Badge> : <span className="text-muted-foreground">No</span>}</ResizableTableCell>
 <ResizableTableCell columnId="ingresses" className="font-mono text-sm">{ic.ingressesCount}</ResizableTableCell>
 <ResizableTableCell columnId="parameters"><span className="text-muted-foreground truncate block">{ic.parameters}</span></ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={ic.age} timestamp={ic.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="IngressClass actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-52">
 <CopyNameDropdownItem name={ic.name} />
 <DropdownMenuItem onClick={() => navigate(`/ingressclasses/${ic.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/ingresses?class=${ic.name}`)} className="gap-2"><ExternalLink className="h-4 w-4" />View Ingresses</DropdownMenuItem>
 {!ic.isDefault && <DropdownMenuItem onClick={() => toast.info('Set as Default: requires cluster-admin or patch IngressClass')} className="gap-2"><Star className="h-4 w-4" />Set as Default</DropdownMenuItem>}
 <DropdownMenuItem onClick={() => navigate(`/ingressclasses/${ic.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-rose-600" onClick={() => setDeleteDialog({ open: true, item: ic })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </tr>
 );
 })
 ) : (
 groupedOnPage.flatMap((group) => {
 const isCollapsed = collapsedGroups.has(group.groupKey);
 return [
 <TableRow key={group.groupKey} className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-b border-border/60 transition-all duration-200" onClick={() => toggleGroup(group.groupKey)}>
 <TableCell colSpan={8} className="py-2">
 <div className="flex items-center gap-2 font-medium">
 {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
 Controller: {group.label}
 <span className="text-muted-foreground font-normal">({group.classes.length})</span>
 </div>
 </TableCell>
 </TableRow>,
 ...(isCollapsed ? [] : group.classes.map((ic, idx) => {
 const isSelected = selectedItems.has(ic.name);
 return (
 <tr key={ic.name} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(ic, e); }}><Checkbox checked={isSelected} tabIndex={-1} aria-label={`Select ${ic.name}`} /></TableCell>
 <ResizableTableCell columnId="name"><Link to={`/ingressclasses/${ic.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate"><Route className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="truncate">{ic.name}</span></Link></ResizableTableCell>
 <ResizableTableCell columnId="status"><StatusPill variant={ic.isDefault ? 'info' : 'success'} label={ic.isDefault ? 'Default' : 'Active'} /></ResizableTableCell>
 <ResizableTableCell columnId="controller"><span className="font-mono text-sm truncate block">{ic.controller}</span></ResizableTableCell>
 <ResizableTableCell columnId="default">{ic.isDefault ? <Badge variant="default" className="text-xs">Yes</Badge> : <span className="text-muted-foreground">No</span>}</ResizableTableCell>
 <ResizableTableCell columnId="ingresses" className="font-mono text-sm">{ic.ingressesCount}</ResizableTableCell>
 <ResizableTableCell columnId="parameters"><span className="text-muted-foreground truncate block">{ic.parameters}</span></ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={ic.age} timestamp={ic.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="IngressClass actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-52">
 <CopyNameDropdownItem name={ic.name} />
 <DropdownMenuItem onClick={() => navigate(`/ingressclasses/${ic.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/ingresses?class=${ic.name}`)} className="gap-2"><ExternalLink className="h-4 w-4" />View Ingresses</DropdownMenuItem>
 {!ic.isDefault && <DropdownMenuItem onClick={() => toast.info('Set as Default: requires cluster-admin or patch IngressClass')} className="gap-2"><Star className="h-4 w-4" />Set as Default</DropdownMenuItem>}
 <DropdownMenuItem onClick={() => navigate(`/ingressclasses/${ic.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-rose-600" onClick={() => setDeleteDialog({ open: true, item: ic })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </TableCell>
 </tr>
 );
 })),
 ];
 })
 )}
 </TableBody>
 </Table>
 </ResizableTableProvider>
 </ResourceListTableToolbar>

 {/* Delete Dialog */}
 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
 resourceType="IngressClass"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} ingress classes` : deleteDialog.item?.name || ''}
 onConfirm={handleDelete}
 />

 {showCreateWizard && (
 <IngressClassWizard
 onClose={() => setShowCreateWizard(false)}
 onSubmit={() => { setShowCreateWizard(false); refetch(); }}
 />
 )}
 </div>
 );
}
