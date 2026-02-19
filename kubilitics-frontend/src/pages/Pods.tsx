import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  Filter,
  RefreshCw,
  MoreHorizontal,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Download,
  Box,
  Loader2,
  WifiOff,
  Plus,
  Terminal,
  FileText,
  ExternalLink,
  Trash2,
  RotateCcw,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GitCompare,
  CheckSquare,
  Square,
  Minus,
  List,
  Layers,
  Boxes,
  FileSpreadsheet,
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
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { useK8sResourceList, useDeleteK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useClusterStore } from '@/stores/clusterStore';
import { getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { getPodMetrics } from '@/services/backendApiClient';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DeleteConfirmDialog, PortForwardDialog, UsageBar, PodComparisonView, calculatePodResourceMax } from '@/components/resources';
import { useRef } from 'react';
import { NamespaceFilter, ResourceCommandBar, StatusPill, resourceTableRowClassName, ROW_MOTION, ListPagination, ListViewSegmentedControl, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, AgeCell, TableEmptyState, TableSkeletonRows, CopyNameDropdownItem, NamespaceBadge, ResourceListTableToolbar, VirtualTableBody, type StatusPillVariant } from '@/components/list';
import { PodIcon } from '@/components/icons/KubernetesIcons';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useTableKeyboardNav } from '@/hooks/useTableKeyboardNav';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { toast } from 'sonner';
import { Progress } from '@/components/ui/progress';

interface PodResource extends KubernetesResource {
  spec: {
    nodeName?: string;
    hostNetwork?: boolean;
    containers: Array<{
      name: string;
      image: string;
      ports?: Array<{ containerPort: number; name?: string; protocol?: string }>;
      resources?: {
        requests?: { cpu?: string; memory?: string };
        limits?: { cpu?: string; memory?: string };
      };
    }>;
  };
  status: {
    phase: string;
    podIP?: string;
    podIPs?: Array<{ ip?: string }>;
    hostIP?: string;
    containerStatuses?: Array<{
      name: string;
      ready: boolean;
      restartCount: number;
    }>;
  };
}

interface Pod {
  name: string;
  namespace: string;
  status: 'Running' | 'Pending' | 'Failed' | 'Succeeded' | 'CrashLoopBackOff';
  ready: string;
  restarts: number;
  age: string;
  creationTimestamp?: string;
  node: string;
  /** Internal pod IP (podIP / podIPs). */
  internalIP: string;
  /** External IP: hostIP when hostNetwork, else "-". */
  externalIP: string;
  cpu: string;
  memory: string;
  containers: Array<{ name: string; ports?: Array<{ containerPort: number; name?: string; protocol?: string }> }>;
  cpuData?: number[];
  memoryData?: number[];
}

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

const PODS_COLUMNS_FOR_VISIBILITY = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'status', label: 'Status' },
  { id: 'ready', label: 'Ready' },
  { id: 'restarts', label: 'Restarts' },
  { id: 'ip', label: 'IP' },
  { id: 'cpu', label: 'CPU' },
  { id: 'memory', label: 'Memory' },
  { id: 'age', label: 'Age' },
  { id: 'node', label: 'Node' },
];

const PODS_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'name', defaultWidth: 260, minWidth: 120 },
  { id: 'namespace', defaultWidth: 140, minWidth: 80 },
  { id: 'status', defaultWidth: 120, minWidth: 82 },
  { id: 'ready', defaultWidth: 88, minWidth: 76 },
  { id: 'restarts', defaultWidth: 100, minWidth: 88 },
  { id: 'ip', defaultWidth: 200, minWidth: 140 },
  { id: 'cpu', defaultWidth: 110, minWidth: 70 },
  { id: 'memory', defaultWidth: 120, minWidth: 78 },
  { id: 'age', defaultWidth: 90, minWidth: 56 },
  { id: 'node', defaultWidth: 160, minWidth: 90 },
];

const statusConfig = {
  Running: { icon: CheckCircle2, color: 'text-[hsl(142,76%,36%)]', bg: 'bg-[hsl(142,76%,36%)]/10' },
  Pending: { icon: Clock, color: 'text-[hsl(45,93%,47%)]', bg: 'bg-[hsl(45,93%,47%)]/10' },
  Failed: { icon: XCircle, color: 'text-[hsl(0,72%,51%)]', bg: 'bg-[hsl(0,72%,51%)]/10' },
  Succeeded: { icon: CheckCircle2, color: 'text-muted-foreground', bg: 'bg-muted' },
  CrashLoopBackOff: { icon: AlertTriangle, color: 'text-[hsl(0,72%,51%)]', bg: 'bg-[hsl(0,72%,51%)]/10' },
};

