import { useState, useMemo, useEffect } from 'react';
import { useQueries } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Server, Search, MoreHorizontal, Loader2, Layers, Lock, Unlock, List, ChevronDown, ChevronRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { DeleteConfirmDialog, UsageBar } from '@/components/resources';
import { StatusPill, type StatusPillVariant } from '@/components/list';
import { Badge } from '@/components/ui/badge';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { usePaginatedResourceList, useDeleteK8sResource, useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getNodeMetrics } from '@/services/backendApiClient';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ResourceCommandBar,
  ClusterScopedScope,
  ResourceExportDropdown,
  ListPagination,
  ListPageStatCard,
  ListPageHeader,
  ListViewSegmentedControl,
  TableColumnHeaderWithFilterAndSort,
  TableFilterCell,
  resourceTableRowClassName,
  ROW_MOTION,
  PAGE_SIZE_OPTIONS,
  AgeCell,
  TableEmptyState,
  TableSkeletonRows,
  CopyNameDropdownItem,
  ResourceListTableToolbar,
  VirtualTableBody,
} from '@/components/list';
import { NodeIcon } from '@/components/icons/KubernetesIcons';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';

interface NodeResource extends KubernetesResource {
  spec?: {
    unschedulable?: boolean;
    taints?: Array<{ key: string; value?: string; effect: string }>;
  };
  status?: {
    conditions?: Array<{ type: string; status: string }>;
    nodeInfo?: { kubeletVersion: string; operatingSystem?: string; architecture?: string };
    allocatable?: { pods: string; cpu: string; memory: string };
    capacity?: { pods: string; cpu: string; memory: string };
  };
}

type ListView = 'flat' | 'byRole';

interface Node {
  name: string;
  status: string;
  roles: string[];
  version: string;
  cpuUsage: number | null;
  memoryUsage: number | null;
  /** Raw usage from metrics (e.g. "250m", "512Mi") for UsageBar display. */
  cpuRaw: string;
  memoryRaw: string;
  pods: string;
  age: string;
  creationTimestamp?: string;
  cpuCapacity: string;
  memoryCapacity: string;
  conditions: string[];
  taintsCount: number;
  osArch: string;
  /** Labels as searchable string (key=value ...). */
  labelsString: string;
}

const nodeStatusVariant: Record<string, StatusPillVariant> = {
  Ready: 'success',
  NotReady: 'error',
  SchedulingDisabled: 'warning',
};

