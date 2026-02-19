import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  Filter,
  RefreshCw,
  MoreHorizontal,
  Database,
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
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { ResourceCommandBar, ResourceExportDropdown, ListViewSegmentedControl, ListPagination, PAGE_SIZE_OPTIONS, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, StatusPill, type StatusPillVariant, resourceTableRowClassName, ROW_MOTION, AgeCell, TableEmptyState, TableSkeletonRows, NamespaceBadge, ResourceListTableToolbar } from '@/components/list';
import { StorageIcon } from '@/components/icons/KubernetesIcons';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { usePaginatedResourceList, useDeleteK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { getPVCConsumers } from '@/services/backendApiClient';
import { useQueries } from '@tanstack/react-query';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { DeleteConfirmDialog } from '@/components/resources';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

interface PVC {
  name: string;
  namespace: string;
  status: string;
  volume: string;
  capacity: string;
  used: string;
  accessModes: string[];
  storageClass: string;
  volumeMode: string;
  age: string;
  creationTimestamp?: string;
}

interface K8sPVC extends KubernetesResource {
  spec?: {
    volumeName?: string;
    storageClassName?: string;
    accessModes?: string[];
    volumeMode?: string;
    resources?: { requests?: { storage?: string } };
  };
  status?: {
    phase?: string;
    capacity?: { storage?: string };
    conditions?: Array<{ type?: string }>;
  };
}

const pvcStatusVariant: Record<string, StatusPillVariant> = {
  Bound: 'success',
  Pending: 'warning',
  Lost: 'error',
  Expanding: 'neutral',
};

function formatAccessMode(mode: string): string {
  const modeMap: Record<string, string> = {
    ReadWriteOnce: 'RWO',
    ReadOnlyMany: 'ROX',
    ReadWriteMany: 'RWX',
    ReadWriteOncePod: 'RWOP',
  };
  return modeMap[mode] || mode;
}

const PVC_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'name', defaultWidth: 220, minWidth: 120 },
  { id: 'namespace', defaultWidth: 130, minWidth: 80 },
  { id: 'status', defaultWidth: 100, minWidth: 80 },
  { id: 'capacity', defaultWidth: 100, minWidth: 70 },
  { id: 'used', defaultWidth: 90, minWidth: 70 },
  { id: 'accessModes', defaultWidth: 120, minWidth: 80 },
  { id: 'storageClass', defaultWidth: 130, minWidth: 90 },
  { id: 'volume', defaultWidth: 160, minWidth: 90 },
  { id: 'volumeMode', defaultWidth: 100, minWidth: 70 },
  { id: 'usedBy', defaultWidth: 90, minWidth: 70 },
  { id: 'age', defaultWidth: 90, minWidth: 56 },
];

const PVC_COLUMNS_FOR_VISIBILITY = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'status', label: 'Status' },
  { id: 'capacity', label: 'Capacity' },
  { id: 'used', label: 'Used' },
  { id: 'accessModes', label: 'Access Modes' },
  { id: 'storageClass', label: 'Storage Class' },
  { id: 'volume', label: 'Volume' },
  { id: 'volumeMode', label: 'Volume Mode' },
  { id: 'age', label: 'Age' },
];

type ListView = 'flat' | 'byNamespace';

function mapPVC(pvc: K8sPVC): PVC {
  return {
    name: pvc.metadata?.name ?? '',
    namespace: pvc.metadata?.namespace || 'default',
    status: pvc.status?.phase || 'Unknown',
    volume: pvc.spec?.volumeName || '—',
    capacity: pvc.spec?.resources?.requests?.storage || '—',
    used: pvc.status?.capacity?.storage || '—',
    accessModes: (pvc.spec?.accessModes || []).map(formatAccessMode),
    storageClass: pvc.spec?.storageClassName || '—',
    volumeMode: pvc.spec?.volumeMode || 'Filesystem',
    age: calculateAge(pvc.metadata?.creationTimestamp),
    creationTimestamp: pvc.metadata?.creationTimestamp,
  };
}

