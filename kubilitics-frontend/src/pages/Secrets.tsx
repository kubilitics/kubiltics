import { useState, useMemo, useEffect } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import {
 Search,
 Filter,
 RefreshCw,
 MoreHorizontal,
 KeyRound,
 Loader2,
 WifiOff,
 Plus,
 ChevronDown,
 ChevronRight,
 Trash2,
 List,
 Layers,
 CheckSquare,
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
import { Badge } from '@/components/ui/badge';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { ResourceCommandBar, ResourceExportDropdown, ListViewSegmentedControl, ListPagination, PAGE_SIZE_OPTIONS, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, resourceTableRowClassName, ROW_MOTION, AgeCell, TableEmptyState, ListPageLoadingShell, TableErrorState, CopyNameDropdownItem, ResourceListTableToolbar, NamespaceBadge, StatusPill, ListSearchInput } from '@/components/list';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { buildAutoWidthColumns } from '@/lib/tableSizing';
import { SecretIcon } from '@/components/icons/KubernetesIcons';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { getRowAnimationClass } from '@/hooks/useResourceLiveUpdates';
import { usePaginatedResourceList, useDeleteK8sResource, useCreateK8sResource, usePatchK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { getSecretConsumers, getSecretTLSInfo, type TLSSecretInfo } from '@/services/backendApiClient';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { DeleteConfirmDialog, BulkActionBar, executeBulkOperation } from '@/components/resources';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/sonner';
import { useMultiSelect } from '@/hooks/useMultiSelect';

interface Secret {
 uid?: string;
 name: string;
 namespace: string;
 type: string;
 dataKeys: number;
 totalSizeBytes: number;
 immutable: boolean;
 age: string;
 creationTimestamp?: string;
}

interface K8sSecret extends KubernetesResource {
 type?: string;
 data?: Record<string, string>;
 immutable?: boolean;
}

const typeLabel = (t: string): string => {
 if (t === 'kubernetes.io/service-account-token') return 'SA Token';
 if (t === 'kubernetes.io/dockerconfigjson') return 'Docker Config';
 if (t === 'kubernetes.io/tls') return 'TLS';
 return t || 'Opaque';
};

function formatBytes(bytes: number): string {
 if (bytes < 1024) return `${bytes} B`;
 if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
 return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TLSExpiryCell({ info }: { info: TLSSecretInfo | undefined }) {
 if (!info) return <span className="text-muted-foreground">—</span>;
 if (info.error || !info.hasValidCert) {
 return (
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="text-muted-foreground text-xs">—</span>
 </TooltipTrigger>
 <TooltipContent><p className="text-xs">{info.error ?? 'No valid cert'}</p></TooltipContent>
 </Tooltip>
 );
 }
 const d = info.daysRemaining;
 const label = d > 0 ? `in ${d}d` : d === 0 ? 'today' : `expired ${-d}d ago`;
 const variant: 'default' | 'secondary' | 'destructive' = d > 7 ? 'default' : 'destructive';
 const className = d <= 0 ? 'bg-destructive/90 text-destructive-foreground' : d <= 7 ? 'bg-destructive/90 text-white' : d <= 30 ? 'bg-amber-500/90 text-white' : 'bg-green-600/90 text-white';
 return (
 <Tooltip>
 <TooltipTrigger asChild>
 <Badge variant={variant} className={cn('font-mono text-xs', className)}>
 {label}
 </Badge>
 </TooltipTrigger>
 <TooltipContent>
 <p className="text-xs">Valid to: {info.validTo ?? '—'}</p>
 </TooltipContent>
 </Tooltip>
 );
}

const SECRETS_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'status', defaultWidth: 140, minWidth: 90 },
 { id: 'type', defaultWidth: 160, minWidth: 100 },
 { id: 'dataKeys', defaultWidth: 100, minWidth: 70 },
 { id: 'totalSize', defaultWidth: 100, minWidth: 70 },
 { id: 'usedBy', defaultWidth: 100, minWidth: 70 },
 { id: 'tlsExpiry', defaultWidth: 160, minWidth: 100 },
 { id: 'immutable', defaultWidth: 100, minWidth: 70 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
 { id: 'lastModified', defaultWidth: 160, minWidth: 100 },
];

const SECRETS_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'status', label: 'Status' },
 { id: 'type', label: 'Type' },
 { id: 'dataKeys', label: 'Data Keys' },
 { id: 'totalSize', label: 'Total Size' },
 { id: 'usedBy', label: 'Used By' },
 { id: 'tlsExpiry', label: 'TLS Expiry' },
 { id: 'immutable', label: 'Immutable' },
 { id: 'age', label: 'Age' },
 { id: 'lastModified', label: 'Last Modified' },
];

