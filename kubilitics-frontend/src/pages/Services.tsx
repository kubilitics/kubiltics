import { useState, useMemo, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import {
 Search,
 Filter,
 RefreshCw,
 MoreHorizontal,
 CheckCircle2,
 XCircle,
 Clock,
 Globe,
 Loader2,
 WifiOff,
 Plus,
 Trash2,
 ChevronDown,
 ChevronRight,
 GitCompare,
 CheckSquare,
 Square,
 Minus,
 ExternalLink,
 Link2,
 List,
 Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
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
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useK8sResourceList, useDeleteK8sResource, useCreateK8sResource, usePatchK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useQueries } from '@tanstack/react-query';
import { getServiceEndpoints } from '@/services/backendApiClient';
import { DeleteConfirmDialog, PortForwardDialog, BulkActionBar, executeBulkOperation } from '@/components/resources';
import { ResourceExportDropdown, ListPagination, PAGE_SIZE_OPTIONS, ResourceCommandBar, resourceTableRowClassName, ROW_MOTION, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, StatusPill, ListViewSegmentedControl, AgeCell, TableEmptyState, ListPageLoadingShell, TableErrorState, CopyNameDropdownItem, NamespaceBadge, ResourceListTableToolbar, ListSearchInput, type StatusPillVariant } from '@/components/list';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { ServiceIcon } from '@/components/icons/KubernetesIcons';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { getRowAnimationClass } from '@/hooks/useResourceLiveUpdates';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { toast } from '@/components/ui/sonner';
import { useMultiSelect } from '@/hooks/useMultiSelect';

interface ServiceResource extends KubernetesResource {
 spec: {
 type: string;
 clusterIP?: string;
 ports?: Array<{ port: number; protocol?: string; targetPort?: number | string; nodePort?: number; name?: string }>;
 externalIPs?: string[];
 selector?: Record<string, string>;
 sessionAffinity?: string;
 externalTrafficPolicy?: string;
 internalTrafficPolicy?: string;
 };
 status?: {
 loadBalancer?: {
 ingress?: Array<{ ip?: string; hostname?: string }>;
 };
 };
}

interface Service {
 uid?: string;
 name: string;
 namespace: string;
 type: 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName';
 clusterIP: string;
 externalIP: string;
 ports: string;
 endpoints: string;
 selector: string;
 sessionAffinity: string;
 trafficPolicy: string;
 age: string;
 creationTimestamp?: string;
 status: 'Healthy' | 'Pending' | 'Error';
 containers: Array<{ name: string; ports?: Array<{ containerPort: number; name?: string; protocol?: string }> }>;
}

const SERVICES_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'status', defaultWidth: 140, minWidth: 100 },
 { id: 'type', defaultWidth: 160, minWidth: 100 },
 { id: 'clusterIP', defaultWidth: 160, minWidth: 120 },
 { id: 'externalIP', defaultWidth: 160, minWidth: 120 },
 { id: 'ports', defaultWidth: 220, minWidth: 120 },
 { id: 'endpoints', defaultWidth: 130, minWidth: 90 },
 { id: 'selector', defaultWidth: 220, minWidth: 120 },
 { id: 'sessionAffinity', defaultWidth: 160, minWidth: 100 },
 { id: 'trafficPolicy', defaultWidth: 160, minWidth: 100 },
 { id: 'requestsSec', defaultWidth: 100, minWidth: 70 },
 { id: 'latencyP99', defaultWidth: 100, minWidth: 70 },
 { id: 'errorRate', defaultWidth: 100, minWidth: 70 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
];

const SERVICES_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'status', label: 'Status' },
 { id: 'type', label: 'Type' },
 { id: 'clusterIP', label: 'Cluster IP' },
 { id: 'externalIP', label: 'External IP' },
 { id: 'ports', label: 'Ports' },
 { id: 'endpoints', label: 'Endpoints' },
 { id: 'selector', label: 'Selector' },
 { id: 'sessionAffinity', label: 'Session Affinity' },
 { id: 'trafficPolicy', label: 'Traffic Policy' },
 { id: 'requestsSec', label: 'Requests/s' },
 { id: 'latencyP99', label: 'Latency P99' },
 { id: 'errorRate', label: 'Error Rate' },
 { id: 'age', label: 'Age' },
];

const statusConfig = {
 Healthy: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-500/10' },
 Pending: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-500/10' },
 Error: { icon: XCircle, color: 'text-rose-600', bg: 'bg-rose-500/10' },
};

const typeColors: Record<string, string> = {
 ClusterIP: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
 NodePort: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
 LoadBalancer: 'bg-green-500/10 text-green-600 dark:text-green-400',
 ExternalName: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
};

const serviceStatusToPillVariant: Record<Service['status'], StatusPillVariant> = {
 Healthy: 'success',
 Pending: 'warning',
 Error: 'error',
};