export default function PersistentVolumeClaims() {
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const { data, isLoading, refetch, pagination: hookPagination } = usePaginatedResourceList<K8sPVC>('persistentvolumeclaims');
  const deleteResource = useDeleteK8sResource('persistentvolumeclaims');
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: PVC | null; bulk?: boolean }>({ open: false, item: null });
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [listView, setListView] = useState<ListView>('flat');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  const allItems = (data?.allItems ?? []) as K8sPVC[];
  const items: PVC[] = useMemo(() => (isConnected ? allItems.map(mapPVC) : []), [isConnected, allItems]);

  const stats = useMemo(() => {
    const fullList = isConnected ? allItems.map(mapPVC) : [];
    return {
      total: fullList.length,
      bound: fullList.filter((p) => p.status === 'Bound').length,
      pending: fullList.filter((p) => p.status === 'Pending').length,
      lost: fullList.filter((p) => p.status === 'Lost').length,
      expanding: fullList.filter((p) => p.status === 'Expanding').length,
    };
  }, [isConnected, allItems]);

  const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.namespace)))], [items]);

  const itemsAfterSearchAndNs = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch =
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.namespace.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesNamespace = selectedNamespace === 'all' || item.namespace === selectedNamespace;
      return matchesSearch && matchesNamespace;
    });
  }, [items, searchQuery, selectedNamespace]);

  const tableConfig: ColumnConfig<PVC>[] = useMemo(
    () => [
      { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
      { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
      { columnId: 'status', getValue: (i) => i.status, sortable: true, filterable: true },
      { columnId: 'capacity', getValue: (i) => i.capacity, sortable: true, filterable: false },
      { columnId: 'used', getValue: (i) => i.used, sortable: true, filterable: false },
      { columnId: 'accessModes', getValue: (i) => i.accessModes.join(', '), sortable: true, filterable: false },
      { columnId: 'storageClass', getValue: (i) => i.storageClass, sortable: true, filterable: true },
      { columnId: 'volume', getValue: (i) => i.volume, sortable: true, filterable: false },
      { columnId: 'volumeMode', getValue: (i) => i.volumeMode, sortable: true, filterable: true },
      { columnId: 'usedBy', getValue: () => '', sortable: false, filterable: false },
      { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
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
  const columnVisibility = useColumnVisibility({ tableId: 'persistentvolumeclaims', columns: PVC_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

  const totalFiltered = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = filteredItems.slice(start, start + pageSize);

  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;

  const consumersQueries = useQueries({
    queries: itemsOnPage.map((p) => ({
      queryKey: ['pvc-consumers', clusterId, p.namespace, p.name],
      queryFn: () => getPVCConsumers(backendBaseUrl!, clusterId!, p.namespace, p.name),
      enabled: !!(isBackendConfigured() && clusterId && p.name && p.namespace),
      staleTime: 60_000,
    })),
  });
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

  useEffect(() => {
    if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
  }, [safePageIndex, pageIndex]);

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPageIndex(0);
  };

  const pagination = {
    rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No PVCs',
    hasPrev: safePageIndex > 0,
    hasNext: start + pageSize < totalFiltered,
    onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
    onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
    currentPage: safePageIndex + 1,
    totalPages: Math.max(1, totalPages),
    onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
    dataUpdatedAt: hookPagination?.dataUpdatedAt,
    isFetching: hookPagination?.isFetching,
  };

  const groupedOnPage = useMemo(() => {
    if (listView !== 'byNamespace' || itemsOnPage.length === 0) return [];
    const map = new Map<string, PVC[]>();
    for (const item of itemsOnPage) {
      const list = map.get(item.namespace) ?? [];
      list.push(item);
      map.set(item.namespace, list);
    }
    return Array.from(map.entries())
      .map(([label, pvcs]) => ({ groupKey: `ns:${label}`, label, pvcs }))
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
        toast.success(`Deleted ${selectedItems.size} PVC(s)`);
        setSelectedItems(new Set());
      } else if (deleteDialog.item) {
        await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
        toast.success('PersistentVolumeClaim deleted');
      }
      setDeleteDialog({ open: false, item: null });
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const toggleSelection = (pvc: PVC) => {
    const key = `${pvc.namespace}/${pvc.name}`;
    const next = new Set(selectedItems);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedItems(next);
  };
  const toggleAll = () => {
    if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(itemsOnPage.map((p) => `${p.namespace}/${p.name}`)));
  };
  const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
  const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

  const handleAction = (action: string, item: PVC) => {
    if (action === 'Delete') setDeleteDialog({ open: true, item });
    if (action === 'View Details') navigate(`/persistentvolumeclaims/${item.namespace}/${item.name}`);
    if (action === 'View Volume' && item.volume !== '—') navigate(`/persistentvolumes/${item.volume}`);
    if (action === 'View Pods') navigate(`/persistentvolumeclaims/${item.namespace}/${item.name}?tab=used-by`);
    if (action === 'View Storage Class' && item.storageClass !== '—') navigate(`/storageclasses/${item.storageClass}`);
    if (action === 'Download YAML') navigate(`/persistentvolumeclaims/${item.namespace}/${item.name}?tab=yaml`);
  };

  const exportConfig = {
    filenamePrefix: 'persistentvolumeclaims',
    resourceLabel: 'PVCs',
    getExportData: (pvc: PVC) => ({ name: pvc.name, namespace: pvc.namespace, status: pvc.status, volume: pvc.volume, capacity: pvc.capacity, storageClass: pvc.storageClass, age: pvc.age }),
    csvColumns: [
      { label: 'Name', getValue: (pvc: PVC) => pvc.name },
      { label: 'Namespace', getValue: (pvc: PVC) => pvc.namespace },
      { label: 'Status', getValue: (pvc: PVC) => pvc.status },
      { label: 'Volume', getValue: (pvc: PVC) => pvc.volume },
      { label: 'Capacity', getValue: (pvc: PVC) => pvc.capacity },
      { label: 'Storage Class', getValue: (pvc: PVC) => pvc.storageClass },
      { label: 'Age', getValue: (pvc: PVC) => pvc.age },
    ],
  };

  const namespaceCount = useMemo(() => new Set(filteredItems.map((i) => i.namespace)).size, [filteredItems]);

  const renderRow = (item: PVC, idx: number) => {
    const key = `${item.namespace}/${item.name}`;
    return (
      <motion.tr
        key={key}
        initial={ROW_MOTION.initial}
        animate={ROW_MOTION.animate}
        transition={ROW_MOTION.transition(idx)}
        className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(key) && 'bg-primary/5')}
      >
        <TableCell><Checkbox checked={selectedItems.has(key)} onCheckedChange={() => toggleSelection(item)} aria-label={`Select ${item.name}`} /></TableCell>
        <ResizableTableCell columnId="name">
          <Link to={`/persistentvolumeclaims/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
            <Database className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="truncate">{item.name}</span>
          </Link>
        </ResizableTableCell>
        <ResizableTableCell columnId="namespace">
          <NamespaceBadge namespace={item.namespace} className="font-normal truncate block w-fit max-w-full" />
        </ResizableTableCell>
        <ResizableTableCell columnId="status">
          <StatusPill label={item.status} variant={pvcStatusVariant[item.status] || 'neutral'} />
        </ResizableTableCell>
        <ResizableTableCell columnId="capacity">
          <Badge variant="secondary" className="font-mono text-xs">{item.capacity}</Badge>
        </ResizableTableCell>
        <ResizableTableCell columnId="used" className="font-mono text-sm">
          {item.used !== '—' ? item.used : (
            <Tooltip>
              <TooltipTrigger asChild><span className="text-muted-foreground">—</span></TooltipTrigger>
              <TooltipContent><p className="text-xs">Used capacity from status when bound; requires storage provider for live usage.</p></TooltipContent>
            </Tooltip>
          )}
        </ResizableTableCell>
        <ResizableTableCell columnId="accessModes" className="font-mono text-sm">{item.accessModes.join(', ') || '—'}</ResizableTableCell>
        <ResizableTableCell columnId="storageClass">
          {item.storageClass !== '—' ? (
            <Link to={`/storageclasses/${item.storageClass}`} className="font-mono text-xs text-primary hover:underline">{item.storageClass}</Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </ResizableTableCell>
        <ResizableTableCell columnId="volume" className="font-mono text-sm">
          {item.volume !== '—' ? (
            <Link to={`/persistentvolumes/${item.volume}`} className="text-primary hover:underline">{item.volume}</Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </ResizableTableCell>
        <ResizableTableCell columnId="volumeMode"><Badge variant="secondary" className="font-normal">{item.volumeMode}</Badge></ResizableTableCell>
        <ResizableTableCell columnId="usedBy">
          {!isBackendConfigured() || !clusterId ? (
            <span className="text-muted-foreground">—</span>
          ) : consumersCountByKey[key] !== undefined ? (
            <Tooltip>
              <TooltipTrigger asChild><span className="font-mono text-sm">{consumersCountByKey[key]}</span></TooltipTrigger>
              <TooltipContent><p className="text-xs">{consumersCountByKey[key]} workload(s) use this PVC</p></TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </ResizableTableCell>
        <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="PVC actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => handleAction('View Details', item)} className="gap-2">View Details</DropdownMenuItem>
              {item.volume !== '—' && <DropdownMenuItem onClick={() => handleAction('View Volume', item)} className="gap-2">View Volume</DropdownMenuItem>}
              <DropdownMenuItem onClick={() => handleAction('View Pods', item)} className="gap-2">View Pods</DropdownMenuItem>
              {item.storageClass !== '—' && <DropdownMenuItem onClick={() => handleAction('View Storage Class', item)} className="gap-2">View Storage Class</DropdownMenuItem>}
              <DropdownMenuItem onClick={() => handleAction('Download YAML', item)} className="gap-2">Download YAML</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </motion.tr>
    );
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <ListPageHeader
          icon={<StorageIcon className="h-6 w-6 text-primary" />}
          title="Persistent Volume Claims"
          resourceCount={filteredItems.length}
          subtitle={namespaceCount > 0 ? `across ${namespaceCount} namespaces` : undefined}
          demoMode={!isConnected}
          isLoading={isLoading}
          onRefresh={() => refetch()}
          createLabel="Create"
          onCreate={() => setShowCreateWizard(true)}
          actions={
            <>
              <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={(pvc) => `${pvc.namespace}/${pvc.name}`} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected PVCs' : 'All visible PVCs'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
              {selectedItems.size > 0 && (
                <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete {selectedItems.size} selected
                </Button>
              )}
            </>
          }
        />

        <div className={cn('grid grid-cols-2 sm:grid-cols-5 gap-4', !isConnected && 'opacity-60')}>
          <ListPageStatCard label="Total PVCs" value={stats.total} icon={Database} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && 'ring-2 ring-primary')} />
          <ListPageStatCard label="Bound" value={stats.bound} icon={Database} iconColor="text-[hsl(142,76%,36%)]" valueClassName="text-[hsl(142,76%,36%)]" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Bound')} onClick={() => setColumnFilter('status', new Set(['Bound']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Bound') && 'ring-2 ring-[hsl(142,76%,36%)]')} />
          <ListPageStatCard label="Pending" value={stats.pending} icon={Database} iconColor="text-amber-600" valueClassName="text-amber-600" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Pending')} onClick={() => setColumnFilter('status', new Set(['Pending']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Pending') && 'ring-2 ring-amber-600')} />
          <ListPageStatCard label="Lost" value={stats.lost} icon={Database} iconColor="text-destructive" valueClassName="text-destructive" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Lost')} onClick={() => setColumnFilter('status', new Set(['Lost']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Lost') && 'ring-2 ring-destructive')} />
          <ListPageStatCard label="Expanding" value={stats.expanding} icon={Database} iconColor="text-[hsl(217,91%,60%)]" valueClassName="text-[hsl(217,91%,60%)]" selected={columnFilters.status?.size === 1 && columnFilters.status.has('Expanding')} onClick={() => setColumnFilter('status', new Set(['Expanding']))} className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Expanding') && 'ring-2 ring-[hsl(217,91%,60%)]')} />
        </div>

        {/* Bulk Actions Bar */}
        {selectedItems.size > 0 && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <Badge variant="secondary" className="gap-1.5">
              <CheckSquare className="h-3.5 w-3.5" />
              {selectedItems.size} selected
            </Badge>
            <div className="flex items-center gap-2">
              <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={(pvc) => `${pvc.namespace}/${pvc.name}`} config={exportConfig} selectionLabel="Selected PVCs" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
              <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete selected
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedItems(new Set())}>
                Clear
              </Button>
            </div>
          </motion.div>
        )}

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
              <Input placeholder="Search PVCs..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search PVCs" />
            </div>
          }
          structure={
            <ListViewSegmentedControl value={listView} onChange={(v) => setListView(v as ListView)} options={[{ id: 'flat', label: 'Flat', icon: List }, { id: 'byNamespace', label: 'By Namespace', icon: Layers }]} label="" ariaLabel="List structure" />
          }
        />
          }
          hasActiveFilters={hasActiveFilters}
          onClearAllFilters={clearAllFilters}
          showTableFilters={showTableFilters}
          onToggleTableFilters={() => setShowTableFilters((v) => !v)}
          columns={PVC_COLUMNS_FOR_VISIBILITY}
          visibleColumns={columnVisibility.visibleColumns}
          onColumnToggle={columnVisibility.setColumnVisible}
          footer={
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">{pagination.rangeLabel}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="gap-2">{pageSize} per page<ChevronDown className="h-4 w-4 opacity-50" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {PAGE_SIZE_OPTIONS.map((size) => <DropdownMenuItem key={size} onClick={() => handlePageSizeChange(size)} className={cn(pageSize === size && 'bg-accent')}>{size} per page</DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <ListPagination hasPrev={pagination.hasPrev} hasNext={pagination.hasNext} onPrev={pagination.onPrev} onNext={pagination.onNext} rangeLabel={undefined} currentPage={pagination.currentPage} totalPages={pagination.totalPages} onPageChange={pagination.onPageChange} dataUpdatedAt={pagination.dataUpdatedAt} isFetching={pagination.isFetching} />
          </div>
          }
        >
          <ResizableTableProvider tableId="persistentvolumeclaims" columnConfig={PVC_TABLE_COLUMNS}>
            <Table className="table-fixed" style={{ minWidth: 1100 }}>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
                  <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
                  <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="status"><TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="capacity"><TableColumnHeaderWithFilterAndSort columnId="capacity" label="Capacity" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="used"><TableColumnHeaderWithFilterAndSort columnId="used" label="Used" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="accessModes" title="Access Modes"><TableColumnHeaderWithFilterAndSort columnId="accessModes" label="Access Modes" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="storageClass"><TableColumnHeaderWithFilterAndSort columnId="storageClass" label="Storage Class" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="volume"><TableColumnHeaderWithFilterAndSort columnId="volume" label="Volume" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="volumeMode"><TableColumnHeaderWithFilterAndSort columnId="volumeMode" label="Volume Mode" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="usedBy" title="Used By"><span className="text-xs font-medium text-muted-foreground">Used By</span></ResizableTableHead>
                  <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
                </TableRow>
                {showTableFilters && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
                    <TableCell className="w-10 p-1.5" />
                    <ResizableTableCell columnId="name" className="p-1.5" />
                    <ResizableTableCell columnId="namespace" className="p-1.5"><TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} /></ResizableTableCell>
                    <ResizableTableCell columnId="status" className="p-1.5"><TableFilterCell columnId="status" label="Status" distinctValues={distinctValuesByColumn.status ?? []} selectedFilterValues={columnFilters.status ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.status} /></ResizableTableCell>
                    <ResizableTableCell columnId="capacity" className="p-1.5" />
                    <ResizableTableCell columnId="used" className="p-1.5" />
                    <ResizableTableCell columnId="accessModes" className="p-1.5" />
                    <ResizableTableCell columnId="storageClass" className="p-1.5"><TableFilterCell columnId="storageClass" label="Storage Class" distinctValues={distinctValuesByColumn.storageClass ?? []} selectedFilterValues={columnFilters.storageClass ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.storageClass} /></ResizableTableCell>
                    <ResizableTableCell columnId="volume" className="p-1.5" />
                    <ResizableTableCell columnId="volumeMode" className="p-1.5"><TableFilterCell columnId="volumeMode" label="Volume Mode" distinctValues={distinctValuesByColumn.volumeMode ?? []} selectedFilterValues={columnFilters.volumeMode ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.volumeMode} /></ResizableTableCell>
                    <ResizableTableCell columnId="usedBy" className="p-1.5" />
                    <ResizableTableCell columnId="age" className="p-1.5" />
                    <TableCell className="w-12 p-1.5" />
                  </TableRow>
                )}
              </TableHeader>
              <TableBody>
                {isLoading && isConnected ? (
                  <TableSkeletonRows columnCount={13} />
                ) : filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="h-40 text-center">
                      <TableEmptyState
                        icon={<Database className="h-8 w-8" />}
                        title="No PVCs found"
                        subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Create a PersistentVolumeClaim to request storage.'}
                        hasActiveFilters={!!(searchQuery || hasActiveFilters)}
                        onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
                        createLabel="Create PersistentVolumeClaim"
                        onCreate={() => setShowCreateWizard(true)}
                      />
                    </TableCell>
                  </TableRow>
                ) : listView === 'flat' ? (
                  itemsOnPage.map((item, idx) => renderRow(item, idx))
                ) : (
                  groupedOnPage.flatMap((group) => {
                    const isCollapsed = collapsedGroups.has(group.groupKey);
                    return [
                      <TableRow key={group.groupKey} className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-b border-border/60" onClick={() => toggleGroup(group.groupKey)}>
                        <TableCell colSpan={13} className="py-2">
                          <div className="flex items-center gap-2 font-medium">
                            {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                            Namespace: {group.label}
                            <span className="text-muted-foreground font-normal">({group.pvcs.length})</span>
                          </div>
                        </TableCell>
                      </TableRow>,
                      ...(isCollapsed ? [] : group.pvcs.map((item, idx) => renderRow(item, idx))),
                    ];
                  })
                )}
              </TableBody>
            </Table>
          </ResizableTableProvider>
        </ResourceListTableToolbar>
        <p className="text-xs text-muted-foreground mt-1">{listView === 'flat' ? 'flat list' : 'grouped by namespace'}</p>
      </motion.div>

      {showCreateWizard && <ResourceCreator resourceKind="PersistentVolumeClaim" defaultYaml={DEFAULT_YAMLS.PersistentVolumeClaim} onClose={() => setShowCreateWizard(false)} onApply={() => { toast.success('PersistentVolumeClaim created'); setShowCreateWizard(false); refetch(); }} />}
      <DeleteConfirmDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null, bulk: open ? deleteDialog.bulk : false })} resourceType="PersistentVolumeClaim" resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name || '')} namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace} onConfirm={handleDelete} requireNameConfirmation={!deleteDialog.bulk} />
    </>
  );
}
