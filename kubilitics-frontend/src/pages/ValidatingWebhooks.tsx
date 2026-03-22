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

interface ValidatingWebhookEntry {
 name?: string;
 failurePolicy?: string;
 sideEffects?: string;
 matchPolicy?: string;
}

interface ValidatingWebhookResource extends KubernetesResource {
 webhooks?: ValidatingWebhookEntry[];
}

interface ValidatingWebhook {
 name: string;
 webhookCount: number;
 failurePolicy: string;
 sideEffects: string;
 matchPolicy: string;
 age: string;
 creationTimestamp?: string;
 hasMultipleWebhooks: boolean;
}

const VW_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 300, minWidth: 150 },
 { id: 'webhooks', defaultWidth: 100, minWidth: 70 },
 { id: 'failurePolicy', defaultWidth: 160, minWidth: 100 },
 { id: 'sideEffects', defaultWidth: 160, minWidth: 100 },
 { id: 'matchPolicy', defaultWidth: 160, minWidth: 100 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const VW_COLUMNS_FOR_VISIBILITY = [
 { id: 'webhooks', label: 'Webhooks' },
 { id: 'failurePolicy', label: 'Failure Policy' },
 { id: 'sideEffects', label: 'Side Effects' },
 { id: 'matchPolicy', label: 'Match Policy' },
 { id: 'age', label: 'Age' },
];

function transformValidatingWebhook(resource: ValidatingWebhookResource): ValidatingWebhook {
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

const ValidatingWebhookYaml = `apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
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
 operations: ["CREATE", "UPDATE"]
 resources: ["pods"]
 admissionReviewVersions: ["v1"]
 sideEffects: None
 failurePolicy: Fail
`;

export default function ValidatingWebhooks() {
 const navigate = useNavigate();
 const [searchQuery, setSearchQuery] = useState('');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: ValidatingWebhook | null; bulk?: boolean }>({ open: false, item: null });
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<ValidatingWebhookResource>('validatingwebhookconfigurations', undefined, { limit: 5000 });
 const deleteResource = useDeleteK8sResource('validatingwebhookconfigurations');

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const items: ValidatingWebhook[] = isConnected && data
 ? (data.items ?? []).map(transformValidatingWebhook)
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

 const vwColumnConfig: ColumnConfig<ValidatingWebhook>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'webhooks', getValue: (i) => i.webhookCount, sortable: true, filterable: false },
 { columnId: 'failurePolicy', getValue: (i) => i.failurePolicy, sortable: true, filterable: true },
 { columnId: 'sideEffects', getValue: (i) => i.sideEffects, sortable: true, filterable: true },
 { columnId: 'matchPolicy', getValue: (i) => i.matchPolicy, sortable: true, filterable: true },
 { columnId: 'hasMultipleWebhooks', getValue: (i) => (i.hasMultipleWebhooks ? 'Yes' : 'No'), sortable: false, filterable: true },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearch, { columns: vwColumnConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'validatingwebhooks', columns: VW_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const totalFiltered = filteredItems.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredItems.slice(start, start + pageSize);

 useEffect(() => {
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [safePageIndex, pageIndex]);

 const toggleStatFilter = (columnId: 'failurePolicy' | 'hasMultipleWebhooks', value: string) => {
 const current = columnFilters[columnId];
 if (current?.size === 1 && current.has(value)) {
 setColumnFilter(columnId, null);
 } else {
 setColumnFilter(columnId, new Set([value]));
 }
 };

 const toggleSelection = (item: ValidatingWebhook) => {
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
 if (!isConnected) { toast.error('Connect cluster to delete validating webhooks'); return; }
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
 filenamePrefix: 'validatingwebhooks',
 resourceLabel: 'validating webhooks',
 getExportData: (d: ValidatingWebhook) => ({ name: d.name, webhooks: d.webhookCount, failurePolicy: d.failurePolicy, sideEffects: d.sideEffects, matchPolicy: d.matchPolicy, age: d.age }),
 csvColumns: [
 { label: 'Name', getValue: (d: ValidatingWebhook) => d.name },
 { label: 'Webhooks', getValue: (d: ValidatingWebhook) => d.webhookCount },
 { label: 'Failure Policy', getValue: (d: ValidatingWebhook) => d.failurePolicy },
 { label: 'Side Effects', getValue: (d: ValidatingWebhook) => d.sideEffects },
 { label: 'Match Policy', getValue: (d: ValidatingWebhook) => d.matchPolicy },
 { label: 'Age', getValue: (d: ValidatingWebhook) => d.age },
 ],
 toK8sYaml: (d: ValidatingWebhook) => `---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
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
 <h1 className="text-2xl font-semibold tracking-tight">Validating Admission Webhooks</h1>
 <p className="text-sm text-muted-foreground">
 {filteredItems.length} validating webhook configurations (cluster-scoped)
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
 selectionLabel={selectedItems.size > 0 ? 'Selected validating webhooks' : 'All visible'}
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
 <ListPageStatCard label="Total" value={stats.total} icon={Webhook} iconColor="text-primary" selected={!hasActiveFilters} onClick={() => clearAllFilters()} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Fail Policy" value={stats.failPolicy} icon={XCircle} iconColor="text-rose-600" valueClassName="text-rose-600" selected={columnFilters.failurePolicy?.size === 1 && columnFilters.failurePolicy.has('Fail')} onClick={() => toggleStatFilter('failurePolicy', 'Fail')} className={cn(columnFilters.failurePolicy?.size === 1 && columnFilters.failurePolicy.has('Fail') && 'ring-2 ring-rose-500')} isLoading={isLoading} />
 <ListPageStatCard label="Ignore Policy" value={stats.ignorePolicy} icon={CheckCircle2} iconColor="text-muted-foreground" valueClassName="text-muted-foreground" selected={columnFilters.failurePolicy?.size === 1 && columnFilters.failurePolicy.has('Ignore')} onClick={() => toggleStatFilter('failurePolicy', 'Ignore')} className={cn(columnFilters.failurePolicy?.size === 1 && columnFilters.failurePolicy.has('Ignore') && 'ring-2 ring-muted-foreground')} isLoading={isLoading} />
 <ListPageStatCard label="Multiple Webhooks" value={stats.multipleWebhooks} icon={Clock} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.hasMultipleWebhooks?.size === 1 && columnFilters.hasMultipleWebhooks.has('Yes')} onClick={() => toggleStatFilter('hasMultipleWebhooks', 'Yes')} className={cn(columnFilters.hasMultipleWebhooks?.size === 1 && columnFilters.hasMultipleWebhooks.has('Yes') && 'ring-2 ring-amber-500')} isLoading={isLoading} />
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
 <Input placeholder="Search validating webhooks..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all" />
 </div>
 }
 />
 }
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={VW_COLUMNS_FOR_VISIBILITY}
 visibleColumns={columnVisibility.visibleColumns}
 onColumnToggle={columnVisibility.setColumnVisible}
 isLoading={isLoading && isConnected}
 footer={
 <div className="flex items-center justify-between flex-wrap gap-2">
 <div className="flex items-center gap-3">
 <span className="text-sm text-muted-foreground">{totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No validating webhooks'}</span>
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
 <ResizableTableProvider tableId="validatingwebhooks" columnConfig={VW_TABLE_COLUMNS}>
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
 <ListPageLoadingShell columnCount={8} resourceName="validating webhooks" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={8} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : !isConnected ? (
 <TableRow><TableCell colSpan={8} className="h-32 text-center"><div className="flex flex-col items-center gap-2"><WifiOff className="h-8 w-8 opacity-50" /><p className="text-sm text-muted-foreground">Connect cluster to view validating webhooks</p></div></TableCell></TableRow>
 ) : itemsOnPage.length === 0 ? (
 <TableRow>
 <TableCell colSpan={8} className="h-40 text-center">
 <TableEmptyState
 icon={<Webhook className="h-8 w-8" />}
 title="No validating webhooks found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Register admission webhooks to validate resources before they are stored.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create ValidatingWebhookConfiguration"
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
 <span className="font-medium flex items-center gap-2 truncate cursor-pointer text-primary hover:underline" onClick={() => navigate(`/validatingwebhooks/${item.name}`)}>
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
 <DropdownMenuItem onClick={() => navigate(`/validatingwebhooks/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/validatingwebhooks/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
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
 resourceKind="ValidatingWebhookConfiguration"
 defaultYaml={ValidatingWebhookYaml}
 onClose={() => setShowCreateWizard(false)}
 onApply={async (yaml) => {
 if (!isConnected) { toast.error('Connect cluster to create validating webhooks'); return; }
 toast.success('ValidatingWebhookConfiguration created successfully');
 setShowCreateWizard(false);
 refetch();
 }}
 />
 )}

 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
 resourceType="ValidatingWebhookConfiguration"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} validating webhooks` : (deleteDialog.item?.name || '')}
 namespace={undefined}
 onConfirm={handleDelete}
 />
 </div>
 );
}
