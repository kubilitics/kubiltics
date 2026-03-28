import { useState, useMemo, useEffect } from 'react';
import {
 RefreshCw, MoreHorizontal, CheckCircle2, XCircle, Clock, Loader2, WifiOff, Plus,
 Trash2, FileText, Search, Webhook, ChevronDown,
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
import { useK8sResourceList, useDeleteK8sResource, usePatchK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog, BulkActionBar, executeBulkOperation } from '@/components/resources';
import { useMultiSelect } from '@/hooks/useMultiSelect';
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

interface WebhookEntry {
 name?: string;
 failurePolicy?: string;
 sideEffects?: string;
 matchPolicy?: string;
}

interface MutatingWebhookResource extends KubernetesResource {
 webhooks?: WebhookEntry[];
}

interface MutatingWebhook {
 name: string;
 webhookCount: number;
 failurePolicy: string;
 sideEffects: string;
 matchPolicy: string;
 age: string;
 creationTimestamp?: string;
 hasMultipleWebhooks: boolean;
}

const MW_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 300, minWidth: 150 },
 { id: 'webhooks', defaultWidth: 100, minWidth: 70 },
 { id: 'failurePolicy', defaultWidth: 160, minWidth: 100 },
 { id: 'sideEffects', defaultWidth: 160, minWidth: 100 },
 { id: 'matchPolicy', defaultWidth: 160, minWidth: 100 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const MW_COLUMNS_FOR_VISIBILITY = [
 { id: 'webhooks', label: 'Webhooks' },
 { id: 'failurePolicy', label: 'Failure Policy' },
 { id: 'sideEffects', label: 'Side Effects' },
 { id: 'matchPolicy', label: 'Match Policy' },
 { id: 'age', label: 'Age' },
];

function transformMutatingWebhook(resource: MutatingWebhookResource): MutatingWebhook {
 const webhooks = resource.webhooks ?? [];
 const first = webhooks[0];
 const failurePolicy = first?.failurePolicy ?? '-';
 const sideEffects = first?.sideEffects ?? '-';
 const matchPolicy = first?.matchPolicy ?? '-';

 return {
 name: resource.metadata.name,
 webhookCount: webhooks.length,
 failurePolicy,
 sideEffects,
 matchPolicy,
 age: calculateAge(resource.metadata.creationTimestamp),
 creationTimestamp: resource.metadata?.creationTimestamp,
 hasMultipleWebhooks: webhooks.length > 1,
 };
}

const MutatingWebhookYaml = `apiVersion: admissionregistration.k8s.io/v1
kind: MutatingWebhookConfiguration
metadata:
 name: ''
webhooks:
 - name: ''
 clientConfig:
 service:
 name: ''
 namespace: ''
 port: 443
 rules:
 - apiGroups: [""]
 apiVersions: ["v1"]
 operations: ["CREATE"]
 resources: ["pods"]
 admissionReviewVersions: ["v1"]
 sideEffects: None
 failurePolicy: Fail
`;

export default function MutatingWebhooks() {
 const navigate = useNavigate();
 const [searchQuery, setSearchQuery] = useState('');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: MutatingWebhook | null; bulk?: boolean }>({ open: false, item: null });
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const multiSelect = useMultiSelect();
 const selectedItems = multiSelect.selectedIds;
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<MutatingWebhookResource>('mutatingwebhookconfigurations', undefined, { limit: 5000 });
 const deleteResource = useDeleteK8sResource('mutatingwebhookconfigurations');
 const patchResource = usePatchK8sResource('mutatingwebhookconfigurations');

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const items: MutatingWebhook[] = isConnected && data
 ? (data.items ?? []).map(transformMutatingWebhook)
 : [];

 const stats = useMemo(() => ({
 total: items.length,
 failPolicy: items.filter((i) => i.failurePolicy === 'Fail').length,
 ignorePolicy: items.filter((i) => i.failurePolicy === 'Ignore').length,
 multipleWebhooks: items.filter((i) => i.hasMultipleWebhooks).length,
 }), [items]);

 const itemsAfterSearch = useMemo(() =>
 items.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase())),
 [items, searchQuery]);

 const mwColumnConfig: ColumnConfig<MutatingWebhook>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'webhooks', getValue: (i) => i.webhookCount, sortable: true, filterable: false },
 { columnId: 'failurePolicy', getValue: (i) => i.failurePolicy, sortable: true, filterable: true },
 { columnId: 'sideEffects', getValue: (i) => i.sideEffects, sortable: true, filterable: true },
 { columnId: 'matchPolicy', getValue: (i) => i.matchPolicy, sortable: true, filterable: true },
 { columnId: 'hasMultipleWebhooks', getValue: (i) => (i.hasMultipleWebhooks ? 'Yes' : 'No'), sortable: false, filterable: true },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearch, { columns: mwColumnConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'mutatingwebhooks', columns: MW_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const totalDisplayed = filteredItems.length;
 const totalDisplayedPages = Math.max(1, Math.ceil(totalDisplayed / pageSize));
 const safeDisplayedPageIndex = Math.min(pageIndex, totalDisplayedPages - 1);
 const displayedStart = safeDisplayedPageIndex * pageSize;
 const displayedOnPage = filteredItems.slice(displayedStart, displayedStart + pageSize);

 const toggleStatFilter = (columnId: 'failurePolicy' | 'hasMultipleWebhooks', value: string) => {
 const current = columnFilters[columnId];
 if (current?.size === 1 && current.has(value)) {
 setColumnFilter(columnId, null);
 } else {
 setColumnFilter(columnId, new Set([value]));
 }
 };

 useEffect(() => {
 if (safeDisplayedPageIndex !== pageIndex) setPageIndex(safeDisplayedPageIndex);
 }, [safeDisplayedPageIndex, pageIndex]);

 const allKeys = useMemo(() => displayedOnPage.map(i => i.name), [displayedOnPage]);

 const toggleSelection = (item: MutatingWebhook, event?: React.MouseEvent) => {
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

 const handleDelete = async () => {
 if (!isConnected) { toast.error('Connect cluster to delete mutating webhooks'); return; }
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

 const exportConfig = {
 filenamePrefix: 'mutatingwebhooks',
 resourceLabel: 'mutating webhooks',
 getExportData: (d: MutatingWebhook) => ({ name: d.name, webhooks: d.webhookCount, failurePolicy: d.failurePolicy, sideEffects: d.sideEffects, matchPolicy: d.matchPolicy, age: d.age }),
 csvColumns: [
 { label: 'Name', getValue: (d: MutatingWebhook) => d.name },
 { label: 'Webhooks', getValue: (d: MutatingWebhook) => d.webhookCount },
 { label: 'Failure Policy', getValue: (d: MutatingWebhook) => d.failurePolicy },
 { label: 'Side Effects', getValue: (d: MutatingWebhook) => d.sideEffects },
 { label: 'Match Policy', getValue: (d: MutatingWebhook) => d.matchPolicy },
 { label: 'Age', getValue: (d: MutatingWebhook) => d.age },
 ],
 toK8sYaml: (d: MutatingWebhook) => `---
apiVersion: admissionregistration.k8s.io/v1
kind: MutatingWebhookConfiguration
metadata:
 name: ${d.name}
`,
 };

 return (
 <div className="space-y-6">
 <div className="flex items-center justify-between flex-wrap gap-4">
 <div className="flex items-center gap-3 flex-wrap">
 <div className="p-2.5 rounded-xl bg-primary/10"><Webhook className="h-6 w-6 text-primary" /></div>
 <div>
 <h1 className="text-2xl font-semibold tracking-tight">Mutating Admission Webhooks</h1>
 <p className="text-sm text-muted-foreground">
 {filteredItems.length} mutating webhook configurations (cluster-scoped)
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
 selectionLabel={selectedItems.size > 0 ? 'Selected mutating webhooks' : 'All visible'}
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
 <ListPageStatCard label="Total" value={stats.total} icon={Webhook} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Fail Policy" value={stats.failPolicy} icon={XCircle} iconColor="text-rose-600" valueClassName="text-rose-600" selected={columnFilters.failurePolicy?.size === 1 && columnFilters.failurePolicy.has('Fail')} onClick={() => toggleStatFilter('failurePolicy', 'Fail')} className={cn(columnFilters.failurePolicy?.size === 1 && columnFilters.failurePolicy.has('Fail') && 'ring-2 ring-rose-500')} isLoading={isLoading} />
 <ListPageStatCard label="Ignore Policy" value={stats.ignorePolicy} icon={CheckCircle2} iconColor="text-muted-foreground" valueClassName="text-muted-foreground" selected={columnFilters.failurePolicy?.size === 1 && columnFilters.failurePolicy.has('Ignore')} onClick={() => toggleStatFilter('failurePolicy', 'Ignore')} className={cn(columnFilters.failurePolicy?.size === 1 && columnFilters.failurePolicy.has('Ignore') && 'ring-2 ring-muted-foreground')} isLoading={isLoading} />
 <ListPageStatCard label="Multiple Webhooks" value={stats.multipleWebhooks} icon={Clock} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.hasMultipleWebhooks?.size === 1 && columnFilters.hasMultipleWebhooks.has('Yes')} onClick={() => toggleStatFilter('hasMultipleWebhooks', 'Yes')} className={cn(columnFilters.hasMultipleWebhooks?.size === 1 && columnFilters.hasMultipleWebhooks.has('Yes') && 'ring-2 ring-amber-500')} isLoading={isLoading} />
 </div>

 <BulkActionBar
 selectedCount={selectedItems.size}
 resourceName="mutating webhook"
 resourceType="mutatingwebhookconfigurations"
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
 <Input placeholder="Search mutating webhooks..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all" />
 </div>
 }
 />
 }
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={MW_COLUMNS_FOR_VISIBILITY}
 visibleColumns={columnVisibility.visibleColumns}
 onColumnToggle={columnVisibility.setColumnVisible}
 isLoading={isLoading && isConnected}
 footer={
 <div className="flex items-center justify-between flex-wrap gap-2">
 <div className="flex items-center gap-3">
 <span className="text-sm text-muted-foreground">{totalDisplayed > 0 ? `Showing ${displayedStart + 1}–${Math.min(displayedStart + pageSize, totalDisplayed)} of ${totalDisplayed}` : 'No mutating webhooks'}</span>
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
 <ListPagination hasPrev={safeDisplayedPageIndex > 0} hasNext={displayedStart + pageSize < totalDisplayed} onPrev={() => setPageIndex((i) => Math.max(0, i - 1))} onNext={() => setPageIndex((i) => Math.min(totalDisplayedPages - 1, i + 1))} rangeLabel={undefined} currentPage={safeDisplayedPageIndex + 1} totalPages={Math.max(1, totalDisplayedPages)} onPageChange={(p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalDisplayedPages - 1)))} dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} />
 </div>
 }
 >
 <ResizableTableProvider tableId="mutatingwebhooks" columnConfig={MW_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 840 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 {columnVisibility.isColumnVisible('webhooks') && <ResizableTableHead columnId="webhooks"><TableColumnHeaderWithFilterAndSort columnId="webhooks" label="Webhooks" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('failurePolicy') && <ResizableTableHead columnId="failurePolicy"><TableColumnHeaderWithFilterAndSort columnId="failurePolicy" label="Failure Policy" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('sideEffects') && <ResizableTableHead columnId="sideEffects"><TableColumnHeaderWithFilterAndSort columnId="sideEffects" label="Side Effects" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('matchPolicy') && <ResizableTableHead columnId="matchPolicy"><TableColumnHeaderWithFilterAndSort columnId="matchPolicy" label="Match Policy" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 {columnVisibility.isColumnVisible('webhooks') && <ResizableTableCell columnId="webhooks" className="p-1.5"><TableFilterCell columnId="hasMultipleWebhooks" label="Multiple Webhooks" distinctValues={['Yes', 'No']} selectedFilterValues={columnFilters.hasMultipleWebhooks ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.hasMultipleWebhooks} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('failurePolicy') && <ResizableTableCell columnId="failurePolicy" className="p-1.5"><TableFilterCell columnId="failurePolicy" label="Failure Policy" distinctValues={distinctValuesByColumn.failurePolicy ?? []} selectedFilterValues={columnFilters.failurePolicy ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.failurePolicy} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('sideEffects') && <ResizableTableCell columnId="sideEffects" className="p-1.5"><TableFilterCell columnId="sideEffects" label="Side Effects" distinctValues={distinctValuesByColumn.sideEffects ?? []} selectedFilterValues={columnFilters.sideEffects ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.sideEffects} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('matchPolicy') && <ResizableTableCell columnId="matchPolicy" className="p-1.5"><TableFilterCell columnId="matchPolicy" label="Match Policy" distinctValues={distinctValuesByColumn.matchPolicy ?? []} selectedFilterValues={columnFilters.matchPolicy ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.matchPolicy} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
 <TableCell className="w-12" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={8} resourceName="mutating webhooks" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={8} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : !isConnected ? (
 <TableRow><TableCell colSpan={8} className="h-32 text-center"><div className="flex flex-col items-center gap-2"><WifiOff className="h-8 w-8 opacity-50" /><p className="text-sm text-muted-foreground">Connect cluster to view mutating webhooks</p></div></TableCell></TableRow>
 ) : displayedOnPage.length === 0 ? (
 <TableRow>
 <TableCell colSpan={8} className="h-40 text-center">
 <TableEmptyState
 icon={<Webhook className="h-8 w-8" />}
 title="No mutating webhooks found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Register admission webhooks to mutate resources before they are stored.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create MutatingWebhookConfiguration"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 displayedOnPage.map((item, idx) => {
 const isSelected = selectedItems.has(item.name);
 return (
 <tr key={item.name} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(item, e); }}><Checkbox checked={isSelected} tabIndex={-1} /></TableCell>
 <ResizableTableCell columnId="name">
 <span className="font-medium flex items-center gap-2 truncate cursor-pointer text-primary hover:underline" onClick={() => navigate(`/mutatingwebhooks/${item.name}`)}>
 <Webhook className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 </span>
 </ResizableTableCell>
 {columnVisibility.isColumnVisible('webhooks') && <ResizableTableCell columnId="webhooks"><Badge variant="outline" className="font-mono text-xs">{item.webhookCount}</Badge></ResizableTableCell>}
 {columnVisibility.isColumnVisible('failurePolicy') && <ResizableTableCell columnId="failurePolicy"><Badge variant={item.failurePolicy === 'Fail' ? 'destructive' : 'secondary'} className="text-xs font-mono">{item.failurePolicy}</Badge></ResizableTableCell>}
 {columnVisibility.isColumnVisible('sideEffects') && <ResizableTableCell columnId="sideEffects"><Badge variant="outline" className="text-xs font-mono truncate block w-fit max-w-full">{item.sideEffects}</Badge></ResizableTableCell>}
 {columnVisibility.isColumnVisible('matchPolicy') && <ResizableTableCell columnId="matchPolicy"><Badge variant="secondary" className="text-xs font-mono">{item.matchPolicy}</Badge></ResizableTableCell>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>}
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem onClick={() => navigate(`/mutatingwebhooks/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/mutatingwebhooks/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
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
 resourceKind="MutatingWebhookConfiguration"
 defaultYaml={MutatingWebhookYaml}
 onClose={() => setShowCreateWizard(false)}
 onApply={async (yaml) => {
 if (!isConnected) { toast.error('Connect cluster to create mutating webhooks'); return; }
 toast.success('MutatingWebhookConfiguration created successfully');
 setShowCreateWizard(false);
 refetch();
 }}
 />
 )}

 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
 resourceType="MutatingWebhookConfiguration"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} mutating webhooks` : (deleteDialog.item?.name || '')}
 namespace={undefined}
 onConfirm={handleDelete}
 />
 </div>
 );
}
