import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Filter, RefreshCw, MoreHorizontal, CheckCircle2, XCircle, Clock, Loader2, WifiOff, Plus,
  ChevronDown, ChevronRight, CheckSquare, Trash2, RotateCcw, Scale, History, Database, FileText, List, Layers, HardDrive, Box,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ResizableTableProvider, ResizableTableHead, ResizableTableCell, type ResizableColumnConfig } from '@/components/ui/resizable-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { useK8sResourceList, useDeleteK8sResource, usePatchK8sResource, useCreateK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog, ScaleDialog, RolloutActionsDialog, UsageBar, parseCpu, parseMemory, calculatePodResourceMax } from '@/components/resources';
import { ResourceExportDropdown, ListViewSegmentedControl, ListPagination, PAGE_SIZE_OPTIONS, ResourceCommandBar, resourceTableRowClassName, ROW_MOTION, StatusPill, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, AgeCell, TableEmptyState, TableSkeletonRows, NamespaceBadge, ResourceListTableToolbar } from '@/components/list';
import type { StatusPillVariant } from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useWorkloadMetricsMap } from '@/hooks/useWorkloadMetricsMap';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { toast } from 'sonner';
import { Progress } from '@/components/ui/progress';
import { StatefulSetIcon } from '@/components/icons/KubernetesIcons';

interface StatefulSetResource extends KubernetesResource {
  spec: {
    replicas?: number;
    serviceName?: string;
    updateStrategy?: { type?: string; rollingUpdate?: { partition?: number } };
    volumeClaimTemplates?: Array<{ metadata?: { name?: string } }>;
    template?: {
      spec?: {
        containers?: Array<{
          name: string;
          image: string;
          resources?: {
            requests?: { cpu?: string; memory?: string };
            limits?: { cpu?: string; memory?: string };
          };
        }>
      }
    };
  };
  status: { replicas?: number; readyReplicas?: number; currentReplicas?: number; updatedReplicas?: number };
}

interface StatefulSet {
  name: string;
  namespace: string;
  status: 'Healthy' | 'Progressing' | 'Degraded';
  ready: string;
  serviceName: string;
  age: string;
  creationTimestamp?: string;
  replicas: number;
  updateStrategy: string;
  partition: number;
  pvcCount: number;
  cpu: string;
  memory: string;
}

const statusConfig = {
  Healthy: { icon: CheckCircle2, color: 'text-[hsl(142,76%,36%)]', bg: 'bg-[hsl(142,76%,36%)]/10' },
  Progressing: { icon: Clock, color: 'text-[hsl(45,93%,47%)]', bg: 'bg-[hsl(45,93%,47%)]/10' },
  Degraded: { icon: XCircle, color: 'text-[hsl(0,72%,51%)]', bg: 'bg-[hsl(0,72%,51%)]/10' },
};

const STATEFULSETS_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'name', defaultWidth: 200, minWidth: 120 },
  { id: 'namespace', defaultWidth: 140, minWidth: 100 },
  { id: 'status', defaultWidth: 120, minWidth: 90 },
  { id: 'ready', defaultWidth: 100, minWidth: 80 },
  { id: 'replicas', defaultWidth: 100, minWidth: 85 },
  { id: 'updateStrategy', defaultWidth: 180, minWidth: 140 },
  { id: 'partition', defaultWidth: 100, minWidth: 80 },
  { id: 'service', defaultWidth: 140, minWidth: 90 },
  { id: 'pvcCount', defaultWidth: 90, minWidth: 75 },
  { id: 'cpu', defaultWidth: 120, minWidth: 85 },
  { id: 'memory', defaultWidth: 130, minWidth: 90 },
  { id: 'age', defaultWidth: 100, minWidth: 65 },
];

const STATEFULSETS_COLUMNS_FOR_VISIBILITY = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'status', label: 'Status' },
  { id: 'ready', label: 'Ready' },
  { id: 'replicas', label: 'Replicas' },
  { id: 'updateStrategy', label: 'Update Strategy' },
  { id: 'partition', label: 'Partition' },
  { id: 'service', label: 'Service' },
  { id: 'pvcCount', label: 'PVCs' },
  { id: 'cpu', label: 'CPU' },
  { id: 'memory', label: 'Memory' },
  { id: 'age', label: 'Age' },
];

const statefulSetStatusToVariant: Record<StatefulSet['status'], StatusPillVariant> = {
  Healthy: 'success',
  Progressing: 'warning',
  Degraded: 'error',
};

function parseReadyFraction(ready: string): number {
  const m = ready.match(/^(\d+)\/(\d+)$/);
  if (!m) return 100;
  const num = parseInt(m[1], 10);
  const den = parseInt(m[2], 10);
  return den > 0 ? Math.round((num / den) * 100) : 0;
}

