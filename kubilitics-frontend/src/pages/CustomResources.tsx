import { useState, useMemo, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import {
 Search,
 RefreshCw,
 MoreHorizontal,
 FileCode,
 ChevronDown,
 CheckSquare,
 ArrowLeft,
 ExternalLink,
} from 'lucide-react';
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
 DropdownMenuTrigger,
 DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Link, useSearchParams } from 'react-router-dom';
import {
 ResourceCommandBar,
 ResourceExportDropdown,
 ListPagination,
 PAGE_SIZE_OPTIONS,
 ListPageStatCard,
 ListPageHeader,
 TableColumnHeaderWithFilterAndSort,
 TableFilterCell,
 resourceTableRowClassName,
 ROW_MOTION,
 AgeCell,
 TableEmptyState,
 TableErrorState, ListPageLoadingShell,
 CopyNameDropdownItem,
 NamespaceBadge,
 ResourceListTableToolbar,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useCRDInstances } from '@/hooks/useCRDInstances';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { calculateAge, useDeleteK8sResource, usePatchK8sResource } from '@/hooks/useKubernetes';
import type { KubernetesResource } from '@/hooks/useKubernetes';
import { toast } from '@/components/ui/sonner';
import { BulkActionBar, executeBulkOperation } from '@/components/resources';
import { useMultiSelect } from '@/hooks/useMultiSelect';

interface CRInstance {
 name: string;
 namespace: string;
 age: string;
 creationTimestamp?: string;
 raw: KubernetesResource;
}

function mapInstance(r: KubernetesResource): CRInstance {
 return {
 name: r.metadata?.name ?? '',
 namespace: r.metadata?.namespace ?? '',
 age: calculateAge(r.metadata?.creationTimestamp),
 creationTimestamp: r.metadata?.creationTimestamp,
 raw: r,
 };
}

const CR_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 300, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const CR_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'age', label: 'Age' },
];

