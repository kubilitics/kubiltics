import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Filter, RefreshCw, MoreHorizontal, CheckCircle2, XCircle, Clock, Loader2, WifiOff, Box,
  ChevronDown, ChevronLeft, ChevronRight, Trash2, RotateCcw, Scale, History, Rocket, FileText,
  List, Layers, Activity, PauseCircle, LayoutGrid, Terminal, ExternalLink, Download, GitCompare, Boxes, X, type LucideIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { resourceTableRowClassName, ROW_MOTION, StatusPill, ListPagination, PAGE_SIZE_OPTIONS, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, AgeCell, TableEmptyState, TableSkeletonRows, CopyNameDropdownItem, ResourceListTableToolbar, type StatusPillVariant } from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useTableKeyboardNav } from '@/hooks/useTableKeyboardNav';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { ResizableTableProvider, ResizableTableHead, ResizableTableCell, type ResizableColumnConfig } from '@/components/ui/resizable-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { useK8sResourceList, useDeleteK8sResource, useCreateK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { getPodMetrics, getPodLogsUrl, postShellCommand } from '@/services/backendApiClient';
import { DeleteConfirmDialog, PortForwardDialog, UsageBar, parseCpu, parseMemory, calculatePodResourceMax, ResourceComparisonView } from '@/components/resources';
import { ResourceCommandBar, ResourceExportDropdown, ListViewSegmentedControl, NamespaceFilter } from '@/components/list';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { useQuery, useQueries } from '@tanstack/react-query';
import { toast } from 'sonner';
import { objectsToYaml, downloadBlob, downloadResourceJson } from '@/lib/exportUtils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';

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
  { id: 'name', defaultWidth: 220, minWidth: 120 },
  { id: 'namespace', defaultWidth: 120, minWidth: 80 },
  { id: 'status', defaultWidth: 130, minWidth: 90 },
  { id: 'ready', defaultWidth: 70, minWidth: 50 },
  { id: 'restarts', defaultWidth: 70, minWidth: 50 },
  { id: 'ip', defaultWidth: 140, minWidth: 100 },
  { id: 'cpu', defaultWidth: 100, minWidth: 70 },
  { id: 'memory', defaultWidth: 100, minWidth: 70 },
  { id: 'age', defaultWidth: 80, minWidth: 60 },
  { id: 'node', defaultWidth: 140, minWidth: 100 },
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
  Running: { icon: CheckCircle2, color: 'text-[hsl(142,76%,36%)]', bg: 'bg-[hsl(142,76%,36%)]/10' },
  Pending: { icon: Clock, color: 'text-[hsl(45,93%,47%)]', bg: 'bg-[hsl(45,93%,47%)]/10' },
  Succeeded: { icon: CheckCircle2, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  Failed: { icon: XCircle, color: 'text-[hsl(0,72%,51%)]', bg: 'bg-[hsl(0,72%,51%)]/10' },
  Unknown: { icon: Loader2, color: 'text-gray-500', bg: 'bg-gray-500/10' },
  CrashLoopBackOff: { icon: RotateCcw, color: 'text-[hsl(0,72%,51%)]', bg: 'bg-[hsl(0,72%,51%)]/10' },
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
function parseCpuForSort(val: string): number {
  if (!val || val === '-') return -1;
  return parseCpu(val); // Returns millicores
}
function parseMemoryForSort(val: string): number {
  if (!val || val === '-') return -1;
  return parseMemory(val); // Returns bytes
}

function transformResource(resource: PodResource): Pod {
  const statusPhase = resource.status?.phase;
  const containerStatuses = resource.status?.containerStatuses || [];
  let status: Pod['status'] = (statusPhase as Pod['status']) || 'Unknown';

  // Refine status based on container states
  if ((resource.metadata as any).deletionTimestamp) {
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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespaces, setSelectedNamespaces] = useState<Set<string>>(new Set());
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; pod: Pod | null; bulk?: boolean }>({ open: false, pod: null });
  const [portForwardDialog, setPortForwardDialog] = useState<{ open: boolean; pod: Pod | null }>({ open: false, pod: null });
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [listView, setListView] = useState<ListView>('flat');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedPods, setSelectedPods] = useState<Set<string>>(new Set());
  const [showTableFilters, setShowTableFilters] = useState(false);

  // Pagination State
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  const { isConnected } = useConnectionStatus();
  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<PodResource>('pods', undefined, { limit: 10000 });
  const deleteResource = useDeleteK8sResource('pods');
  const createResource = useCreateK8sResource('pods');
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;

  const fullPods: Pod[] = useMemo(() => {
    return isConnected && data ? (data.items ?? []).map(transformResource) : [];
  }, [data, isConnected]);

  const namespaceList = useMemo(() => {
    return Array.from(new Set(fullPods.map(p => p.namespace))).sort();
  }, [fullPods]);

  // Calculate resource max values from pod spec (for sparklines)
  const podResourceMaxMap = useMemo(() => {
    const m: Record<string, { cpuMax?: number; memoryMax?: number }> = {};
    if (data?.items) {
      data.items.forEach((podResource) => {
        const key = `${podResource.metadata.namespace}/${podResource.metadata.name}`;
        const containers = podResource.spec?.containers || [];
        const cpuMax = calculatePodResourceMax(containers, 'cpu'); // millicores
        const memoryMax = calculatePodResourceMax(containers, 'memory'); // bytes
        if (cpuMax !== undefined || memoryMax !== undefined) {
          m[key] = { cpuMax, memoryMax };
        }
      });
    }
    return m;
  }, [data?.items]);

  const currentFilteredPods = useMemo(() => {
    return fullPods.filter((pod) => {
      const matchesSearch =
        pod.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pod.status.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pod.node.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pod.internalIP.includes(searchQuery);
      const matchesNs = selectedNamespaces.size === 0 || selectedNamespaces.has(pod.namespace);
      return matchesSearch && matchesNs;
    });
  }, [fullPods, searchQuery, selectedNamespaces]);

  const stats = useMemo(() => ({
    total: fullPods.length,
    running: fullPods.filter((p) => p.status === 'Running').length,
    pending: fullPods.filter((p) => p.status === 'Pending').length,
    failed: fullPods.filter((p) => p.status === 'Failed' || p.status === 'CrashLoopBackOff').length,
  }), [fullPods]);

  // Use raw data for initial filter/sort to avoid expensive metrics merging on every render
  const filteredUnsorted = useMemo(() => {
    return currentFilteredPods;
  }, [currentFilteredPods]);

  // CPU/Memory sort: fetch metrics for first N pods so the sorted order is correct when user sorts by CPU/Memory.
  const SORT_METRICS_BATCH = 20;
  const podsForSortMetrics = useMemo(
    () => filteredUnsorted.slice(0, SORT_METRICS_BATCH),
    [filteredUnsorted]
  );
  const sortMetricsQueries = useQueries({
    queries: podsForSortMetrics.map((pod) => ({
      queryKey: ['pod-metrics-sort', clusterId, pod.namespace, pod.name],
      queryFn: () => getPodMetrics(backendBaseUrl, clusterId!, pod.namespace, pod.name),
      enabled: !!(isBackendConfigured() && clusterId && podsForSortMetrics.length > 0),
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

  // Calculate pagination
  const totalFiltered = filteredPods.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = filteredPods.slice(start, start + pageSize);

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
      enabled: !!(isBackendConfigured() && clusterId),
      staleTime: 60_000,
      refetchInterval: 60_000,
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

  const togglePodSelection = (pod: Pod) => {
    const key = `${pod.namespace}/${pod.name}`;
    const newSel = new Set(selectedPods);
    if (newSel.has(key)) newSel.delete(key); else newSel.add(key);
    setSelectedPods(newSel);
  };

  const toggleAllSelection = () => {
    if (selectedPods.size === filteredPods.length && filteredPods.length > 0) {
      setSelectedPods(new Set());
    } else {
      setSelectedPods(new Set(filteredPods.map(p => `${p.namespace}/${p.name}`)));
    }
  };

  const isAllSelected = filteredPods.length > 0 && selectedPods.size === filteredPods.length;
  const isSomeSelected = selectedPods.size > 0 && selectedPods.size < filteredPods.length;

  const handleViewLogs = (pod: Pod) => {
    const url = getPodLogsUrl(backendBaseUrl, clusterId!, pod.namespace, pod.name, { follow: true });
    // TODO: Use internal log viewer
    window.open(url, '_blank');
  };

  const handleExecShell = (pod: Pod) => {
    // Open in separate window or terminal drawer
    console.log('Exec shell for', pod.name);
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

  const handleBulkRestart = () => {
    toast.info(`Restarting ${selectedPods.size} pods...`);
    setSelectedPods(new Set());
  };

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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <ListPageHeader
        icon={<Box className="h-6 w-6 text-primary" />}
        title="Pods"
        resourceCount={filteredPods.length}
        subtitle={selectedNamespaces.size > 0 ? `in ${selectedNamespaces.size} namespaces` : 'across all namespaces'}
        demoMode={!isConnected}
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
                  <Button variant="outline" size="sm" className="gap-2">
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
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelectedPods(new Set())}>Clear</Button>
          </div>
        ) : undefined}
      />

      {/* Stats Cards — quick filters for Status column */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ListPageStatCard
          label="Total Pods"
          value={stats.total}
          icon={Box}
          iconColor="text-primary"
          selected={!columnFilters.status?.size}
          onClick={() => setColumnFilter('status', null)}
          className={cn(!columnFilters.status?.size && 'ring-2 ring-primary')}
        />
        <ListPageStatCard
          label="Running"
          value={stats.running}
          icon={CheckCircle2}
          iconColor="text-[hsl(142,76%,36%)]"
          valueClassName="text-[hsl(142,76%,36%)]"
          selected={columnFilters.status?.size === 1 && columnFilters.status.has('Running')}
          onClick={() => setColumnFilter('status', new Set(['Running']))}
          className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Running') && 'ring-2 ring-[hsl(142,76%,36%)]')}
        />
        <ListPageStatCard
          label="Pending"
          value={stats.pending}
          icon={Clock}
          iconColor="text-[hsl(45,93%,47%)]"
          valueClassName="text-[hsl(45,93%,47%)]"
          selected={columnFilters.status?.size === 1 && columnFilters.status.has('Pending')}
          onClick={() => setColumnFilter('status', new Set(['Pending']))}
          className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Pending') && 'ring-2 ring-[hsl(45,93%,47%)]')}
        />
        <ListPageStatCard
          label="Failed"
          value={stats.failed}
          icon={XCircle}
          iconColor="text-[hsl(0,72%,51%)]"
          valueClassName="text-[hsl(0,72%,51%)]"
          selected={columnFilters.status?.size !== undefined && columnFilters.status?.size > 0 && ['Failed', 'CrashLoopBackOff'].every((s) => columnFilters.status?.has(s)) && columnFilters.status.size === 2}
          onClick={() => setColumnFilter('status', new Set(['Failed', 'CrashLoopBackOff']))}
          className={cn(columnFilters.status?.size === 2 && columnFilters.status?.has('Failed') && columnFilters.status?.has('CrashLoopBackOff') && 'ring-2 ring-[hsl(0,72%,51%)]')}
        />
      </div>

      <ResourceListTableToolbar
        globalFilterBar={
          <ResourceCommandBar
            scope={
              <NamespaceFilter
                namespaces={namespaceList}
                selected={selectedNamespaces}
                onSelectionChange={setSelectedNamespaces}
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
                {filteredPods.length} pods
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
        onClearAllFilters={clearAllFilters}
        columns={PODS_COLUMNS_FOR_VISIBILITY}
        visibleColumns={columnVisibility.visibleColumns}
        onColumnToggle={columnVisibility.setColumnVisible}
        tableContainerProps={keyboardNav.tableContainerProps}
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
        <ResizableTableProvider tableId="pods" columnConfig={PODS_TABLE_COLUMNS}>
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
              {isLoading && isConnected ? (
                <TableSkeletonRows columnCount={visibleColumnCount} />
              ) : itemsToRender.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColumnCount} className="h-40 text-center">
                    <TableEmptyState
                      icon={<Box className="h-8 w-8" />}
                      title="No Pods found"
                      subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Get started by creating a Pod.'}
                      hasActiveFilters={!!(searchQuery || hasActiveFilters)}
                      onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
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
                    <motion.tr
                      key={podKey}
                      initial={false}
                      className={cn(
                        resourceTableRowClassName,
                        isSelected && 'bg-primary/5'
                      )}
                    >
                      <TableCell className="w-10">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => togglePodSelection(pod)}
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
                                <span className="truncate">{pod.name}</span>
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
                          <Badge variant="outline" className="font-normal truncate max-w-full inline-block">
                            {pod.namespace}
                          </Badge>
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
                            pod.restarts > 5 && 'text-[hsl(0,72%,51%)]',
                            pod.restarts > 0 && pod.restarts <= 5 && 'text-[hsl(45,93%,47%)]'
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
                          <div className="min-w-0 overflow-hidden">
                            <UsageBar
                              variant="sparkline"
                              value={cpuVal}
                              kind="cpu"
                              displayFormat="compact"
                              width={56}
                              max={podResourceMaxMap[podKey]?.cpuMax}
                            />
                          </div>
                        </ResizableTableCell>
                      )}
                      {columnVisibility.isColumnVisible('memory') && (
                        <ResizableTableCell columnId="memory">
                          <div className="min-w-0 overflow-hidden">
                            <UsageBar
                              variant="sparkline"
                              value={memVal}
                              kind="memory"
                              displayFormat="compact"
                              width={56}
                              max={podResourceMaxMap[podKey]?.memoryMax}
                            />
                          </div>
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
                              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                              aria-label="Pod actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <CopyNameDropdownItem name={pod.name} namespace={pod.namespace} />
                            <DropdownMenuItem onClick={() => navigate(`/pods/${pod.namespace}/${pod.name}`)} className="gap-2">
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleViewLogs(pod)} className="gap-2">
                              <FileText className="h-4 w-4" />
                              View Logs
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleExecShell(pod)} className="gap-2">
                              <Terminal className="h-4 w-4" />
                              Exec Shell
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setPortForwardDialog({ open: true, pod })} className="gap-2">
                              <ExternalLink className="h-4 w-4" />
                              Port Forward
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleDownloadYaml(pod)} className="gap-2">
                              <Download className="h-4 w-4" />
                              Download YAML
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDownloadJson(pod)} className="gap-2">
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
                    </motion.tr>
                  );
                })
              )}
            </TableBody>
          </Table>
        </ResizableTableProvider>
      </ResourceListTableToolbar>

      {/* Create Pod */}
      {
        showCreateWizard && (
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
            clusterName="docker-desktop"
          />
        )
      }

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, pod: open ? deleteDialog.pod : null })}
        resourceType="Pod"
        resourceName={deleteDialog.bulk ? `${selectedPods.size} pods` : (deleteDialog.pod?.name || '')}
        namespace={deleteDialog.bulk ? undefined : deleteDialog.pod?.namespace}
        onConfirm={handleDelete}
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full h-full max-w-[min(96vw,1680px)] max-h-[95vh] flex flex-col bg-background border rounded-xl shadow-2xl overflow-hidden relative"
            >
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-4 top-4 z-50"
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div >
  );
}
