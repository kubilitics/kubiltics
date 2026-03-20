import { useState, useMemo, useEffect } from 'react';
import {
 RefreshCw, MoreHorizontal, CheckCircle2, XCircle, Clock, Loader2, WifiOff, Plus,
 Trash2, FileText, Search, Shield, ChevronDown, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
 TableColumnHeaderWithFilterAndSort, TableFilterCell, PAGE_SIZE_OPTIONS,
 AgeCell, TableEmptyState, TableErrorState, ListPageLoadingShell, ResourceListTableToolbar,
 type StatusPillVariant,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { ResourceCreator } from '@/components/editor';
import { toast } from 'sonner';

interface PSPResource extends KubernetesResource {
 spec?: {
 privileged?: boolean;
 volumes?: string[];
 hostNetwork?: boolean;
 hostPID?: boolean;
 hostIPC?: boolean;
 runAsUser?: { rule?: string };
 seLinux?: { rule?: string };
 supplementalGroups?: { rule?: string };
 fsGroup?: { rule?: string };
 };
}

interface PodSecurityPolicy {
 name: string;
 privileged: boolean;
 volumes: string;
 hostNetwork: boolean;
 hostPID: boolean;
 runAsUser: string;
 age: string;
 creationTimestamp?: string;
 hasHostAccess: boolean;
}

const PSP_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'privileged', defaultWidth: 100, minWidth: 70 },
 { id: 'volumes', defaultWidth: 220, minWidth: 120 },
 { id: 'hostNetwork', defaultWidth: 160, minWidth: 100 },
 { id: 'hostPID', defaultWidth: 100, minWidth: 70 },
 { id: 'runAsUser', defaultWidth: 160, minWidth: 100 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const PSP_COLUMNS_FOR_VISIBILITY = [
 { id: 'privileged', label: 'Privileged' },
 { id: 'volumes', label: 'Volumes' },
 { id: 'hostNetwork', label: 'Host Network' },
 { id: 'hostPID', label: 'Host PID' },
 { id: 'runAsUser', label: 'Run As User' },
 { id: 'age', label: 'Age' },
];

function transformPSP(resource: PSPResource): PodSecurityPolicy {
 const spec = resource.spec ?? {};
 const privileged = spec.privileged ?? false;
 const volumes = spec.volumes?.join(', ') || '-';
 const hostNetwork = spec.hostNetwork ?? false;
 const hostPID = spec.hostPID ?? false;
 const runAsUser = spec.runAsUser?.rule ?? '-';
 const hasHostAccess = hostNetwork || hostPID;

 return {
 name: resource.metadata.name,
 privileged,
 volumes,
 hostNetwork,
 hostPID,
 runAsUser,
 age: calculateAge(resource.metadata.creationTimestamp),
 creationTimestamp: resource.metadata?.creationTimestamp,
 hasHostAccess,
 };
}

const PSPYaml = `apiVersion: policy/v1beta1
kind: PodSecurityPolicy
metadata:
 name: ''
spec:
 privileged: false
 seLinux:
 rule: RunAsAny
 runAsUser:
 rule: MustRunAsNonRoot
 fsGroup:
 rule: RunAsAny
 volumes:
 - 'configMap'
 - 'emptyDir'
 - 'secret'
`;

export default function PodSecurityPolicies() {
 const navigate = useNavigate();
 const [searchQuery, setSearchQuery] = useState('');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: PodSecurityPolicy | null; bulk?: boolean }>({ open: false, item: null });
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<PSPResource>('podsecuritypolicies', undefined, { limit: 5000 });
 const deleteResource = useDeleteK8sResource('podsecuritypolicies');

 const items: PodSecurityPolicy[] = isConnected && data
 ? (data.items ?? []).map(transformPSP)
 : [];

 const stats = useMemo(() => ({
 total: items.length,
 privileged: items.filter((i) => i.privileged).length,
 restricted: items.filter((i) => !i.privileged).length,
 hostAccess: items.filter((i) => i.hasHostAccess).length,
 }), [items]);

 const itemsAfterSearch = useMemo(() =>
 items.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase())),
 [items, searchQuery]);

 const pspColumnConfig: ColumnConfig<PodSecurityPolicy>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
 { columnId: 'privileged', getValue: (i) => String(i.privileged), sortable: true, filterable: true },
 { columnId: 'volumes', getValue: (i) => i.volumes, sortable: false, filterable: false },
 { columnId: 'hostNetwork', getValue: (i) => String(i.hostNetwork), sortable: true, filterable: false },
 { columnId: 'hostPID', getValue: (i) => String(i.hostPID), sortable: true, filterable: false },
 { columnId: 'runAsUser', getValue: (i) => i.runAsUser, sortable: true, filterable: true },
 { columnId: 'hasHostAccess', getValue: (i) => (i.hasHostAccess ? 'Yes' : 'No'), sortable: false, filterable: true },
 { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
 ], []);

 const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearch, { columns: pspColumnConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'podsecuritypolicies', columns: PSP_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const totalFiltered = filteredItems.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredItems.slice(start, start + pageSize);

 useEffect(() => {
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [safePageIndex, pageIndex]);

 const toggleSelection = (item: PodSecurityPolicy) => {
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
 if (!isConnected) { toast.error('Connect cluster to delete pod security policies'); return; }
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
 filenamePrefix: 'podsecuritypolicies',
 resourceLabel: 'pod security policies',
 getExportData: (d: PodSecurityPolicy) => ({ name: d.name, privileged: d.privileged, volumes: d.volumes, hostNetwork: d.hostNetwork, hostPID: d.hostPID, runAsUser: d.runAsUser, age: d.age }),
 csvColumns: [
 { label: 'Name', getValue: (d: PodSecurityPolicy) => d.name },
 { label: 'Privileged', getValue: (d: PodSecurityPolicy) => String(d.privileged) },
 { label: 'Volumes', getValue: (d: PodSecurityPolicy) => d.volumes },
 { label: 'Host Network', getValue: (d: PodSecurityPolicy) => String(d.hostNetwork) },
 { label: 'Host PID', getValue: (d: PodSecurityPolicy) => String(d.hostPID) },
 { label: 'Run As User', getValue: (d: PodSecurityPolicy) => d.runAsUser },
 { label: 'Age', getValue: (d: PodSecurityPolicy) => d.age },
 ],
 toK8sYaml: (d: PodSecurityPolicy) => `---
apiVersion: policy/v1beta1
kind: PodSecurityPolicy
metadata:
 name: ${d.name}
spec:
 privileged: ${d.privileged}
`,
 };

 return (
 <div className="space-y-6">
 <Alert className="border-amber-500/50 bg-amber-500/10">
 <AlertTriangle className="h-4 w-4 text-amber-500" />
 <AlertTitle className="text-amber-600">Deprecated Resource</AlertTitle>
 <AlertDescription className="text-amber-600/80">
 PodSecurityPolicy was deprecated in Kubernetes 1.21 and removed in 1.25. Consider migrating to Pod Security Admission or third-party admission controllers such as OPA/Gatekeeper.
 </AlertDescription>
 </Alert>

 <div className="flex items-center justify-between flex-wrap gap-4">
 <div className="flex items-center gap-3 flex-wrap">
 <div className="p-2.5 rounded-xl bg-primary/10"><Shield className="h-6 w-6 text-primary" /></div>
 <div>
 <h1 className="text-2xl font-semibold tracking-tight">Pod Security Policies</h1>
 <p className="text-sm text-muted-foreground">
 {filteredItems.length} pod security policies (cluster-scoped)
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
 selectionLabel={selectedItems.size > 0 ? 'Selected pod security policies' : 'All visible'}
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
 <ListPageStatCard label="Total" value={stats.total} icon={Shield} iconColor="text-primary" selected={!hasActiveFilters} onClick={() => clearAllFilters()} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Privileged" value={stats.privileged} icon={XCircle} iconColor="text-rose-600" valueClassName="text-rose-600" selected={columnFilters.privileged?.size === 1 && columnFilters.privileged.has('true')} onClick={() => setColumnFilter('privileged', columnFilters.privileged?.has('true') ? null : new Set(['true']))} className={cn(columnFilters.privileged?.size === 1 && columnFilters.privileged.has('true') && 'ring-2 ring-rose-500')} isLoading={isLoading} />
 <ListPageStatCard label="Restricted" value={stats.restricted} icon={CheckCircle2} iconColor="text-emerald-600" valueClassName="text-emerald-600" selected={columnFilters.privileged?.size === 1 && columnFilters.privileged.has('false')} onClick={() => setColumnFilter('privileged', columnFilters.privileged?.has('false') ? null : new Set(['false']))} className={cn(columnFilters.privileged?.size === 1 && columnFilters.privileged.has('false') && 'ring-2 ring-emerald-500')} isLoading={isLoading} />
 <ListPageStatCard label="With Host Access" value={stats.hostAccess} icon={Clock} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.hasHostAccess?.size === 1 && columnFilters.hasHostAccess.has('Yes')} onClick={() => setColumnFilter('hasHostAccess', columnFilters.hasHostAccess?.has('Yes') ? null : new Set(['Yes']))} className={cn(columnFilters.hasHostAccess?.size === 1 && columnFilters.hasHostAccess.has('Yes') && 'ring-2 ring-amber-500')} isLoading={isLoading} />
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
 <Input placeholder="Search pod security policies..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all" />
 </div>
 }
 />
 }
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={PSP_COLUMNS_FOR_VISIBILITY}
 visibleColumns={columnVisibility.visibleColumns}
 onColumnToggle={columnVisibility.setColumnVisible}
 isLoading={isLoading && isConnected}
 footer={
 <div className="flex items-center justify-between flex-wrap gap-2">
 <div className="flex items-center gap-3">
 <span className="text-sm text-muted-foreground">{totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No pod security policies'}</span>
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
 <ResizableTableProvider tableId="podsecuritypolicies" columnConfig={PSP_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 980 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
 {columnVisibility.isColumnVisible('privileged') && <ResizableTableHead columnId="privileged"><TableColumnHeaderWithFilterAndSort columnId="privileged" label="Privileged" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={distinctValuesByColumn.privileged ?? []} selectedFilterValues={columnFilters.privileged ?? new Set()} onFilterChange={setColumnFilter} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('volumes') && <ResizableTableHead columnId="volumes"><TableColumnHeaderWithFilterAndSort columnId="volumes" label="Volumes" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('hostNetwork') && <ResizableTableHead columnId="hostNetwork"><TableColumnHeaderWithFilterAndSort columnId="hostNetwork" label="Host Network" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('hostPID') && <ResizableTableHead columnId="hostPID"><TableColumnHeaderWithFilterAndSort columnId="hostPID" label="Host PID" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('runAsUser') && <ResizableTableHead columnId="runAsUser"><TableColumnHeaderWithFilterAndSort columnId="runAsUser" label="Run As User" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={distinctValuesByColumn.runAsUser ?? []} selectedFilterValues={columnFilters.runAsUser ?? new Set()} onFilterChange={setColumnFilter} /></ResizableTableHead>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>}
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10" />
 <ResizableTableCell columnId="name" />
 {columnVisibility.isColumnVisible('privileged') && <ResizableTableCell columnId="privileged"><TableFilterCell columnId="privileged" label="Privileged" distinctValues={distinctValuesByColumn.privileged ?? []} selectedFilterValues={columnFilters.privileged ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.privileged} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('volumes') && <ResizableTableCell columnId="volumes" />}
 {columnVisibility.isColumnVisible('hostNetwork') && <ResizableTableCell columnId="hostNetwork" />}
 {columnVisibility.isColumnVisible('hostPID') && <ResizableTableCell columnId="hostPID" />}
 {columnVisibility.isColumnVisible('runAsUser') && <ResizableTableCell columnId="runAsUser"><TableFilterCell columnId="runAsUser" label="Run As User" distinctValues={distinctValuesByColumn.runAsUser ?? []} selectedFilterValues={columnFilters.runAsUser ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.runAsUser} /></ResizableTableCell>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" />}
 <TableCell className="w-12" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={9} resourceName="pod security policies" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={9} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : !isConnected ? (
 <TableRow><TableCell colSpan={9} className="h-32 text-center"><div className="flex flex-col items-center gap-2"><WifiOff className="h-8 w-8 opacity-50" /><p className="text-sm text-muted-foreground">Connect cluster to view pod security policies</p></div></TableCell></TableRow>
 ) : itemsOnPage.length === 0 ? (
 <TableRow>
 <TableCell colSpan={9} className="h-40 text-center">
 <TableEmptyState
 icon={<Shield className="h-8 w-8" />}
 title="No pod security policies found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'PodSecurityPolicy is deprecated; consider Pod Security Standards.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create PodSecurityPolicy"
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
 <span className="font-medium flex items-center gap-2 truncate cursor-pointer text-primary hover:underline" onClick={() => navigate(`/podsecuritypolicies/${item.name}`)}>
 <Shield className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 </span>
 </ResizableTableCell>
 {columnVisibility.isColumnVisible('privileged') && <ResizableTableCell columnId="privileged"><Badge variant={item.privileged ? 'destructive' : 'secondary'} className="text-xs">{item.privileged ? 'Yes' : 'No'}</Badge></ResizableTableCell>}
 {columnVisibility.isColumnVisible('volumes') && <ResizableTableCell columnId="volumes" className="text-xs text-muted-foreground truncate max-w-[220px]" title={item.volumes}>{item.volumes}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('hostNetwork') && <ResizableTableCell columnId="hostNetwork"><Badge variant={item.hostNetwork ? 'destructive' : 'outline'} className="text-xs">{item.hostNetwork ? 'Yes' : 'No'}</Badge></ResizableTableCell>}
 {columnVisibility.isColumnVisible('hostPID') && <ResizableTableCell columnId="hostPID"><Badge variant={item.hostPID ? 'destructive' : 'outline'} className="text-xs">{item.hostPID ? 'Yes' : 'No'}</Badge></ResizableTableCell>}
 {columnVisibility.isColumnVisible('runAsUser') && <ResizableTableCell columnId="runAsUser">{item.runAsUser !== '-' ? (<Badge variant="secondary" className="font-mono text-xs truncate block w-fit max-w-full">{item.runAsUser}</Badge>) : <span className="text-muted-foreground text-xs">-</span>}</ResizableTableCell>}
 {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>}
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem onClick={() => navigate(`/podsecuritypolicies/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/podsecuritypolicies/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
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
 resourceKind="PodSecurityPolicy"
 defaultYaml={PSPYaml}
 onClose={() => setShowCreateWizard(false)}
 onApply={async (yaml) => {
 if (!isConnected) { toast.error('Connect cluster to create pod security policies'); return; }
 toast.success('PodSecurityPolicy created successfully');
 setShowCreateWizard(false);
 refetch();
 }}
 />
 )}

 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
 resourceType="PodSecurityPolicy"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} pod security policies` : (deleteDialog.item?.name || '')}
 namespace={undefined}
 onConfirm={handleDelete}
 />
 </div>
 );
}