export default function CustomResources() {
 const [searchParams] = useSearchParams();
 const crdName = searchParams.get('crd') ?? undefined;
 const { isConnected } = useConnectionStatus();
 const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

 const [namespaceFilter, setNamespaceFilter] = useState<string>('');
 const [searchQuery, setSearchQuery] = useState('');
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);
 const multiSelect = useMultiSelect();
 const selectedItems = multiSelect.selectedIds;

 const { items: rawItems, isLoading, isFetching, dataUpdatedAt, error, refetch } = useCRDInstances(crdName, namespaceFilter || undefined, { limit: 5000 });
 const crdPlural = crdName ? crdName.split('.')[0] : 'customresources';
 const deleteResource = useDeleteK8sResource(crdPlural);
 const patchResource = usePatchK8sResource(crdPlural);
 const isError = !!error;

 const items: CRInstance[] = useMemo(
 () => (isConnected && rawItems ? rawItems.map(mapInstance) : []),
 [isConnected, rawItems]
 );

 const stats = useMemo(() => ({ total: items.length }), [items]);

 const namespaces = useMemo(
 () => [...new Set(items.map((i) => i.namespace).filter(Boolean))].sort(),
 [items]
 );

 const itemsFiltered = useMemo(() => {
 let out = items;
 if (namespaceFilter) out = out.filter((i) => i.namespace === namespaceFilter);
 if (searchQuery) {
 const q = searchQuery.toLowerCase();
 out = out.filter(
 (i) =>
 i.name.toLowerCase().includes(q) ||
 i.namespace.toLowerCase().includes(q)
 );
 }
 return out;
 }, [items, namespaceFilter, searchQuery]);

 const tableConfig: ColumnConfig<CRInstance>[] = useMemo(
 () => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: true },
 { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
 {
   columnId: 'age',
   getValue: (i) => i.age,
   sortValue: (i) => -(i.creationTimestamp ? Date.parse(i.creationTimestamp) : 0),
   sortable: true,
   filterable: false,
 },
 ],
 []
 );

 const {
 filteredAndSortedItems: filteredItems,
 distinctValuesByColumn,
 valueCountsByColumn,
 columnFilters,
 setColumnFilter,
 sortKey,
 sortOrder,
 setSort,
 clearAllFilters,
 hasActiveFilters,
 } = useTableFiltersAndSort(itemsFiltered, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'customresources', columns: CR_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const totalFiltered = filteredItems.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredItems.slice(start, start + pageSize);

 useEffect(() => {
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [safePageIndex, pageIndex]);

 const handlePageSizeChange = (size: number) => {
 setPageSize(size);
 setPageIndex(0);
 };

 const itemKey = (i: CRInstance) => `${i.namespace}/${i.name}`;
 const allKeys = useMemo(() => itemsOnPage.map(itemKey), [itemsOnPage]);

 const toggleSelection = (i: CRInstance, event?: React.MouseEvent) => {
 const key = itemKey(i);
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
 await patchResource.mutateAsync({ name, namespace: ns, patch: { metadata: { labels: { [label.split('=')[0]]: label.split('=')[1] } } } });
 });
 };

 const pagination = {
 rangeLabel:
 totalFiltered > 0
 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}`
 : 'No instances',
 hasPrev: safePageIndex > 0,
 hasNext: start + pageSize < totalFiltered,
 onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
 onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
 currentPage: safePageIndex + 1,
 totalPages: Math.max(1, totalPages),
 onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
 };

 const displayKind = crdName ? crdName.split('.')[0] : 'Custom Resource';
 const exportConfig = {
 filenamePrefix: crdName ? crdName.replace(/\./g, '-') : 'custom-resources',
 resourceLabel: displayKind,
 getExportData: (v: CRInstance) => ({ name: v.name, namespace: v.namespace, age: v.age }),
 csvColumns: [
 { label: 'Name', getValue: (v) => v.name },
 { label: 'Namespace', getValue: (v) => v.namespace },
 { label: 'Age', getValue: (v) => v.age },
 ],
 toK8sYaml: () => `${displayKind} instances`,
 };

 // No CRD selected — show empty state with link to CRD definitions
 if (!crdName) {
 return (
 <PageLayout label="Custom Resources">
 <div>
 <h1 className="text-2xl font-bold tracking-tight">Custom Resource Instances</h1>
 <p className="text-muted-foreground">Browse instances of a Custom Resource Definition</p>
 </div>
 <div className="border border-dashed border-border rounded-xl bg-muted/20 p-16 flex flex-col items-center justify-center gap-4">
 <FileCode className="h-16 w-16 text-muted-foreground/60" />
 <h2 className="text-lg font-medium">Select a CRD</h2>
 <p className="text-muted-foreground text-center max-w-md">
 Choose a Custom Resource Definition from the Definitions page to view its instances.
 </p>
 <Button asChild variant="default" className="gap-2">
 <Link to="/customresourcedefinitions">
 <ExternalLink className="h-4 w-4" />
 Go to Custom Resource Definitions
 </Link>
 </Button>
 </div>
 </PageLayout>
 );
 }

 // Backend not configured — CRD instances require backend
 if (!isBackendConfigured) {
 return (
 <PageLayout label="Custom Resources">
 <div>
 <h1 className="text-2xl font-bold tracking-tight">{displayKind} Instances</h1>
 <p className="text-muted-foreground">Instances of {crdName}</p>
 </div>
 <div className="border border-dashed border-border rounded-xl bg-muted/20 p-16 flex flex-col items-center justify-center gap-4">
 <FileCode className="h-16 w-16 text-muted-foreground/60" />
 <h2 className="text-lg font-medium">Backend required</h2>
 <p className="text-muted-foreground text-center max-w-md">
 Custom resource instances are available when connected via the Kubilitics backend. Connect a cluster through the backend to view CRD instances.
 </p>
 <Button asChild variant="outline" className="gap-2">
 <Link to="/customresourcedefinitions">
 <ArrowLeft className="h-4 w-4" />
 Back to CRD Definitions
 </Link>
 </Button>
 </div>
 </PageLayout>
 );
 }

 return (
 <PageLayout label="Custom Resources">
 <div className="flex items-center gap-3 mb-2">
 <Button asChild variant="ghost" size="sm" className="gap-1.5 -ml-2">
 <Link to="/customresourcedefinitions">
 <ArrowLeft className="h-4 w-4" />
 CRD Definitions
 </Link>
 </Button>
 </div>

 <ListPageHeader
 icon={<FileCode className="h-6 w-6 text-primary" />}
 title={`${displayKind} Instances`}
 resourceCount={filteredItems.length}
 subtitle={crdName}
 demoMode={!isConnected}
 dataUpdatedAt={dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 actions={
 <>
 <ResourceExportDropdown
 items={filteredItems}
 selectedKeys={selectedItems}
 getKey={itemKey}
 config={exportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected instances' : 'All visible'}
 onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
 />
 </>
 }
 />

 {error && (
 <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
 {error.message}
 </div>
 )}

 <div className={cn('grid grid-cols-2 sm:grid-cols-4 gap-4', !isConnected && 'opacity-60')}>
 <ListPageStatCard
 label="Total"
 value={stats.total}
 icon={FileCode}
 iconColor="text-primary"
 selected={!hasActiveFilters}
 onClick={clearAllFilters}
 className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 </div>

 <BulkActionBar
 selectedCount={selectedItems.size}
 resourceName={displayKind}
 resourceType={crdPlural}
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
 namespaces.length > 0 ? (
 <div className="flex items-center gap-2">
 <span className="text-sm text-muted-foreground">Namespace</span>
 <select
 value={namespaceFilter}
 onChange={(e) => {
 setNamespaceFilter(e.target.value);
 setPageIndex(0);
 }}
 className="h-9 rounded-md border border-input bg-background px-3 text-sm"
 >
 <option value="">All</option>
 {namespaces.map((ns) => (
 <option key={ns} value={ns}>
 {ns}
 </option>
 ))}
 </select>
 </div>
 ) : (
 <span className="text-sm text-muted-foreground">Cluster-scoped</span>
 )
 }
 search={
 <div className="relative w-full min-w-0">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" isLoading={isLoading} />
 <Input
 placeholder="Search instances..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20"
 aria-label="Search instances"
 />
 </div>
 }
 />
 }
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={CR_COLUMNS_FOR_VISIBILITY}
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
 <DropdownMenuItem
 key={size}
 onClick={() => handlePageSizeChange(size)}
 className={cn(pageSize === size && 'bg-accent')}
 >
 {size} per page
 </DropdownMenuItem>
 ))}
 </DropdownMenuContent>
 </DropdownMenu>
 </div>
 <ListPagination
 hasPrev={pagination.hasPrev}
 hasNext={pagination.hasNext}
 onPrev={pagination.onPrev}
 onNext={pagination.onNext}
 rangeLabel={undefined}
 currentPage={pagination.currentPage}
 totalPages={pagination.totalPages}
 onPageChange={pagination.onPageChange}
 dataUpdatedAt={dataUpdatedAt}
 isFetching={isFetching}
 />
 </div>
 }
 >
 <ResizableTableProvider tableId="customresources" columnConfig={CR_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 560 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10">
 <Checkbox
 checked={isAllSelected}
 onCheckedChange={toggleAll}
 aria-label="Select all"
 className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')}
 />
 </TableHead>
 <ResizableTableHead columnId="name">
 <TableColumnHeaderWithFilterAndSort
 columnId="name"
 label="Name"
 sortKey={sortKey}
 sortOrder={sortOrder}
 onSort={setSort}
 filterable={false}
 distinctValues={[]}
 selectedFilterValues={new Set()}
 onFilterChange={() => {}}
 />
 </ResizableTableHead>
 {columnVisibility.isColumnVisible('namespace') && (
 <ResizableTableHead columnId="namespace">
 <TableColumnHeaderWithFilterAndSort
 columnId="namespace"
 label="Namespace"
 sortKey={sortKey}
 sortOrder={sortOrder}
 onSort={setSort}
 filterable={false}
 distinctValues={distinctValuesByColumn.namespace ?? []}
 selectedFilterValues={columnFilters.namespace ?? new Set()}
 onFilterChange={setColumnFilter}
 />
 </ResizableTableHead>
 )}
 {columnVisibility.isColumnVisible('age') && (
 <ResizableTableHead columnId="age">
 <TableColumnHeaderWithFilterAndSort
 columnId="age"
 label="Age"
 sortKey={sortKey}
 sortOrder={sortOrder}
 onSort={setSort}
 filterable={false}
 distinctValues={[]}
 selectedFilterValues={new Set()}
 onFilterChange={() => {}}
 />
 </ResizableTableHead>
 )}
 <TableHead className="w-12 text-center">
 <span className="sr-only">Actions</span>
 <MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden />
 </TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10" />
 <ResizableTableCell columnId="name">
 <TableFilterCell
 columnId="name"
 label="Name"
 distinctValues={distinctValuesByColumn.name ?? []}
 selectedFilterValues={columnFilters.name ?? new Set()}
 onFilterChange={setColumnFilter}
 valueCounts={valueCountsByColumn.name}
 />
 </ResizableTableCell>
 {columnVisibility.isColumnVisible('namespace') && (
 <ResizableTableCell columnId="namespace">
 <TableFilterCell
 columnId="namespace"
 label="Namespace"
 distinctValues={distinctValuesByColumn.namespace ?? []}
 selectedFilterValues={columnFilters.namespace ?? new Set()}
 onFilterChange={setColumnFilter}
 valueCounts={valueCountsByColumn.namespace}
 />
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" />}
 <TableCell className="w-12" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={5} resourceName="custom resources" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={5} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : itemsOnPage.length === 0 ? (
 <TableRow>
 <TableCell colSpan={5} className="h-40 text-center">
 <TableEmptyState
 icon={<FileCode className="h-8 w-8" />}
 title="No instances found"
 subtitle={
 searchQuery || hasActiveFilters || namespaceFilter
 ? 'Clear filters to see resources.'
 : `No ${displayKind} instances in this cluster.`
 }
 hasActiveFilters={!!(searchQuery || hasActiveFilters || namespaceFilter)}
 onClearFilters={() => {
 setSearchQuery('');
 setNamespaceFilter('');
 clearAllFilters();
 }}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((item, idx) => (
 <tr
 key={itemKey(item)}
 className={cn(
 resourceTableRowClassName,
 idx % 2 === 1 && 'bg-muted/5',
 selectedItems.has(itemKey(item)) && 'bg-primary/5'
 )}
 >
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(item, e); }}>
 <Checkbox
 checked={selectedItems.has(itemKey(item))}
 tabIndex={-1}
 aria-label={`Select ${item.name}`}
 />
 </TableCell>
 <ResizableTableCell columnId="name">
 <span className="font-medium flex items-center gap-2 truncate font-mono text-sm">
 <FileCode className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 </span>
 </ResizableTableCell>
 {columnVisibility.isColumnVisible('namespace') && (
 <ResizableTableCell columnId="namespace">
 <NamespaceBadge namespace={item.namespace || '-'} />
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('age') && (
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap">
 <AgeCell age={item.age} timestamp={item.creationTimestamp} />
 </ResizableTableCell>
 )}
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button
 variant="ghost"
 size="icon"
 className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
 aria-label="Actions"
 >
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <CopyNameDropdownItem name={item.name} />
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
 );
}
