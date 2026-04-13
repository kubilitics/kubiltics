import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useClusterSummaryWithProject } from '@/hooks/useClusterSummary';
import { useNamespacesFromCluster } from '@/hooks/useNamespacesFromCluster';
import { motion, AnimatePresence } from 'framer-motion';
import { PageLayout } from '@/components/layout/PageLayout';
import {
 Search, Filter, RefreshCw, MoreHorizontal, CheckCircle2, XCircle, Clock, Loader2, WifiOff, Box,
 ChevronDown, ChevronLeft, ChevronRight, Trash2, RotateCcw, Scale, History, Rocket, FileText,
 List, Layers, Activity, PauseCircle, LayoutGrid, Terminal, ExternalLink, Download, GitCompare, Boxes, X, type LucideIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
 resourceTableRowClassName,
 ROW_MOTION,
 StatusPill,
 ListPagination,
 PAGE_SIZE_OPTIONS,
 ListPageStatCard,
 ListPageHeader,
 TableColumnHeaderWithFilterAndSort,
 TableFilterCell,
 AgeCell,
 TableEmptyState,
 TableErrorState, ListPageLoadingShell,
 CopyNameDropdownItem,
 ResourceListTableToolbar,
 NamespaceBadge,
 BulkActionToolbar,
 type StatusPillVariant,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { getRowAnimationClass } from '@/hooks/useResourceLiveUpdates';
import { useTableKeyboardNav } from '@/hooks/useTableKeyboardNav';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { ResizableTableProvider, ResizableTableHead, ResizableTableCell, type ResizableColumnConfig } from '@/components/ui/resizable-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useK8sResourceList, useServerPaginatedResourceList, useDeleteK8sResource, useCreateK8sResource, usePatchK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { getPodMetrics, postShellCommand } from '@/services/backendApiClient';
import { DeleteConfirmDialog, PortForwardDialog, parseCpu, parseMemory, calculatePodResourceMax, ResourceComparisonView, BulkActionBar, executeBulkOperation } from '@/components/resources';
import { ResourceCommandBar, ResourceExportDropdown, ListViewSegmentedControl, NamespaceFilter } from '@/components/list';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { useQuery, useQueries } from '@tanstack/react-query';
import { toast } from '@/components/ui/sonner';
import { objectsToYaml, downloadBlob, downloadResourceJson } from '@/lib/exportUtils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { buildAutoWidthColumns } from '@/lib/tableSizing';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { SearchHighlight } from '@/components/list/SearchHighlight';
import { useMultiSelect } from '@/hooks/useMultiSelect';

interface PodResource extends KubernetesResource {
 spec: {
 nodeName?: string;
 containers: Array<{
 name: string;
 image: string;
 resources?: {
 requests?: { cpu?: string; memory?: string };
 limits?: { cpu?: string; memory?: string };
 };
 }>;
 };
 status: {
 phase: string;
 podIP?: string;
 hostIP?: string;
 containerStatuses?: Array<{
 name: string;
 ready: boolean;
 restartCount: number;
 state: { waiting?: { reason: string }; running?: { startedAt: string }; terminated?: { reason: string } };
 }>;
 conditions?: Array<{ type: string; status: string }>;
 };
}

interface Pod {
 uid?: string;
 name: string;
 namespace: string;
 status: 'Running' | 'Pending' | 'Succeeded' | 'Failed' | 'Unknown' | 'CrashLoopBackOff' | 'ContainerCreating' | 'Terminating';
 ready: string;
 restarts: number;
 cpu: string;
 memory: string;
 age: string;
 creationTimestamp?: string;
 node: string;
 internalIP: string;
 externalIP: string;
 containers: Array<{ name: string; image: string }>;
}

const PODS_TABLE_COLUMNS: ResizableColumnConfig[] = [
 { id: 'name', defaultWidth: 280, minWidth: 150 },
 { id: 'namespace', defaultWidth: 180, minWidth: 120 },
 { id: 'status', defaultWidth: 150, minWidth: 100 },
 { id: 'ready', defaultWidth: 100, minWidth: 70 },
 { id: 'restarts', defaultWidth: 100, minWidth: 70 },
 { id: 'ip', defaultWidth: 160, minWidth: 120 },
 { id: 'cpu', defaultWidth: 130, minWidth: 90 },
 { id: 'memory', defaultWidth: 130, minWidth: 90 },
 { id: 'age', defaultWidth: 110, minWidth: 80 },
 { id: 'node', defaultWidth: 260, minWidth: 150 },
];

const PODS_COLUMNS_FOR_VISIBILITY = [
 { id: 'namespace', label: 'Namespace' },
 { id: 'status', label: 'Status' },
 { id: 'ready', label: 'Ready' },
 { id: 'restarts', label: 'Restarts' },
 { id: 'ip', label: 'IP' },
 { id: 'cpu', label: 'CPU Usage' },
 { id: 'memory', label: 'Memory Usage' },
 { id: 'age', label: 'Age' },
 { id: 'node', label: 'Node' },
];

const statusConfig: Record<string, { icon: LucideIcon; color: string; bg: string }> = {
 Running: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-500/10' },
 Pending: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-500/10' },
 Succeeded: { icon: CheckCircle2, color: 'text-blue-500', bg: 'bg-blue-500/10' },
 Failed: { icon: XCircle, color: 'text-rose-600', bg: 'bg-rose-500/10' },
 Unknown: { icon: Loader2, color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-500/10' },
 CrashLoopBackOff: { icon: RotateCcw, color: 'text-rose-600', bg: 'bg-rose-500/10' },
 ContainerCreating: { icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-500/10' },
 Terminating: { icon: XCircle, color: 'text-orange-500', bg: 'bg-orange-500/10' },
};

const statusToPillVariant: Record<string, StatusPillVariant> = {
 Running: 'success',
 Pending: 'warning',
 Succeeded: 'success',
 Failed: 'error',
 Unknown: 'neutral',
 CrashLoopBackOff: 'error',
 ContainerCreating: 'neutral',
 Terminating: 'warning',
};

function parseReadyFraction(ready: string): number {
 const m = ready.match(/^(\d+)\/(\d+)$/);
 if (!m) return 100;
 const num = parseInt(m[1], 10);
 const den = parseInt(m[2], 10);
 return den > 0 ? Math.round((num / den) * 100) : 0;
}

// Helpers for sorting CPU/Memory strings (e.g. "100m", "256Mi")
// parseCpu/parseMemory return `number | null`, so we coalesce null → -1
// to ensure pods without metrics sort to the bottom.
function parseCpuForSort(val: string): number {
 if (!val || val === '-') return -1;
 return parseCpu(val) ?? -1; // Returns millicores, null → -1
}
function parseMemoryForSort(val: string): number {
 if (!val || val === '-') return -1;
 return parseMemory(val) ?? -1; // Returns Mi, null → -1
}

function transformResource(resource: PodResource): Pod {
 const statusPhase = resource.status?.phase;
 const containerStatuses = resource.status?.containerStatuses || [];
 let status: Pod['status'] = (statusPhase as Pod['status']) || 'Unknown';

 // Refine status based on container states
 if ((resource.metadata as unknown as Record<string, unknown>).deletionTimestamp) {
 status = 'Terminating';
 } else {
 for (const c of containerStatuses) {
 if (c.state.waiting?.reason === 'CrashLoopBackOff') {
 status = 'CrashLoopBackOff';
 break;
 }
 if (c.state.waiting?.reason === 'ContainerCreating') {
 status = 'ContainerCreating';
 break;
 }
 }
 }

 const readyContainers = containerStatuses.filter((c) => c.ready).length;
 const totalContainers = resource.spec?.containers?.length || 0;
 const restarts = containerStatuses.reduce((acc, c) => acc + c.restartCount, 0);

 return {
 uid: resource.metadata?.uid,
 name: resource.metadata.name,
 namespace: resource.metadata.namespace || 'default',
 status,
 ready: `${readyContainers}/${totalContainers}`,
 restarts,
 cpu: '-', // Filled by metrics
 memory: '-', // Filled by metrics
 age: calculateAge(resource.metadata.creationTimestamp),
 creationTimestamp: resource.metadata.creationTimestamp,
 node: resource.spec?.nodeName || '-',
 internalIP: resource.status?.podIP || '-',
 externalIP: resource.status?.hostIP || '-',
 containers: resource.spec?.containers?.map(c => ({ name: c.name, image: c.image })) || [],
 };
}

type ListView = 'flat' | 'byNamespace' | 'byNode';

export default function Pods() {
 const navigate = useNavigate();
 const [searchParams] = useSearchParams();
 const [searchQuery, setSearchQuery] = useState('');
 const debouncedSearch = useDebouncedValue(searchQuery, 250);
 const [selectedNamespaces, setSelectedNamespaces] = useState<Set<string>>(new Set());
 const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; pod: Pod | null; bulk?: boolean }>({ open: false, pod: null });
 const [portForwardDialog, setPortForwardDialog] = useState<{ open: boolean; pod: Pod | null }>({ open: false, pod: null });
 const [showCreateWizard, setShowCreateWizard] = useState(false);
 const [showComparison, setShowComparison] = useState(false);
 const [listView, setListView] = useState<ListView>('flat');
 const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
 const multiSelect = useMultiSelect();
 const selectedPods = multiSelect.selectedIds;
 const setSelectedPods = (s: Set<string>) => { if (s.size === 0) multiSelect.clearSelection(); else multiSelect.selectAll(Array.from(s)); };
 const [showTableFilters, setShowTableFilters] = useState(false);

 // Client-side page size selector (used only in fallback/non-backend mode)
 const [pageSize, setPageSize] = useState(10);
 const [pageIndex, setPageIndex] = useState(0);

 // Status phase filter — drives server-side fieldSelector so pagination works with status cards
 const [statusPhaseFilter, setStatusPhaseFilter] = useState<string | null>(null);

 const { isConnected } = useConnectionStatus();

 // Server-side pagination path (backend + informer cache)
 // Server sorts by name (default); client-side useTableFiltersAndSort re-sorts the visible page.
 const {
   data: serverItems,
   isLoading: serverIsLoading,
   isError: serverIsError,
   isFetching: serverIsFetching,
   dataUpdatedAt: serverDataUpdatedAt,
   refetch: serverRefetch,
   pagination: serverPagination,
   total: serverTotal,
   isBackendAvailable,
 } = useServerPaginatedResourceList<PodResource>('pods', selectedNamespaces.size === 1 ? Array.from(selectedNamespaces)[0] : undefined, {
   pageSize,
   search: debouncedSearch || undefined,
   sortBy: 'name',
   sortOrder: 'asc',
   fieldSelector: statusPhaseFilter ? `status.phase=${statusPhaseFilter}` : undefined,
   namespaces: selectedNamespaces.size > 1 ? Array.from(selectedNamespaces) : undefined,
 });

 // Wrapped setters that also reset fallback pageIndex (status cards, namespace filter)
 const handleNamespaceChange = useCallback((ns: Set<string>) => {
   setSelectedNamespaces(ns);
   setPageIndex(0);
 }, []);
 const setStatusPhaseAndResetPage = useCallback((next: string | null) => {
   setStatusPhaseFilter(next);
   setPageIndex(0);
 }, []);

 // Fallback: direct K8s / non-backend mode (limit 500, client-side pagination)
 const { data: fallbackData, isLoading: fallbackIsLoading, isError: fallbackIsError, isFetching: fallbackIsFetching, dataUpdatedAt: fallbackDataUpdatedAt, refetch: fallbackRefetch } = useK8sResourceList<PodResource>('pods', undefined, {
   limit: 500,
   enabled: !isBackendAvailable,
 });

 // Unified data surface
 const data = isBackendAvailable ? null : fallbackData;
 const isLoading = isBackendAvailable ? serverIsLoading : fallbackIsLoading;
 const isError = isBackendAvailable ? serverIsError : fallbackIsError;
 const isFetching = isBackendAvailable ? serverIsFetching : fallbackIsFetching;
 const dataUpdatedAt = isBackendAvailable ? serverDataUpdatedAt : fallbackDataUpdatedAt;
 const refetch = isBackendAvailable ? serverRefetch : fallbackRefetch;
 const deleteResource = useDeleteK8sResource('pods');
 const patchResource = usePatchK8sResource('pods');
 const createResource = useCreateK8sResource('pods');
 const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
 const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
 const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
 const clusterId = currentClusterId ?? null;
 const { data: summaryData } = useClusterSummaryWithProject(clusterId ?? undefined);

 // In backend mode, serverItems is the current page from the server (already paginated + searched).
 // In fallback mode, fallbackData.items is the full fetched list for client-side processing.
 const rawItems: PodResource[] = useMemo(() => {
   if (isBackendAvailable) return isConnected ? serverItems : [];
   return isConnected && fallbackData ? (fallbackData.items ?? []) : [];
 }, [isBackendAvailable, serverItems, fallbackData, isConnected]);

 const fullPods: Pod[] = useMemo(() => rawItems.map(transformResource), [rawItems]);

 // Namespace list: use cluster-wide namespace list when backend is available
 // (not just namespaces from the current page of pods)
 const { data: allNamespaces } = useNamespacesFromCluster(clusterId);
 const namespaceList = useMemo(() => {
 if (allNamespaces && allNamespaces.length > 0) return allNamespaces.sort();
 return Array.from(new Set(fullPods.map(p => p.namespace))).sort();
 }, [allNamespaces, fullPods]);

 // Seed namespace filter from ?namespace=<ns> on initial load so views
 // navigated from Namespace detail are scoped correctly.
 useEffect(() => {
 const nsFromQuery = searchParams.get('namespace');
 if (!nsFromQuery) return;
 if (selectedNamespaces.size > 0) return;
 setSelectedNamespaces(new Set([nsFromQuery]));
 }, [searchParams, selectedNamespaces.size]);

 // Calculate resource max values from pod spec (for CPU/Memory bars)
 const podResourceMaxMap = useMemo(() => {
 const m: Record<string, { cpuMax?: number; memoryMax?: number }> = {};
 rawItems.forEach((podResource) => {
 const key = `${podResource.metadata.namespace}/${podResource.metadata.name}`;
 const containers = podResource.spec?.containers || [];
 const cpuMax = calculatePodResourceMax(containers, 'cpu'); // millicores
 const memoryMax = calculatePodResourceMax(containers, 'memory'); // bytes
 if (cpuMax !== undefined || memoryMax !== undefined) {
 m[key] = { cpuMax, memoryMax };
 }
 });
 return m;
 }, [rawItems]);

 const currentFilteredPods = useMemo(() => {
 if (isBackendAvailable) {
 // Server already handled search + single-namespace filter.
 // Only apply multi-namespace and status filters client-side here.
 return fullPods.filter((pod) => {
 const matchesNs = selectedNamespaces.size === 0 || selectedNamespaces.has(pod.namespace);
 return matchesNs;
 });
 }
 // Fallback / non-backend: full client-side filtering
 const q = debouncedSearch.toLowerCase();
 return fullPods.filter((pod) => {
 const matchesSearch = !q ||
 pod.name.toLowerCase().includes(q) ||
 pod.status.toLowerCase().includes(q) ||
 pod.node.toLowerCase().includes(q) ||
 pod.internalIP.includes(debouncedSearch);
 const matchesNs = selectedNamespaces.size === 0 || selectedNamespaces.has(pod.namespace);
 return matchesSearch && matchesNs;
 });
 }, [isBackendAvailable, fullPods, debouncedSearch, selectedNamespaces]);

 // High-level stats aligned with the current global scope (search + namespace filter)
 // In backend mode, serverTotal is the real count (pre-pagination); page data is just one page.
 // Stats: use backend summary counts (accurate across all pages) when available,
 // fall back to counting from loaded page data.
 const stats = useMemo(() => {
 if (isBackendAvailable && summaryData?.pod_status) {
 const ps = summaryData.pod_status;
 return {
 total: summaryData.pod_count,
 running: ps.running,
 succeeded: ps.succeeded,
 pending: ps.pending,
 failed: ps.failed,
 };
 }
 const pods = currentFilteredPods;
 return {
 total: pods.length,
 running: pods.filter((p) => p.status === 'Running').length,
 succeeded: pods.filter((p) => p.status === 'Succeeded').length,
 pending: pods.filter((p) => p.status === 'Pending').length,
 failed: pods.filter((p) => p.status === 'Failed' || p.status === 'CrashLoopBackOff').length,
 };
 }, [isBackendAvailable, summaryData, currentFilteredPods]);

 // Use raw data for initial filter/sort to avoid expensive metrics merging on every render
 const filteredUnsorted = useMemo(() => {
 return currentFilteredPods;
 }, [currentFilteredPods]);

 // CPU/Memory sort: fetch metrics for ALL filtered pods so sorting is accurate
 // across the full list, not just the first N. React Query caches these
 // individually (staleTime 60s) so repeated queries are essentially free.
 const SORT_METRICS_BATCH = 50; // Capped to prevent API storm — 500 was causing page freezes
 const podsForSortMetrics = useMemo(
 () => filteredUnsorted.slice(0, SORT_METRICS_BATCH),
 [filteredUnsorted]
 );
 const sortMetricsQueries = useQueries({
 queries: podsForSortMetrics.map((pod) => ({
 queryKey: ['pod-metrics-sort', clusterId, pod.namespace, pod.name],
 queryFn: () => getPodMetrics(backendBaseUrl, clusterId!, pod.namespace, pod.name),
 enabled: !!(isBackendConfigured && clusterId && podsForSortMetrics.length > 0),
 staleTime: 60_000,
 })),
 });
 const sortMetricsMap = useMemo(() => {
 const m: Record<string, { cpu: string; memory: string }> = {};
 sortMetricsQueries.forEach((q, i) => {
 if (q.data && podsForSortMetrics[i]) {
 const key = `${podsForSortMetrics[i].namespace}/${podsForSortMetrics[i].name}`;
 const d = q.data as { CPU?: string; Memory?: string };
 m[key] = { cpu: d.CPU ?? '-', memory: d.Memory ?? '-' };
 }
 });
 return m;
 }, [sortMetricsQueries, podsForSortMetrics]);

 const podKey = (p: Pod) => `${p.namespace}/${p.name}`;
 const podsTableConfig = useMemo((): { columns: ColumnConfig<Pod>[]; defaultSortKey: string; defaultSortOrder: 'asc' } => ({
 defaultSortKey: 'name',
 defaultSortOrder: 'asc',
 columns: [
 { columnId: 'name', getValue: (p) => p.name, sortable: true, filterable: true },
 { columnId: 'namespace', getValue: (p) => p.namespace, sortable: true, filterable: true },
 { columnId: 'status', getValue: (p) => p.status, sortable: true, filterable: true },
 { columnId: 'restarts', getValue: (p) => p.restarts, sortable: true, filterable: false },
 { columnId: 'ip', getValue: (p) => p.internalIP || '-', sortable: true, filterable: true },
 {
 columnId: 'cpu',
 getValue: (p) => sortMetricsMap[podKey(p)]?.cpu ?? p.cpu,
 sortable: true,
 filterable: false,
 compare: (a, b) => {
 const valA = sortMetricsMap[podKey(a)]?.cpu ?? a.cpu;
 const valB = sortMetricsMap[podKey(b)]?.cpu ?? b.cpu;
 return parseCpuForSort(valA) - parseCpuForSort(valB);
 },
 },
 {
 columnId: 'memory',
 getValue: (p) => sortMetricsMap[podKey(p)]?.memory ?? p.memory,
 sortable: true,
 filterable: false,
 compare: (a, b) => {
 const valA = sortMetricsMap[podKey(a)]?.memory ?? a.memory;
 const valB = sortMetricsMap[podKey(b)]?.memory ?? b.memory;
 return parseMemoryForSort(valA) - parseMemoryForSort(valB);
 },
 },
 { columnId: 'age', getValue: (p) => p.age, sortable: true, filterable: false },
 { columnId: 'node', getValue: (p) => p.node || '-', sortable: true, filterable: true },
 ],
 }), [sortMetricsMap]);

 const {
 filteredAndSortedItems: filteredPods,
 distinctValuesByColumn,
 valueCountsByColumn,
 columnFilters,
 setColumnFilter,
 sortKey,
 sortOrder,
 setSort,
 clearAllFilters,
 hasActiveFilters,
 } = useTableFiltersAndSort(filteredUnsorted, podsTableConfig);

 const columnVisibility = useColumnVisibility({
 tableId: 'pods',
 columns: PODS_COLUMNS_FOR_VISIBILITY,
 alwaysVisible: ['name'],
 });

 // Data-aware default widths for all visible columns, based on current data.
 const podsColumnConfig: ResizableColumnConfig[] = useMemo(() => {
 const valueGetters: Record<string, (p: Pod) => unknown> = {
 name: (p) => p.name,
 namespace: (p) => p.namespace,
 status: (p) => p.status,
 ready: (p) => p.ready,
 restarts: (p) => p.restarts,
 ip: (p) => `${p.internalIP} / ${p.externalIP}`,
 cpu: (p) => p.cpu,
 memory: (p) => p.memory,
 age: (p) => p.age,
 node: (p) => p.node,
 };
 const rows = filteredPods.length > 0 ? filteredPods : fullPods;
 if (!rows.length) return PODS_TABLE_COLUMNS;
 return buildAutoWidthColumns(PODS_TABLE_COLUMNS, rows, valueGetters, {
 perColumn: {
 name: { maxPx: 320 },
 namespace: { maxPx: 260 },
 node: { maxPx: 280 },
 ip: { maxPx: 300 },
 images: { maxPx: 320 },
 },
 });
 }, [filteredPods, fullPods]);

 // Pagination: server-side in backend mode, client-side in fallback mode
 const totalFiltered = isBackendAvailable ? serverTotal : filteredPods.length;
 const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
 const safePageIndex = Math.min(pageIndex, totalPages - 1);
 const start = safePageIndex * pageSize;
 // In backend mode, server returns the correct page; filteredPods IS the current page
 const itemsOnPage = isBackendAvailable ? filteredPods : filteredPods.slice(start, start + pageSize);

 useEffect(() => {
 if (!isBackendAvailable && safePageIndex !== pageIndex) setPageIndex(safePageIndex);
 }, [isBackendAvailable, safePageIndex, pageIndex]);

 const handlePageSizeChange = (size: number) => {
 setPageSize(size);
 setPageIndex(0);
 };

 const pagination = isBackendAvailable
 ? {
 ...serverPagination,
 rangeLabel: serverPagination.rangeLabel ?? (serverTotal === 0 ? 'No pods' : undefined),
 }
 : {
 rangeLabel: totalFiltered > 0
 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}`
 : 'No pods',
 hasPrev: safePageIndex > 0,
 hasNext: start + pageSize < totalFiltered,
 onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
 onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
 currentPage: safePageIndex + 1,
 totalPages: Math.max(1, totalPages),
 onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
 };

 // Grouping Logic for Views
 // We need to flatten the list if grouping is active for the current page
 // Note: Pagination applies to items *before* grouping for consistent page size, or *after*?
 // Usually pagination in table view applies to rows. If we group, we structure existing `itemsOnPage`.
 type PodListItem = { type: 'pod'; data: Pod } | { type: 'header'; label: string; count: number; groupKey: string; isCollapsed: boolean };

 const itemsToRender = useMemo<PodListItem[]>(() => {
 if (listView === 'flat') {
 return itemsOnPage.map(p => ({ type: 'pod', data: p }));
 }

 const isByNs = listView === 'byNamespace';
 const map = new Map<string, Pod[]>();
 for (const pod of itemsOnPage) {
 const key = isByNs ? pod.namespace : pod.node;
 const list = map.get(key) ?? [];
 list.push(pod);
 map.set(key, list);
 }

 const prefix = isByNs ? 'ns:' : 'node:';
 const sortedGroups = Array.from(map.entries())
 .sort((a, b) => a[0].localeCompare(b[0])); // Simple string sort for groups

 const result: PodListItem[] = [];
 for (const [key, pods] of sortedGroups) {
 const groupKey = prefix + key;
 const isCollapsed = collapsedGroups.has(groupKey);
 result.push({
 type: 'header',
 label: key,
 count: pods.length,
 groupKey,
 isCollapsed
 });
 if (!isCollapsed) {
 result.push(...pods.map(p => ({ type: 'pod', data: p } as PodListItem)));
 }
 }
 return result;
 }, [itemsOnPage, listView, collapsedGroups]);

 const toggleGroup = (groupKey: string) => {
 setCollapsedGroups((prev) => {
 const next = new Set(prev);
 if (next.has(groupKey)) next.delete(groupKey);
 else next.add(groupKey);
 return next;
 });
 };

 // Metrics Fetching for Visible Items
 // Use itemsToRender (which covers the current page) to decide what to fetch
 const visiblePodsForMetrics = useMemo(() => {
 return itemsToRender
 .filter(i => i.type === 'pod')
 .slice(0, 30) // Cap at ~30 per page for safety although page size controls this
 .map(i => (i as { data: Pod }).data);
 }, [itemsToRender]);

 const metricsQueries = useQueries({
 queries: visiblePodsForMetrics.map((pod) => ({
 queryKey: ['pod-metrics', clusterId, pod.namespace, pod.name],
 queryFn: () => getPodMetrics(backendBaseUrl, clusterId!, pod.namespace, pod.name),
 enabled: !!(isBackendConfigured && clusterId),
 staleTime: 120_000,
 })),
 });

 const metricsMap = useMemo(() => {
 const m: Record<string, { cpu: string; memory: string }> = {};
 metricsQueries.forEach((q, i) => {
 if (q.data && visiblePodsForMetrics[i]) {
 const key = `${visiblePodsForMetrics[i].namespace}/${visiblePodsForMetrics[i].name}`;
 const d = q.data as { CPU?: string; Memory?: string };
 m[key] = { cpu: d.CPU ?? '-', memory: d.Memory ?? '-' };
 }
 });
 return m;
 }, [metricsQueries, visiblePodsForMetrics]);

 // Dynamic max: when pods don't have resource limits, compute max from actual usage
 // across all visible pods so bars are proportional (not invisible against 1000m default)
 const { dynamicCpuMax, dynamicMemoryMax } = useMemo(() => {
   let maxCpu = 0;
   let maxMem = 0;
   const allMetrics = { ...metricsMap, ...sortMetricsMap };
   for (const key of Object.keys(allMetrics)) {
     const m = allMetrics[key];
     if (m?.cpu) {
       const val = parseCpu(m.cpu);
       if (val !== null && val > maxCpu) maxCpu = val;
     }
     if (m?.memory) {
       const val = parseMemory(m.memory);
       if (val !== null && val > maxMem) maxMem = val;
     }
   }
   return {
     dynamicCpuMax: Math.max(maxCpu * 1.5, 10),
     dynamicMemoryMax: Math.max(maxMem * 1.5, 32),
   };
 }, [metricsMap, sortMetricsMap]);

 const handleDelete = async () => {
 if (!isConnected) return;
 if (deleteDialog.bulk && selectedPods.size > 0) {
 for (const key of selectedPods) {
 const [ns, n] = key.split('/');
 await deleteResource.mutateAsync({ name: n, namespace: ns });
 }
 setSelectedPods(new Set());
 } else if (deleteDialog.pod) {
 await deleteResource.mutateAsync({ name: deleteDialog.pod.name, namespace: deleteDialog.pod.namespace });
 }
 setDeleteDialog({ open: false, pod: null });
 };

 const allPodKeys = useMemo(() => filteredPods.map(p => `${p.namespace}/${p.name}`), [filteredPods]);

 const togglePodSelection = (pod: Pod, event?: React.MouseEvent) => {
 const key = `${pod.namespace}/${pod.name}`;
 if (event?.shiftKey) {
 multiSelect.toggleRange(key, allPodKeys);
 } else {
 multiSelect.toggle(key);
 }
 };

 const toggleAllSelection = () => {
 if (multiSelect.isAllSelected(allPodKeys)) {
 multiSelect.clearSelection();
 } else {
 multiSelect.selectAll(allPodKeys);
 }
 };

 const isAllSelected = multiSelect.isAllSelected(allPodKeys);
 const isSomeSelected = multiSelect.isSomeSelected(allPodKeys);

 const handleViewLogs = (pod: Pod) => {
 // FIX P2-001: Navigate to the pod detail page's Logs tab (internal LogViewer component)
 // instead of opening a raw backend URL in a new browser tab.
 navigate(`/pods/${pod.namespace}/${pod.name}?tab=logs`);
 };

 const handleExecShell = (pod: Pod) => {
 // Navigate to pod detail exec tab
 navigate(`/pods/${pod.namespace}/${pod.name}?tab=exec`);
 };

 const handleDownloadYaml = (pod: Pod) => {
 const data: Record<string, unknown> = {
 name: pod.name,
 namespace: pod.namespace,
 status: pod.status,
 ready: pod.ready,
 restarts: pod.restarts,
 cpu: pod.cpu,
 memory: pod.memory,
 age: pod.age,
 node: pod.node,
 internalIP: pod.internalIP,
 externalIP: pod.externalIP,
 containers: pod.containers?.length ?? 0,
 containerNames: pod.containers?.map((c) => c.name).join(', ') ?? '',
 };
 const yaml = objectsToYaml([data]);
 const blob = new Blob([yaml], { type: 'text/yaml' });
 downloadBlob(blob, `${pod.namespace}-${pod.name}.yaml`);
 toast.success('YAML downloaded');
 };

 const handleDownloadJson = (pod: Pod) => {
 const data: Record<string, unknown> = {
 name: pod.name,
 namespace: pod.namespace,
 status: pod.status,
 ready: pod.ready,
 restarts: pod.restarts,
 cpu: pod.cpu,
 memory: pod.memory,
 age: pod.age,
 node: pod.node,
 internalIP: pod.internalIP,
 externalIP: pod.externalIP,
 containers: pod.containers?.length ?? 0,
 containerNames: pod.containers?.map((c) => c.name).join(', ') ?? '',
 };
 downloadResourceJson(data, `${pod.namespace}-${pod.name}.json`);
 toast.success('JSON downloaded');
 };

 const podExportConfig = useMemo(() => ({
 filenamePrefix: 'pods',
 resourceLabel: 'pods',
 getExportData: (p: Pod) => ({
 name: p.name,
 namespace: p.namespace,
 status: p.status,
 ready: p.ready,
 restarts: p.restarts,
 cpu: p.cpu,
 memory: p.memory,
 age: p.age,
 node: p.node,
 internalIP: p.internalIP,
 externalIP: p.externalIP,
 containers: p.containers?.length ?? 0,
 containerNames: p.containers?.map(c => c.name).join(', ') ?? '',
 }),
 csvColumns: [
 { label: 'Name', getValue: (p: Pod) => p.name },
 { label: 'Namespace', getValue: (p: Pod) => p.namespace },
 { label: 'Status', getValue: (p: Pod) => p.status },
 { label: 'Ready', getValue: (p: Pod) => p.ready },
 { label: 'Restarts', getValue: (p: Pod) => p.restarts },
 { label: 'CPU', getValue: (p: Pod) => p.cpu },
 { label: 'Memory', getValue: (p: Pod) => p.memory },
 { label: 'Age', getValue: (p: Pod) => p.age },
 { label: 'Node', getValue: (p: Pod) => p.node },
 { label: 'Internal IP', getValue: (p: Pod) => p.internalIP },
 { label: 'External IP', getValue: (p: Pod) => p.externalIP },
 ],
 }), []);

 const handleBulkDelete = async () => {
 return executeBulkOperation(Array.from(selectedPods), async (_key, ns, name) => {
 await deleteResource.mutateAsync({ name, namespace: ns });
 });
 };

 const handleBulkRestart = async () => {
 return executeBulkOperation(Array.from(selectedPods), async (_key, ns, name) => {
 await deleteResource.mutateAsync({ name, namespace: ns });
 });
 };

 const handleBulkLabel = async (label: string) => {
 return executeBulkOperation(Array.from(selectedPods), async (_key, ns, name) => {
 await patchResource.mutateAsync({
 name,
 namespace: ns,
 patch: { metadata: { labels: { [label.split("=")[0]]: label.split("=")[1] } } },
 });
 });
 };

 const selectedResourceLabels = useMemo(() => {
 const map = new Map<string, Record<string, string>>();
 for (const key of selectedPods) {
 const [ns, n] = key.split('/');
 const raw = rawItems.find((r) => r.metadata.namespace === ns && r.metadata.name === n);
 if (raw) map.set(key, raw.metadata.labels ?? {});
 }
 return map;
 }, [selectedPods, rawItems]);

 const keyboardNav = useTableKeyboardNav({
 rowCount: itemsToRender.length,
 onOpenRow: (index) => {
 const item = itemsToRender[index];
 if (item.type === 'pod') navigate(`/pods/${item.data.namespace}/${item.data.name}`);
 else toggleGroup(item.groupKey);
 },
 getRowKeyAt: (index) => {
 const item = itemsToRender[index];
 return item.type === 'pod' ? `${item.data.namespace}/${item.data.name}` : item.groupKey;
 },
 selectedKeys: selectedPods,
 onToggleSelect: (key) => {
 const item = itemsToRender.find(i => i.type === 'pod' && `${i.data.namespace}/${i.data.name}` === key);
 if (item && item.type === 'pod') togglePodSelection(item.data);
 },
 enabled: true,
 });

 const visibleColumnCount = useMemo(() => {
 const dataCols = PODS_TABLE_COLUMNS.filter((c) => columnVisibility.isColumnVisible(c.id)).length;
 return 1 + dataCols + 1; // checkbox + data columns + actions
 }, [columnVisibility]);

 return (
 <PageLayout label="Pods">
 <div className="space-y-6">
 <ListPageHeader
 icon={<Box className="h-6 w-6 text-primary" />}
 title="Pods"
 resourceCount={isBackendAvailable ? serverTotal : filteredPods.length}
 subtitle={selectedNamespaces.size > 0 ? `in ${selectedNamespaces.size} namespaces` : 'across all namespaces'}
 demoMode={!isConnected}
 dataUpdatedAt={dataUpdatedAt}
 isLoading={isLoading}
 onRefresh={() => refetch()}
 createLabel="Create Pod"
 onCreate={() => setShowCreateWizard(true)}
 actions={
 <>
 <ResourceExportDropdown
 items={filteredPods}
 selectedKeys={selectedPods}
 getKey={(p) => `${p.namespace}/${p.name}`}
 config={podExportConfig}
 selectionLabel={selectedPods.size > 0 ? 'Selected pods' : 'All visible pods'}
 onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
 />
 {selectedPods.size > 0 && (
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="outline" size="sm" className="press-effect gap-2">
 <RotateCcw className="h-4 w-4" />
 Actions
 <ChevronDown className="h-4 w-4 opacity-50" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end">
 <DropdownMenuItem onClick={handleBulkRestart} className="gap-2 cursor-pointer">
 <RotateCcw className="h-4 w-4 shrink-0" />
 Restart selected
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 )}
 <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowComparison(true)}>
 <GitCompare className="h-4 w-4" />
 Compare
 </Button>
 {selectedPods.size > 0 && (
 <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleteDialog({ open: true, pod: null, bulk: true })}>
 <Trash2 className="h-4 w-4" />
 Delete
 </Button>
 )}
 </>
 }
 leftExtra={selectedPods.size > 0 ? (
 <div className="flex items-center gap-2 ml-2 pl-2 border-l border-border">
 <span className="text-sm text-muted-foreground">{selectedPods.size} selected</span>
 <Button variant="ghost" size="sm" className="press-effect h-8" onClick={() => setSelectedPods(new Set())}>Clear</Button>
 </div>
 ) : undefined}
 />

 {/* Stats Cards — quick filters for Status column */}
 <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
 <ListPageStatCard
 label="Total Pods"
 value={stats.total}
 icon={Box}
 iconColor="text-primary"
 isLoading={isLoading}
 selected={!statusPhaseFilter}
 onClick={() => { setStatusPhaseAndResetPage(null); setColumnFilter('status', null); }}
 className={cn(!statusPhaseFilter && !isLoading && 'ring-2 ring-primary')}
 />
 <ListPageStatCard
 label="Running"
 value={stats.running}
 icon={CheckCircle2}
 iconColor="text-emerald-600"
 valueClassName="text-emerald-600"
 isLoading={isLoading}
 selected={statusPhaseFilter === 'Running'}
 onClick={() => { setStatusPhaseAndResetPage(statusPhaseFilter === 'Running' ? null : 'Running'); setColumnFilter('status', statusPhaseFilter === 'Running' ? null : new Set(['Running'])); }}
 className={cn(statusPhaseFilter === 'Running' && 'ring-2 ring-emerald-500')}
 />
 <ListPageStatCard
 label="Succeeded"
 value={stats.succeeded}
 icon={CheckCircle2}
 iconColor="text-blue-600"
 valueClassName="text-blue-600"
 isLoading={isLoading}
 selected={statusPhaseFilter === 'Succeeded'}
 onClick={() => { setStatusPhaseAndResetPage(statusPhaseFilter === 'Succeeded' ? null : 'Succeeded'); setColumnFilter('status', statusPhaseFilter === 'Succeeded' ? null : new Set(['Succeeded'])); }}
 className={cn(statusPhaseFilter === 'Succeeded' && 'ring-2 ring-blue-500')}
 />
 <ListPageStatCard
 label="Pending"
 value={stats.pending}
 icon={Clock}
 iconColor="text-amber-600"
 valueClassName="text-amber-600"
 isLoading={isLoading}
 selected={statusPhaseFilter === 'Pending'}
 onClick={() => { setStatusPhaseAndResetPage(statusPhaseFilter === 'Pending' ? null : 'Pending'); setColumnFilter('status', statusPhaseFilter === 'Pending' ? null : new Set(['Pending'])); }}
 className={cn(statusPhaseFilter === 'Pending' && 'ring-2 ring-amber-500')}
 />
 <ListPageStatCard
 label="Failed"
 value={stats.failed}
 icon={XCircle}
 iconColor="text-rose-600"
 valueClassName="text-rose-600"
 isLoading={isLoading}
 selected={statusPhaseFilter === 'Failed'}
 onClick={() => { setStatusPhaseAndResetPage(statusPhaseFilter === 'Failed' ? null : 'Failed'); setColumnFilter('status', statusPhaseFilter === 'Failed' ? null : new Set(['Failed', 'CrashLoopBackOff'])); }}
 className={cn(statusPhaseFilter === 'Failed' && 'ring-2 ring-rose-500')}
 />
 </div>

 <BulkActionBar
 selectedCount={selectedPods.size}
 resourceName="pod"
 resourceType="pods"
 onClearSelection={() => multiSelect.clearSelection()}
 onBulkDelete={handleBulkDelete}
 onBulkRestart={handleBulkRestart}
 onBulkLabel={handleBulkLabel}
 />

 <ResourceListTableToolbar
 globalFilterBar={
 <ResourceCommandBar
 scope={
 <NamespaceFilter
 namespaces={namespaceList}
 selected={selectedNamespaces}
 onSelectionChange={handleNamespaceChange}
 triggerVariant="bar"
 />
 }
 search={
 <div className="relative w-full min-w-0">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
 <Input
 placeholder="Search pods..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all"
 aria-label="Search pods by name or namespace"
 />
 </div>
 }
 structure={
 <ListViewSegmentedControl
 value={listView}
 onChange={(v) => setListView(v as ListView)}
 options={[
 { id: 'flat', label: 'Flat', icon: List },
 { id: 'byNamespace', label: 'By Namespace', icon: Layers },
 { id: 'byNode', label: 'By Node', icon: Boxes },
 ]}
 ariaLabel="List structure"
 />
 }
 footer={
 <p className="text-xs text-muted-foreground tabular-nums">
 {isBackendAvailable ? serverTotal : filteredPods.length} pods
 {' · '}
 {selectedNamespaces.size === 0 ? 'all namespaces' : `${selectedNamespaces.size} namespace${selectedNamespaces.size === 1 ? '' : 's'}`}
 {' · '}
 {listView === 'flat' ? 'flat list' : listView === 'byNamespace' ? 'grouped by namespace' : 'grouped by node'}
 </p>
 }
 />
 }
 showTableFilters={showTableFilters}
 onToggleTableFilters={() => setShowTableFilters((v) => !v)}
 hasActiveFilters={hasActiveFilters}
 onClearAllFilters={() => { clearAllFilters(); setStatusPhaseFilter(null); setSearchQuery(''); setSelectedNamespaces(new Set()); setPageIndex(0); }}
 columns={PODS_COLUMNS_FOR_VISIBILITY}
 visibleColumns={columnVisibility.visibleColumns}
 onColumnToggle={columnVisibility.setColumnVisible}
 isLoading={isLoading && isConnected}
 tableContainerProps={keyboardNav.tableContainerProps}
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
 <ResizableTableProvider tableId="pods" columnConfig={podsColumnConfig}>
 <Table className="table-fixed">
 <TableHeader>
 <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
 <TableHead className="w-10">
 <Checkbox
 checked={isAllSelected}
 onCheckedChange={toggleAllSelection}
 aria-label="Select all"
 className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')}
 />
 </TableHead>
 {columnVisibility.isColumnVisible('name') && (
 <ResizableTableHead columnId="name" className="font-semibold">
 <TableColumnHeaderWithFilterAndSort
 columnId="name"
 label="Name"
 sortKey={sortKey}
 sortOrder={sortOrder}
 onSort={setSort}
 filterable={false}
 distinctValues={[]}
 selectedFilterValues={new Set()}
 onFilterChange={() => { }}
 />
 </ResizableTableHead>
 )}
 {columnVisibility.isColumnVisible('namespace') && (
 <ResizableTableHead columnId="namespace" className="font-semibold">
 <TableColumnHeaderWithFilterAndSort
 columnId="namespace"
 label="Namespace"
 sortKey={sortKey}
 sortOrder={sortOrder}
 onSort={setSort}
 filterable
 distinctValues={distinctValuesByColumn.namespace ?? []}
 selectedFilterValues={columnFilters.namespace ?? new Set()}
 onFilterChange={setColumnFilter}
 />
 </ResizableTableHead>
 )}
 {columnVisibility.isColumnVisible('status') && (
 <ResizableTableHead columnId="status" className="font-semibold">
 <TableColumnHeaderWithFilterAndSort
 columnId="status"
 label="Status"
 sortKey={sortKey}
 sortOrder={sortOrder}
 onSort={setSort}
 filterable
 distinctValues={distinctValuesByColumn.status ?? []}
 selectedFilterValues={columnFilters.status ?? new Set()}
 onFilterChange={setColumnFilter}
 />
 </ResizableTableHead>
 )}
 {columnVisibility.isColumnVisible('ready') && (
 <ResizableTableHead columnId="ready" className="font-semibold">
 <span className="truncate block">Ready</span>
 </ResizableTableHead>
 )}
 {columnVisibility.isColumnVisible('restarts') && (
 <ResizableTableHead columnId="restarts" className="font-semibold">
 <TableColumnHeaderWithFilterAndSort
 columnId="restarts"
 label="Restarts"
 sortKey={sortKey}
 sortOrder={sortOrder}
 onSort={setSort}
 filterable={false}
 distinctValues={[]}
 selectedFilterValues={new Set()}
 onFilterChange={() => { }}
 />
 </ResizableTableHead>
 )}
 {columnVisibility.isColumnVisible('ip') && (
 <ResizableTableHead columnId="ip" className="font-semibold">
 <TableColumnHeaderWithFilterAndSort
 columnId="ip"
 label="Internal IP / External IP"
 sortKey={sortKey}
 sortOrder={sortOrder}
 onSort={setSort}
 filterable={false}
 distinctValues={[]}
 selectedFilterValues={new Set()}
 onFilterChange={() => { }}
 />
 </ResizableTableHead>
 )}
 {columnVisibility.isColumnVisible('cpu') && (
 <ResizableTableHead columnId="cpu" className="font-semibold">
 <TableColumnHeaderWithFilterAndSort
 columnId="cpu"
 label="CPU"
 sortKey={sortKey}
 sortOrder={sortOrder}
 onSort={setSort}
 filterable={false}
 distinctValues={[]}
 selectedFilterValues={new Set()}
 onFilterChange={() => { }}
 />
 </ResizableTableHead>
 )}
 {columnVisibility.isColumnVisible('memory') && (
 <ResizableTableHead columnId="memory" className="font-semibold">
 <TableColumnHeaderWithFilterAndSort
 columnId="memory"
 label="Memory"
 sortKey={sortKey}
 sortOrder={sortOrder}
 onSort={setSort}
 filterable={false}
 distinctValues={[]}
 selectedFilterValues={new Set()}
 onFilterChange={() => { }}
 />
 </ResizableTableHead>
 )}
 {columnVisibility.isColumnVisible('age') && (
 <ResizableTableHead columnId="age" className="font-semibold">
 <TableColumnHeaderWithFilterAndSort
 columnId="age"
 label="Age"
 sortKey={sortKey}
 sortOrder={sortOrder}
 onSort={setSort}
 filterable={false}
 distinctValues={[]}
 selectedFilterValues={new Set()}
 onFilterChange={() => { }}
 />
 </ResizableTableHead>
 )}
 {columnVisibility.isColumnVisible('node') && (
 <ResizableTableHead columnId="node" className="font-semibold">
 <TableColumnHeaderWithFilterAndSort
 columnId="node"
 label="Node"
 sortKey={sortKey}
 sortOrder={sortOrder}
 onSort={setSort}
 filterable
 distinctValues={distinctValuesByColumn.node ?? []}
 selectedFilterValues={columnFilters.node ?? new Set()}
 onFilterChange={setColumnFilter}
 />
 </ResizableTableHead>
 )}
 <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
 </TableRow>
 {/* Filter row - appears under headers when Show filters is on */}
 {showTableFilters && (
 <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
 <TableCell className="w-10 p-1.5" />
 {columnVisibility.isColumnVisible('name') && (
 <ResizableTableCell columnId="name" className="p-1.5">
 <TableFilterCell
 columnId="name"
 label="Name"
 distinctValues={distinctValuesByColumn.name ?? []}
 selectedFilterValues={columnFilters.name ?? new Set()}
 onFilterChange={setColumnFilter}
 valueCounts={valueCountsByColumn.name}
 />
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('namespace') && (
 <ResizableTableCell columnId="namespace" className="p-1.5">
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
 {columnVisibility.isColumnVisible('status') && (
 <ResizableTableCell columnId="status" className="p-1.5">
 <TableFilterCell
 columnId="status"
 label="Status"
 distinctValues={distinctValuesByColumn.status ?? []}
 selectedFilterValues={columnFilters.status ?? new Set()}
 onFilterChange={setColumnFilter}
 valueCounts={valueCountsByColumn.status}
 />
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('ready') && (
 <ResizableTableCell columnId="ready" className="p-1.5" />
 )}
 {columnVisibility.isColumnVisible('restarts') && (
 <ResizableTableCell columnId="restarts" className="p-1.5" />
 )}
 {columnVisibility.isColumnVisible('ip') && (
 <ResizableTableCell columnId="ip" className="p-1.5">
 <TableFilterCell
 columnId="ip"
 label="IP"
 distinctValues={distinctValuesByColumn.ip ?? []}
 selectedFilterValues={columnFilters.ip ?? new Set()}
 onFilterChange={setColumnFilter}
 valueCounts={valueCountsByColumn.ip}
 />
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('cpu') && (
 <ResizableTableCell columnId="cpu" className="p-1.5" />
 )}
 {columnVisibility.isColumnVisible('memory') && (
 <ResizableTableCell columnId="memory" className="p-1.5" />
 )}
 {columnVisibility.isColumnVisible('age') && (
 <ResizableTableCell columnId="age" className="p-1.5" />
 )}
 {columnVisibility.isColumnVisible('node') && (
 <ResizableTableCell columnId="node" className="p-1.5">
 <TableFilterCell
 columnId="node"
 label="Node"
 distinctValues={distinctValuesByColumn.node ?? []}
 selectedFilterValues={columnFilters.node ?? new Set()}
 onFilterChange={setColumnFilter}
 valueCounts={valueCountsByColumn.node}
 />
 </ResizableTableCell>
 )}
 <TableCell className="w-12 p-1.5" />
 </TableRow>
 )}
 </TableHeader>
 <TableBody>
 {isLoading && isConnected && !isError ? (
 <ListPageLoadingShell columnCount={visibleColumnCount} resourceName="pods" isLoading={isLoading} onRetry={() => refetch()} />
 ) : isError ? (
 <TableRow>
 <TableCell colSpan={visibleColumnCount} className="h-40 text-center">
 <TableErrorState onRetry={() => refetch()} />
 </TableCell>
 </TableRow>
 ) : itemsToRender.length === 0 ? (
 <TableRow>
 <TableCell colSpan={visibleColumnCount} className="h-40 text-center">
 <TableEmptyState
 icon={<Box className="h-8 w-8" />}
 title="No Pods found"
 subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Get started by creating a Pod.'}
 hasActiveFilters={!!(searchQuery || hasActiveFilters || statusPhaseFilter)}
 onClearFilters={() => { setSearchQuery(''); clearAllFilters(); setStatusPhaseFilter(null); }}
 createLabel="Create Pod"
 onCreate={() => setShowCreateWizard(true)}
 />
 </TableCell>
 </TableRow>
 ) : (
 itemsToRender.map((item, index) => {
 if (item.type === 'header') {
 const groupLabel = listView === 'byNamespace' ? `Namespace: ${item.label}` : `Node: ${item.label}`;
 return (
 <TableRow
 key={`header-${item.groupKey}`}
 className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-b border-border/60 transition-all duration-200"
 onClick={() => toggleGroup(item.groupKey)}
 >
 <TableCell colSpan={visibleColumnCount} className="py-2">
 <div className="flex items-center gap-2 font-medium">
 {item.isCollapsed ? (
 <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
 ) : (
 <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
 )}
 {groupLabel}
 <span className="text-muted-foreground font-normal">({item.count})</span>
 </div>
 </TableCell>
 </TableRow>
 );
 }

 const pod = item.data;
 const StatusIcon = statusConfig[pod.status]?.icon || Clock;
 const podKey = `${pod.namespace}/${pod.name}`;
 const isSelected = selectedPods.has(podKey);
 const cpuVal = sortKey === 'cpu' ? (sortMetricsMap[podKey]?.cpu ?? metricsMap[podKey]?.cpu ?? pod.cpu) : (metricsMap[podKey]?.cpu ?? sortMetricsMap[podKey]?.cpu ?? pod.cpu);
 const memVal = sortKey === 'memory' ? (sortMetricsMap[podKey]?.memory ?? metricsMap[podKey]?.memory ?? pod.memory) : (metricsMap[podKey]?.memory ?? sortMetricsMap[podKey]?.memory ?? pod.memory);

 return (
 <tr
 key={podKey}
 className={cn(
 resourceTableRowClassName,
 getRowAnimationClass(pod.uid),
 isSelected && 'bg-primary/5'
 )}
 >
 <TableCell className="w-10" onClick={(e) => { e.stopPropagation(); togglePodSelection(pod, e); }}>
 <Checkbox
 checked={isSelected}
 tabIndex={-1}
 aria-label={`Select ${pod.name}`}
 />
 </TableCell>
 {columnVisibility.isColumnVisible('name') && (
 <ResizableTableCell columnId="name">
 <Tooltip>
 <TooltipTrigger asChild>
 <Link
 to={`/pods/${pod.namespace}/${pod.name}`}
 className="font-medium text-primary hover:underline flex items-center gap-2 min-w-0"
 onClick={(e) => e.stopPropagation()}
 >
 <Box className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <span className="truncate"><SearchHighlight text={pod.name} query={debouncedSearch} /></span>
 </Link>
 </TooltipTrigger>
 <TooltipContent side="top" className="max-w-md">
 {pod.name}
 </TooltipContent>
 </Tooltip>
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('namespace') && (
 <ResizableTableCell columnId="namespace">
 <NamespaceBadge
 namespace={pod.namespace}
 className="font-normal truncate block w-fit max-w-full"
 />
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('status') && (
 <ResizableTableCell columnId="status">
 <StatusPill label={pod.status} variant={statusToPillVariant[pod.status]} icon={StatusIcon} />
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('ready') && (
 <ResizableTableCell columnId="ready" className="font-mono text-sm">
 <div className="flex items-center gap-2 min-w-0">
 <Progress value={parseReadyFraction(pod.ready)} className="h-1.5 w-12 flex-shrink-0" />
 <span className="tabular-nums">{pod.ready}</span>
 </div>
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('restarts') && (
 <ResizableTableCell columnId="restarts">
 <span className={cn(
 'font-medium',
 pod.restarts > 5 && 'text-rose-600',
 pod.restarts > 0 && pod.restarts <= 5 && 'text-amber-600'
 )}>
 {pod.restarts}
 </span>
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('ip') && (
 <ResizableTableCell columnId="ip" className="font-mono text-sm">
 <Tooltip>
 <TooltipTrigger asChild>
 <span
 className="cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 truncate block"
 onClick={(e) => {
 e.stopPropagation();
 const text = `${pod.internalIP} / ${pod.externalIP}`;
 navigator.clipboard?.writeText(text);
 }}
 >
 {pod.internalIP} / {pod.externalIP}
 </span>
 </TooltipTrigger>
 <TooltipContent side="top">
 Internal and external IP. Click to copy.
 </TooltipContent>
 </Tooltip>
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('cpu') && (
 <ResizableTableCell columnId="cpu">
 {(() => {
   const val = parseCpu(cpuVal);
   const maxVal = podResourceMaxMap[podKey]?.cpuMax ?? dynamicCpuMax;
   const ratio = val !== null && maxVal > 0 ? Math.min(val / maxVal, 1) : 0;
   const pct = Math.round(ratio * 100);
   const barColor = ratio < 0.4 ? '#10b981' : ratio < 0.7 ? '#f59e0b' : ratio < 0.9 ? '#f97316' : '#ef4444';
   const display = val !== null ? (val >= 1000 ? `${(val/1000).toFixed(1)} cores` : `${val.toFixed(1)}m`) : '-';
   const limit = podResourceMaxMap[podKey]?.cpuMax;
   const limitDisplay = limit ? (limit >= 1000 ? `${(limit/1000).toFixed(1)} cores` : `${limit}m`) : 'no limit';
   return (
     <div className="flex items-center gap-2" title={`CPU: ${display} / ${limitDisplay} (${pct}% used)`}>
       <div className="w-[52px] shrink-0">
         <div className="h-[5px] rounded-full bg-gray-200/80 dark:bg-gray-700/60 overflow-hidden">
           <div className="h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${Math.max(pct, val !== null && val > 0 ? 4 : 0)}%`, background: barColor }} />
         </div>
       </div>
       <span className="text-xs font-medium tabular-nums text-gray-700 dark:text-gray-300 whitespace-nowrap">{display}</span>
     </div>
   );
 })()}
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('memory') && (
 <ResizableTableCell columnId="memory">
 {(() => {
   const val = parseMemory(memVal);
   const maxVal = podResourceMaxMap[podKey]?.memoryMax ?? dynamicMemoryMax;
   const ratio = val !== null && maxVal > 0 ? Math.min(val / maxVal, 1) : 0;
   const pct = Math.round(ratio * 100);
   const barColor = ratio < 0.4 ? '#3b82f6' : ratio < 0.7 ? '#f59e0b' : ratio < 0.9 ? '#f97316' : '#ef4444';
   const display = val !== null ? (val >= 1024 ? `${(val/1024).toFixed(1)} Gi` : `${val.toFixed(0)} Mi`) : '-';
   const limit = podResourceMaxMap[podKey]?.memoryMax;
   const limitDisplay = limit ? (limit >= 1024 ? `${(limit/1024).toFixed(1)} Gi` : `${limit.toFixed(0)} Mi`) : 'no limit';
   return (
     <div className="flex items-center gap-2" title={`Memory: ${display} / ${limitDisplay} (${pct}% used)`}>
       <div className="w-[52px] shrink-0">
         <div className="h-[5px] rounded-full bg-gray-200/80 dark:bg-gray-700/60 overflow-hidden">
           <div className="h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${Math.max(pct, val !== null && val > 0 ? 4 : 0)}%`, background: barColor }} />
         </div>
       </div>
       <span className="text-xs font-medium tabular-nums text-gray-700 dark:text-gray-300 whitespace-nowrap">{display}</span>
     </div>
   );
 })()}
 </ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('age') && (
 <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={pod.age} timestamp={pod.creationTimestamp} /></ResizableTableCell>
 )}
 {columnVisibility.isColumnVisible('node') && (
 <ResizableTableCell columnId="node" className="text-muted-foreground">
 {pod.node !== '-' ? (
 <Tooltip>
 <TooltipTrigger asChild>
 <Link to={`/nodes/${encodeURIComponent(pod.node)}`} className="text-primary hover:underline truncate block">
 {pod.node}
 </Link>
 </TooltipTrigger>
 <TooltipContent side="top">{pod.node}</TooltipContent>
 </Tooltip>
 ) : (
 <span className="truncate block">{pod.node}</span>
 )}
 </ResizableTableCell>
 )}
 <TableCell className="w-12">
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button
 variant="ghost"
 size="icon"
 className="press-effect h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
 aria-label="Pod actions"
 >
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <CopyNameDropdownItem name={pod.name} namespace={pod.namespace} />
 <DropdownMenuItem onClick={() => navigate(`/pods/${pod.namespace}/${pod.name}`)} className="press-effect gap-2">
 View Details
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => handleViewLogs(pod)} className="press-effect gap-2">
 <FileText className="h-4 w-4" />
 View Logs
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => handleExecShell(pod)} className="press-effect gap-2">
 <Terminal className="h-4 w-4" />
 Exec Shell
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => setPortForwardDialog({ open: true, pod })} className="press-effect gap-2">
 <ExternalLink className="h-4 w-4" />
 Port Forward
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem onClick={() => handleDownloadYaml(pod)} className="press-effect gap-2">
 <Download className="h-4 w-4" />
 Download YAML
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => handleDownloadJson(pod)} className="press-effect gap-2">
 <Download className="h-4 w-4" />
 Export as JSON
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem
 className="gap-2 text-destructive"
 onClick={() => setDeleteDialog({ open: true, pod })}
 >
 <Trash2 className="h-4 w-4" />
 Delete
 </DropdownMenuItem>
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
 resourceKind="Pod"
 defaultYaml={DEFAULT_YAMLS.Pod}
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

 {/* Delete Confirmation Dialog */}
 <DeleteConfirmDialog
 open={deleteDialog.open}
 onOpenChange={(open) => setDeleteDialog({ open, pod: open ? deleteDialog.pod : null })}
 resourceType="Pod"
 resourceName={deleteDialog.bulk ? `${selectedPods.size} pods` : (deleteDialog.pod?.name || '')}
 namespace={deleteDialog.bulk ? undefined : deleteDialog.pod?.namespace}
 onConfirm={handleDelete}
 requireNameConfirmation={!deleteDialog.bulk}
 />

 {/* Port Forward Dialog */}
 {
 portForwardDialog.pod && (
 <PortForwardDialog
 open={portForwardDialog.open}
 onOpenChange={(open) => setPortForwardDialog({ open, pod: open ? portForwardDialog.pod : null })}
 podName={portForwardDialog.pod.name}
 namespace={portForwardDialog.pod.namespace}
 containers={portForwardDialog.pod.containers}
 />
 )
 }

 {/* Resource Comparison View Modal */}
 <AnimatePresence>
 {showComparison && (
 <div className="fixed z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
  style={{ top: 0, right: 0, bottom: 0, left: 0 }}
  ref={(el) => {
    if (el) {
      const main = document.getElementById('main-content');
      if (main) {
        const rect = main.getBoundingClientRect();
        el.style.top = `${rect.top}px`;
        el.style.left = `${rect.left}px`;
        el.style.right = '0px';
        el.style.bottom = '0px';
      }
    }
  }}
 >
 <div className="w-full h-full max-w-[min(96vw,1680px)] max-h-[95vh] flex flex-col bg-background border rounded-xl shadow-2xl overflow-hidden relative"
 >
 <Button
 variant="ghost"
 size="icon"
 className="press-effect absolute right-4 top-4 z-50"
 onClick={() => setShowComparison(false)}
 >
 <X className="h-4 w-4" />
 </Button>
 <div className="flex-1 overflow-hidden">
 <ResourceComparisonView
 resourceType="pods"
 resourceKind="Pod"
 initialSelectedResources={Array.from(selectedPods)}
 clusterId={clusterId ?? undefined}
 backendBaseUrl={backendBaseUrl ?? ''}
 isConnected={isConnected}
 />
 </div>
 </div>
 </div>
 )}
 </AnimatePresence>
 </div>
 </PageLayout>
 );
}
