import { useState, useMemo, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { 
 Search, 
 Filter,
 RefreshCw, 
 MoreHorizontal,
 Download,
 Shield,
 Loader2,
 WifiOff,
 Plus,
 Trash2,
 ChevronDown,
 CheckSquare,
 ExternalLink,
 ArrowDownToLine,
 ArrowUpFromLine,
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
import { useK8sResourceList, useDeleteK8sResource, usePatchK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog, BulkActionBar, executeBulkOperation } from '@/components/resources';
import { NetworkPolicyWizard } from '@/components/wizards';
import { ResourceExportDropdown, ResourceCommandBar, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, ListPagination, PAGE_SIZE_OPTIONS, resourceTableRowClassName, ROW_MOTION, AgeCell, TableEmptyState, ListPageLoadingShell, TableErrorState, CopyNameDropdownItem, NamespaceBadge, ResourceListTableToolbar, StatusPill } from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { toast } from '@/components/ui/sonner';
import { useMultiSelect } from '@/hooks/useMultiSelect';

interface K8sNetworkPolicy extends KubernetesResource {
 spec?: {
 podSelector?: { matchLabels?: Record<string, string> };
 policyTypes?: string[];
 ingress?: Array<{ from?: unknown[]; ports?: unknown[] }>;
 egress?: Array<{ to?: unknown[]; ports?: unknown[] }>;
 };
}

interface NetworkPolicy {
 name: string;
 namespace: string;
 podSelector: string;
 policyTypes: string[];
 ingressRules: number;
 egressRules: number;
 allowedSources: number;
 allowedDestinations: number;
 affectedPods: number;
 age: string;
 creationTimestamp?: string;
}

const NETWORKPOLICIES_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'status', defaultWidth: 120, minWidth: 80 },
 { id: 'podSelector', defaultWidth: 220, minWidth: 120 },
 { id: 'affectedPods', defaultWidth: 100, minWidth: 70 },
 { id: 'policyTypes', defaultWidth: 160, minWidth: 100 },
 { id: 'ingressRules', defaultWidth: 100, minWidth: 70 },
 { id: 'egressRules', defaultWidth: 100, minWidth: 70 },
 { id: 'allowedSources', defaultWidth: 100, minWidth: 70 },
 { id: 'allowedDestinations', defaultWidth: 100, minWidth: 70 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const NETWORKPOLICIES_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'status', label: 'Status' },
 { id: 'podSelector', label: 'Pod Selector' },
 { id: 'affectedPods', label: 'Affected Pods' },
 { id: 'policyTypes', label: 'Policy Types' },
 { id: 'ingressRules', label: 'Ingress Rules' },
 { id: 'egressRules', label: 'Egress Rules' },
 { id: 'allowedSources', label: 'Allowed Sources' },
 { id: 'allowedDestinations', label: 'Allowed Destinations' },
 { id: 'age', label: 'Age' },
];

function podMatchesSelector(podLabels: Record<string, string> | undefined, matchLabels: Record<string, string> | undefined): boolean {
 if (!matchLabels || Object.keys(matchLabels).length === 0) return true;
 if (!podLabels) return false;
 return Object.entries(matchLabels).every(([k, v]) => podLabels[k] === v);
}