const statusToPillVariant: Record<Pod['status'], StatusPillVariant> = {
  Running: 'success',
  Pending: 'warning',
  Failed: 'error',
  Succeeded: 'neutral',
  CrashLoopBackOff: 'error',
};

/** Parse "1/1" or "0/2" to percentage for ready progress bar. */
function parseReadyFraction(ready: string): number {
  const m = ready.match(/^(\d+)\/(\d+)$/);
  if (!m) return 100;
  const num = parseInt(m[1], 10);
  const den = parseInt(m[2], 10);
  return den > 0 ? Math.round((num / den) * 100) : 0;
}

function transformPodResource(resource: PodResource): Pod {
  const containerStatuses = resource.status?.containerStatuses || [];
  const readyCount = containerStatuses.filter(c => c.ready).length;
  const totalCount = resource.spec?.containers?.length || containerStatuses.length || 1;
  const restarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount || 0), 0);

  let status: Pod['status'] = 'Running';
  const phase = resource.status?.phase;
  if (phase === 'Pending') status = 'Pending';
  else if (phase === 'Failed') status = 'Failed';
  else if (phase === 'Succeeded') status = 'Succeeded';
  else if (containerStatuses.some(c => !c.ready && (c as any).state?.waiting?.reason === 'CrashLoopBackOff')) {
    status = 'CrashLoopBackOff';
  }

  const internalIP = resource.status?.podIPs?.[0]?.ip ?? resource.status?.podIP ?? '-';
  const externalIP =
    resource.spec?.hostNetwork && resource.status?.hostIP
      ? resource.status.hostIP
      : '-';

  return {
    name: resource.metadata.name,
    namespace: resource.metadata.namespace || 'default',
    status,
    ready: `${readyCount}/${totalCount}`,
    restarts,
    age: calculateAge(resource.metadata.creationTimestamp),
    creationTimestamp: resource.metadata?.creationTimestamp,
    node: resource.spec?.nodeName || '-',
    internalIP,
    externalIP,
    cpu: '-',
    memory: '-',
    containers: resource.spec?.containers || [],
  };
}