function transformResource(resource: StatefulSetResource): StatefulSet {
  const desired = resource.spec?.replicas ?? 0;
  const ready = resource.status?.readyReplicas ?? 0;
  let status: StatefulSet['status'] = 'Healthy';
  if (ready === 0 && desired > 0) status = 'Degraded';
  else if (ready < desired) status = 'Progressing';
  const vct = resource.spec?.volumeClaimTemplates ?? [];
  const pvcCount = vct.length * Math.max(desired, 0);
  const updateStrategy = resource.spec?.updateStrategy?.type ?? 'RollingUpdate';
  const partition = resource.spec?.updateStrategy?.rollingUpdate?.partition ?? 0;
  return {
    name: resource.metadata.name,
    namespace: resource.metadata.namespace || 'default',
    status,
    ready: `${ready}/${desired}`,
    serviceName: resource.spec?.serviceName || '-',
    age: calculateAge(resource.metadata.creationTimestamp),
    creationTimestamp: resource.metadata?.creationTimestamp,
    replicas: desired,
    updateStrategy,
    partition,
    pvcCount,
    cpu: '-',
    memory: '-',
  };
}

type ListView = 'flat' | 'byNamespace';

export default function StatefulSets() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: StatefulSet | null; bulk?: boolean }>({ open: false, item: null });
  const [scaleDialog, setScaleDialog] = useState<{ open: boolean; item: StatefulSet | null }>({ open: false, item: null });
  const [rolloutDialog, setRolloutDialog] = useState<{ open: boolean; item: StatefulSet | null }>({ open: false, item: null });
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [listView, setListView] = useState<ListView>('flat');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  const { isConnected } = useConnectionStatus();
  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useK8sResourceList<StatefulSetResource>('statefulsets', undefined, { limit: 5000 });
  const deleteResource = useDeleteK8sResource('statefulsets');
  const patchStatefulSet = usePatchK8sResource('statefulsets');
  const createResource = useCreateK8sResource('statefulsets');

  const rawItems = (data?.items ?? []) as StatefulSetResource[];

  const { data: pvcList } = useK8sResourceList<KubernetesResource & { metadata?: { name?: string; namespace?: string }; status?: { phase?: string }; spec?: Record<string, unknown> }>(
    'persistentvolumeclaims',
    selectedNamespace === 'all' ? undefined : selectedNamespace,
    { limit: 5000, enabled: isConnected }
  );
  const actualPvcCountByKey = useMemo(() => {
    const map = new Map<string, number>();
    const pvcSet = new Set((pvcList?.items ?? []).map((p) => `${p.metadata?.namespace ?? ''}/${p.metadata?.name ?? ''}`));
    for (const r of rawItems) {
      const ns = r.metadata?.namespace ?? 'default';
      const stsName = r.metadata?.name ?? '';
      const vct = r.spec?.volumeClaimTemplates ?? [];
      const replicas = Math.max(0, r.spec?.replicas ?? 0);
      let count = 0;
      for (let i = 0; i < replicas; i++) {
        for (const t of vct) {
          const pvcName = `${t.metadata?.name ?? 'vol'}-${stsName}-${i}`;
          if (pvcSet.has(`${ns}/${pvcName}`)) count++;
        }
      }
      map.set(`${ns}/${stsName}`, count);
    }
    return map;
  }, [rawItems, pvcList?.items]);
  const items: StatefulSet[] = useMemo(() => {
    if (!isConnected || !data) return [];
    return rawItems.map((r) => {
      const t = transformResource(r);
      const key = `${t.namespace}/${t.name}`;
      const actual = actualPvcCountByKey.get(key);
      return actual !== undefined ? { ...t, pvcCount: actual } : t;
    });
  }, [isConnected, data, rawItems, actualPvcCountByKey]);
  const pvcBoundCount = useMemo(() => {
    if (!pvcList?.items?.length) return 0;
    const boundSet = new Set<string>();
    for (const pvc of pvcList.items) {
      const ns = pvc.metadata?.namespace ?? '';
      const name = pvc.metadata?.name ?? '';
      const phase = (pvc.status as { phase?: string })?.phase;
      if (name && phase === 'Bound') boundSet.add(`${ns}/${name}`);
    }
    let bound = 0;
    for (const r of rawItems) {
      const vct = r.spec?.volumeClaimTemplates ?? [];
      const desired = r.spec?.replicas ?? 0;
      const stsName = r.metadata?.name ?? '';
      const ns = r.metadata?.namespace ?? 'default';
      if (selectedNamespace !== 'all' && ns !== selectedNamespace) continue;
      if (vct.length === 0) {
        bound += 1;
        continue;
      }
      let allBound = true;
      for (let i = 0; i < desired; i++) {
        for (const t of vct) {
          const pvcName = `${t.metadata?.name ?? 'vol'}-${stsName}-${i}`;
          if (!boundSet.has(`${ns}/${pvcName}`)) {
            allBound = false;
            break;
          }
        }
        if (!allBound) break;
      }
      if (allBound) bound += 1;
    }
    return bound;
  }, [rawItems, pvcList?.items, selectedNamespace]);

  const stats = useMemo(() => ({
    total: items.length,
    healthy: items.filter(i => i.status === 'Healthy').length,
    progressing: items.filter(i => i.status === 'Progressing').length,
    degraded: items.filter(i => i.status === 'Degraded').length,
    pvcBound: pvcBoundCount,
  }), [items, pvcBoundCount]);
  const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map(i => i.namespace)))], [items]);

  const itemsAfterSearchAndNs = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.namespace.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesNamespace = selectedNamespace === 'all' || item.namespace === selectedNamespace;
      return matchesSearch && matchesNamespace;
    });
  }, [items, searchQuery, selectedNamespace]);

  const statefulSetsTableConfig: ColumnConfig<StatefulSet>[] = useMemo(() => {
    const parseReady = (ready: string): number => {
      const m = ready.match(/^(\d+)\/(\d+)$/);
      if (!m) return -1;
      const den = parseInt(m[2], 10);
      return den > 0 ? parseInt(m[1], 10) / den : -1;
    };
    return [
      { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: true },
      { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
      { columnId: 'status', getValue: (i) => i.status, sortable: true, filterable: true },
      { columnId: 'ready', getValue: (i) => i.ready, sortable: true, filterable: false, compare: (a, b) => parseReady(a.ready) - parseReady(b.ready) },
      { columnId: 'replicas', getValue: (i) => i.replicas, sortable: true, filterable: false },
      { columnId: 'updateStrategy', getValue: (i) => i.updateStrategy, sortable: true, filterable: true },
      { columnId: 'partition', getValue: (i) => i.partition, sortable: true, filterable: false },
      { columnId: 'service', getValue: (i) => i.serviceName, sortable: true, filterable: true },
      { columnId: 'pvcCount', getValue: (i) => i.pvcCount, sortable: true, filterable: false },
      { columnId: 'cpu', getValue: (i) => i.cpu, sortable: true, filterable: false },
      { columnId: 'memory', getValue: (i) => i.memory, sortable: true, filterable: false },
      { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
    ];
  }, []);

  const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterSearchAndNs, { columns: statefulSetsTableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });

  const columnVisibility = useColumnVisibility({
    tableId: 'statefulsets',
    columns: STATEFULSETS_COLUMNS_FOR_VISIBILITY,
    alwaysVisible: ['name'],
  });

  const totalFiltered = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = filteredItems.slice(start, start + pageSize);

  const metricsEntries = useMemo(
    () => itemsOnPage.map((i) => ({ namespace: i.namespace, name: i.name })),
    [itemsOnPage]
  );
  const { metricsMap } = useWorkloadMetricsMap('statefulset', metricsEntries);

  // Calculate resource max values from statefulset pod template container limits/requests
  const statefulsetResourceMaxMap = useMemo(() => {
    const m: Record<string, { cpuMax?: number; memoryMax?: number }> = {};
    if (data?.items) {
      data.items.forEach((ssResource) => {
        const key = `${ssResource.metadata.namespace}/${ssResource.metadata.name}`;
        const containers = ssResource.spec?.template?.spec?.containers || [];
        const cpuMax = calculatePodResourceMax(containers, 'cpu');
        const memoryMax = calculatePodResourceMax(containers, 'memory');
        if (cpuMax !== undefined || memoryMax !== undefined) {
          m[key] = { cpuMax, memoryMax };
        }
      });
    }
    return m;
  }, [data?.items]);

  const groupedOnPage = useMemo(() => {
    if (listView !== 'byNamespace' || itemsOnPage.length === 0) return [];
    const map = new Map<string, StatefulSet[]>();
    for (const item of itemsOnPage) {
      const list = map.get(item.namespace) ?? [];
      list.push(item);
      map.set(item.namespace, list);
    }
    return Array.from(map.entries())
      .map(([label, list]) => ({ groupKey: `ns:${label}`, label, list }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [listView, itemsOnPage]);

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
      : 'No statefulsets',
    hasPrev: safePageIndex > 0,
    hasNext: start + pageSize < totalFiltered,
    onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
    onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
    currentPage: safePageIndex + 1,
    totalPages: Math.max(1, totalPages),
    onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
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
    if (!isConnected) {
      toast.error('Connect cluster to delete statefulsets');
      setDeleteDialog({ open: false, item: null });
      return;
    }
    if (deleteDialog.bulk && selectedItems.size > 0) {
      for (const key of selectedItems) {
        const [ns, n] = key.split('/');
        if (n && ns) await deleteResource.mutateAsync({ name: n, namespace: ns });
      }
      toast.success(`Deleted ${selectedItems.size} statefulset(s)`);
      setSelectedItems(new Set());
    } else if (deleteDialog.item) {
      await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
      toast.success(`StatefulSet ${deleteDialog.item.name} deleted`);
    }
    setDeleteDialog({ open: false, item: null });
  };

  const statefulSetExportConfig = {
    filenamePrefix: 'statefulsets',
    resourceLabel: 'statefulsets',
    getExportData: (s: StatefulSet) => ({ name: s.name, namespace: s.namespace, status: s.status, ready: s.ready, serviceName: s.serviceName, age: s.age, replicas: s.replicas, updateStrategy: s.updateStrategy, partition: s.partition, pvcCount: s.pvcCount, cpu: s.cpu, memory: s.memory }),
    csvColumns: [
      { label: 'Name', getValue: (s: StatefulSet) => s.name },
      { label: 'Namespace', getValue: (s: StatefulSet) => s.namespace },
      { label: 'Status', getValue: (s: StatefulSet) => s.status },
      { label: 'Ready', getValue: (s: StatefulSet) => s.ready },
      { label: 'Replicas', getValue: (s: StatefulSet) => s.replicas },
      { label: 'Update Strategy', getValue: (s: StatefulSet) => s.updateStrategy },
      { label: 'Partition', getValue: (s: StatefulSet) => s.partition },
      { label: 'Service', getValue: (s: StatefulSet) => s.serviceName },
      { label: 'PVC Count', getValue: (s: StatefulSet) => s.pvcCount },
      { label: 'CPU', getValue: (s: StatefulSet) => s.cpu },
      { label: 'Memory', getValue: (s: StatefulSet) => s.memory },
      { label: 'Age', getValue: (s: StatefulSet) => s.age },
    ],
    toK8sYaml: (s: StatefulSet) => `---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ${s.name}
  namespace: ${s.namespace}
spec:
  replicas: ${s.replicas}
  serviceName: ${s.serviceName}
  selector:
    matchLabels: {}
  template:
    metadata:
      labels: {}
    spec:
      containers: []
`,
  };

  const toggleSelection = (item: StatefulSet) => { const key = `${item.namespace}/${item.name}`; const newSel = new Set(selectedItems); if (newSel.has(key)) newSel.delete(key); else newSel.add(key); setSelectedItems(newSel); };
  const toggleAll = () => { if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set()); else setSelectedItems(new Set(itemsOnPage.map(i => `${i.namespace}/${i.name}`))); };
  const handleBulkRestart = () => {
    if (!isConnected) { toast.error('Connect cluster to restart statefulsets'); return; }
    toast.info('Bulk restart: trigger rollout restart for each selected StatefulSet when backend supports it.');
    setSelectedItems(new Set());
  };

  const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
  const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <ListPageHeader
        icon={<StatefulSetIcon className="h-6 w-6 text-primary" />}
        title="StatefulSets"
        resourceCount={filteredItems.length}
        subtitle={namespaces.length > 1 ? `across ${namespaces.length - 1} namespaces` : undefined}
        demoMode={!isConnected}
        isLoading={isLoading}
        onRefresh={() => refetch()}
        createLabel="Create StatefulSet"
        onCreate={() => setShowCreateWizard(true)}
        actions={
          <>
            <ResourceExportDropdown
              items={filteredItems}
              selectedKeys={selectedItems}
              getKey={(i) => `${i.namespace}/${i.name}`}
              config={statefulSetExportConfig}
              selectionLabel={selectedItems.size > 0 ? 'Selected statefulsets' : 'All visible statefulsets'}
              onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
            />
            {selectedItems.size > 0 && (
              <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}><Trash2 className="h-4 w-4" />Delete</Button>
            )}
          </>
        }
        leftExtra={selectedItems.size > 0 ? (
          <div className="flex items-center gap-2 ml-2 pl-2 border-l border-border">
            <span className="text-sm text-muted-foreground">{selectedItems.size} selected</span>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelectedItems(new Set())}>Clear</Button>
          </div>
        ) : undefined}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <ListPageStatCard label="Total" value={stats.total} icon={StatefulSetIcon as any} iconColor="text-primary" selected={!columnFilters.status?.size} onClick={() => setColumnFilter('status', null)} className={cn(!columnFilters.status?.size && 'ring-2 ring-primary')} />
        <ListPageStatCard label="Healthy" value={stats.healthy} icon={CheckCircle2} iconColor="text-[hsl(142,76%,36%)]" valueClassName="text-[hsl(142,76%,36%)]" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Healthy')} onClick={() => setColumnFilter('status', new Set(['Healthy']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Healthy') && 'ring-2 ring-[hsl(142,76%,36%)]')} />
        <ListPageStatCard label="Progressing" value={stats.progressing} icon={Clock} iconColor="text-[hsl(45,93%,47%)]" valueClassName="text-[hsl(45,93%,47%)]" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Progressing')} onClick={() => setColumnFilter('status', new Set(['Progressing']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Progressing') && 'ring-2 ring-[hsl(45,93%,47%)]')} />
        <ListPageStatCard label="Degraded" value={stats.degraded} icon={XCircle} iconColor="text-[hsl(0,72%,51%)]" valueClassName="text-[hsl(0,72%,51%)]" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Degraded')} onClick={() => setColumnFilter('status', new Set(['Degraded']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Degraded') && 'ring-2 ring-[hsl(0,72%,51%)]')} />
        <ListPageStatCard label="PVC Bound" value={selectedNamespace === 'all' ? '—' : stats.pvcBound} icon={HardDrive} iconColor="text-cyan-500" valueClassName="text-cyan-600" />
      </div>

      <ResourceListTableToolbar
        globalFilterBar={
          <ResourceCommandBar
            scope={
              <div className="w-full min-w-0">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full min-w-0 justify-between h-10 gap-2 rounded-lg border border-border bg-background font-medium shadow-sm hover:bg-muted/50 hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary/20">
                      <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{selectedNamespace === 'all' ? 'All Namespaces' : selectedNamespace}</span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
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
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search statefulsets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all"
                  aria-label="Search statefulsets"
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
        columns={STATEFULSETS_COLUMNS_FOR_VISIBILITY}
        visibleColumns={columnVisibility.visibleColumns}
        onColumnToggle={columnVisibility.setColumnVisible}
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
        <ResizableTableProvider tableId="statefulsets" columnConfig={STATEFULSETS_TABLE_COLUMNS}>
          <Table className="table-fixed" style={{ minWidth: 1620 }}>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
                <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
                <ResizableTableHead columnId="name">
                  <TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
                </ResizableTableHead>
                {columnVisibility.isColumnVisible('namespace') && (
                  <ResizableTableHead columnId="namespace">
                    <TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
                  </ResizableTableHead>
                )}
                {columnVisibility.isColumnVisible('status') && (
                  <ResizableTableHead columnId="status">
                    <TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
                  </ResizableTableHead>
                )}
                {columnVisibility.isColumnVisible('ready') && (
                  <ResizableTableHead columnId="ready">
                    <TableColumnHeaderWithFilterAndSort columnId="ready" label="Ready" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
                  </ResizableTableHead>
                )}
                {columnVisibility.isColumnVisible('replicas') && (
                  <ResizableTableHead columnId="replicas">
                    <TableColumnHeaderWithFilterAndSort columnId="replicas" label="Replicas" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
                  </ResizableTableHead>
                )}
                {columnVisibility.isColumnVisible('updateStrategy') && (
                  <ResizableTableHead columnId="updateStrategy">
                    <TableColumnHeaderWithFilterAndSort columnId="updateStrategy" label="Update Strategy" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
                  </ResizableTableHead>
                )}
                {columnVisibility.isColumnVisible('partition') && (
                  <ResizableTableHead columnId="partition">
                    <TableColumnHeaderWithFilterAndSort columnId="partition" label="Partition" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
                  </ResizableTableHead>
                )}
                {columnVisibility.isColumnVisible('service') && (
                  <ResizableTableHead columnId="service">
                    <TableColumnHeaderWithFilterAndSort columnId="service" label="Service" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
                  </ResizableTableHead>
                )}
                {columnVisibility.isColumnVisible('pvcCount') && (
                  <ResizableTableHead columnId="pvcCount">
                    <TableColumnHeaderWithFilterAndSort columnId="pvcCount" label="PVCs" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
                  </ResizableTableHead>
                )}
                {columnVisibility.isColumnVisible('cpu') && (
                  <ResizableTableHead columnId="cpu" title="CPU">
                    <TableColumnHeaderWithFilterAndSort columnId="cpu" label="CPU" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
                  </ResizableTableHead>
                )}
                {columnVisibility.isColumnVisible('memory') && (
                  <ResizableTableHead columnId="memory" title="Memory">
                    <TableColumnHeaderWithFilterAndSort columnId="memory" label="Memory" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
                  </ResizableTableHead>
                )}
                {columnVisibility.isColumnVisible('age') && (
                  <ResizableTableHead columnId="age">
                    <TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} />
                  </ResizableTableHead>
                )}
                <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
              </TableRow>
              {showTableFilters && (
                <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
                  <TableCell className="w-10 p-1.5" />
                  <ResizableTableCell columnId="name" className="p-1.5">
                    <TableFilterCell columnId="name" label="Name" distinctValues={distinctValuesByColumn.name ?? []} selectedFilterValues={columnFilters.name ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.name} />
                  </ResizableTableCell>
                  {columnVisibility.isColumnVisible('namespace') && (
                    <ResizableTableCell columnId="namespace" className="p-1.5">
                      <TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} />
                    </ResizableTableCell>
                  )}
                  {columnVisibility.isColumnVisible('status') && (
                    <ResizableTableCell columnId="status" className="p-1.5">
                      <TableFilterCell columnId="status" label="Status" distinctValues={distinctValuesByColumn.status ?? []} selectedFilterValues={columnFilters.status ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.status} />
                    </ResizableTableCell>
                  )}
                  {columnVisibility.isColumnVisible('ready') && <ResizableTableCell columnId="ready" className="p-1.5" />}
                  {columnVisibility.isColumnVisible('replicas') && <ResizableTableCell columnId="replicas" className="p-1.5" />}
                  {columnVisibility.isColumnVisible('updateStrategy') && (
                    <ResizableTableCell columnId="updateStrategy" className="p-1.5">
                      <TableFilterCell columnId="updateStrategy" label="Update Strategy" distinctValues={distinctValuesByColumn.updateStrategy ?? []} selectedFilterValues={columnFilters.updateStrategy ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.updateStrategy} />
                    </ResizableTableCell>
                  )}
                  {columnVisibility.isColumnVisible('partition') && <ResizableTableCell columnId="partition" className="p-1.5" />}
                  {columnVisibility.isColumnVisible('service') && (
                    <ResizableTableCell columnId="service" className="p-1.5">
                      <TableFilterCell columnId="service" label="Service" distinctValues={distinctValuesByColumn.service ?? []} selectedFilterValues={columnFilters.service ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.service} />
                    </ResizableTableCell>
                  )}
                  {columnVisibility.isColumnVisible('pvcCount') && <ResizableTableCell columnId="pvcCount" className="p-1.5" />}
                  {columnVisibility.isColumnVisible('cpu') && <ResizableTableCell columnId="cpu" className="p-1.5" />}
                  {columnVisibility.isColumnVisible('memory') && <ResizableTableCell columnId="memory" className="p-1.5" />}
                  {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
                  <TableCell className="w-12 p-1.5" />
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {isLoading && isConnected ? (
                <TableSkeletonRows columnCount={15} />
              ) : filteredItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={15} className="h-40 text-center">
                    <TableEmptyState
                      icon={<Database className="h-8 w-8" />}
                      title="No StatefulSets found"
                      subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Get started by creating a StatefulSet for stateful workloads.'}
                      hasActiveFilters={!!(searchQuery || hasActiveFilters)}
                      onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
                      createLabel="Create StatefulSet"
                      onCreate={() => setShowCreateWizard(true)}
                    />
                  </TableCell>
                </TableRow>
              ) : listView === 'flat' ? (
                itemsOnPage.map((item, idx) => {
                  const StatusIcon = statusConfig[item.status]?.icon || Clock;
                  const key = `${item.namespace}/${item.name}`;
                  const isSelected = selectedItems.has(key);
                  const cpuVal = metricsMap[key]?.cpu ?? '-';
                  const memVal = metricsMap[key]?.memory ?? '-';
                  const cpuNum = parseCpu(cpuVal);
                  const memNum = parseMemory(memVal);
                  const cpuDataPoints = cpuNum != null ? Array(12).fill(cpuNum) : undefined;
                  const memDataPoints = memNum != null ? Array(12).fill(memNum) : undefined;
                  return (
                    <motion.tr key={key} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
                      <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(item)} /></TableCell>
                      <ResizableTableCell columnId="name"><Link to={`/statefulsets/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate"><StatefulSetIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="truncate">{item.name}</span></Link></ResizableTableCell>
                      {columnVisibility.isColumnVisible('namespace') && <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} className="font-normal truncate block w-fit max-w-full" /></ResizableTableCell>}
                      {columnVisibility.isColumnVisible('status') && <ResizableTableCell columnId="status"><StatusPill label={item.status} variant={statefulSetStatusToVariant[item.status]} icon={StatusIcon} /></ResizableTableCell>}
                      {columnVisibility.isColumnVisible('ready') && (
                        <ResizableTableCell columnId="ready" className="font-mono text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <Progress value={parseReadyFraction(item.ready)} className="h-1.5 w-10 flex-shrink-0" />
                            <span className="tabular-nums">{item.ready}</span>
                          </div>
                        </ResizableTableCell>
                      )}
                      {columnVisibility.isColumnVisible('replicas') && <ResizableTableCell columnId="replicas" className="font-mono text-sm">{item.replicas}</ResizableTableCell>}
                      {columnVisibility.isColumnVisible('updateStrategy') && <ResizableTableCell columnId="updateStrategy"><Badge variant="secondary" className="font-mono text-xs truncate block w-fit max-w-full">{item.updateStrategy}</Badge></ResizableTableCell>}
                      {columnVisibility.isColumnVisible('partition') && <ResizableTableCell columnId="partition" className="font-mono text-xs">{item.partition}</ResizableTableCell>}
                      {columnVisibility.isColumnVisible('service') && (
                        <ResizableTableCell columnId="service">
                          {item.serviceName !== '-' ? (
                            <Link to={`/services/${item.namespace}/${item.serviceName}`} className="font-mono text-xs text-primary hover:underline truncate block w-fit max-w-full">{item.serviceName}</Link>
                          ) : (
                            <span className="font-mono text-xs text-muted-foreground">—</span>
                          )}
                        </ResizableTableCell>
                      )}
                      {columnVisibility.isColumnVisible('pvcCount') && (
                        <ResizableTableCell columnId="pvcCount" className="font-mono text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            <HardDrive className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
                            {item.pvcCount}
                          </span>
                        </ResizableTableCell>
                      )}
                      {columnVisibility.isColumnVisible('cpu') && (
                        <ResizableTableCell columnId="cpu">
                          <div className="min-w-0 overflow-hidden">
                            <UsageBar variant="sparkline" value={cpuVal} kind="cpu" dataPoints={cpuDataPoints} displayFormat="compact" width={56} />
                          </div>
                        </ResizableTableCell>
                      )}
                      {columnVisibility.isColumnVisible('memory') && (
                        <ResizableTableCell columnId="memory">
                          <div className="min-w-0 overflow-hidden">
                            <UsageBar variant="sparkline" value={memVal} kind="memory" dataPoints={memDataPoints} displayFormat="compact" width={56} />
                          </div>
                        </ResizableTableCell>
                      )}
                      {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>}
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="StatefulSet actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => navigate(`/statefulsets/${item.namespace}/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/pods?namespace=${item.namespace}`)} className="gap-2"><Box className="h-4 w-4" />View Pods</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setScaleDialog({ open: true, item })} className="gap-2" disabled={!isConnected}><Scale className="h-4 w-4" />Scale</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setRolloutDialog({ open: true, item })} className="gap-2" disabled={!isConnected}><History className="h-4 w-4" />Restart</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/statefulsets/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="gap-2 text-[hsl(0,72%,51%)]" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </motion.tr>
                  );
                })
              ) : (
                groupedOnPage.flatMap((group) => {
                  const isCollapsed = collapsedGroups.has(group.groupKey);
                  return [
                    <TableRow key={group.groupKey} className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-b border-border/60 transition-all duration-200" onClick={() => toggleGroup(group.groupKey)}>
                      <TableCell colSpan={15} className="py-2">
                        <div className="flex items-center gap-2 font-medium">
                          {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                          Namespace: {group.label}
                          <span className="text-muted-foreground font-normal">({group.list.length})</span>
                        </div>
                      </TableCell>
                    </TableRow>,
                    ...(isCollapsed ? [] : group.list.map((item, idx) => {
                      const StatusIcon = statusConfig[item.status]?.icon || Clock;
                      const key = `${item.namespace}/${item.name}`;
                      const isSelected = selectedItems.has(key);
                      const cpuVal = metricsMap[key]?.cpu ?? '-';
                      const memVal = metricsMap[key]?.memory ?? '-';
                      const cpuNum = parseCpu(cpuVal);
                      const memNum = parseMemory(memVal);
                      const cpuDataPoints = cpuNum != null ? Array(12).fill(cpuNum) : undefined;
                      const memDataPoints = memNum != null ? Array(12).fill(memNum) : undefined;
                      return (
                        <motion.tr key={key} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', isSelected && 'bg-primary/5')}>
                          <TableCell><Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(item)} /></TableCell>
                          <ResizableTableCell columnId="name"><Link to={`/statefulsets/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate"><StatefulSetIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" /><span className="truncate">{item.name}</span></Link></ResizableTableCell>
                          {columnVisibility.isColumnVisible('namespace') && <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} className="font-normal truncate block w-fit max-w-full" /></ResizableTableCell>}
                          {columnVisibility.isColumnVisible('status') && <ResizableTableCell columnId="status"><StatusPill label={item.status} variant={statefulSetStatusToVariant[item.status]} icon={StatusIcon} /></ResizableTableCell>}
                          {columnVisibility.isColumnVisible('ready') && (
                            <ResizableTableCell columnId="ready" className="font-mono text-sm">
                              <div className="flex items-center gap-2 min-w-0">
                                <Progress value={parseReadyFraction(item.ready)} className="h-1.5 w-10 flex-shrink-0" />
                                <span className="tabular-nums">{item.ready}</span>
                              </div>
                            </ResizableTableCell>
                          )}
                          {columnVisibility.isColumnVisible('replicas') && <ResizableTableCell columnId="replicas" className="font-mono text-sm">{item.replicas}</ResizableTableCell>}
                          {columnVisibility.isColumnVisible('updateStrategy') && <ResizableTableCell columnId="updateStrategy"><Badge variant="secondary" className="font-mono text-xs truncate block w-fit max-w-full">{item.updateStrategy}</Badge></ResizableTableCell>}
                          {columnVisibility.isColumnVisible('partition') && <ResizableTableCell columnId="partition" className="font-mono text-xs">{item.partition}</ResizableTableCell>}
                          {columnVisibility.isColumnVisible('service') && (
                            <ResizableTableCell columnId="service">
                              {item.serviceName !== '-' ? <Link to={`/services/${item.namespace}/${item.serviceName}`} className="font-mono text-xs text-primary hover:underline truncate block w-fit max-w-full">{item.serviceName}</Link> : <span className="font-mono text-xs text-muted-foreground">—</span>}
                            </ResizableTableCell>
                          )}
                          {columnVisibility.isColumnVisible('pvcCount') && (
                            <ResizableTableCell columnId="pvcCount" className="font-mono text-xs">
                              <span className="inline-flex items-center gap-1.5">
                                <HardDrive className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
                                {item.pvcCount}
                              </span>
                            </ResizableTableCell>
                          )}
                          {columnVisibility.isColumnVisible('cpu') && (
                            <ResizableTableCell columnId="cpu">
                              <div className="min-w-0 overflow-hidden">
                                <UsageBar variant="sparkline" value={cpuVal} kind="cpu" displayFormat="compact" width={56} max={statefulsetResourceMaxMap[key]?.cpuMax} />
                              </div>
                            </ResizableTableCell>
                          )}
                          {columnVisibility.isColumnVisible('memory') && (
                            <ResizableTableCell columnId="memory">
                              <div className="min-w-0 overflow-hidden">
                                <UsageBar variant="sparkline" value={memVal} kind="memory" displayFormat="compact" width={56} max={statefulsetResourceMaxMap[key]?.memoryMax} />
                              </div>
                            </ResizableTableCell>
                          )}
                          {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>}
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="StatefulSet actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem onClick={() => navigate(`/statefulsets/${item.namespace}/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => navigate(`/pods?namespace=${item.namespace}`)} className="gap-2"><Box className="h-4 w-4" />View Pods</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setScaleDialog({ open: true, item })} className="gap-2" disabled={!isConnected}><Scale className="h-4 w-4" />Scale</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setRolloutDialog({ open: true, item })} className="gap-2" disabled={!isConnected}><History className="h-4 w-4" />Restart</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => navigate(`/statefulsets/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="gap-2 text-[hsl(0,72%,51%)]" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </motion.tr>
                      );
                    })),
                  ];
                })
              )}
            </TableBody>
          </Table>
        </ResizableTableProvider>
      </ResourceListTableToolbar>

      {showCreateWizard && (
        <ResourceCreator
          resourceKind="StatefulSet"
          defaultYaml={DEFAULT_YAMLS.StatefulSet}
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
      <DeleteConfirmDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })} resourceType="StatefulSet" resourceName={deleteDialog.bulk ? `${selectedItems.size} statefulsets` : (deleteDialog.item?.name || '')} namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace} onConfirm={handleDelete} />
      {scaleDialog.item && (
        <ScaleDialog
          open={scaleDialog.open}
          onOpenChange={(open) => setScaleDialog({ open, item: open ? scaleDialog.item : null })}
          resourceType="StatefulSet"
          resourceName={scaleDialog.item.name}
          namespace={scaleDialog.item.namespace}
          currentReplicas={scaleDialog.item.replicas}
          onScale={async (r) => {
            if (!isConnected) { toast.error('Connect cluster to scale'); return; }
            try {
              await patchStatefulSet.mutateAsync({ name: scaleDialog.item!.name, namespace: scaleDialog.item!.namespace, patch: { spec: { replicas: r } } });
              toast.success(`Scaled ${scaleDialog.item?.name} to ${r} replicas`);
              setScaleDialog({ open: false, item: null });
              refetch();
            } catch (e: any) {
              toast.error(e?.message ?? 'Failed to scale');
            }
          }}
        />
      )}
      {rolloutDialog.item && (
        <RolloutActionsDialog
          open={rolloutDialog.open}
          onOpenChange={(open) => setRolloutDialog({ open, item: open ? rolloutDialog.item : null })}
          resourceType="StatefulSet"
          resourceName={rolloutDialog.item.name}
          namespace={rolloutDialog.item.namespace}
          revisions={[]}
          onRestart={async () => {
            if (!isConnected) { toast.error('Connect cluster to restart'); return; }
            try {
              await patchStatefulSet.mutateAsync({
                name: rolloutDialog.item!.name,
                namespace: rolloutDialog.item!.namespace,
                patch: { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } } },
              });
              toast.success(`Restarted ${rolloutDialog.item?.name}`);
              setRolloutDialog({ open: false, item: null });
              refetch();
            } catch (e: any) {
              toast.error(e?.message ?? 'Failed to restart');
            }
          }}
          onRollback={(rev) => { toast.info('Rollback for StatefulSet is revision-specific; use detail page when supported.'); setRolloutDialog({ open: false, item: null }); }}
        />
      )}
    </motion.div>
  );
}