function transformServiceResource(resource: ServiceResource): Service {
 const ports = resource.spec?.ports?.map(p => {
 const portStr = p.nodePort ? `${p.port}:${p.nodePort}/${p.protocol}` : `${p.port}/${p.protocol}`;
 return portStr;
 }).join(',') || '-';

 let externalIP = '-';
 if (resource.spec?.type === 'LoadBalancer') {
 const ingress = resource.status?.loadBalancer?.ingress;
 if (ingress && ingress.length > 0) {
 externalIP = ingress[0].ip || ingress[0].hostname || '-';
 } else {
 externalIP = '<pending>';
 }
 } else if (resource.spec?.externalIPs?.length) {
 externalIP = resource.spec.externalIPs.join(',');
 }

 const status: Service['status'] = externalIP === '<pending>' ? 'Pending' : 'Healthy';
 const selector = resource.spec?.selector
 ? Object.entries(resource.spec.selector).map(([k, v]) => `${k}=${v}`).join(', ')
 : '-';
 const sessionAffinity = resource.spec?.sessionAffinity || 'None';
 const trafficPolicy = resource.spec?.externalTrafficPolicy || resource.spec?.internalTrafficPolicy || 'Cluster';

 const containers = resource.spec?.ports?.map(p => ({
 name: 'service',
 ports: [{ containerPort: typeof p.targetPort === 'number' ? p.targetPort : p.port, name: p.protocol || 'TCP', protocol: p.protocol || 'TCP' }],
 })) || [];

 return {
 uid: resource.metadata?.uid,
 name: resource.metadata.name,
 namespace: resource.metadata.namespace || 'default',
 type: (resource.spec?.type as Service['type']) || 'ClusterIP',
 clusterIP: resource.spec?.clusterIP ?? '-',
 externalIP,
 ports,
 endpoints: '—',
 selector,
 sessionAffinity,
 trafficPolicy,
 age: calculateAge(resource.metadata.creationTimestamp),
 creationTimestamp: resource.metadata?.creationTimestamp,
 status,
 containers,
 };
}

type ListView = 'flat' | 'byNamespace' | 'byType';