type ListView = 'flat' | 'byNamespace';

/** Approximate decoded size: base64 length * 0.75 */
function totalSizeFromData(data: Record<string, string> | undefined): number {
 if (!data) return 0;
 let total = 0;
 for (const v of Object.values(data)) total += (v?.length ?? 0) * 0.75;
 return Math.round(total);
}

function mapSecret(s: K8sSecret): Secret {
 return {
 uid: s.metadata?.uid,
 name: s.metadata?.name ?? '',
 namespace: s.metadata?.namespace || 'default',
 type: s.type || 'Opaque',
 dataKeys: s.data ? Object.keys(s.data).length : 0,
 totalSizeBytes: totalSizeFromData(s.data),
 immutable: !!s.immutable,
 age: calculateAge(s.metadata?.creationTimestamp),
 creationTimestamp: s.metadata?.creationTimestamp,
 };
}

export default function Secrets() {
 const navigate = useNavigate();
 const { isConnected } = useConnectionStatus();
 const { data, isLoading, isError, refetch } = usePaginatedResourceList<K8sSecret>('secrets');
 const deleteResource = useDeleteK8sResource('secrets');
 const createResource = useCreateK8sResource('secrets');
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: Secret | null; bulk?: boolean }>({ open: false, item: null });
 const multiSelect = useMultiSelect();
 const selectedItems = multiSelect.selectedIds;
 const setSelectedItems = (s: Set<string>) => { if (s.size === 0) multiSelect.clearSelection(); else multiSelect.selectAll(Array.from(s)); };
 const patchSecretResource = usePatchK8sResource('secrets');
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [searchQuery, setSearchQuery] = useState('');
 const debouncedSearch = useDebouncedValue(searchQuery, 250);
 const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
 const [listView, setListView] = useState<ListView>('flat');
 const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
 const [showTableFilters, setShowTableFilters] = useState(false);
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
 const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
 const activeCluster = useClusterStore((s) => s.activeCluster);
 const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
 const clusterId = currentClusterId ?? null;

 // eslint-disable-next-line react-hooks/exhaustive-deps
 const allItems = (data?.allItems ?? []) as K8sSecret[];
 const items: Secret[] = useMemo(() => (isConnected ? allItems.map(mapSecret) : []), [isConnected, allItems]);

 const stats = useMemo(() => {
 const fullList = isConnected ? allItems.map(mapSecret) : [];
 return {
 total: fullList.length,
 opaque: fullList.filter((s) => !s.type || s.type === 'Opaque').length,
 tls: fullList.filter((s) => s.type === 'kubernetes.io/tls').length,
 docker: fullList.filter((s) => s.type === 'kubernetes.io/dockerconfigjson').length,
 sa: fullList.filter((s) => s.type === 'kubernetes.io/service-account-token').length,
 };
 }, [isConnected, allItems]);

 const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.namespace)))], [items]);

 const [searchParams] = useSearchParams();

 // Seed namespace filter from ?namespace=<ns> when navigated from Namespace views.
 useEffect(() => {
 const nsFromQuery = searchParams.get('namespace');
 if (!nsFromQuery) return;
 if (selectedNamespace !== 'all') return;
 setSelectedNamespace(nsFromQuery);
 }, [searchParams, selectedNamespace]);

 const itemsAfterSearchAndNs = useMemo(() => {
 return items.filter((item) => {
 const q = debouncedSearch.toLowerCase();
 const matchesSearch = !q ||
 item.name.toLowerCase().includes(q) ||
 item.namespace.toLowerCase().includes(q);
 const matchesNamespace = selectedNamespace === 'all' || item.namespace === selectedNamespace;
 return matchesSearch && matchesNamespace;
 });
 }, [items, debouncedSearch, selectedNamespace]);

 const tableConfig: ColumnConfig<Secret>[] = useMemo(
 () => [
 { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: true },
 { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
 { columnId: 'status', getValue: (i) => typeLabel(i.type), sortable: true, filterable: true },
 { columnId: 'type', getValue: (i) => typeLabel(i.type), sortable: true, filterable: true },
 { columnId: 'dataKeys', getValue: (i) => i.dataKeys, sortable: true, filterable: false },
 { columnId: 'totalSize', getValue: (i) => i.totalSizeBytes, sortable: true, filterable: false },
 { columnId: 'usedBy', getValue: () => '', sortable: false, filterable: false },
 { columnId: 'tlsExpiry', getValue: () => '', sortable: false, filterable: false },
 { columnId: 'immutable', getValue: (i) => (i.immutable ? 'Yes' : 'No'), sortable: true, filterable: true },
 {
   columnId: 'age',
   getValue: (i) => i.age,
   sortValue: (i) => -(i.creationTimestamp ? Date.parse(i.creationTimestamp) : 0),
   sortable: true,
   filterable: false,
 },
 { columnId: 'lastModified', getValue: (i) => i.age, sortable: true, filterable: false },
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
 } = useTableFiltersAndSort(itemsAfterSearchAndNs, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });

 const columnVisibility = useColumnVisibility({
 tableId: 'secrets',
 columns: SECRETS_COLUMNS_FOR_VISIBILITY,
 alwaysVisible: ['name'],
 });

 // Data-aware default widths for all Secrets columns.
 const secretsColumnConfig: ResizableColumnConfig[] = useMemo(() => {
 const valueGetters: Record<string, (s: Secret) => unknown> = {
 name: (s) => s.name,
 namespace: (s) => s.namespace,
 type: (s) => typeLabel(s.type),
 dataKeys: (s) => s.dataKeys,
 totalSize: (s) => s.totalSizeBytes,
 usedBy: () => '', // numeric indicator; keep compact
 tlsExpiry: () => '', // rendered via badge; width small
 immutable: (s) => (s.immutable ? 'Yes' : 'No'),
 age: (s) => s.age,
 lastModified: (s) => s.age,
 };
 const rows = filteredItems.length > 0 ? filteredItems : items;
 if (!rows.length) return SECRETS_TABLE_COLUMNS;
 return buildAutoWidthColumns(SECRETS_TABLE_COLUMNS, rows, valueGetters, {
 perColumn: {
 name: { maxPx: 320 },
 namespace: { maxPx: 260 },
 type: { maxPx: 220 },
 },
 });
 }, [filteredItems, items]);

 const totalFiltered = filteredItems.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 const itemsOnPage = filteredItems.slice(start, start + pageSize);

 useEffect(() => {
 if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [safePageIndex, pageIndex]);

 const consumersQueries = useQueries({
 queries: itemsOnPage.map((s) => ({
 queryKey: ['secret-consumers', clusterId, s.namespace, s.name],
 queryFn: () => getSecretConsumers(backendBaseUrl!, clusterId!, s.namespace, s.name),
 enabled: !!(isBackendConfigured && clusterId && s.name && s.namespace),
 staleTime: 60_000,
 })),
 });

 const tlsSecretsOnPage = useMemo(() => itemsOnPage.filter((s) => s.type === 'kubernetes.io/tls'), [itemsOnPage]);
 const tlsInfoQueries = useQueries({
 queries: tlsSecretsOnPage.map((s) => ({
 queryKey: ['secret-tls-info', clusterId, s.namespace, s.name],
 queryFn: () => getSecretTLSInfo(backendBaseUrl!, clusterId!, s.namespace, s.name),
 enabled: !!(isBackendConfigured && clusterId && s.name && s.namespace),
 staleTime: 60_000,
 })),
 });
 const tlsInfoByKey = useMemo(() => {
 const m: Record<string, TLSSecretInfo> = {};
 tlsInfoQueries.forEach((q, i) => {
 if (q.data && tlsSecretsOnPage[i]) {
 const s = tlsSecretsOnPage[i];
 m[`${s.namespace}/${s.name}`] = q.data;
 }
 });
 return m;
 }, [tlsInfoQueries, tlsSecretsOnPage]);

 const consumersCountByKey = useMemo(() => {
 const m: Record<string, number> = {};
 consumersQueries.forEach((q, i) => {
 if (q.data && itemsOnPage[i]) {
 const c = q.data;
 const total =
 (c.pods?.length ?? 0) +
 (c.deployments?.length ?? 0) +
 (c.statefulSets?.length ?? 0) +
 (c.daemonSets?.length ?? 0) +
 (c.jobs?.length ?? 0) +
 (c.cronJobs?.length ?? 0);
 const key = `${itemsOnPage[i].namespace}/${itemsOnPage[i].name}`;
 m[key] = total;
 }
 });
 return m;
 }, [consumersQueries, itemsOnPage]);

 const handlePageSizeChange = (size: number) => {
 setPageSize(size);
 setPageIndex(0);
 };

 const pagination = {
 rangeLabel:
 totalFiltered > 0
 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}`
 : 'No secrets',
 hasPrev: safePageIndex > 0,
 hasNext: start + pageSize < totalFiltered,
 onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
 onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
 currentPage: safePageIndex + 1,
 totalPages: Math.max(1, totalPages),
 onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
 dataUpdatedAt: (data as unknown as Record<string, unknown>)?.dataUpdatedAt,
 isFetching: isLoading,
 };

 const groupedOnPage = useMemo(() => {
 if (listView !== 'byNamespace' || itemsOnPage.length === 0) return [];
 const map = new Map<string, Secret[]>();
 for (const item of itemsOnPage) {
 const list = map.get(item.namespace) ?? [];
 list.push(item);
 map.set(item.namespace, list);
 }
 return Array.from(map.entries())
 .map(([label, secrets]) => ({ groupKey: `ns:${label}`, label, secrets }))
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
 try {
 if (deleteDialog.bulk && selectedItems.size > 0) {
 for (const key of selectedItems) {
 const [ns, n] = key.split('/');
 if (n && ns) await deleteResource.mutateAsync({ name: n, namespace: ns });
 }
 toast.success(`Deleted ${selectedItems.size} Secret(s)`);
 setSelectedItems(new Set());
 } else if (deleteDialog.item) {
 await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
 toast.success('Secret deleted');
 }
 setDeleteDialog({ open: false, item: null });
 refetch();
 } catch (e) {
 toast.error(e instanceof Error ? e.message : 'Delete failed');
 }
 };

 const allSecretKeys = useMemo(() => itemsOnPage.map(s => `${s.namespace}/${s.name}`), [itemsOnPage]);

 const toggleSelection = (s: Secret, event?: React.MouseEvent) => {
 const key = `${s.namespace}/${s.name}`;
 if (event?.shiftKey) {
 multiSelect.toggleRange(key, allSecretKeys);
 } else {
 multiSelect.toggle(key);
 }
 };

 const toggleAll = () => {
 if (multiSelect.isAllSelected(allSecretKeys)) multiSelect.clearSelection();
 else multiSelect.selectAll(allSecretKeys);
 };

 const handleBulkDeleteSecret = async () => {
 return executeBulkOperation(Array.from(selectedItems), async (_key, ns, name) => {
 await deleteResource.mutateAsync({ name, namespace: ns });
 });
 };

 const handleBulkLabelSecret = async (labelPatch: Record<string, string | null>) => {
 return executeBulkOperation(Array.from(selectedItems), async (_key, ns, name) => {
 await patchSecretResource.mutateAsync({ name, namespace: ns, patch: { metadata: { labels: { [label.split("=")[0]]: label.split("=")[1] } } } });
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

 const isAllSelected = multiSelect.isAllSelected(allSecretKeys);
 const isSomeSelected = multiSelect.isSomeSelected(allSecretKeys);

 const exportConfig = {
 filenamePrefix: 'secrets',
 resourceLabel: 'secrets',
 getExportData: (s: Secret) => ({ name: s.name, namespace: s.namespace, type: typeLabel(s.type), dataKeys: s.dataKeys, age: s.age }),
 csvColumns: [
 { label: 'Name', getValue: (s: Secret) => s.name },
 { label: 'Namespace', getValue: (s: Secret) => s.namespace },
 { label: 'Type', getValue: (s: Secret) => typeLabel(s.type) },
 { label: 'Data Keys', getValue: (s: Secret) => String(s.dataKeys) },
 { label: 'Age', getValue: (s: Secret) => s.age },
 ],
 toK8sYaml: (s: Secret) => `---
apiVersion: v1
kind: Secret
metadata:
 name: ${s.name}
 namespace: ${s.namespace}
type: ${s.type}
data: {}
`,
 };

 const namespaceCount = useMemo(() => new Set(filteredItems.map((i) => i.namespace)).size, [filteredItems]);

 return (
 <PageLayout label="Secrets">
 <div className="space-y-6">
 <ListPageHeader
 icon={<SecretIcon className="h-6 w-6 text-primary" />}
 title="Secrets"
 resourceCount={filteredItems.length}
 subtitle={namespaceCount > 0 ? `across ${namespaceCount} namespaces` : undefined}
 demoMode={!isConnected}
 dataUpdatedAt={(data as unknown as Record<string, unknown>)?.dataUpdatedAt as number | undefined}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create"
 onCreate={() => setShowCreateWizard(true)}
 actions={
 <>
 <ResourceExportDropdown
 items={filteredItems}
 selectedKeys={selectedItems}
 getKey={(s) => `${s.namespace}/${s.name}`}
 config={exportConfig}
 selectionLabel={selectedItems.size > 0 ? 'Selected secrets' : 'All visible secrets'}
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

 <div className={cn('grid grid-cols-2 sm:grid-cols-5 gap-4', !isConnected && 'opacity-60')}>
 <ListPageStatCard label="Total" value={stats.total} icon={KeyRound} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && !isLoading && 'ring-2 ring-primary')} isLoading={isLoading} />
 <ListPageStatCard label="Opaque" value={stats.opaque} icon={KeyRound} iconColor="text-muted-foreground" selected={columnFilters.type?.size === 1 && columnFilters.type.has('Opaque')} onClick={() => setColumnFilter('type', new Set(['Opaque']))} className={cn(columnFilters.type?.size === 1 && columnFilters.type.has('Opaque') && 'ring-2 ring-muted-foreground')} isLoading={isLoading} />
 <ListPageStatCard label="TLS" value={stats.tls} icon={KeyRound} iconColor="text-blue-500" valueClassName="text-blue-500" selected={columnFilters.type?.size === 1 && columnFilters.type.has('TLS')} onClick={() => setColumnFilter('type', new Set(['TLS']))} className={cn(columnFilters.type?.size === 1 && columnFilters.type.has('TLS') && 'ring-2 ring-blue-500')} isLoading={isLoading} />
 <ListPageStatCard label="Docker Config" value={stats.docker} icon={KeyRound} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.type?.size === 1 && columnFilters.type.has('Docker Config')} onClick={() => setColumnFilter('type', new Set(['Docker Config']))} className={cn(columnFilters.type?.size === 1 && columnFilters.type.has('Docker Config') && 'ring-2 ring-amber-500')} isLoading={isLoading} />
 <ListPageStatCard label="Service Account" value={stats.sa} icon={KeyRound} iconColor="text-muted-foreground" selected={columnFilters.type?.size === 1 && columnFilters.type.has('SA Token')} onClick={() => setColumnFilter('type', new Set(['SA Token']))} className={cn(columnFilters.type?.size === 1 && columnFilters.type.has('SA Token') && 'ring-2 ring-muted-foreground')} isLoading={isLoading} />
 </div>

 <BulkActionBar
 selectedCount={selectedItems.size}
 resourceName="secret"
 resourceType="secrets"
 onClearSelection={() => multiSelect.clearSelection()}
 onBulkDelete={handleBulkDeleteSecret}
 onBulkLabel={handleBulkLabelSecret}
 />

 <ResourceListTableToolbar
 globalFilterBar={
 <ResourceCommandBar
 scope={
 <div className="w-full min-w-0">
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button
 variant="outline"
 className="w-full min-w-0 justify-between h-10 gap-2 rounded-lg border border-border bg-background font-medium shadow-sm hover:bg-muted/50 hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary/20"
 >
 <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
 <span className="truncate">{selectedNamespace === 'all' ? 'All Namespaces' : selectedNamespace}</span>
 <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="start" className="w-48">
 {namespaces.map((ns) => (
 <DropdownMenuItem
 key={ns}
 onClick={() => setSelectedNamespace(ns)}
 className={cn(selectedNamespace === ns && 'bg-accent')}
 >
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
 placeholder="Search secrets..."
 ariaLabel="Search secrets"
 />
 }
 structure={
 <ListViewSegmentedControl
 value={listView}
 onChange={(v) => setListView(v as ListView)}
 options={[
 { id: 'flat', label: 'Flat', icon: List },
 { id: 'byNamespace', label: 'By Namespace', icon: Layers },
 ]}
 label=""
 ariaLabel="List structure"
 />
 }
 className="mb-0"
 />
 }
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={clearAllFilters}
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 columns={SECRETS_COLUMNS_FOR_VISIBILITY}
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
 dataUpdatedAt={pagination.dataUpdatedAt}
 isFetching={pagination.isFetching}
 />
 </div>
 }
 >
 <div className="overflow-x-auto">
 <ResizableTableProvider tableId="secrets" columnConfig={secretsColumnConfig}>
 <Table className="table-fixed" style={{ minWidth: 900 }}>
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
 <ResizableTableHead columnId="name">
 <TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
 </ResizableTableHead>
 <ResizableTableHead columnId="namespace">
 <TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
 </ResizableTableHead>
 <ResizableTableHead columnId="status">
 <TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
 </ResizableTableHead>
 <ResizableTableHead columnId="type">
 <TableColumnHeaderWithFilterAndSort columnId="type" label="Type" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
 </ResizableTableHead>
 <ResizableTableHead columnId="dataKeys">
 <TableColumnHeaderWithFilterAndSort columnId="dataKeys" label="Data Keys" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
 </ResizableTableHead>
 <ResizableTableHead columnId="totalSize">
 <TableColumnHeaderWithFilterAndSort columnId="totalSize" label="Total Size" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
 </ResizableTableHead>
 <ResizableTableHead columnId="usedBy" title="Used By">
 <span className="text-xs font-medium text-muted-foreground">Used By</span>
 </ResizableTableHead>
 <ResizableTableHead columnId="tlsExpiry" title="TLS Expiry">
 <span className="text-xs font-medium text-muted-foreground">TLS Expiry</span>
 </ResizableTableHead>
 <ResizableTableHead columnId="immutable">
 <TableColumnHeaderWithFilterAndSort columnId="immutable" label="Immutable" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
 </ResizableTableHead>
 <ResizableTableHead columnId="age">
 <TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
 </ResizableTableHead>
 <ResizableTableHead columnId="lastModified">
 <TableColumnHeaderWithFilterAndSort columnId="lastModified" label="Last Modified" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
 </ResizableTableHead>
 <TableHead className="w-12 text-center">
 <span className="sr-only">Actions</span>
 <MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden />
 </TableHead>
 </TableRow>
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10 p-1.5" />
 <ResizableTableCell columnId="name" className="p-1.5">
 <TableFilterCell columnId="name" label="Name" distinctValues={distinctValuesByColumn.name ?? []} selectedFilterValues={columnFilters.name ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.name} />
 </ResizableTableCell>
 <ResizableTableCell columnId="namespace" className="p-1.5"><TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} /></ResizableTableCell>
 <ResizableTableCell columnId="status" className="p-1.5"><TableFilterCell columnId="status" label="Status" distinctValues={distinctValuesByColumn.status ?? []} selectedFilterValues={columnFilters.status ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.status} /></ResizableTableCell>
 <ResizableTableCell columnId="type" className="p-1.5"><TableFilterCell columnId="type" label="Type" distinctValues={distinctValuesByColumn.type ?? []} selectedFilterValues={columnFilters.type ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.type} /></ResizableTableCell>
 <ResizableTableCell columnId="dataKeys" className="p-1.5" />
 <ResizableTableCell columnId="totalSize" className="p-1.5" />
 <ResizableTableCell columnId="usedBy" className="p-1.5" />
 <ResizableTableCell columnId="tlsExpiry" className="p-1.5" />
 <ResizableTableCell columnId="immutable" className="p-1.5"><TableFilterCell columnId="immutable" label="Immutable" distinctValues={['Yes', 'No']} selectedFilterValues={columnFilters.immutable ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.immutable} /></ResizableTableCell>
 <ResizableTableCell columnId="age" className="p-1.5" />
 <ResizableTableCell columnId="lastModified" className="p-1.5" />
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={13} resourceName="secrets" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={13} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : filteredItems.length === 0 ? (
 <TableRow>
 <TableCell colSpan={13} className="h-40 text-center">
 <TableEmptyState
 icon={<KeyRound className="h-8 w-8" />}
 title="No secrets found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Create a Secret to store sensitive data.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
 createLabel="Create Secret"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : listView === 'flat' ? (
 itemsOnPage.map((item, idx) => {
 const key = `${item.namespace}/${item.name}`;
 const usedByCount = consumersCountByKey[key];
 const usedByNode =
 !isBackendConfigured || !clusterId ? (
 <span className="text-muted-foreground">—</span>
 ) : usedByCount !== undefined ? (
 <Tooltip>
 <TooltipTrigger asChild>
 <span className="font-mono text-sm">{usedByCount}</span>
 </TooltipTrigger>
 <TooltipContent>
 <p className="text-xs">{usedByCount} workload(s) use this Secret</p>
 </TooltipContent>
 </Tooltip>
 ) : (
 <span className="text-muted-foreground">—</span>
 );
 return (
 <tr
 key={key}
 className={cn(resourceTableRowClassName, getRowAnimationClass(item.uid), idx % 2 === 1 && 'bg-muted/5', selectedItems.has(key) && 'bg-primary/5')}
 >
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(item, e); }}><Checkbox checked={selectedItems.has(key)} tabIndex={-1} aria-label={`Select ${item.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/secrets/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <KeyRound className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 </Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="namespace">
 <NamespaceBadge
 namespace={item.namespace}
 className="font-normal truncate block w-fit max-w-full"
 />
 </ResizableTableCell>
 <ResizableTableCell columnId="status">
 <StatusPill variant={item.type === 'kubernetes.io/tls' ? 'info' : item.type === 'Opaque' ? 'default' : 'success'} label={typeLabel(item.type)} />
 </ResizableTableCell>
 <ResizableTableCell columnId="type">
 <Badge variant="secondary" className="font-mono text-xs truncate block w-fit max-w-full">
 {typeLabel(item.type)}
 </Badge>
 </ResizableTableCell>
 <ResizableTableCell columnId="dataKeys" className="font-mono text-sm">
 {item.dataKeys}
 </ResizableTableCell>
 <ResizableTableCell columnId="totalSize" className="font-mono text-sm text-muted-foreground">
 {formatBytes(item.totalSizeBytes)}
 </ResizableTableCell>
 <ResizableTableCell columnId="usedBy">{usedByNode}</ResizableTableCell>
 <ResizableTableCell columnId="tlsExpiry">
 {item.type === 'kubernetes.io/tls' ? (
 <TLSExpiryCell info={tlsInfoByKey[`${item.namespace}/${item.name}`]} />
 ) : (
 <span className="text-muted-foreground">—</span>
 )}
 </ResizableTableCell>
 <ResizableTableCell columnId="immutable">
 {item.immutable ? <Badge variant="default">Yes</Badge> : <Badge variant="outline">No</Badge>}
 </ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap">
 <AgeCell age={item.age} timestamp={item.creationTimestamp} />
 </ResizableTableCell>
 <ResizableTableCell columnId="lastModified" className="text-muted-foreground whitespace-nowrap">
 <AgeCell age={item.age} timestamp={item.creationTimestamp} />
 </ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Secret actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <CopyNameDropdownItem name={item.name} namespace={item.namespace} />
 <DropdownMenuItem onClick={() => navigate(`/secrets/${item.namespace}/${item.name}`)} className="gap-2">
 View Details
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/secrets/${item.namespace}/${item.name}?tab=data`)} className="gap-2">
 View Keys
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/secrets/${item.namespace}/${item.name}?tab=used-by`)} className="gap-2">
 View Consumers
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/secrets/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2">
 Download YAML
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}>
 <Trash2 className="h-4 w-4" /> Delete
 </DropdownMenuItem>
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
 <TableRow
 key={group.groupKey}
 className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-b border-border/60 transition-all duration-200"
 onClick={() => toggleGroup(group.groupKey)}
 >
 <TableCell colSpan={13} className="py-2">
 <div className="flex items-center gap-2 font-medium">
 {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
 Namespace: {group.label}
 <span className="text-muted-foreground font-normal">({group.secrets.length})</span>
 </div>
 </TableCell>
 </TableRow>,
 ...(isCollapsed
 ? []
 : group.secrets.map((item, idx) => {
 const key = `${item.namespace}/${item.name}`;
 const usedByCount = consumersCountByKey[key];
 const usedByNode =
 !isBackendConfigured || !clusterId ? (
 <span className="text-muted-foreground">—</span>
 ) : usedByCount !== undefined ? (
 <span className="font-mono text-sm">{usedByCount}</span>
 ) : (
 <span className="text-muted-foreground">—</span>
 );
 return (
 <tr
 key={key}
 className={cn(resourceTableRowClassName, getRowAnimationClass(item.uid), idx % 2 === 1 && 'bg-muted/5', selectedItems.has(key) && 'bg-primary/5')}
 >
 <TableCell onClick={(e) => { e.stopPropagation(); toggleSelection(item, e); }}><Checkbox checked={selectedItems.has(key)} tabIndex={-1} aria-label={`Select ${item.name}`} /></TableCell>
 <ResizableTableCell columnId="name">
 <Link to={`/secrets/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
 <KeyRound className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate">{item.name}</span>
 </Link>
 </ResizableTableCell>
 <ResizableTableCell columnId="namespace">
 <NamespaceBadge
 namespace={item.namespace}
 className="font-normal truncate block w-fit max-w-full"
 />
 </ResizableTableCell>
 <ResizableTableCell columnId="status">
 <StatusPill variant={item.type === 'kubernetes.io/tls' ? 'info' : item.type === 'Opaque' ? 'default' : 'success'} label={typeLabel(item.type)} />
 </ResizableTableCell>
 <ResizableTableCell columnId="type">
 <Badge variant="secondary" className="font-mono text-xs truncate block w-fit max-w-full">
 {typeLabel(item.type)}
 </Badge>
 </ResizableTableCell>
 <ResizableTableCell columnId="dataKeys" className="font-mono text-sm">
 {item.dataKeys}
 </ResizableTableCell>
 <ResizableTableCell columnId="totalSize" className="font-mono text-sm text-muted-foreground">
 {formatBytes(item.totalSizeBytes)}
 </ResizableTableCell>
 <ResizableTableCell columnId="usedBy">{usedByNode}</ResizableTableCell>
 <ResizableTableCell columnId="tlsExpiry">
 {item.type === 'kubernetes.io/tls' ? (
 <TLSExpiryCell info={tlsInfoByKey[`${item.namespace}/${item.name}`]} />
 ) : (
 <span className="text-muted-foreground">—</span>
 )}
 </ResizableTableCell>
 <ResizableTableCell columnId="immutable">
 {item.immutable ? <Badge variant="default">Yes</Badge> : <Badge variant="outline">No</Badge>}
 </ResizableTableCell>
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap">
 <AgeCell age={item.age} timestamp={item.creationTimestamp} />
 </ResizableTableCell>
 <ResizableTableCell columnId="lastModified" className="text-muted-foreground whitespace-nowrap">
 <AgeCell age={item.age} timestamp={item.creationTimestamp} />
 </ResizableTableCell>
 <TableCell>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Secret actions">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <CopyNameDropdownItem name={item.name} namespace={item.namespace} />
 <DropdownMenuItem onClick={() => navigate(`/secrets/${item.namespace}/${item.name}`)} className="gap-2">
 View Details
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/secrets/${item.namespace}/${item.name}?tab=data`)} className="gap-2">
 View Keys
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => navigate(`/secrets/${item.namespace}/${item.name}?tab=used-by`)} className="gap-2">
 View Consumers
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => navigate(`/secrets/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2">
 Download YAML
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}>
 <Trash2 className="h-4 w-4" /> Delete
 </DropdownMenuItem>
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
 </div>
 </ResourceListTableToolbar>
 <p className="text-xs text-muted-foreground mt-1">
 {listView === 'flat' ? 'flat list' : 'grouped by namespace'}
 </p>
 </div>

 {showCreateWizard && (
 <ResourceCreator
 resourceKind="Secret"
 defaultYaml={DEFAULT_YAMLS.Secret}
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

 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null, bulk: open ? deleteDialog.bulk : false })}
 resourceType="Secret"
 resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name || '')}
 namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace}
 onConfirm={handleDelete}
 requireNameConfirmation={!deleteDialog.bulk}
 />
 </PageLayout>
 );
}