/** Parse CPU capacity string to millicores (e.g. "8" -> 8000, "8000m" -> 8000). */
function parseCpuCapacityToMilli(s: string): number | null {
  if (!s || s === '-') return null;
  const t = s.trim();
  if (t.endsWith('m')) {
    const n = parseFloat(t.slice(0, -1));
    return Number.isFinite(n) ? n : null;
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n * 1000 : null;
}

/** Parse memory capacity string to Mi (e.g. "32Gi" -> 32768, "16384Ki" -> 16). */
function parseMemoryCapacityToMi(s: string): number | null {
  if (!s || s === '-') return null;
  const t = s.trim();
  if (t.endsWith('Ki')) {
    const n = parseFloat(t.slice(0, -2));
    return Number.isFinite(n) ? n / 1024 : null;
  }
  if (t.endsWith('Mi')) {
    const n = parseFloat(t.slice(0, -2));
    return Number.isFinite(n) ? n : null;
  }
  if (t.endsWith('Gi')) {
    const n = parseFloat(t.slice(0, -2));
    return Number.isFinite(n) ? n * 1024 : null;
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/** Parse usage CPU string to millicores (e.g. "250.00m" -> 250). */
function parseCpuUsageToMilli(s: string): number | null {
  if (!s || s === '-') return null;
  const t = s.trim();
  if (t.endsWith('m')) {
    const n = parseFloat(t.slice(0, -1));
    return Number.isFinite(n) ? n : null;
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n * 1000 : null;
}

/** Parse usage memory string to Mi (e.g. "1024.50Mi" -> 1024.5). */
function parseMemoryUsageToMi(s: string): number | null {
  if (!s || s === '-') return null;
  const t = s.trim();
  if (t.endsWith('Ki')) {
    const n = parseFloat(t.slice(0, -2));
    return Number.isFinite(n) ? n / 1024 : null;
  }
  if (t.endsWith('Mi')) {
    const n = parseFloat(t.slice(0, -2));
    return Number.isFinite(n) ? n : null;
  }
  if (t.endsWith('Gi')) {
    const n = parseFloat(t.slice(0, -2));
    return Number.isFinite(n) ? n * 1024 : null;
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function transformNodeResource(resource: NodeResource): Node {
  const labels = resource.metadata.labels || {};
  const roles = Object.keys(labels)
    .filter(k => k.startsWith('node-role.kubernetes.io/'))
    .map(k => k.replace('node-role.kubernetes.io/', ''));

  if (roles.length === 0) roles.push('worker');

  const readyCondition = resource.status?.conditions?.find(c => c.type === 'Ready');
  const isReady = readyCondition?.status === 'True';
  const isSchedulable = !resource.spec?.unschedulable;

  let status = 'NotReady';
  if (isReady && isSchedulable) status = 'Ready';
  else if (isReady && !isSchedulable) status = 'SchedulingDisabled';

  const conditions = (resource.status?.conditions || [])
    .filter(c => c.status === 'True' || (c.type === 'Ready' && c.status === 'False'))
    .map(c => c.type);

  const podsCap = resource.status?.allocatable?.pods || '0';
  const taintsCount = resource.spec?.taints?.length ?? 0;
  const ni = resource.status?.nodeInfo;
  const osArch = [ni?.operatingSystem ?? '', ni?.architecture ?? ''].filter(Boolean).join(' / ') || '–';
  const labelsString = Object.entries(resource.metadata?.labels ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');

  return {
    name: resource.metadata.name,
    status,
    roles,
    version: resource.status?.nodeInfo?.kubeletVersion || '-',
    cpuUsage: null,
    memoryUsage: null,
    cpuRaw: '-',
    memoryRaw: '-',
    pods: `–/${podsCap}`,
    age: calculateAge(resource.metadata.creationTimestamp),
    creationTimestamp: resource.metadata?.creationTimestamp,
    cpuCapacity: resource.status?.capacity?.cpu || resource.status?.allocatable?.cpu || '-',
    memoryCapacity: resource.status?.capacity?.memory || resource.status?.allocatable?.memory || '-',
    conditions,
    taintsCount,
    osArch,
    labelsString,
  };
}

const NODES_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'name', defaultWidth: 180, minWidth: 100 },
  { id: 'status', defaultWidth: 110, minWidth: 80 },
  { id: 'roles', defaultWidth: 140, minWidth: 90 },
  { id: 'conditions', defaultWidth: 120, minWidth: 80 },
  { id: 'cpu', defaultWidth: 100, minWidth: 70 },
  { id: 'memory', defaultWidth: 100, minWidth: 70 },
  { id: 'pods', defaultWidth: 80, minWidth: 50 },
  { id: 'version', defaultWidth: 100, minWidth: 70 },
  { id: 'osArch', defaultWidth: 120, minWidth: 80 },
  { id: 'taints', defaultWidth: 70, minWidth: 50 },
  { id: 'age', defaultWidth: 90, minWidth: 56 },
];

const NODES_COLUMNS_FOR_VISIBILITY = [
  { id: 'status', label: 'Status' },
  { id: 'roles', label: 'Roles' },
  { id: 'conditions', label: 'Conditions' },
  { id: 'cpu', label: 'CPU' },
  { id: 'memory', label: 'Memory' },
  { id: 'pods', label: 'Pods' },
  { id: 'version', label: 'Version' },
  { id: 'osArch', label: 'OS / Arch' },
  { id: 'taints', label: 'Taints' },
  { id: 'age', label: 'Age' },
];

export default function Nodes() {
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const clusterId = currentClusterId ?? null;

  const { data, refetch, isLoading, pagination: hookPagination } = usePaginatedResourceList<NodeResource>('nodes');
  const deleteResource = useDeleteK8sResource('nodes');

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: Node | null; bulk?: boolean }>({ open: false, item: null });
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const [listView, setListView] = useState<ListView>('flat');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const allItems = (data?.allItems ?? []) as NodeResource[];
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const nodes: Node[] = useMemo(() => (isConnected ? allItems.map(transformNodeResource) : []), [isConnected, allItems]);

  const podsListQuery = useK8sResourceList<KubernetesResource & { spec?: { nodeName?: string } }>('pods', undefined, { limit: 5000, enabled: isConnected });
  const podCountByNode = useMemo(() => {
    const items = podsListQuery.data?.items ?? [];
    const map: Record<string, number> = {};
    for (const p of items) {
      const nodeName = p.spec?.nodeName;
      if (nodeName) map[nodeName] = (map[nodeName] ?? 0) + 1;
    }
    return map;
  }, [podsListQuery.data?.items]);

  const nodesWithPodCount: Node[] = useMemo(() => {
    return nodes.map((n) => {
      const cap = n.pods.split('/')[1] ?? '0';
      const count = podCountByNode[n.name] ?? 0;
      return { ...n, pods: `${count}/${cap}` };
    });
  }, [nodes, podCountByNode]);

  const nodesToFetch = useMemo(() => nodesWithPodCount.slice(0, 40), [nodesWithPodCount]);
  const nodeMetricsQueries = useQueries({
    queries: nodesToFetch.map((node) => ({
      queryKey: ['node-metrics', clusterId, node.name],
      queryFn: () => getNodeMetrics(backendBaseUrl, clusterId!, node.name),
      enabled: !!(isBackendConfigured() && clusterId),
      staleTime: 30_000,
      refetchInterval: 30_000,
    })),
  });
  const nodeMetricsMap = useMemo(() => {
    const m: Record<string, { cpu: string; memory: string }> = {};
    nodeMetricsQueries.forEach((q, i) => {
      if (q.data && nodesToFetch[i]) {
        const d = q.data as { CPU?: string; Memory?: string };
        m[nodesToFetch[i].name] = { cpu: d.CPU ?? '-', memory: d.Memory ?? '-' };
      }
    });
    return m;
  }, [nodeMetricsQueries, nodesToFetch]);

  const nodesWithMetrics = useMemo(() => {
    return nodesWithPodCount.map((n) => {
      const metrics = nodeMetricsMap[n.name];
      const cpuRaw = metrics?.cpu ?? '-';
      const memoryRaw = metrics?.memory ?? '-';
      if (!metrics || (metrics.cpu === '-' && metrics.memory === '-')) return { ...n, cpuRaw, memoryRaw };
      const cpuCapMilli = parseCpuCapacityToMilli(n.cpuCapacity);
      const memCapMi = parseMemoryCapacityToMi(n.memoryCapacity);
      const cpuUsageMilli = parseCpuUsageToMilli(metrics.cpu);
      const memUsageMi = parseMemoryUsageToMi(metrics.memory);
      const cpuUsage = cpuCapMilli != null && cpuCapMilli > 0 && cpuUsageMilli != null ? Math.min(100, (cpuUsageMilli / cpuCapMilli) * 100) : null;
      const memoryUsage = memCapMi != null && memCapMi > 0 && memUsageMi != null ? Math.min(100, (memUsageMi / memCapMi) * 100) : null;
      return { ...n, cpuUsage: cpuUsage ?? n.cpuUsage, memoryUsage: memoryUsage ?? n.memoryUsage, cpuRaw, memoryRaw };
    });
  }, [nodesWithPodCount, nodeMetricsMap]);

  const tableConfig: ColumnConfig<Node>[] = useMemo(() => [
    { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
    { columnId: 'status', getValue: (i) => i.status, sortable: true, filterable: true },
    { columnId: 'roles', getValue: (i) => i.roles.join(','), sortable: true, filterable: true },
    { columnId: 'roleType', getValue: (i) => (i.roles.some((r) => r === 'control-plane' || r === 'master') ? 'control-plane' : 'worker'), sortable: false, filterable: true },
    {
      columnId: 'cpu',
      getValue: (i) => (i.cpuUsage != null ? String(i.cpuUsage) : ''),
      sortable: true,
      filterable: false,
      compare: (a, b) => (a.cpuUsage ?? -1) - (b.cpuUsage ?? -1),
    },
    {
      columnId: 'memory',
      getValue: (i) => (i.memoryUsage != null ? String(i.memoryUsage) : ''),
      sortable: true,
      filterable: false,
      compare: (a, b) => (a.memoryUsage ?? -1) - (b.memoryUsage ?? -1),
    },
    { columnId: 'pods', getValue: (i) => i.pods, sortable: true, filterable: false },
    { columnId: 'conditions', getValue: (i) => i.conditions.join(', '), sortable: true, filterable: false },
    { columnId: 'version', getValue: (i) => i.version, sortable: true, filterable: true },
    { columnId: 'osArch', getValue: (i) => i.osArch, sortable: true, filterable: false },
    { columnId: 'taints', getValue: (i) => String(i.taintsCount), sortable: true, filterable: false, compare: (a, b) => a.taintsCount - b.taintsCount },
    { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
  ], []);

  const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(nodesWithMetrics, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
  const columnVisibility = useColumnVisibility({ tableId: 'nodes', columns: NODES_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

  const searchFiltered = useMemo(() => {
    if (!searchQuery.trim()) return filteredItems;
    const q = searchQuery.toLowerCase();
    return filteredItems.filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.roles.some((r) => r.toLowerCase().includes(q)) ||
        n.version.toLowerCase().includes(q) ||
        (n.labelsString && n.labelsString.toLowerCase().includes(q))
    );
  }, [filteredItems, searchQuery]);

  const stats = useMemo(() => {
    const total = nodesWithMetrics.length;
    const ready = nodesWithMetrics.filter((n) => n.status === 'Ready').length;
    const notReady = nodesWithMetrics.filter((n) => n.status === 'NotReady').length;
    const controlPlane = nodesWithMetrics.filter((n) => n.roles.some((r) => r === 'control-plane' || r === 'master')).length;
    const unschedulable = nodesWithMetrics.filter((n) => n.status === 'SchedulingDisabled').length;
    return { total, ready, notReady, controlPlane, unschedulable };
  }, [nodesWithMetrics]);

  type NodeListItem = { type: 'node'; data: Node } | { type: 'header'; label: string; count: number; groupKey: string; isCollapsed: boolean };

  const itemsToRender = useMemo<NodeListItem[]>(() => {
    if (listView === 'flat') {
      return searchFiltered.map(n => ({ type: 'node', data: n }));
    }

    const groupByKey = (item: Node) => (item.roles.some((r) => r === 'control-plane' || r === 'master') ? 'control-plane' : 'worker');
    const map = new Map<string, Node[]>();
    for (const item of searchFiltered) {
      const k = groupByKey(item);
      const list = map.get(k) ?? [];
      list.push(item);
      map.set(k, list);
    }

    const order = ['control-plane', 'worker'];
    const result: NodeListItem[] = [];

    for (const k of order) {
      if (!map.has(k)) continue;
      const nodes = map.get(k)!;
      const groupKey = `byRole:${k}`;
      const isCollapsed = collapsedGroups.has(groupKey);
      result.push({
        type: 'header',
        label: k === 'control-plane' ? 'Control Plane' : 'Worker',
        count: nodes.length,
        groupKey,
        isCollapsed
      });
      if (!isCollapsed) {
        result.push(...nodes.map(n => ({ type: 'node', data: n } as NodeListItem)));
      }
    }
    return result;
  }, [searchFiltered, listView, collapsedGroups]);

  const toggleStatFilter = (columnId: 'status' | 'roleType', value: string) => {
    const current = columnFilters[columnId];
    if (current?.size === 1 && current.has(value)) {
      setColumnFilter(columnId, null);
    } else {
      setColumnFilter(columnId, new Set([value]));
    }
  };

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const handleDelete = async () => {
    if (deleteDialog.bulk && selectedNodes.size > 0) {
      if (isConnected) {
        for (const nodeName of selectedNodes) {
          await deleteResource.mutateAsync({ name: nodeName });
        }
        setSelectedNodes(new Set());
      }
      setDeleteDialog({ open: false, item: null });
      refetch();
    } else if (deleteDialog.item) {
      if (isConnected) {
        await deleteResource.mutateAsync({ name: deleteDialog.item.name });
        setDeleteDialog({ open: false, item: null });
        refetch();
      } else {
        toast.info('Connect cluster to delete resources');
      }
    }
  };

  const toggleNodeSelection = (node: Node) => {
    const next = new Set(selectedNodes);
    if (next.has(node.name)) next.delete(node.name);
    else next.add(node.name);
    setSelectedNodes(next);
  };

  const toggleAllNodesSelection = () => {
    const keys = searchFiltered.map((n) => n.name);
    const allSelected = keys.length > 0 && keys.every((k) => selectedNodes.has(k));
    if (allSelected) {
      const next = new Set(selectedNodes);
      keys.forEach((k) => next.delete(k));
      setSelectedNodes(next);
    } else {
      const next = new Set(selectedNodes);
      keys.forEach((k) => next.add(k));
      setSelectedNodes(next);
    }
  };

  const handleCordon = (item: Node) => {
    toast.info(item.status === 'SchedulingDisabled' ? `Uncordon ${item.name} (not implemented)` : `Cordon ${item.name} (not implemented)`);
  };

  const handleDrain = (item: Node) => {
    toast.info(`Drain ${item.name} (not implemented)`);
  };

  const exportConfig = {
    filenamePrefix: 'nodes',
    resourceLabel: 'Nodes',
    getExportData: (n: Node) => ({ name: n.name, status: n.status, roles: n.roles.join(', '), version: n.version, cpuUsage: n.cpuUsage != null ? n.cpuUsage : '–', memoryUsage: n.memoryUsage != null ? n.memoryUsage : '–', pods: n.pods, age: n.age, cpuCapacity: n.cpuCapacity, memoryCapacity: n.memoryCapacity, conditions: n.conditions.join(', '), taintsCount: n.taintsCount, osArch: n.osArch }),
    csvColumns: [
      { label: 'Name', getValue: (n: Node) => n.name },
      { label: 'Status', getValue: (n: Node) => n.status },
      { label: 'Roles', getValue: (n: Node) => n.roles.join(', ') },
      { label: 'Version', getValue: (n: Node) => n.version },
      { label: 'CPU %', getValue: (n: Node) => (n.cpuUsage != null ? String(Math.round(n.cpuUsage)) : '–') },
      { label: 'Memory %', getValue: (n: Node) => (n.memoryUsage != null ? String(Math.round(n.memoryUsage)) : '–') },
      { label: 'Pods', getValue: (n: Node) => n.pods },
      { label: 'Age', getValue: (n: Node) => n.age },
    ],
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <ListPageHeader
          icon={<NodeIcon className="h-6 w-6 text-primary" />}
          title="Nodes"
          resourceCount={filteredItems.length}
          subtitle="Cluster-scoped"
          demoMode={!isConnected}
          isLoading={isLoading}
          onRefresh={() => refetch()}
          actions={
            <>
              {selectedNodes.size > 0 && (
                <>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => {
                    const names = Array.from(selectedNodes).join(', ');
                    toast.info(`Cordon ${selectedNodes.size} node(s): ${names}`);
                  }}>
                    <Lock className="h-4 w-4" />Cordon ({selectedNodes.size})
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => {
                    const names = Array.from(selectedNodes).join(', ');
                    toast.info(`Uncordon ${selectedNodes.size} node(s): ${names}`);
                  }}>
                    <Unlock className="h-4 w-4" />Uncordon ({selectedNodes.size})
                  </Button>
                  <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
                    Delete {selectedNodes.size} selected
                  </Button>
                </>
              )}
              <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedNodes} getKey={(n) => n.name} config={exportConfig} selectionLabel={selectedNodes.size > 0 ? `${selectedNodes.size} selected` : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
            </>
          }
        />

        <div className={cn('grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4', !isConnected && 'opacity-60')}>
          <ListPageStatCard
            label="Total Nodes"
            value={stats.total}
            icon={Server}
            iconColor="text-primary"
            selected={!hasActiveFilters}
            onClick={clearAllFilters}
            className={cn(!hasActiveFilters && 'ring-2 ring-primary')}
          />
          <ListPageStatCard
            label="Ready"
            value={stats.ready}
            icon={Layers}
            iconColor="text-[hsl(142,76%,36%)]"
            valueClassName="text-[hsl(142,76%,36%)]"
            selected={columnFilters.status?.size === 1 && columnFilters.status.has('Ready')}
            onClick={() => toggleStatFilter('status', 'Ready')}
            className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Ready') && 'ring-2 ring-[hsl(142,76%,36%)]')}
          />
          <ListPageStatCard
            label="Not Ready"
            value={stats.notReady}
            icon={Layers}
            iconColor="text-[hsl(0,72%,51%)]"
            valueClassName="text-[hsl(0,72%,51%)]"
            selected={columnFilters.status?.size === 1 && columnFilters.status.has('NotReady')}
            onClick={() => toggleStatFilter('status', 'NotReady')}
            className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('NotReady') && 'ring-2 ring-[hsl(0,72%,51%)]')}
          />
          <ListPageStatCard
            label="Control Plane"
            value={stats.controlPlane}
            icon={Layers}
            iconColor="text-muted-foreground"
            selected={columnFilters.roleType?.size === 1 && columnFilters.roleType.has('control-plane')}
            onClick={() => toggleStatFilter('roleType', 'control-plane')}
            className={cn(columnFilters.roleType?.size === 1 && columnFilters.roleType.has('control-plane') && 'ring-2 ring-primary')}
          />
          <ListPageStatCard
            label="Unschedulable"
            value={stats.unschedulable}
            icon={Layers}
            iconColor="text-[hsl(45,93%,47%)]"
            valueClassName="text-[hsl(45,93%,47%)]"
            selected={columnFilters.status?.size === 1 && columnFilters.status.has('SchedulingDisabled')}
            onClick={() => toggleStatFilter('status', 'SchedulingDisabled')}
            className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('SchedulingDisabled') && 'ring-2 ring-[hsl(45,93%,47%)]')}
          />
        </div>

        <ResourceListTableToolbar
          globalFilterBar={
            <ResourceCommandBar
              scope={<ClusterScopedScope />}
              search={
                <div className="relative w-full min-w-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search by name or labels..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search nodes" />
                </div>
              }
              structure={
                <ListViewSegmentedControl
                  value={listView}
                  onChange={(v) => setListView(v as ListView)}
                  options={[
                    { id: 'flat', label: 'Flat', icon: List },
                    { id: 'byRole', label: 'By Role', icon: Layers },
                  ]}
                  label=""
                  ariaLabel="List structure"
                />
              }
            />
          }
          hasActiveFilters={hasActiveFilters}
          onClearAllFilters={clearAllFilters}
          showTableFilters={showTableFilters}
          onToggleTableFilters={() => setShowTableFilters((v) => !v)}
          columns={NODES_COLUMNS_FOR_VISIBILITY}
          visibleColumns={columnVisibility.visibleColumns}
          onColumnToggle={columnVisibility.setColumnVisible}
          footer={
            <div className="flex items-center justify-between flex-wrap gap-2 text-sm text-muted-foreground px-1">
              <span>Showing {searchFiltered.length} nodes</span>
            </div>
          }
        >
          <ResizableTableProvider tableId="nodes" columnConfig={NODES_TABLE_COLUMNS}>
            <div className="rounded-md border relative flex flex-col h-[calc(100vh-220px)] overflow-hidden">
              <div className="overflow-auto flex-1 relative" ref={tableContainerRef}>
                <Table className="table-fixed" style={{ minWidth: 1100 }}>
                  <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
                    <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
                      <TableHead className="w-12 px-2 text-center">
                        <Checkbox
                          checked={searchFiltered.length > 0 && searchFiltered.every((n) => selectedNodes.has(n.name))}
                          onCheckedChange={toggleAllNodesSelection}
                          aria-label="Select all nodes"
                        />
                      </TableHead>
                      <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                      <ResizableTableHead columnId="status"><TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                      <ResizableTableHead columnId="roles"><TableColumnHeaderWithFilterAndSort columnId="roles" label="Roles" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                      <ResizableTableHead columnId="conditions"><TableColumnHeaderWithFilterAndSort columnId="conditions" label="Conditions" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                      <ResizableTableHead columnId="cpu"><TableColumnHeaderWithFilterAndSort columnId="cpu" label="CPU" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                      <ResizableTableHead columnId="memory"><TableColumnHeaderWithFilterAndSort columnId="memory" label="Memory" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                      <ResizableTableHead columnId="pods"><TableColumnHeaderWithFilterAndSort columnId="pods" label="Pods" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                      <ResizableTableHead columnId="version"><TableColumnHeaderWithFilterAndSort columnId="version" label="Version" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                      <ResizableTableHead columnId="osArch"><TableColumnHeaderWithFilterAndSort columnId="osArch" label="OS / Arch" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                      <ResizableTableHead columnId="taints"><TableColumnHeaderWithFilterAndSort columnId="taints" label="Taints" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                      <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                      <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
                    </TableRow>
                    {showTableFilters && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
                        <TableCell className="w-12 p-1.5" />
                        <ResizableTableCell columnId="name" className="p-1.5" />
                        <ResizableTableCell columnId="status" className="p-1.5"><TableFilterCell columnId="status" label="Status" distinctValues={distinctValuesByColumn.status ?? []} selectedFilterValues={columnFilters.status ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.status} /></ResizableTableCell>
                        <ResizableTableCell columnId="roles" className="p-1.5"><TableFilterCell columnId="roles" label="Roles" distinctValues={distinctValuesByColumn.roles ?? []} selectedFilterValues={columnFilters.roles ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.roles} /></ResizableTableCell>
                        <ResizableTableCell columnId="conditions" className="p-1.5" />
                        <ResizableTableCell columnId="cpu" className="p-1.5" />
                        <ResizableTableCell columnId="memory" className="p-1.5" />
                        <ResizableTableCell columnId="pods" className="p-1.5" />
                        <ResizableTableCell columnId="version" className="p-1.5"><TableFilterCell columnId="version" label="Version" distinctValues={distinctValuesByColumn.version ?? []} selectedFilterValues={columnFilters.version ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.version} /></ResizableTableCell>
                        <ResizableTableCell columnId="osArch" className="p-1.5" />
                        <ResizableTableCell columnId="taints" className="p-1.5" />
                        <ResizableTableCell columnId="age" className="p-1.5" />
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
                        return (
                          <TableRow key={item.groupKey} className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-b border-border/60" onClick={() => toggleGroup(item.groupKey)}>
                            <TableCell colSpan={13} className="py-2">
                              <div className="flex items-center gap-2 font-medium">
                                {item.isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                                {item.label}
                                <span className="text-muted-foreground font-normal">({item.count})</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }

                      const node = item.data;
                      const isSelected = selectedNodes.has(node.name);

                      return (
                        <motion.tr
                          key={node.name}
                          initial={false}
                          className={cn(resourceTableRowClassName, isSelected && 'bg-primary/5')}
                        >
                          <TableCell className="w-12 px-2 text-center">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleNodeSelection(node)}
                              aria-label={`Select ${node.name}`}
                            />
                          </TableCell>
                          <ResizableTableCell columnId="name">
                            <Link to={`/nodes/${node.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
                              <Server className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              <span className="truncate">{node.name}</span>
                            </Link>
                          </ResizableTableCell>
                          <ResizableTableCell columnId="status"><StatusPill label={node.status} variant={nodeStatusVariant[node.status] || 'error'} /></ResizableTableCell>
                          <ResizableTableCell columnId="roles">
                            <div className="flex flex-wrap gap-1">
                              {node.roles.map((role) => <Badge key={role} variant="outline" className="text-xs">{role}</Badge>)}
                            </div>
                          </ResizableTableCell>
                          <ResizableTableCell columnId="conditions">
                            <div className="flex flex-wrap gap-1">
                              {node.conditions.slice(0, 2).map((cond) => <Badge key={cond} variant={cond === 'Ready' ? 'default' : 'destructive'} className="text-xs">{cond}</Badge>)}
                              {node.conditions.length > 2 && <Badge variant="outline" className="text-xs">+{node.conditions.length - 2}</Badge>}
                            </div>
                          </ResizableTableCell>
                          <ResizableTableCell columnId="cpu">
                            <div className="min-w-0 overflow-hidden">
                              <UsageBar
                                variant="sparkline"
                                value={node.cpuRaw}
                                kind="cpu"
                                displayFormat="compact"
                                width={56}
                                max={parseCpuCapacityToMilli(node.cpuCapacity) ?? undefined}
                              />
                            </div>
                          </ResizableTableCell>
                          <ResizableTableCell columnId="memory">
                            <div className="min-w-0 overflow-hidden">
                              <UsageBar
                                variant="sparkline"
                                value={node.memoryRaw}
                                kind="memory"
                                displayFormat="compact"
                                width={56}
                                max={parseMemoryCapacityToMi(node.memoryCapacity) ?? undefined}
                              />
                            </div>
                          </ResizableTableCell>
                          <ResizableTableCell columnId="pods" className="font-mono text-sm">{node.pods}</ResizableTableCell>
                          <ResizableTableCell columnId="version"><Badge variant="secondary" className="font-mono text-xs">{node.version}</Badge></ResizableTableCell>
                          <ResizableTableCell columnId="osArch" className="text-sm text-muted-foreground">{node.osArch}</ResizableTableCell>
                          <ResizableTableCell columnId="taints">{node.taintsCount > 0 ? <Badge variant="outline">{node.taintsCount}</Badge> : '–'}</ResizableTableCell>
                          <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={node.age} timestamp={node.creationTimestamp} /></ResizableTableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="Node actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52">
                                <CopyNameDropdownItem name={node.name} />
                                <DropdownMenuItem onClick={() => navigate(`/nodes/${node.name}`)} className="gap-2">View Details</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => navigate(`/pods?node=${encodeURIComponent(node.name)}`)} className="gap-2">View Pods on Node</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleCordon(node)} className="gap-2">Cordon</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleCordon(node)} className="gap-2">Uncordon</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleDrain(node)} className="gap-2">Drain</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => navigate(`/nodes/${node.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteDialog({ open: true, item: node })} disabled={!isConnected}>Delete</DropdownMenuItem>
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
      </motion.div>

      <DeleteConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null, bulk: open ? deleteDialog.bulk : false })}
        resourceType={deleteDialog.bulk ? 'nodes' : 'Node'}
        resourceName={deleteDialog.bulk ? `${selectedNodes.size} selected` : (deleteDialog.item?.name || '')}
        onConfirm={handleDelete}
        requireNameConfirmation={!deleteDialog.bulk}
      />
    </>
  );
}