/** Parse CPU string to millicores for sorting (e.g. "200m" -> 200, "0.01" cores -> 10, "-" -> -1). */
function parseCpuForSort(value: string): number {
  if (!value || value === '-') return -1;
  const s = value.trim();
  const last = s.slice(-1).toLowerCase();
  if (last === 'm') {
    const n = parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? n : -1;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n * 1000 : -1;
}

/** Parse memory string to Mi for sorting (e.g. "256Mi" -> 256, "-" -> -1). */
function parseMemoryForSort(value: string): number {
  if (!value || value === '-') return -1;
  const s = value.trim();
  if (s.endsWith('Ki')) {
    const n = parseFloat(s.slice(0, -2));
    return Number.isFinite(n) ? n / 1024 : -1;
  }
  if (s.endsWith('Mi')) {
    const n = parseFloat(s.slice(0, -2));
    return Number.isFinite(n) ? n : -1;
  }
  if (s.endsWith('Gi')) {
    const n = parseFloat(s.slice(0, -2));
    return Number.isFinite(n) ? n * 1024 : -1;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : -1;
}

type ListView = 'flat' | 'byNamespace' | 'byNode';

export default function Pods() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const namespaceFromUrl = searchParams.get('namespace');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespaces, setSelectedNamespaces] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (namespaceFromUrl) setSelectedNamespaces(new Set([namespaceFromUrl]));
  }, [namespaceFromUrl]);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; pod: Pod | null; bulk?: boolean }>({ open: false, pod: null });
  const [portForwardDialog, setPortForwardDialog] = useState<{ open: boolean; pod: Pod | null }>({ open: false, pod: null });
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [selectedPods, setSelectedPods] = useState<Set<string>>(new Set());
  const [showComparison, setShowComparison] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const [listView, setListView] = useState<ListView>('flat');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showTableFilters, setShowTableFilters] = useState(false);

  const { isConnected } = useConnectionStatus();
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  // P0-D: Use currentClusterId only for backend API paths.
  const clusterId = currentClusterId ?? null;

  // Single full-list fetch (limit 5000 when backend); pagination is frontend-only
  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<PodResource>('pods', undefined, {
    enabled: isConnected,
    refetchInterval: 30000,
    limit: 5000,
  });
  const deletePod = useDeleteK8sResource('pods');

  // Full list of pods (all loaded); stats and pagination derived from this
  const fullPods: Pod[] = isConnected && data?.items
    ? data.items.map(transformPodResource)
    : [];

  // Stats from full list so top counter matches footer total
  const stats = useMemo(() => ({
    total: fullPods.length,
    running: fullPods.filter(p => p.status === 'Running').length,
    pending: fullPods.filter(p => p.status === 'Pending').length,
    failed: fullPods.filter(p => p.status === 'Failed' || p.status === 'CrashLoopBackOff').length,
  }), [fullPods]);

  const namespaceList = useMemo(() => Array.from(new Set(fullPods.map((p) => p.namespace))), [fullPods]);

  // Filter by search and namespace only; column filters and sort are handled by useTableFiltersAndSort
  const filteredUnsorted = useMemo(() => {
    return fullPods.filter((pod) => {
      const matchesSearch = pod.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pod.namespace.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesNamespace = selectedNamespaces.size === 0 || selectedNamespaces.has(pod.namespace);
      return matchesSearch && matchesNamespace;
    });
  }, [fullPods, searchQuery, selectedNamespaces]);

  // CPU/Memory sort: fetch metrics for first N pods so the sorted order is correct when user sorts by CPU/Memory.
  const SORT_METRICS_BATCH = 80;
  const podsForSortMetrics = useMemo(
    () => filteredUnsorted.slice(0, SORT_METRICS_BATCH),
    [filteredUnsorted]
  );
  const sortMetricsQueries = useQueries({
    queries: podsForSortMetrics.map((pod) => ({
      queryKey: ['pod-metrics-sort', clusterId, pod.namespace, pod.name],
      queryFn: () => getPodMetrics(backendBaseUrl, clusterId!, pod.namespace, pod.name),
      enabled: !!(isBackendConfigured() && clusterId && podsForSortMetrics.length > 0),
      staleTime: 30_000,
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
  const getCpuForSort = (p: Pod) => sortMetricsMap[podKey(p)]?.cpu ?? p.cpu;
  const getMemoryForSort = (p: Pod) => sortMetricsMap[podKey(p)]?.memory ?? p.memory;

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
        getValue: (p) => getCpuForSort(p),
        sortable: true,
        filterable: false,
        compare: (a, b) => parseCpuForSort(getCpuForSort(a)) - parseCpuForSort(getCpuForSort(b)),
      },
      {
        columnId: 'memory',
        getValue: (p) => getMemoryForSort(p),
        sortable: true,
        filterable: false,
        compare: (a, b) => parseMemoryForSort(getMemoryForSort(a)) - parseMemoryForSort(getMemoryForSort(b)),
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

  // Calculate stats for filtered list (Virtualization uses full list)
  const totalFiltered = filteredPods.length;

  // Virtual Table Ref
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Grouping Logic for Virtualization
  // We need to flatten the list if grouping is active
  type PodListItem = { type: 'pod'; data: Pod } | { type: 'header'; label: string; count: number; groupKey: string; isCollapsed: boolean };

  const itemsToRender = useMemo<PodListItem[]>(() => {
    if (listView === 'flat') {
      return filteredPods.map(p => ({ type: 'pod', data: p }));
    }

    const isByNs = listView === 'byNamespace';
    const map = new Map<string, Pod[]>();
    for (const pod of filteredPods) {
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
  }, [filteredPods, listView, collapsedGroups]);

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  // Pod metrics fetch logic needs to know which items are visible?
  // With virtualization, we can fetch for ALL potentially visible items or stick to batch fetching.
  // For now, let's keep the existing logic but target the first N items of the virtual list or refactor later.
  // Actually, existing logic used `itemsOnPage.slice(0, 40)`.
  // We can just take the first 40 of `itemsToRender` that are pods.
  const visiblePodsForMetrics = useMemo(() => {
    return itemsToRender
      .filter(i => i.type === 'pod')
      .slice(0, 40)
      .map(i => (i as { data: Pod }).data);
  }, [itemsToRender]);

  const metricsQueries = useQueries({
    queries: visiblePodsForMetrics.map((pod) => ({
      queryKey: ['pod-metrics', clusterId, pod.namespace, pod.name],
      queryFn: () => getPodMetrics(backendBaseUrl, clusterId!, pod.namespace, pod.name),
      enabled: !!(isBackendConfigured() && clusterId),
      staleTime: 30_000,
      refetchInterval: 30_000,
    })),
  });

  const metricsMap = useMemo(() => {
    const m: Record<string, { cpu: string; memory: string }> = {};
    metricsQueries.forEach((q, i) => {
      if (q.data && visiblePodsForMetrics[i]) {
        const key = `${visiblePodsForMetrics[i].namespace}/${visiblePodsForMetrics[i].name}`;
        const d = q.data as { CPU?: string; Memory?: string; cpu?: string; memory?: string };
        m[key] = {
          cpu: d.CPU ?? d.cpu ?? '-',
          memory: d.Memory ?? d.memory ?? '-',
        };
      }
    });
    return m;
  }, [metricsQueries, visiblePodsForMetrics]);

  // Calculate resource max values from pod container limits/requests
  const podResourceMaxMap = useMemo(() => {
    const m: Record<string, { cpuMax?: number; memoryMax?: number }> = {};
    if (data?.items) {
      data.items.forEach((podResource) => {
        const key = `${podResource.metadata.namespace}/${podResource.metadata.name}`;
        const containers = podResource.spec?.containers || [];
        const cpuMax = calculatePodResourceMax(containers, 'cpu');
        const memoryMax = calculatePodResourceMax(containers, 'memory');
        if (cpuMax !== undefined || memoryMax !== undefined) {
          m[key] = { cpuMax, memoryMax };
        }
      });
    }
    return m;
  }, [data?.items]);


  const handleDelete = async () => {
    if (deleteDialog.bulk && selectedPods.size > 0) {
      // Bulk delete
      if (isConnected) {
        for (const podKey of selectedPods) {
          const [namespace, name] = podKey.split('/');
          await deletePod.mutateAsync({ name, namespace });
        }
      } else {
        toast.success(`Deleted ${selectedPods.size} pods (demo mode)`);
      }
      setSelectedPods(new Set());
    } else if (deleteDialog.pod) {
      // Single delete
      if (isConnected) {
        await deletePod.mutateAsync({
          name: deleteDialog.pod.name,
          namespace: deleteDialog.pod.namespace,
        });
      } else {
        toast.success(`Pod ${deleteDialog.pod.name} deleted (demo mode)`);
      }
    }
    setDeleteDialog({ open: false, pod: null });
  };

  const handleViewLogs = (pod: Pod) => {
    navigate(`/pods/${pod.namespace}/${pod.name}?tab=logs`);
  };

  const handleExecShell = (pod: Pod) => {
    navigate(`/pods/${pod.namespace}/${pod.name}?tab=terminal`);
  };

  const handleDownloadYaml = (pod: Pod) => {
    const yaml = `apiVersion: v1
kind: Pod
metadata:
  name: ${pod.name}
  namespace: ${pod.namespace}
spec:
  containers:
${pod.containers.map(c => `  - name: ${c.name}
    image: nginx:latest`).join('\n')}
`;
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pod.name}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('YAML downloaded');
  };

  const handleExportAll = () => {
    const podsToExport = selectedPods.size > 0
      ? filteredPods.filter(p => selectedPods.has(`${p.namespace}/${p.name}`))
      : filteredPods;
    const exportData = podsToExport.map(p => ({
      name: p.name,
      namespace: p.namespace,
      status: p.status,
      ready: p.ready,
      restarts: p.restarts,
      age: p.age,
      node: p.node,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pods-export.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${podsToExport.length} pods`);
  };

  const yamlValue = (v: string | number): string => {
    if (typeof v === 'number') return String(v);
    const s = String(v);
    const needsQuotes = s === '' || s.includes('\n') || s.includes(':') || s.includes('#') || /^[\s\-[\]{}&*!|>'%@`]/.test(s);
    if (!needsQuotes) return s;
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  };

  const handleExportAsYaml = () => {
    const podsToExport = selectedPods.size > 0
      ? filteredPods.filter(p => selectedPods.has(`${p.namespace}/${p.name}`))
      : filteredPods;
    if (podsToExport.length === 0) {
      toast.info('No pods to export');
      return;
    }
    const exportData = podsToExport.map(p => ({
      name: p.name,
      namespace: p.namespace,
      status: p.status,
      ready: p.ready,
      restarts: p.restarts,
      age: p.age,
      node: p.node,
    }));
    const lines: string[] = [];
    for (const obj of exportData) {
      const entries = Object.entries(obj);
      lines.push(`- ${entries[0][0]}: ${yamlValue(entries[0][1])}`);
      for (let i = 1; i < entries.length; i++) {
        lines.push(`  ${entries[i][0]}: ${yamlValue(entries[i][1])}`);
      }
    }
    const yaml = lines.join('\n');
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pods-export.yaml';
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${podsToExport.length} pods as YAML`);
  };

  const escapeCsvCell = (value: string | number): string => {
    const s = String(value);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const handleBulkExportCsv = () => {
    const podsToExport = selectedPods.size > 0
      ? filteredPods.filter(p => selectedPods.has(`${p.namespace}/${p.name}`))
      : filteredPods;
    if (podsToExport.length === 0) {
      toast.info('No pods to export');
      return;
    }
    const prefix = activeCluster?.name ? `${activeCluster.name.replace(/[^a-zA-Z0-9_-]/g, '-')}-` : '';
    const headers = ['S.No', 'Name', 'Namespace', 'Status', 'Ready', 'Restarts', 'Internal IP', 'External IP', 'CPU', 'Memory', 'Age', 'Node'];
    const rows = podsToExport.map((p, i) => [
      escapeCsvCell(i + 1),
      escapeCsvCell(p.name),
      escapeCsvCell(p.namespace),
      escapeCsvCell(p.status),
      escapeCsvCell(p.ready),
      escapeCsvCell(p.restarts),
      escapeCsvCell(p.internalIP),
      escapeCsvCell(p.externalIP),
      escapeCsvCell(p.cpu),
      escapeCsvCell(p.memory),
      escapeCsvCell(p.age),
      escapeCsvCell(p.node),
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${prefix}pods-export.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${podsToExport.length} pods as CSV`);
  };

  // Bulk actions
  const togglePodSelection = (pod: Pod) => {
    const key = `${pod.namespace}/${pod.name}`;
    const newSelection = new Set(selectedPods);
    if (newSelection.has(key)) {
      newSelection.delete(key);
    } else {
      newSelection.add(key);
    }
    setSelectedPods(newSelection);
  };

  const toggleAllSelection = () => {
    const keys = filteredPods.map((p) => `${p.namespace}/${p.name}`);
    const allSelected = keys.every((k) => selectedPods.has(k));
    if (allSelected) {
      const next = new Set(selectedPods);
      keys.forEach((k) => next.delete(k));
      setSelectedPods(next);
    } else {
      const next = new Set(selectedPods);
      keys.forEach((k) => next.add(k));
      setSelectedPods(next);
    }
  };

  const handleBulkRestart = () => {
    if (selectedPods.size === 0) return;
    toast.success(`Restarted ${selectedPods.size} pods (demo mode)`);
    setSelectedPods(new Set());
  };

  const handleBulkExportYaml = () => {
    const podsToExport = selectedPods.size > 0
      ? filteredPods.filter(p => selectedPods.has(`${p.namespace}/${p.name}`))
      : filteredPods;
    if (podsToExport.length === 0) {
      toast.info('No pods to export');
      return;
    }
    const yamls = podsToExport.map(pod => `---
apiVersion: v1
kind: Pod
metadata:
  name: ${pod.name}
  namespace: ${pod.namespace}
spec:
  containers:
${pod.containers.map(c => `  - name: ${c.name}
    image: nginx:latest`).join('\n')}
`).join('\n');
    const blob = new Blob([yamls], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pods-bulk.yaml';
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${podsToExport.length} pod YAMLs`);
  };

  const isAllSelected = filteredPods.length > 0 && filteredPods.every((p) => selectedPods.has(`${p.namespace}/${p.name}`));
  const isSomeSelected = filteredPods.some((p) => selectedPods.has(`${p.namespace}/${p.name}`)) && !isAllSelected;

  const keyboardNav = useTableKeyboardNav({
    rowCount: itemsToRender.length,
    onOpenRow: (index) => {
      const item = itemsToRender[index];
      if (item.type === 'pod') {
        const pod = item.data;
        navigate(`/pods/${pod.namespace}/${pod.name}`);
      } else {
        toggleGroup(item.groupKey);
      }
    },
    getRowKeyAt: (index) => {
      const item = itemsToRender[index];
      return item.type === 'pod'
        ? `${item.data.namespace}/${item.data.name}`
        : item.groupKey;
    },
    selectedKeys: selectedPods,
    onToggleSelect: (key) => {
      // Only pods are selectable for now
      const item = itemsToRender.find((i) => i.type === 'pod' && `${i.data.namespace}/${i.data.name}` === key);
      if (item && item.type === 'pod') togglePodSelection(item.data);
    },
    enabled: itemsToRender.length > 0,
  });



  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      <ListPageHeader
        icon={<PodIcon className="h-6 w-6 text-primary" />}
        title="Pods"
        resourceCount={filteredPods.length}
        subtitle={namespaceList.length > 0 ? `across ${namespaceList.length} namespaces` : undefined}
        demoMode={!isConnected}
        isLoading={isLoading}
        onRefresh={() => refetch()}
        createLabel="Create Pod"
        onCreate={() => setShowCreateWizard(true)}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Download className="h-4 w-4" />
                  {selectedPods.size > 0 ? `Export (${selectedPods.size})` : 'Export'}
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="text-muted-foreground font-normal text-xs">
                  {selectedPods.size > 0 ? 'Selected pods' : 'All visible pods'}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleExportAll} className="gap-2 cursor-pointer">
                  <Download className="h-4 w-4 shrink-0" />
                  Export as JSON — for reports or automation
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportAsYaml} className="gap-2 cursor-pointer">
                  <FileText className="h-4 w-4 shrink-0" />
                  Export as YAML — for reports or automation
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleBulkExportCsv} className="gap-2 cursor-pointer">
                  <FileSpreadsheet className="h-4 w-4 shrink-0" />
                  Export as CSV — for spreadsheets
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleBulkExportYaml} className="gap-2 cursor-pointer">
                  <FileText className="h-4 w-4 shrink-0" />
                  Download as YAML — Kubernetes manifests
                </DropdownMenuItem>
                {selectedPods.size > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleBulkRestart} className="gap-2 cursor-pointer">
                      <RotateCcw className="h-4 w-4" />
                      Restart selected
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
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
            <span className="text-sm text-muted-foreground">{itemsToRender.length > 0 ? `Showing ${itemsToRender.filter(i => i.type === 'pod').length} pods` : 'No pods'}</span>
          </div>
        }
      >
        <ResizableTableProvider tableId="pods" columnConfig={PODS_TABLE_COLUMNS}>
          <div className="rounded-md border relative flex flex-col h-[calc(100vh-220px)] overflow-hidden">
            <div className="overflow-auto flex-1 relative" ref={tableContainerRef}>
              <Table className="table-fixed">
                <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
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
                <VirtualTableBody
                  data={itemsToRender}
                  tableContainerRef={tableContainerRef}
                  rowHeight={48}
                  renderRow={(item) => {
                    if (item.type === 'header') {
                      const groupLabel = listView === 'byNamespace' ? `Namespace: ${item.label}` : `Node: ${item.label}`;
                      return (
                        <TableRow
                          key={item.groupKey}
                          className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-b border-border/60 transition-all duration-200"
                          onClick={() => toggleGroup(item.groupKey)}
                        >
                          <TableCell colSpan={12} className="py-2">
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
                  }}
                />
              </Table>
            </div>
          </div>
        </ResizableTableProvider>
      </ResourceListTableToolbar>

      {/* Create Pod */}
      {
        showCreateWizard && (
          <ResourceCreator
            resourceKind="Pod"
            defaultYaml={DEFAULT_YAMLS.Pod}
            onClose={() => setShowCreateWizard(false)}
            onApply={(yaml) => {
              console.log('Creating Pod with YAML:', yaml);
              toast.success('Pod created successfully (demo mode)');
              setShowCreateWizard(false);
              refetch();
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

      {/* Pod Comparison View */}
      <PodComparisonView
        open={showComparison}
        onClose={() => setShowComparison(false)}
        availablePods={filteredPods.map(p => ({ name: p.name, namespace: p.namespace, status: p.status }))}
        clusterId={clusterId ?? undefined}
        backendBaseUrl={backendBaseUrl ?? ''}
        isConnected={isConnected}
      />
    </motion.div >
  );
}