export default function NetworkPolicies() {
 const navigate = useNavigate();
 const [searchQuery, setSearchQuery] = useState('');
 const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: NetworkPolicy | null; bulk?: boolean }>({ open: false, item: null });
 const multiSelect = useMultiSelect();
 const selectedItems = multiSelect.selectedIds;
 const setSelectedItems = (s: Set<string>) => { if (s.size === 0) multiSelect.clearSelection(); else multiSelect.selectAll(Array.from(s)); };
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<K8sNetworkPolicy>('networkpolicies', undefined, { limit: 5000 });
 const { data: podsData } = useK8sResourceList<KubernetesResource>('pods', undefined, { limit: 10000, enabled: isConnected });
 const deleteResource = useDeleteK8sResource('networkpolicies');
 const patchNetworkPolicyResource = usePatchK8sResource('networkpolicies');

 const podsByNamespace = useMemo(() => {
 const map = new Map<string, Array<{ labels?: Record<string, string> }>>();
 if (!podsData?.items?.length) return map;
 (podsData.items as KubernetesResource[]).forEach((p) => {
 const ns = p.metadata?.namespace ?? '';
 const list = map.get(ns) ?? [];
 list.push({ labels: p.metadata?.labels as Record<string, string> | undefined });
 map.set(ns, list);
 });
 return map;
 }, [podsData?.items]);

 const networkpolicies: NetworkPolicy[] = useMemo(() => {
 if (!isConnected || !data?.items?.length) return [];
 const matchLabelsByKey = new Map<string, Record<string, string> | undefined>();
 return (data.items as K8sNetworkPolicy[]).map((np) => {
 const labels = np.spec?.podSelector?.matchLabels;
 const podSelector = labels 
 ? Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(', ') 
 : 'All Pods';
 const ingress = np.spec?.ingress ?? [];
 const egress = np.spec?.egress ?? [];
 const allowedSources = ingress.reduce((sum, r) => sum + (Array.isArray(r.from) ? r.from.length : 0), 0);
 const allowedDestinations = egress.reduce((sum, r) => sum + (Array.isArray(r.to) ? r.to.length : 0), 0);
 const ns = np.metadata.namespace || 'default';
 const podsInNs = podsByNamespace.get(ns) ?? [];
 const affectedPods = podsInNs.filter((p) => podMatchesSelector(p.labels, labels)).length;
 return {
 name: np.metadata.name,
 namespace: ns,
 podSelector,
 policyTypes: np.spec?.policyTypes || ['Ingress'],
 ingressRules: ingress.length,
 egressRules: egress.length,
 allowedSources,
 allowedDestinations,
 affectedPods,
 age: calculateAge(np.metadata.creationTimestamp),
 creationTimestamp: np.metadata?.creationTimestamp,
 };
 });
 }, [isConnected, data?.items, podsByNamespace]);

 const stats = useMemo(() => {
 let unprotectedPods = 0;
 const npList = (data?.items ?? []) as K8sNetworkPolicy[];
 if (npList.length > 0 && podsByNamespace.size > 0) {
 podsByNamespace.forEach((pods, ns) => {
 if (selectedNamespace !== 'all' && selectedNamespace !== ns) return;
 const policiesInNs = npList.filter((np) => (np.metadata?.namespace ?? 'default') === ns);
 pods.forEach((p) => {
 const covered = policiesInNs.some((np) => podMatchesSelector(p.labels, np.spec?.podSelector?.matchLabels));
 if (!covered) unprotectedPods += 1;
 });
 });
 }
 return {
 total: networkpolicies.length,
 withIngress: networkpolicies.filter((np) => np.ingressRules > 0 || np.policyTypes.includes('Ingress')).length,
 withEgress: networkpolicies.filter((np) => np.egressRules > 0 || np.policyTypes.includes('Egress')).length,
 defaultDeny: networkpolicies.filter(
 (np) =>
 (np.policyTypes.includes('Ingress') && np.ingressRules === 0) ||
 (np.policyTypes.includes('Egress') && np.egressRules === 0)
 ).length,
 unprotectedPods,
 };
 }, [networkpolicies, data?.items, podsByNamespace, selectedNamespace]);

 const namespaces = useMemo(() => {
 return ['all', ...Array.from(new Set(networkpolicies.map(np => np.namespace)))];
 }, [networkpolicies]);

 const itemsAfterSearchAndNs = useMemo(() => {
 return networkpolicies.filter(np => {
 const matchesSearch = np.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
 np.namespace.toLowerCase().includes(searchQuery.toLowerCase()) ||
 np.podSelector.toLowerCase().includes(searchQuery.toLowerCase());
 const matchesNamespace = selectedNamespace === 'all' || np.namespace === selectedNamespace;
 return matchesSearch && matchesNamespace;
 });
 }, [networkpolicies, searchQuery, selectedNamespace]);

 const policyTypeValue = (np: NetworkPolicy) =>
 np.policyTypes.includes('Ingress') && np.policyTypes.includes('Egress') ? 'Both' : np.policyTypes.includes('Ingress') ? 'Ingress' : 'Egress';

 const networkPoliciesTableConfig: ColumnConfig<NetworkPolicy>[] = useMemo(() => [
 { columnId: 'name', getValue: (np) => np.name, sortable: true, filterable: false },
 { columnId: 'namespace', getValue: (np) => np.namespace, sortable: true, filterable: true },
 { columnId: 'status', getValue: () => 'Active', sortable: false, filterable: false },
 { columnId: 'podSelector', getValue: (np) => np.podSelector, sortable: true, filterable: false },
 { columnId: 'affectedPods', getValue: (np) => np.affectedPods, sortable: true, filterable: false },
 { columnId: 'policyTypes', getValue: policyTypeValue, sortable: true, filterable: true },
 { columnId: 'ingressRules', getValue: (np) => np.ingressRules, sortable: true, filterable: false },
 { columnId: 'egressRules', getValue: (np) => np.egressRules, sortable: true, filterable: false },
 { columnId: 'allowedSources', getValue: (np) => np.allowedSources, sortable: true, filterable: false },
 { columnId: 'allowedDestinations', getValue: (np) => np.allowedDestinations, sortable: true, filterable: false },
 {
   columnId: 'age',
   getValue: (np) => np.age,
   sortValue: (np) => -(np.creationTimestamp ? Date.parse(np.creationTimestamp) : 0),
   sortable: true,
   filterable: false,
 },
 ], []);

 const { filteredAndSortedItems: filteredPolicies, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearchAndNs, { columns: networkPoliciesTableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
 const columnVisibility = useColumnVisibility({ tableId: 'networkpolicies', columns: NETWORKPOLICIES_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

 const totalFiltered = filteredPolicies.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredPolicies.slice(start, start + pageSize);

 useEffect(() => {
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [safePageIndex, pageIndex]);

 const handleDelete = async () => {
 if (deleteDialog.bulk && selectedItems.size > 0) {
 for (const key of selectedItems) {
 const [namespace, name] = key.split('/');
 if (isConnected) {
 await deleteResource.mutateAsync({ name, namespace });
 }
 }
 toast.success(`Deleted ${selectedItems.size} network policies`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 if (isConnected) {
 await deleteResource.mutateAsync({
 name: deleteDialog.item.name,
 namespace: deleteDialog.item.namespace,
 });
 } else {
 toast.success(`NetworkPolicy ${deleteDialog.item.name} deleted (demo mode)`);
 }
 }
 setDeleteDialog({ open: false, item: null });
 };

 const networkPolicyExportConfig = {
 filenamePrefix: 'networkpolicies',
 resourceLabel: 'network policies',
 getExportData: (np: NetworkPolicy) => ({ name: np.name, namespace: np.namespace, podSelector: np.podSelector, affectedPods: np.affectedPods, policyTypes: np.policyTypes.join(', '), ingressRules: np.ingressRules, egressRules: np.egressRules, allowedSources: np.allowedSources, allowedDestinations: np.allowedDestinations, age: np.age }),
 csvColumns: [
 { label: 'Name', getValue: (np: NetworkPolicy) => np.name },
 { label: 'Namespace', getValue: (np: NetworkPolicy) => np.namespace },
 { label: 'Pod Selector', getValue: (np: NetworkPolicy) => np.podSelector },
 { label: 'Affected Pods', getValue: (np: NetworkPolicy) => np.affectedPods },
 { label: 'Policy Types', getValue: (np: NetworkPolicy) => np.policyTypes.join(', ') },
 { label: 'Ingress Rules', getValue: (np: NetworkPolicy) => np.ingressRules },
 { label: 'Egress Rules', getValue: (np: NetworkPolicy) => np.egressRules },
 { label: 'Allowed Sources', getValue: (np: NetworkPolicy) => np.allowedSources },
 { label: 'Allowed Destinations', getValue: (np: NetworkPolicy) => np.allowedDestinations },
 { label: 'Age', getValue: (np: NetworkPolicy) => np.age },
 ],
 toK8sYaml: (np: NetworkPolicy) => `---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
 name: ${np.name}
 namespace: ${np.namespace}
spec:
 podSelector: {}
 policyTypes: [${np.policyTypes.map(t => `"${t}"`).join(', ')}]
 ingress: []
 egress: []
`,
 };

 const allPolicyKeys = useMemo(() => filteredPolicies.map(np => `${np.namespace}/${np.name}`), [filteredPolicies]);

 const toggleSelection = (item: NetworkPolicy, event?: React.MouseEvent) => {
 const key = `${item.namespace}/${item.name}`;
 if (event?.shiftKey) {
 multiSelect.toggleRange(key, allPolicyKeys);
 } else {
 multiSelect.toggle(key);
 }
 };

 const toggleAllSelection = () => {
 if (multiSelect.isAllSelected(allPolicyKeys)) multiSelect.clearSelection();
 else multiSelect.selectAll(allPolicyKeys);
 };

 const handleBulkDelete = async () => {
 return executeBulkOperation(Array.from(selectedItems), async (_key, ns, name) => {
 await deleteResource.mutateAsync({ name, namespace: ns });
 });
 };

 const handleBulkLabel = async (label: string) => {
 return executeBulkOperation(Array.from(selectedItems), async (_key, ns, name) => {
 await patchNetworkPolicyResource.mutateAsync({ name, namespace: ns, patch: { metadata: { labels: { [label.split("=")[0]]: label.split("=")[1] } } } });
 });
 };

 const selectedResourceLabels = useMemo(() => {
 const map = new Map<string, Record<string, string>>();
 for (const key of selectedItems) {
 const [ns, n] = key.split('/');
 const raw = (data?.items ?? []).find((r) => r.metadata.namespace === ns && r.metadata.name === n);
 if (raw) map.set(key, raw.metadata.labels ?? {});
 }
 return map;
 }, [selectedItems, data?.items]);

 const isAllSelected = multiSelect.isAllSelected(allPolicyKeys);
 const isSomeSelected = multiSelect.isSomeSelected(allPolicyKeys);

 const pagination = {
 rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No network policies',
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
 <PageLayout label="Network Policies">
 <ListPageHeader
 icon={<Shield className="h-6 w-6 text-primary" />}
 title="Network Policies"
 resourceCount={filteredPolicies.length}
 subtitle={namespaces.length > 1 ? `across ${namespaces.length - 1} namespaces` : undefined}
 demoMode={!isConnected}
 dataUpdatedAt={dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create Policy"
 onCreate={() => setShowCreateWizard(true)}
 actions={
 <>
 <ResourceExportDropdown
 items={filteredPolicies}
 selectedKeys={selectedItems}
 getKey={(np) => `${np.namespace}/${np.name}`}
 config={networkPolicyExportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected network policies' : 'All visible network policies'}
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
 />

 <BulkActionBar
 selectedCount={selectedItems.size}
 resourceName="network policy"
 resourceType="networkpolicies"
 onClearSelection={() => multiSelect.clearSelection()}
 onBulkDelete={handleBulkDelete}
 onBulkLabel={handleBulkLabel}
 />

 {/* Stats Cards - Design 3.6: Total, Ingress Rules, Egress Rules, Default Deny, Unprotected Pods */}
 <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
 <ListPageStatCard size="sm" label="Total Policies" value={stats.total} selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard size="sm" label="Ingress Rules" value={stats.withIngress} valueClassName="text-blue-600" icon={ArrowDownToLine} iconColor="text-blue-600" selected={columnFilters.policyTypes?.size === 1 && columnFilters.policyTypes.has('Ingress')} onClick={() => setColumnFilter('policyTypes', new Set(['Ingress']))} className={cn(columnFilters.policyTypes?.size === 1 && columnFilters.policyTypes.has('Ingress') && 'ring-2 ring-blue-600')} isLoading={isLoading} />
 <ListPageStatCard size="sm" label="Egress Rules" value={stats.withEgress} valueClassName="text-orange-600" icon={ArrowUpFromLine} iconColor="text-orange-600" selected={columnFilters.policyTypes?.size === 1 && columnFilters.policyTypes.has('Egress')} onClick={() => setColumnFilter('policyTypes', new Set(['Egress']))} className={cn(columnFilters.policyTypes?.size === 1 && columnFilters.policyTypes.has('Egress') && 'ring-2 ring-orange-600')} isLoading={isLoading} />
 <ListPageStatCard size="sm" label="Default Deny" value={stats.defaultDeny} valueClassName="text-purple-600" isLoading={isLoading} />
 <ListPageStatCard size="sm" label="Unprotected Pods" value={stats.unprotectedPods} valueClassName="text-amber-600" isLoading={isLoading} />
 </div>

 <ResourceListTableToolbar
 globalFilterBar={
 <ResourceCommandBar
 scope={
 <div className="w-full min-w-0">
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="outline" className="w-full min-w-0 h-10 gap-2 justify-between truncate rounded-lg border border-border bg-background font-medium shadow-sm hover:bg-muted/50 hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary/20">
 <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
 <span className="truncate">{selectedNamespace === 'all' ? 'All Namespaces' : selectedNamespace}</span>
 <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="start">
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
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
 <Input
 placeholder="Search network policies..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all"
 aria-label="Search network policies"
 />
 </div>
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
 columns={NETWORKPOLICIES_COLUMNS_FOR_VISIBILITY}
 visibleColumns={columnVisibility.visibleColumns}
 onColumnToggle={columnVisibility.setColumnVisible}
 isLoading={isLoading && isConnected}
 footer={
 <div className="flex items-center justify-between flex-wrap gap-2">
 <div className="flex items-center gap-4">
 <span className="text-sm text-muted-foreground">{pagination.rangeLabel}</span>
 <DropdownMenu>
 <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="gap-2">{pageSize} per page<ChevronDown className="h-4 w-4 opacity-50" /></Button></DropdownMenuTrigger>
 <DropdownMenuContent align="start">
 {PAGE_SIZE_OPTIONS.map((size) => (
 <DropdownMenuItem key={size} onClick={() => { setPageSize(size); setPageIndex(0); }} className={cn(pageSize === size && 'bg-accent')}>{size} per page</DropdownMenuItem>
 ))}
 </DropdownMenuContent>
 </DropdownMenu>
 </div>
 <ListPagination hasPrev={pagination.hasPrev} hasNext={pagination.hasNext} onPrev={pagination.onPrev} onNext={pagination.onNext} rangeLabel={undefined} currentPage={pagination.currentPage} totalPages={pagination.totalPages} onPageChange={pagination.onPageChange} dataUpdatedAt={pagination.dataUpdatedAt} isFetching={pagination.isFetching} />
 </div>
 }
 >
 <ResizableTableProvider tableId="kubilitics-resizable-table-networkpolicies" columnConfig={NETWORKPOLICIES_TABLE_COLUMNS}>
 <Table className="table-fixed" style={{ minWidth: 1340 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-12">
 <Checkbox checked={isAllSelected} onCheckedChange={toggleAllSelection} aria-label="Select all" className={isSomeSelected ? 'opacity-50' : ''} />
 </TableHead>
 <ResizableTableHead columnId="name">
 <TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="namespace">
 <TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="status">
 <TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="podSelector">
 <TableColumnHeaderWithFilterAndSort columnId="podSelector" label="Pod Selector" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="affectedPods">
 <TableColumnHeaderWithFilterAndSort columnId="affectedPods" label="Affected Pods" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="policyTypes">
 <TableColumnHeaderWithFilterAndSort columnId="policyTypes" label="Policy Types" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="ingressRules">Ingress Rules</ResizableTableHead>
 <ResizableTableHead columnId="egressRules">Egress Rules</ResizableTableHead>
 <ResizableTableHead columnId="allowedSources">Allowed Sources</ResizableTableHead>
 <ResizableTableHead columnId="allowedDestinations">Allowed Destinations</ResizableTableHead>
 <ResizableTableHead columnId="age">
 <TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <TableHead className="w-12"></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-12 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5" />
 <ResizableTableCell columnId="namespace" className="p-1.5">
 <TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} />
 </ResizableTableCell>
 <ResizableTableCell columnId="status" className="p-1.5" />
 <ResizableTableCell columnId="podSelector" className="p-1.5" />
 <ResizableTableCell columnId="affectedPods" className="p-1.5" />
 <ResizableTableCell columnId="policyTypes" className="p-1.5">
 <TableFilterCell columnId="policyTypes" label="Policy Types" distinctValues={distinctValuesByColumn.policyTypes ?? []} selectedFilterValues={columnFilters.policyTypes ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.policyTypes} />
 </ResizableTableCell>
 <ResizableTableCell columnId="ingressRules" className="p-1.5" />
 <ResizableTableCell columnId="egressRules" className="p-1.5" />
 <ResizableTableCell columnId="allowedSources" className="p-1.5" />
 <ResizableTableCell columnId="allowedDestinations" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={14} resourceName="network policies" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={14} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : itemsOnPage.length === 0 ? (
 <TableRow>
 <TableCell colSpan={14} className="h-40 text-center">
 <TableEmptyState
 icon={<Shield className="h-8 w-8" />}
 title="No NetworkPolicies found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Create a NetworkPolicy to control pod-to-pod traffic.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create NetworkPolicy"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsOnPage.map((np, idx) => {
 const isSelected = selectedItems.has(`${np.namespace}/${np.name}`);
 return (
 <tr
 key={`${np.namespace}/${np.name}`}
 className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}
 >
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(np, e); }}><Checkbox checked={isSelected} tabIndex={-1} aria-label={`Select ${np.name}`} /></TableCell>
 <ResizableTableCell columnId="name"><Link to={`/networkpolicies/${np.namespace}/${np.name}`} className="font-medium text-primary hover:underline truncate block">{np.name}</Link></ResizableTableCell>
 <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={np.namespace} /></ResizableTableCell>
 <ResizableTableCell columnId="status">
 <StatusPill variant="success" label="Active" />
 </ResizableTableCell>
 <ResizableTableCell columnId="podSelector"><span className="font-mono text-sm truncate block" title={np.podSelector}>{np.podSelector}</span></ResizableTableCell>
 <ResizableTableCell columnId="affectedPods"><span className="font-mono">{np.affectedPods > 0 ? np.affectedPods : '—'}</span></ResizableTableCell>
 <ResizableTableCell columnId="policyTypes">
 <div className="flex gap-1 flex-wrap">
 {np.policyTypes.map((type) => (
 <Badge key={type} variant="secondary" className={cn("text-xs", type === 'Ingress' && "bg-blue-500/10 text-blue-600", type === 'Egress' && "bg-orange-500/10 text-orange-600")}>{type}</Badge>
 ))}
 </div>
 </ResizableTableCell>
 <ResizableTableCell columnId="ingressRules"><span className="font-mono">{np.ingressRules}</span></ResizableTableCell>
 <ResizableTableCell columnId="egressRules"><span className="font-mono">{np.egressRules}</span></ResizableTableCell>
 <ResizableTableCell columnId="allowedSources"><span className="font-mono">{np.allowedSources}</span></ResizableTableCell>
 <ResizableTableCell columnId="allowedDestinations"><span className="font-mono">{np.allowedDestinations}</span></ResizableTableCell>
 <ResizableTableCell columnId="age"><AgeCell age={np.age} timestamp={np.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-52">
 <CopyNameDropdownItem name={np.name} namespace={np.namespace} />
 <DropdownMenuItem onClick={() => navigate(`/networkpolicies/${np.namespace}/${np.name}`)}><ExternalLink className="h-4 w-4 mr-2" />View Details</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/networkpolicies/${np.namespace}/${np.name}?tab=simulation`)}>Simulate Policy</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/networkpolicies/${np.namespace}/${np.name}?tab=pods`)}>View Affected Pods</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/networkpolicies/${np.namespace}/${np.name}?tab=yaml`)}><Download className="h-4 w-4 mr-2" />Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="text-destructive" onClick={() => setDeleteDialog({ open: true, item: np })}><Trash2 className="h-4 w-4 mr-2" />Delete</DropdownMenuItem>
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

 {/* Delete Dialog */}
 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
 resourceType="NetworkPolicy"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} policies` : deleteDialog.item?.name || ''}
 namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace}
 onConfirm={handleDelete}
 requireNameConfirmation={!deleteDialog.bulk}
 />

 {showCreateWizard && (
 <NetworkPolicyWizard
 onClose={() => setShowCreateWizard(false)}
 onSubmit={() => { setShowCreateWizard(false); refetch(); }}
 />
 )}
 </PageLayout>
 );
}