export default function Services() {
 const navigate = useNavigate();
 const [searchParams] = useSearchParams();
 const [searchQuery, setSearchQuery] = useState('');
 const debouncedSearch = useDebouncedValue(searchQuery, 250);
 const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: Service | null; bulk?: boolean }>({ open: false, item: null });
 const [portForwardDialog, setPortForwardDialog] = useState<{ open: boolean; item: Service | null }>({ open: false, item: null });
 const [testConnectivityDialogOpen, setTestConnectivityDialogOpen] = useState(false);
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const multiSelect = useMultiSelect();
 const selectedItems = multiSelect.selectedIds;
 const setSelectedItems = (s: Set<string>) => { if (s.size === 0) multiSelect.clearSelection(); else multiSelect.selectAll(Array.from(s)); };
 const [listView, setListView] = useState<ListView>('flat');
 const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const { isConnected } = useConnectionStatus();
 const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
 const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
 const activeCluster = useClusterStore((s) => s.activeCluster);
 const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
 const clusterId = currentClusterId ?? null;
 const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<ServiceResource>('services', undefined, { limit: 5000 });
 const deleteResource = useDeleteK8sResource('services');
 const createResource = useCreateK8sResource('services');
 const patchServiceResource = usePatchK8sResource('services');

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const services: Service[] = isConnected && data?.items
 ? (data.items ?? []).map(transformServiceResource)
 : [];

 const stats = useMemo(() => {
 const total = services.length;
 const clusterIP = services.filter(s => s.type === 'ClusterIP').length;
 const nodePort = services.filter(s => s.type === 'NodePort').length;
 const loadBalancer = services.filter(s => s.type === 'LoadBalancer').length;
 const loadBalancerPending = services.filter(s => s.type === 'LoadBalancer' && s.externalIP === '<pending>').length;
 const loadBalancerProvisioned = loadBalancer - loadBalancerPending;
 const externalName = services.filter(s => s.type === 'ExternalName').length;
 return {
 total,
 clusterIP,
 nodePort,
 loadBalancer,
 loadBalancerPending,
 loadBalancerProvisioned,
 externalName,
 unhealthyEndpoints: 0, // computed from endpointsMap after first page load; optional enhancement
 };
 }, [services]);

 const namespaces = useMemo(() => {
 return ['all', ...Array.from(new Set(services.map(s => s.namespace)))];
 }, [services]);

 // Seed namespace filter from ?namespace=<ns> when navigated from Namespace views.
 useEffect(() => {
 const nsFromQuery = searchParams.get('namespace');
 if (!nsFromQuery) return;
 if (selectedNamespace !== 'all') return;
 setSelectedNamespace(nsFromQuery);
 }, [searchParams, selectedNamespace]);

 const itemsAfterSearchAndNs = useMemo(() => {
 return services.filter(svc => {
 const q = debouncedSearch.toLowerCase();
 const matchesSearch = !q || svc.name.toLowerCase().includes(q) ||
 svc.namespace.toLowerCase().includes(q) ||
 svc.clusterIP.includes(debouncedSearch);
 const matchesNamespace = selectedNamespace === 'all' || svc.namespace === selectedNamespace;
 return matchesSearch && matchesNamespace;
 });
 }, [services, debouncedSearch, selectedNamespace]);

 const servicesTableConfig: ColumnConfig<Service>[] = useMemo(() => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: true },
 { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
 { columnId: 'status', getValue: (i) => i.status, sortable: true, filterable: true },
 { columnId: 'type', getValue: (i) => i.type, sortable: true, filterable: true },
 { columnId: 'clusterIP', getValue: (i) => i.clusterIP, sortable: true, filterable: false },
 { columnId: 'externalIP', getValue: (i) => i.externalIP, sortable: true, filterable: false },
 { columnId: 'ports', getValue: (i) => i.ports, sortable: true, filterable: false },
 { columnId: 'endpoints', getValue: (i) => i.endpoints, sortable: true, filterable: false },
 { columnId: 'selector', getValue: (i) => i.selector, sortable: true, filterable: false },
 { columnId: 'sessionAffinity', getValue: (i) => i.sessionAffinity, sortable: true, filterable: true },
 { columnId: 'trafficPolicy', getValue: (i) => i.trafficPolicy, sortable: true, filterable: true },
 { columnId: 'hasUnhealthyEndpoints', getValue: () => 'No', sortable: false, filterable: true },
 {
   columnId: 'age',
   getValue: (i) => i.age,
   sortValue: (i) => -(i.creationTimestamp ? Date.parse(i.creationTimestamp) : 0),
   sortable: true,
   filterable: false,
 },
 ], []);

 const { filteredAndSortedItems: filteredServices, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearchAndNs, { columns: servicesTableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });

 const columnVisibility = useColumnVisibility({
 tableId: 'services',
 columns: SERVICES_COLUMNS_FOR_VISIBILITY,
 alwaysVisible: ['name'],
 });

 const totalFiltered = filteredServices.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredServices.slice(start, start + pageSize);

 const groupedOnPage = useMemo(() => {
 if (listView === 'flat' || itemsOnPage.length === 0) return [];
 const groupByKey = listView === 'byType' ? (s: Service) => s.type : (s: Service) => s.namespace;
 const labelPrefix = listView === 'byType' ? 'Type: ' : 'Namespace: ';
 const map = new Map<string, Service[]>();
 for (const item of itemsOnPage) {
 const k = groupByKey(item);
 const list = map.get(k) ?? [];
 list.push(item);
 map.set(k, list);
 }
 return Array.from(map.entries())
 .map(([label, services]) => ({ groupKey: `${listView}:${label}`, label: `${labelPrefix}${label}`, services }))
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

 const endpointQueries = useQueries({
 queries: itemsOnPage.map((svc) => ({
 queryKey: ['service-endpoints-list', clusterId, svc.namespace, svc.name],
 queryFn: () => getServiceEndpoints(backendBaseUrl!, clusterId!, svc.namespace, svc.name),
 enabled: !!(isBackendConfigured && clusterId && backendBaseUrl && itemsOnPage.length > 0),
 staleTime: 30_000,
 })),
 });
 const endpointsMap = useMemo(() => {
 const m: Record<string, string> = {};
 endpointQueries.forEach((q, i) => {
 if (itemsOnPage[i] && q.data && typeof q.data === 'object' && q.data !== null) {
 const ep = q.data as { subsets?: Array<{ addresses?: unknown[]; notReadyAddresses?: unknown[] }> };
 const subsets = ep.subsets ?? [];
 let ready = 0;
 let total = 0;
 for (const sub of subsets) {
 ready += (sub.addresses ?? []).length;
 total += (sub.addresses ?? []).length + (sub.notReadyAddresses ?? []).length;
 }
 m[`${itemsOnPage[i].namespace}/${itemsOnPage[i].name}`] = total > 0 ? `${ready}/${total}` : '—';
 }
 });
 return m;
 }, [endpointQueries, itemsOnPage]);

 useEffect(() => {
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [safePageIndex, pageIndex]);

 const handlePageSizeChange = (size: number) => {
 setPageSize(size);
 setPageIndex(0);
 };

 const pagination = {
 rangeLabel: totalFiltered > 0
 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}`
 : 'No services',
 hasPrev: safePageIndex > 0,
 hasNext: start + pageSize < totalFiltered,
 onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
 onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
 currentPage: safePageIndex + 1,
 totalPages: Math.max(1, totalPages),
 onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
 };

 const handleDelete = async () => {
 if (deleteDialog.bulk && selectedItems.size > 0) {
 for (const key of selectedItems) {
 const [namespace, name] = key.split('/');
 if (isConnected) {
 await deleteResource.mutateAsync({ name, namespace });
 }
 }
 toast.success(`Deleted ${selectedItems.size} services`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 if (isConnected) {
 await deleteResource.mutateAsync({
 name: deleteDialog.item.name,
 namespace: deleteDialog.item.namespace,
 });
 } else {
 toast.success(`Service ${deleteDialog.item.name} deleted (demo mode)`);
 }
 }
 setDeleteDialog({ open: false, item: null });
 };

 const serviceExportConfig = {
 filenamePrefix: 'services',
 resourceLabel: 'services',
 getExportData: (s: Service) => ({ name: s.name, namespace: s.namespace, type: s.type, clusterIP: s.clusterIP, externalIP: s.externalIP, ports: s.ports, selector: s.selector, age: s.age, status: s.status }),
 csvColumns: [
 { label: 'Name', getValue: (s: Service) => s.name },
 { label: 'Namespace', getValue: (s: Service) => s.namespace },
 { label: 'Type', getValue: (s: Service) => s.type },
 { label: 'Cluster IP', getValue: (s: Service) => s.clusterIP },
 { label: 'External IP', getValue: (s: Service) => s.externalIP },
 { label: 'Ports', getValue: (s: Service) => s.ports },
 { label: 'Selector', getValue: (s: Service) => s.selector },
 { label: 'Age', getValue: (s: Service) => s.age },
 { label: 'Status', getValue: (s: Service) => s.status },
 ],
 toK8sYaml: (s: Service) => `---
apiVersion: v1
kind: Service
metadata:
 name: ${s.name}
 namespace: ${s.namespace}
spec:
 type: ${s.type}
 clusterIP: ${s.clusterIP}
 ports: []
 selector: {}
`,
 };

 const allServiceKeys = useMemo(() => filteredServices.map(s => `${s.namespace}/${s.name}`), [filteredServices]);

 const toggleSelection = (item: Service, event?: React.MouseEvent) => {
 const key = `${item.namespace}/${item.name}`;
 if (event?.shiftKey) {
 multiSelect.toggleRange(key, allServiceKeys);
 } else {
 multiSelect.toggle(key);
 }
 };

 const toggleAllSelection = () => {
 if (multiSelect.isAllSelected(allServiceKeys)) multiSelect.clearSelection();
 else multiSelect.selectAll(allServiceKeys);
 };

 const handleBulkDelete = async () => {
 return executeBulkOperation(Array.from(selectedItems), async (_key, ns, name) => {
 await deleteResource.mutateAsync({ name, namespace: ns });
 });
 };

 const handleBulkLabel = async (label: string) => {
 return executeBulkOperation(Array.from(selectedItems), async (_key, ns, name) => {
 await patchServiceResource.mutateAsync({ name, namespace: ns, patch: { metadata: { labels: { [label.split("=")[0]]: label.split("=")[1] } } } });
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

 const isAllSelected = multiSelect.isAllSelected(allServiceKeys);
 const isSomeSelected = multiSelect.isSomeSelected(allServiceKeys);

 return (
 <PageLayout label="Services">
 <div className="space-y-6">
 {/* Page Header: title + selection hint, toolbar (Export, Download YAML, Delete, Refresh, Create) */}
 <ListPageHeader
 icon={<ServiceIcon className="h-6 w-6 text-primary" />}
 title="Services"
 resourceCount={filteredServices.length}
 subtitle={namespaces.length > 1 ? `across ${namespaces.length - 1} namespaces` : undefined}
 demoMode={!isConnected}
 dataUpdatedAt={dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create Service"
 onCreate={() => setShowCreateWizard(true)}
 actions={
 <>
 <ResourceExportDropdown
 items={filteredServices}
 selectedKeys={selectedItems}
 getKey={(s) => `${s.namespace}/${s.name}`}
 config={serviceExportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected services' : 'All visible services'}
 onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
 />
 {selectedItems.size > 0 && (
 <Button
 variant="destructive"
 size="sm"
 className="gap-2"
 onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}
 >
 <Trash2 className="h-4 w-4" />
 Delete
 </Button>
 )}
 </>
 }
 leftExtra={selectedItems.size > 0 ? (
 <div className="flex items-center gap-2 ml-2 pl-2 border-l border-border">
 <span className="text-sm text-muted-foreground">{selectedItems.size} selected</span>
 <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelectedItems(new Set())}>
 Clear
 </Button>
 </div>
 ) : undefined}
 />

 <BulkActionBar
 selectedCount={selectedItems.size}
 resourceName="service"
 resourceType="services"
 onClearSelection={() => multiSelect.clearSelection()}
 onBulkDelete={handleBulkDelete}
 onBulkLabel={handleBulkLabel}
 />

 {/* Stats Cards */}
 <div className="grid grid-cols-2 sm:grid-cols-6 gap-4">
 <ListPageStatCard size="sm" label="Total Services" value={stats.total} selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard size="sm" label="ClusterIP" value={stats.clusterIP} valueClassName="text-blue-600" selected={columnFilters.type?.size === 1 && columnFilters.type?.has('ClusterIP')} onClick={() => setColumnFilter('type', new Set(['ClusterIP']))} className={cn(columnFilters.type?.size === 1 && columnFilters.type?.has('ClusterIP') && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard size="sm" label="NodePort" value={stats.nodePort} valueClassName="text-orange-600" selected={columnFilters.type?.size === 1 && columnFilters.type?.has('NodePort')} onClick={() => setColumnFilter('type', new Set(['NodePort']))} className={cn(columnFilters.type?.size === 1 && columnFilters.type?.has('NodePort') && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard size="sm" label="LoadBalancer" value={stats.loadBalancer} valueClassName="text-green-600" selected={columnFilters.type?.size === 1 && columnFilters.type?.has('LoadBalancer')} onClick={() => setColumnFilter('type', new Set(['LoadBalancer']))} className={cn(columnFilters.type?.size === 1 && columnFilters.type?.has('LoadBalancer') && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard size="sm" label="ExternalName" value={stats.externalName} valueClassName="text-purple-600" selected={columnFilters.type?.size === 1 && columnFilters.type?.has('ExternalName')} onClick={() => setColumnFilter('type', new Set(['ExternalName']))} className={cn(columnFilters.type?.size === 1 && columnFilters.type?.has('ExternalName') && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard size="sm" label="Unhealthy Endpoints" value={stats.unhealthyEndpoints} valueClassName="text-rose-600" selected={columnFilters.hasUnhealthyEndpoints?.size === 1 && columnFilters.hasUnhealthyEndpoints?.has('Yes')} onClick={() => { if (columnFilters.hasUnhealthyEndpoints?.size === 1 && columnFilters.hasUnhealthyEndpoints?.has('Yes')) setColumnFilter('hasUnhealthyEndpoints', null); else setColumnFilter('hasUnhealthyEndpoints', new Set(['Yes'])); }} className={cn(columnFilters.hasUnhealthyEndpoints?.size === 1 && columnFilters.hasUnhealthyEndpoints?.has('Yes') && 'ring-2 ring-destructive')} isLoading={isLoading} />
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
 <ListSearchInput
 value={searchQuery}
 onChange={setSearchQuery}
 placeholder="Search services by name, namespace, or IP..."
 ariaLabel="Search services"
 />
 }
 structure={
 <ListViewSegmentedControl
 value={listView}
 onChange={(v) => setListView(v as ListView)}
 options={[
 { id: 'flat', label: 'Flat', icon: List },
 { id: 'byNamespace', label: 'By Namespace', icon: Layers },
 { id: 'byType', label: 'By Type', icon: Globe },
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
 columns={SERVICES_COLUMNS_FOR_VISIBILITY}
 visibleColumns={columnVisibility.visibleColumns}
 onColumnToggle={columnVisibility.setColumnVisible}
 isLoading={isLoading && isConnected}
 footer={
 <div className="flex items-center justify-between flex-wrap gap-2">
 <div className="flex items-center gap-4">
 <span className="text-sm text-muted-foreground">{pagination.rangeLabel}</span>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="outline" size="sm" className="press-effect gap-2">
 {pageSize} per page
 <ChevronDown className="h-4 w-4 opacity-50" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="start">
 {PAGE_SIZE_OPTIONS.map((size) => (
 <DropdownMenuItem key={size} onClick={() => handlePageSizeChange(size)} className={cn(pageSize === size && 'bg-accent')}>
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
 <ResizableTableProvider tableId="kubilitics-resizable-table-services" columnConfig={SERVICES_TABLE_COLUMNS}>
 <div className="border border-border rounded-xl overflow-x-auto bg-card">
 <Table className="table-fixed" style={{ minWidth: 1830 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-12">
 <Checkbox
 checked={isAllSelected}
 onCheckedChange={toggleAllSelection}
 aria-label="Select all"
 className={isSomeSelected ? 'opacity-50' : ''}
 />
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
 <ResizableTableHead columnId="type">
 <TableColumnHeaderWithFilterAndSort columnId="type" label="Type" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="clusterIP">
 <TableColumnHeaderWithFilterAndSort columnId="clusterIP" label="Cluster IP" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="externalIP">
 <TableColumnHeaderWithFilterAndSort columnId="externalIP" label="External IP" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="ports">
 <TableColumnHeaderWithFilterAndSort columnId="ports" label="Ports" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="endpoints">
 <TableColumnHeaderWithFilterAndSort columnId="endpoints" label="Endpoints" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="selector">
 <TableColumnHeaderWithFilterAndSort columnId="selector" label="Selector" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="sessionAffinity">
 <TableColumnHeaderWithFilterAndSort columnId="sessionAffinity" label="Session Affinity" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="trafficPolicy">
 <TableColumnHeaderWithFilterAndSort columnId="trafficPolicy" label="Traffic Policy" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <ResizableTableHead columnId="requestsSec">Requests/s</ResizableTableHead>
 <ResizableTableHead columnId="latencyP99">Latency P99</ResizableTableHead>
 <ResizableTableHead columnId="errorRate">Error Rate</ResizableTableHead>
 <ResizableTableHead columnId="age">
 <TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
 </ResizableTableHead>
 <TableHead className="w-12"></TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-12 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5">
 <TableFilterCell columnId="name" label="Name" distinctValues={distinctValuesByColumn.name ?? []} selectedFilterValues={columnFilters.name ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.name} />
 </ResizableTableCell>
 <ResizableTableCell columnId="namespace" className="p-1.5">
 <TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} />
 </ResizableTableCell>
 <ResizableTableCell columnId="status" className="p-1.5">
 <TableFilterCell columnId="status" label="Status" distinctValues={distinctValuesByColumn.status ?? []} selectedFilterValues={columnFilters.status ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.status} />
 </ResizableTableCell>
 <ResizableTableCell columnId="type" className="p-1.5">
 <TableFilterCell columnId="type" label="Type" distinctValues={distinctValuesByColumn.type ?? []} selectedFilterValues={columnFilters.type ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.type} />
 </ResizableTableCell>
 <ResizableTableCell columnId="clusterIP" className="p-1.5" />
 <ResizableTableCell columnId="externalIP" className="p-1.5" />
 <ResizableTableCell columnId="ports" className="p-1.5" />
 <ResizableTableCell columnId="endpoints" className="p-1.5" />
 <ResizableTableCell columnId="selector" className="p-1.5" />
 <ResizableTableCell columnId="sessionAffinity" className="p-1.5">
 <TableFilterCell columnId="sessionAffinity" label="Session Affinity" distinctValues={distinctValuesByColumn.sessionAffinity ?? []} selectedFilterValues={columnFilters.sessionAffinity ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.sessionAffinity} />
 </ResizableTableCell>
 <ResizableTableCell columnId="trafficPolicy" className="p-1.5">
 <TableFilterCell columnId="trafficPolicy" label="Traffic Policy" distinctValues={distinctValuesByColumn.trafficPolicy ?? []} selectedFilterValues={columnFilters.trafficPolicy ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.trafficPolicy} />
 </ResizableTableCell>
 <ResizableTableCell columnId="requestsSec" className="p-1.5" />
 <ResizableTableCell columnId="latencyP99" className="p-1.5" />
 <ResizableTableCell columnId="errorRate" className="p-1.5" />
 <ResizableTableCell columnId="age" className="p-1.5" />
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={17} resourceName="services" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={17} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : itemsOnPage.length === 0 ? (
 <TableRow>
 <TableCell colSpan={17} className="h-40 text-center">
 <TableEmptyState
 icon={<Globe className="h-8 w-8" />}
 title="No Services found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Create a Service to expose workloads in the cluster.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create Service"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : listView === 'flat' ? (
 itemsOnPage.map((svc, idx) => {
 const isSelected = selectedItems.has(`${svc.namespace}/${svc.name}`);
 return (
 <tr
 key={`${svc.namespace}/${svc.name}`}
 className={cn(resourceTableRowClassName, getRowAnimationClass(svc.uid), idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}
 >
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(svc, e); }}>
 <Checkbox
 checked={isSelected}
 tabIndex={-1}
 aria-label={`Select ${svc.name}`}
 />
 </TableCell>
 <ResizableTableCell columnId="name">
 <div className="min-w-0 overflow-hidden">
 <Link to={`/services/${svc.namespace}/${svc.name}`} className="font-medium text-primary hover:underline truncate block w-fit max-w-full">{svc.name}</Link>
 </div>
 </ResizableTableCell>
 <ResizableTableCell columnId="namespace">
 <NamespaceBadge namespace={svc.namespace} className="truncate max-w-full" />
 </ResizableTableCell>
 <ResizableTableCell columnId="status">
 <StatusPill variant={serviceStatusToPillVariant[svc.status]} label={svc.status} />
 </ResizableTableCell>
 <ResizableTableCell columnId="type">
 <Badge className={cn('font-medium', typeColors[svc.type])}>{svc.type}</Badge>
 </ResizableTableCell>
 <ResizableTableCell columnId="clusterIP">
 <span className="font-mono text-sm truncate block">{svc.clusterIP}</span>
 </ResizableTableCell>
 <ResizableTableCell columnId="externalIP">
 <span className={cn('font-mono text-sm truncate block', svc.externalIP === '<pending>' && 'text-amber-600')}>{svc.externalIP}</span>
 </ResizableTableCell>
 <ResizableTableCell columnId="ports">
 <span className="font-mono text-xs truncate block">{svc.ports}</span>
 </ResizableTableCell>
 <ResizableTableCell columnId="endpoints">
 <span className="text-muted-foreground">{endpointsMap[`${svc.namespace}/${svc.name}`] ?? svc.endpoints}</span>
 </ResizableTableCell>
 <ResizableTableCell columnId="selector">
 <span className="font-mono text-xs truncate block" title={svc.selector}>{svc.selector}</span>
 </ResizableTableCell>
 <ResizableTableCell columnId="sessionAffinity">
 <Badge variant="secondary" className="font-normal">{svc.sessionAffinity}</Badge>
 </ResizableTableCell>
 <ResizableTableCell columnId="trafficPolicy">
 <Badge variant="secondary" className="font-normal">{svc.trafficPolicy}</Badge>
 </ResizableTableCell>
 <ResizableTableCell columnId="requestsSec">
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="text-muted-foreground/40 text-sm cursor-help">—</span>
 </TooltipTrigger>
 <TooltipContent side="top" className="text-xs max-w-56">
 Requires service mesh metrics (Istio/Linkerd/Prometheus integration)
 </TooltipContent>
 </Tooltip>
 </ResizableTableCell>
 <ResizableTableCell columnId="latencyP99">
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="text-muted-foreground/40 text-sm cursor-help">—</span>
 </TooltipTrigger>
 <TooltipContent side="top" className="text-xs max-w-56">
 Requires service mesh metrics (Istio/Linkerd/Prometheus integration)
 </TooltipContent>
 </Tooltip>
 </ResizableTableCell>
 <ResizableTableCell columnId="errorRate">
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="text-muted-foreground/40 text-sm cursor-help">—</span>
 </TooltipTrigger>
 <TooltipContent side="top" className="text-xs max-w-56">
 Requires service mesh metrics (Istio/Linkerd/Prometheus integration)
 </TooltipContent>
 </Tooltip>
 </ResizableTableCell>
 <ResizableTableCell columnId="age">
 <AgeCell age={svc.age} timestamp={svc.creationTimestamp} />
 </ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end">
 <CopyNameDropdownItem name={svc.name} namespace={svc.namespace} />
 <DropdownMenuItem onClick={() => navigate(`/services/${svc.namespace}/${svc.name}`)}>View Details</DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/endpoints/${svc.namespace}/${svc.name}`)}>View Endpoints</DropdownMenuItem>
 <DropdownMenuItem onClick={() => setPortForwardDialog({ open: true, item: svc })}>Port Forward</DropdownMenuItem>
 <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(svc.clusterIP); toast.success('Cluster IP copied'); }}>Copy Cluster IP</DropdownMenuItem>
 <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(svc.externalIP); toast.success('External IP copied'); }}>Copy External IP</DropdownMenuItem>
 <DropdownMenuItem onClick={() => setTestConnectivityDialogOpen(true)}>Test Connectivity (Beta)</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/services/${svc.namespace}/${svc.name}?tab=yaml`)}>Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="text-destructive" onClick={() => setDeleteDialog({ open: true, item: svc })}>Delete</DropdownMenuItem>
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
 <TableCell colSpan={17} className="py-2">
 <div className="flex items-center gap-2 font-medium">
 {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
 {group.label}
 <span className="text-muted-foreground font-normal">({group.services.length})</span>
 </div>
 </TableCell>
 </TableRow>,
 ...(isCollapsed ? [] : group.services.map((svc, idx) => {
 const isSelected = selectedItems.has(`${svc.namespace}/${svc.name}`);
 return (
 <tr
 key={`${svc.namespace}/${svc.name}`}
 className={cn(resourceTableRowClassName, getRowAnimationClass(svc.uid), idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}
 >
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(svc, e); }}><Checkbox checked={isSelected} tabIndex={-1} aria-label={`Select ${svc.name}`} /></TableCell>
 <ResizableTableCell columnId="name"><div className="min-w-0 overflow-hidden"><Link to={`/services/${svc.namespace}/${svc.name}`} className="font-medium text-primary hover:underline truncate block w-fit max-w-full">{svc.name}</Link></div></ResizableTableCell>
 <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={svc.namespace} className="truncate max-w-full" /></ResizableTableCell>
 <ResizableTableCell columnId="status"><StatusPill variant={serviceStatusToPillVariant[svc.status]} label={svc.status} /></ResizableTableCell>
 <ResizableTableCell columnId="type"><Badge className={cn('font-medium', typeColors[svc.type])}>{svc.type}</Badge></ResizableTableCell>
 <ResizableTableCell columnId="clusterIP"><span className="font-mono text-sm truncate block">{svc.clusterIP}</span></ResizableTableCell>
 <ResizableTableCell columnId="externalIP"><span className={cn('font-mono text-sm truncate block', svc.externalIP === '<pending>' && 'text-amber-600')}>{svc.externalIP}</span></ResizableTableCell>
 <ResizableTableCell columnId="ports"><span className="font-mono text-xs truncate block">{svc.ports}</span></ResizableTableCell>
 <ResizableTableCell columnId="endpoints"><span className="text-muted-foreground">{endpointsMap[`${svc.namespace}/${svc.name}`] ?? svc.endpoints}</span></ResizableTableCell>
 <ResizableTableCell columnId="selector"><span className="font-mono text-xs truncate block" title={svc.selector}>{svc.selector}</span></ResizableTableCell>
 <ResizableTableCell columnId="sessionAffinity"><Badge variant="secondary" className="font-normal">{svc.sessionAffinity}</Badge></ResizableTableCell>
 <ResizableTableCell columnId="trafficPolicy"><Badge variant="secondary" className="font-normal">{svc.trafficPolicy}</Badge></ResizableTableCell>
 <ResizableTableCell columnId="requestsSec">
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="text-muted-foreground/40 text-sm cursor-help">—</span>
 </TooltipTrigger>
 <TooltipContent side="top" className="text-xs max-w-56">
 Requires service mesh metrics (Istio/Linkerd/Prometheus integration)
 </TooltipContent>
 </Tooltip>
 </ResizableTableCell>
 <ResizableTableCell columnId="latencyP99">
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="text-muted-foreground/40 text-sm cursor-help">—</span>
 </TooltipTrigger>
 <TooltipContent side="top" className="text-xs max-w-56">
 Requires service mesh metrics (Istio/Linkerd/Prometheus integration)
 </TooltipContent>
 </Tooltip>
 </ResizableTableCell>
 <ResizableTableCell columnId="errorRate">
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="text-muted-foreground/40 text-sm cursor-help">—</span>
 </TooltipTrigger>
 <TooltipContent side="top" className="text-xs max-w-56">
 Requires service mesh metrics (Istio/Linkerd/Prometheus integration)
 </TooltipContent>
 </Tooltip>
 </ResizableTableCell>
 <ResizableTableCell columnId="age"><AgeCell age={svc.age} timestamp={svc.creationTimestamp} /></ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="press-effect h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
 <DropdownMenuContent align="end">
 <CopyNameDropdownItem name={svc.name} namespace={svc.namespace} />
 <DropdownMenuItem onClick={() => navigate(`/services/${svc.namespace}/${svc.name}`)}>View Details</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => setPortForwardDialog({ open: true, item: svc })}>Port Forward</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/services/${svc.namespace}/${svc.name}?tab=yaml`)}>Download YAML</DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="text-destructive" onClick={() => setDeleteDialog({ open: true, item: svc })}>Delete</DropdownMenuItem>
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
 </div>
 </ResizableTableProvider>
 </ResourceListTableToolbar>

 {showCreateWizard && (
 <ResourceCreator
 resourceKind="Service"
 defaultYaml={DEFAULT_YAMLS.Service}
 onClose={() => setShowCreateWizard(false)}
 onApply={async (yaml) => {
 try {
 await createResource.mutateAsync({ yaml });
 setShowCreateWizard(false);
 refetch();
 } catch (e) {
 // Error toast is handled by useCreateK8sResource
 }
 }}
 />
 )}

 {/* Delete Dialog */}
 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
 resourceType="Service"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} services` : deleteDialog.item?.name || ''}
 namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace}
 onConfirm={handleDelete}
 requireNameConfirmation={!deleteDialog.bulk}
 />

 {/* Port Forward Dialog */}
 {portForwardDialog.item && (
 <PortForwardDialog
 open={portForwardDialog.open}
 onOpenChange={(open) => setPortForwardDialog({ open, item: open ? portForwardDialog.item : null })}
 podName={portForwardDialog.item.name}
 namespace={portForwardDialog.item.namespace}
 containers={portForwardDialog.item.containers}
 />
 )}

 {/* Test Connectivity (Beta) — explains backend requirement */}
 <Dialog open={testConnectivityDialogOpen} onOpenChange={setTestConnectivityDialogOpen}>
 <DialogContent className="sm:max-w-md">
 <DialogHeader>
 <DialogTitle>Test Connectivity (Beta)</DialogTitle>
 <DialogDescription>
 Testing service connectivity requires the Kubilitics backend to be configured and a cluster to be selected. The backend can perform health checks or port-forward to reach the service from your environment. Use <strong>Port Forward</strong> from the row menu to expose a service port locally and test with your own client.
 </DialogDescription>
 </DialogHeader>
 <DialogFooter className="gap-2 sm:gap-0">
 <Button variant="outline" asChild>
 <Link to="/settings">Learn more (Settings)</Link>
 </Button>
 <Button variant="secondary" onClick={() => setTestConnectivityDialogOpen(false)}>Close</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </div>
 </PageLayout>
 );
}
