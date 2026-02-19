import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  Filter,
  RefreshCw,
  MoreHorizontal,
  FileJson,
  FileText,
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
import { useQueries } from '@tanstack/react-query';
import { ResourceCommandBar, ResourceExportDropdown, ListViewSegmentedControl, ListPagination, PAGE_SIZE_OPTIONS, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, resourceTableRowClassName, ROW_MOTION, AgeCell, TableEmptyState, CopyNameDropdownItem, ResourceListTableToolbar } from '@/components/list';
import { ConfigMapIcon } from '@/components/icons/KubernetesIcons';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { usePaginatedResourceList, useDeleteK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { resourceToYaml } from '@/hooks/useK8sResourceDetail';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { getConfigMapConsumers } from '@/services/backendApiClient';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { DeleteConfirmDialog } from '@/components/resources';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

interface ConfigMap {
  name: string;
  namespace: string;
  dataKeys: number;
  totalSizeBytes: number;
  totalSizeHuman: string;
  binaryData: boolean;
  immutable: boolean;
  age: string;
  creationTimestamp?: string;
}

interface K8sConfigMap extends KubernetesResource {
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
  immutable?: boolean;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}

const CONFIGMAPS_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'name', defaultWidth: 220, minWidth: 120 },
  { id: 'namespace', defaultWidth: 130, minWidth: 80 },
  { id: 'dataKeys', defaultWidth: 90, minWidth: 70 },
  { id: 'totalSize', defaultWidth: 100, minWidth: 70 },
  { id: 'usedBy', defaultWidth: 90, minWidth: 70 },
  { id: 'binaryData', defaultWidth: 100, minWidth: 70 },
  { id: 'immutable', defaultWidth: 100, minWidth: 70 },
  { id: 'age', defaultWidth: 90, minWidth: 56 },
  { id: 'lastModified', defaultWidth: 110, minWidth: 90 },
];

const CONFIGMAPS_COLUMNS_FOR_VISIBILITY = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'dataKeys', label: 'Data Keys' },
  { id: 'totalSize', label: 'Total Size' },
  { id: 'usedBy', label: 'Used By' },
  { id: 'binaryData', label: 'Binary Data' },
  { id: 'immutable', label: 'Immutable' },
  { id: 'age', label: 'Age' },
  { id: 'lastModified', label: 'Last Modified' },
];

type ListView = 'flat' | 'byNamespace';

function mapConfigMap(cm: K8sConfigMap): ConfigMap {
  const dataKeys = cm.data ? Object.keys(cm.data).length : 0;
  const binaryKeys = cm.binaryData ? Object.keys(cm.binaryData).length : 0;
  let totalBytes = 0;
  if (cm.data) {
    for (const v of Object.values(cm.data)) totalBytes += (v ?? '').length;
  }
  if (cm.binaryData) {
    for (const v of Object.values(cm.binaryData)) totalBytes += (typeof v === 'string' ? v.length : 0);
  }
  return {
    name: cm.metadata?.name ?? '',
    namespace: cm.metadata?.namespace || 'default',
    dataKeys: dataKeys + binaryKeys,
    totalSizeBytes: totalBytes,
    totalSizeHuman: formatBytes(totalBytes),
    binaryData: binaryKeys > 0,
    immutable: !!cm.immutable,
    age: calculateAge(cm.metadata?.creationTimestamp),
    creationTimestamp: cm.metadata?.creationTimestamp,
  };
}

export default function ConfigMaps() {
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const { data, isLoading, refetch } = usePaginatedResourceList<K8sConfigMap>('configmaps');
  const deleteResource = useDeleteK8sResource('configmaps');
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: ConfigMap | null; bulk?: boolean }>({ open: false, item: null });
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [cloneInitialYaml, setCloneInitialYaml] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [listView, setListView] = useState<ListView>('flat');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;

  const allItems = (data?.allItems ?? []) as K8sConfigMap[];
  const items: ConfigMap[] = useMemo(() => (isConnected ? allItems.map(mapConfigMap) : []), [isConnected, allItems]);

  const stats = useMemo(() => {
    const fullList = isConnected ? allItems.map(mapConfigMap) : [];
    return {
      total: fullList.length,
      large: fullList.filter((cm) => cm.totalSizeBytes > 1024 * 1024).length,
      withBinary: fullList.filter((cm) => cm.binaryData).length,
      immutable: fullList.filter((cm) => cm.immutable).length,
    };
  }, [isConnected, allItems]);

  // Fetch consumers for full list to compute In Use / Unused (design 4.1 stats)
  const allItemsMapped = useMemo(() => (isConnected ? (allItems as K8sConfigMap[]).map(mapConfigMap) : []), [isConnected, allItems]);
  const allConsumersQueries = useQueries({
    queries: allItemsMapped.slice(0, 100).map((cm) => ({
      queryKey: ['configmap-consumers-stats', clusterId, cm.namespace, cm.name],
      queryFn: () => getConfigMapConsumers(backendBaseUrl!, clusterId!, cm.namespace, cm.name),
      enabled: !!(isBackendConfigured() && clusterId && cm.name && cm.namespace),
      staleTime: 120_000,
    })),
  });
  const { inUseCount, inUseKeys } = useMemo(() => {
    let count = 0;
    const keys = new Set<string>();
    allConsumersQueries.forEach((q, i) => {
      if (q.data && allItemsMapped[i]) {
        const c = q.data;
        const total = (c.pods?.length ?? 0) + (c.deployments?.length ?? 0) + (c.statefulSets?.length ?? 0) + (c.daemonSets?.length ?? 0) + (c.jobs?.length ?? 0) + (c.cronJobs?.length ?? 0);
        if (total > 0) {
          count++;
          keys.add(`${allItemsMapped[i].namespace}/${allItemsMapped[i].name}`);
        }
      }
    });
    return { inUseCount: count, inUseKeys: keys };
  }, [allConsumersQueries, allItemsMapped]);
  const statsWithUsage = useMemo(() => ({
    ...stats,
    inUse: inUseCount,
    unused: Math.max(0, stats.total - inUseCount),
  }), [stats, inUseCount]);

  const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.namespace)))], [items]);

  const handleClone = useCallback((item: ConfigMap) => {
    const raw = (allItems as K8sConfigMap[]).find((cm) => cm.metadata?.name === item.name && (cm.metadata?.namespace || 'default') === item.namespace);
    if (!raw) return;
    const metadata = { ...raw.metadata, name: '' };
    delete (metadata as Record<string, unknown>).resourceVersion;
    delete (metadata as Record<string, unknown>).uid;
    delete (metadata as Record<string, unknown>).creationTimestamp;
    delete (metadata as Record<string, unknown>).generation;
    const cloneObj: K8sConfigMap = { ...raw, metadata };
    setCloneInitialYaml(resourceToYaml(cloneObj as KubernetesResource));
    setShowCreateWizard(true);
  }, [allItems]);

  const handleCloseCreateWizard = useCallback(() => {
    setShowCreateWizard(false);
    setCloneInitialYaml(null);
  }, []);

  const itemsAfterSearchAndNs = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch =
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.namespace.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesNamespace = selectedNamespace === 'all' || item.namespace === selectedNamespace;
      return matchesSearch && matchesNamespace;
    });
  }, [items, searchQuery, selectedNamespace]);

  const tableConfig: ColumnConfig<ConfigMap>[] = useMemo(
    () => [
      { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: true },
      { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
      { columnId: 'dataKeys', getValue: (i) => i.dataKeys, sortable: true, filterable: false },
      { columnId: 'totalSize', getValue: (i) => i.totalSizeHuman, sortable: true, filterable: false },
      { columnId: 'usedBy', getValue: () => '', sortable: false, filterable: false },
      { columnId: 'binaryData', getValue: (i) => (i.binaryData ? 'Yes' : 'No'), sortable: true, filterable: true },
      { columnId: 'immutable', getValue: (i) => (i.immutable ? 'Yes' : 'No'), sortable: true, filterable: true },
      { columnId: 'usage', getValue: (i) => (inUseKeys.has(`${i.namespace}/${i.name}`) ? 'In Use' : 'Unused'), sortable: false, filterable: true },
      { columnId: 'isLarge', getValue: (i) => (i.totalSizeBytes > 1024 * 1024 ? 'Yes' : 'No'), sortable: false, filterable: true },
      { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
      { columnId: 'lastModified', getValue: (i) => i.age, sortable: true, filterable: false },
    ],
    [inUseKeys]
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
    tableId: 'configmaps',
    columns: CONFIGMAPS_COLUMNS_FOR_VISIBILITY,
    alwaysVisible: ['name'],
  });

  const totalFiltered = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = filteredItems.slice(start, start + pageSize);

  useEffect(() => {
    if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
  }, [safePageIndex, pageIndex]);

  const consumersQueries = useQueries({
    queries: itemsOnPage.map((cm) => ({
      queryKey: ['configmap-consumers', clusterId, cm.namespace, cm.name],
      queryFn: () => getConfigMapConsumers(backendBaseUrl!, clusterId!, cm.namespace, cm.name),
      enabled: !!(isBackendConfigured() && clusterId && cm.name && cm.namespace),
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

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPageIndex(0);
  };

  const pagination = {
    rangeLabel:
      totalFiltered > 0
        ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}`
        : 'No configmaps',
    hasPrev: safePageIndex > 0,
    hasNext: start + pageSize < totalFiltered,
    onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
    onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
    currentPage: safePageIndex + 1,
    totalPages: Math.max(1, totalPages),
    onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
  };

  const groupedOnPage = useMemo(() => {
    if (listView !== 'byNamespace' || itemsOnPage.length === 0) return [];
    const map = new Map<string, ConfigMap[]>();
    for (const item of itemsOnPage) {
      const list = map.get(item.namespace) ?? [];
      list.push(item);
      map.set(item.namespace, list);
    }
    return Array.from(map.entries())
      .map(([label, configMaps]) => ({ groupKey: `ns:${label}`, label, configMaps }))
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
        toast.success(`Deleted ${selectedItems.size} ConfigMap(s)`);
        setSelectedItems(new Set());
      } else if (deleteDialog.item) {
        await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
        toast.success('ConfigMap deleted');
      }
      setDeleteDialog({ open: false, item: null });
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const toggleSelection = (cm: ConfigMap) => {
    const key = `${cm.namespace}/${cm.name}`;
    const next = new Set(selectedItems);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedItems(next);
  };
  const toggleAll = () => {
    if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(itemsOnPage.map((cm) => `${cm.namespace}/${cm.name}`)));
  };
  const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
  const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

  const exportConfig = {
    filenamePrefix: 'configmaps',
    resourceLabel: 'configmaps',
    getExportData: (cm: ConfigMap) => ({
      name: cm.name,
      namespace: cm.namespace,
      dataKeys: cm.dataKeys,
      totalSize: cm.totalSizeHuman,
      age: cm.age,
    }),
    csvColumns: [
      { label: 'Name', getValue: (cm: ConfigMap) => cm.name },
      { label: 'Namespace', getValue: (cm: ConfigMap) => cm.namespace },
      { label: 'Data Keys', getValue: (cm: ConfigMap) => String(cm.dataKeys) },
      { label: 'Total Size', getValue: (cm: ConfigMap) => cm.totalSizeHuman },
      { label: 'Age', getValue: (cm: ConfigMap) => cm.age },
    ],
    toK8sYaml: (cm: ConfigMap) => `---
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${cm.name}
  namespace: ${cm.namespace}
data: {}
`,
  };

  const namespaceCount = useMemo(() => new Set(filteredItems.map((i) => i.namespace)).size, [filteredItems]);

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <ListPageHeader
          icon={<ConfigMapIcon className="h-6 w-6 text-primary" />}
          title="ConfigMaps"
          resourceCount={filteredItems.length}
          subtitle={namespaceCount > 0 ? `across ${namespaceCount} namespaces` : undefined}
          demoMode={!isConnected}
          isLoading={isLoading}
          onRefresh={() => refetch()}
          createLabel="Create"
          onCreate={() => setShowCreateWizard(true)}
          actions={
            <>
              <ResourceExportDropdown
                items={filteredItems}
                selectedKeys={selectedItems}
                getKey={(cm) => `${cm.namespace}/${cm.name}`}
                config={exportConfig}
                selectionLabel={selectedItems.size > 0 ? 'Selected configmaps' : 'All visible configmaps'}
                onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
              />
              {selectedItems.size > 0 && (
                <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete {selectedItems.size} selected
                </Button>
              )}
            </>
          }
        />

        <div className={cn('grid grid-cols-2 sm:grid-cols-4 gap-4', !isConnected && 'opacity-60')}>
          <ListPageStatCard
            label="Total ConfigMaps"
            value={statsWithUsage.total}
            icon={FileJson}
            iconColor="text-primary"
            selected={!hasActiveFilters}
            onClick={clearAllFilters}
            className={cn(!hasActiveFilters && 'ring-2 ring-primary')}
          />
          <ListPageStatCard
            label="In Use"
            value={statsWithUsage.inUse}
            icon={FileText}
            iconColor="text-[hsl(142,76%,36%)]"
            valueClassName="text-[hsl(142,76%,36%)]"
            selected={columnFilters.usage?.size === 1 && columnFilters.usage.has('In Use')}
            onClick={() => { if (columnFilters.usage?.size === 1 && columnFilters.usage.has('In Use')) setColumnFilter('usage', null); else setColumnFilter('usage', new Set(['In Use'])); }}
            className={cn(columnFilters.usage?.size === 1 && columnFilters.usage.has('In Use') && 'ring-2 ring-[hsl(142,76%,36%)]')}
          />
          <ListPageStatCard
            label="Unused"
            value={statsWithUsage.unused}
            icon={FileText}
            iconColor="text-muted-foreground"
            selected={columnFilters.usage?.size === 1 && columnFilters.usage.has('Unused')}
            onClick={() => { if (columnFilters.usage?.size === 1 && columnFilters.usage.has('Unused')) setColumnFilter('usage', null); else setColumnFilter('usage', new Set(['Unused'])); }}
            className={cn(columnFilters.usage?.size === 1 && columnFilters.usage.has('Unused') && 'ring-2 ring-primary')}
          />
          <ListPageStatCard
            label="Large (>1MB)"
            value={statsWithUsage.large}
            icon={FileText}
            iconColor="text-amber-600"
            valueClassName={statsWithUsage.large > 0 ? 'text-amber-600' : undefined}
            selected={columnFilters.isLarge?.size === 1 && columnFilters.isLarge.has('Yes')}
            onClick={() => { if (columnFilters.isLarge?.size === 1 && columnFilters.isLarge.has('Yes')) setColumnFilter('isLarge', null); else setColumnFilter('isLarge', new Set(['Yes'])); }}
            className={cn(columnFilters.isLarge?.size === 1 && columnFilters.isLarge.has('Yes') && 'ring-2 ring-amber-600')}
          />
        </div>

        {/* Bulk Actions Bar */}
        {selectedItems.size > 0 && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <Badge variant="secondary" className="gap-1.5">
              <CheckSquare className="h-3.5 w-3.5" />
              {selectedItems.size} selected
            </Badge>
            <div className="flex items-center gap-2">
              <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={(cm) => `${cm.namespace}/${cm.name}`} config={exportConfig} selectionLabel="Selected configmaps" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
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
            <div className="relative w-full min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search configmaps..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all"
                aria-label="Search configmaps"
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
          columns={CONFIGMAPS_COLUMNS_FOR_VISIBILITY}
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
              dataUpdatedAt={pagination.dataUpdatedAt}
              isFetching={pagination.isFetching}
            />
          </div>
          }
        >
        <div className="overflow-x-auto">
          <ResizableTableProvider tableId="configmaps" columnConfig={CONFIGMAPS_TABLE_COLUMNS}>
            <Table className="table-fixed" style={{ minWidth: 1000 }}>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
                  <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
                  <ResizableTableHead columnId="name">
                    <TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
                  </ResizableTableHead>
                  {columnVisibility.isColumnVisible('namespace') && (
                  <ResizableTableHead columnId="namespace">
                    <TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
                  </ResizableTableHead>
                  )}
                  {columnVisibility.isColumnVisible('dataKeys') && (
                  <ResizableTableHead columnId="dataKeys">
                    <TableColumnHeaderWithFilterAndSort columnId="dataKeys" label="Data Keys" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
                  </ResizableTableHead>
                  )}
                  {columnVisibility.isColumnVisible('totalSize') && (
                  <ResizableTableHead columnId="totalSize">
                    <TableColumnHeaderWithFilterAndSort columnId="totalSize" label="Total Size" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
                  </ResizableTableHead>
                  )}
                  {columnVisibility.isColumnVisible('usedBy') && (
                  <ResizableTableHead columnId="usedBy" title="Used By">
                    <span className="text-xs font-medium text-muted-foreground">Used By</span>
                  </ResizableTableHead>
                  )}
                  {columnVisibility.isColumnVisible('binaryData') && (
                  <ResizableTableHead columnId="binaryData">
                    <TableColumnHeaderWithFilterAndSort columnId="binaryData" label="Binary Data" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
                  </ResizableTableHead>
                  )}
                  {columnVisibility.isColumnVisible('immutable') && (
                  <ResizableTableHead columnId="immutable">
                    <TableColumnHeaderWithFilterAndSort columnId="immutable" label="Immutable" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
                  </ResizableTableHead>
                  )}
                  {columnVisibility.isColumnVisible('age') && (
                  <ResizableTableHead columnId="age">
                    <TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
                  </ResizableTableHead>
                  )}
                  {columnVisibility.isColumnVisible('lastModified') && (
                  <ResizableTableHead columnId="lastModified">
                    <TableColumnHeaderWithFilterAndSort columnId="lastModified" label="Last Modified" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} />
                  </ResizableTableHead>
                  )}
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
                    {columnVisibility.isColumnVisible('namespace') && <ResizableTableCell columnId="namespace" className="p-1.5"><TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} /></ResizableTableCell>}
                    {columnVisibility.isColumnVisible('dataKeys') && <ResizableTableCell columnId="dataKeys" className="p-1.5" />}
                    {columnVisibility.isColumnVisible('totalSize') && <ResizableTableCell columnId="totalSize" className="p-1.5" />}
                    {columnVisibility.isColumnVisible('usedBy') && <ResizableTableCell columnId="usedBy" className="p-1.5"><TableFilterCell columnId="usage" label="Used By" distinctValues={distinctValuesByColumn.usage ?? []} selectedFilterValues={columnFilters.usage ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.usage} /></ResizableTableCell>}
                    {columnVisibility.isColumnVisible('binaryData') && <ResizableTableCell columnId="binaryData" className="p-1.5"><TableFilterCell columnId="binaryData" label="Binary Data" distinctValues={['Yes', 'No']} selectedFilterValues={columnFilters.binaryData ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.binaryData} /></ResizableTableCell>}
                    {columnVisibility.isColumnVisible('immutable') && <ResizableTableCell columnId="immutable" className="p-1.5"><TableFilterCell columnId="immutable" label="Immutable" distinctValues={['Yes', 'No']} selectedFilterValues={columnFilters.immutable ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.immutable} /></ResizableTableCell>}
                    {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
                    {columnVisibility.isColumnVisible('lastModified') && <ResizableTableCell columnId="lastModified" className="p-1.5" />}
                    <TableCell className="w-12 p-1.5" />
                  </TableRow>
                )}
              </TableHeader>
              <TableBody>
                {isLoading && isConnected ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-32 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Loading...</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-40 text-center">
                      <TableEmptyState
                        icon={<FileJson className="h-8 w-8" />}
                        title="No ConfigMaps found"
                        subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Create a ConfigMap to store non-sensitive configuration.'}
                        hasActiveFilters={!!(searchQuery || hasActiveFilters)}
                        onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
                        createLabel="Create ConfigMap"
                        onCreate={() => setShowCreateWizard(true)}
                      />
                    </TableCell>
                  </TableRow>
                ) : listView === 'flat' ? (
                  itemsOnPage.map((item, idx) => {
                    const key = `${item.namespace}/${item.name}`;
                    const usedByCount = consumersCountByKey[key];
                    const usedByNode =
                      !isBackendConfigured() || !clusterId ? (
                        <span className="text-muted-foreground">—</span>
                      ) : usedByCount !== undefined ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="font-mono text-sm">{usedByCount}</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">{usedByCount} workload(s) use this ConfigMap</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      );
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
                          <Link to={`/configmaps/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
                            <FileJson className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="truncate">{item.name}</span>
                          </Link>
                        </ResizableTableCell>
                        {columnVisibility.isColumnVisible('namespace') && (
                        <ResizableTableCell columnId="namespace">
                          <Badge variant="outline" className="font-normal truncate block w-fit max-w-full">
                            {item.namespace}
                          </Badge>
                        </ResizableTableCell>
                        )}
                        {columnVisibility.isColumnVisible('dataKeys') && (
                        <ResizableTableCell columnId="dataKeys" className="font-mono text-sm">
                          {item.dataKeys}
                        </ResizableTableCell>
                        )}
                        {columnVisibility.isColumnVisible('totalSize') && (
                        <ResizableTableCell columnId="totalSize" className="text-muted-foreground font-mono text-sm">
                          {item.totalSizeHuman}
                        </ResizableTableCell>
                        )}
                        {columnVisibility.isColumnVisible('usedBy') && (
                        <ResizableTableCell columnId="usedBy">{usedByNode}</ResizableTableCell>
                        )}
                        {columnVisibility.isColumnVisible('binaryData') && (
                        <ResizableTableCell columnId="binaryData">
                          {item.binaryData ? <Badge variant="secondary">Yes</Badge> : <span className="text-muted-foreground">No</span>}
                        </ResizableTableCell>
                        )}
                        {columnVisibility.isColumnVisible('immutable') && (
                        <ResizableTableCell columnId="immutable">
                          {item.immutable ? <Badge variant="default">Yes</Badge> : <Badge variant="outline">No</Badge>}
                        </ResizableTableCell>
                        )}
                        {columnVisibility.isColumnVisible('age') && (
                        <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap">
                          <AgeCell age={item.age} timestamp={item.creationTimestamp} />
                        </ResizableTableCell>
                        )}
                        {columnVisibility.isColumnVisible('lastModified') && (
                        <ResizableTableCell columnId="lastModified" className="text-muted-foreground whitespace-nowrap">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span><AgeCell age={item.age} timestamp={item.creationTimestamp} /></span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-xs">
                              K8s does not expose last-modified time; showing creation time
                            </TooltipContent>
                          </Tooltip>
                        </ResizableTableCell>
                        )}
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="ConfigMap actions">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <CopyNameDropdownItem name={item.name} namespace={item.namespace} />
                              <DropdownMenuItem onClick={() => navigate(`/configmaps/${item.namespace}/${item.name}`)} className="gap-2">
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/configmaps/${item.namespace}/${item.name}?tab=data`)} className="gap-2">
                                View Data
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/configmaps/${item.namespace}/${item.name}?tab=used-by`)} className="gap-2">
                                View Consumers
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleClone(item)} className="gap-2">
                                Clone / Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => navigate(`/configmaps/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2">
                                Download YAML
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}>
                                <Trash2 className="h-4 w-4" /> Delete
                              </DropdownMenuItem>
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
                      <TableRow
                        key={group.groupKey}
                        className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-b border-border/60 transition-all duration-200"
                        onClick={() => toggleGroup(group.groupKey)}
                      >
                        <TableCell colSpan={11} className="py-2">
                          <div className="flex items-center gap-2 font-medium">
                            {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                            Namespace: {group.label}
                            <span className="text-muted-foreground font-normal">({group.configMaps.length})</span>
                          </div>
                        </TableCell>
                      </TableRow>,
                      ...(isCollapsed
                        ? []
                        : group.configMaps.map((item, idx) => {
                            const key = `${item.namespace}/${item.name}`;
                            const usedByCount = consumersCountByKey[key];
                            const usedByNode =
                              !isBackendConfigured() || !clusterId ? (
                                <span className="text-muted-foreground">—</span>
                              ) : usedByCount !== undefined ? (
                                <span className="font-mono text-sm">{usedByCount}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              );
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
                                  <Link to={`/configmaps/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
                                    <FileJson className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                    <span className="truncate">{item.name}</span>
                                  </Link>
                                </ResizableTableCell>
                                {columnVisibility.isColumnVisible('namespace') && (
                                <ResizableTableCell columnId="namespace">
                                  <Badge variant="outline" className="font-normal truncate block w-fit max-w-full">
                                    {item.namespace}
                                  </Badge>
                                </ResizableTableCell>
                                )}
                                {columnVisibility.isColumnVisible('dataKeys') && (
                                <ResizableTableCell columnId="dataKeys" className="font-mono text-sm">
                                  {item.dataKeys}
                                </ResizableTableCell>
                                )}
                                {columnVisibility.isColumnVisible('totalSize') && (
                                <ResizableTableCell columnId="totalSize" className="text-muted-foreground font-mono text-sm">
                                  {item.totalSizeHuman}
                                </ResizableTableCell>
                                )}
                                {columnVisibility.isColumnVisible('usedBy') && (
                                <ResizableTableCell columnId="usedBy">{usedByNode}</ResizableTableCell>
                                )}
                                {columnVisibility.isColumnVisible('binaryData') && (
                                <ResizableTableCell columnId="binaryData">
                                  {item.binaryData ? <Badge variant="secondary">Yes</Badge> : <span className="text-muted-foreground">No</span>}
                                </ResizableTableCell>
                                )}
                                {columnVisibility.isColumnVisible('immutable') && (
                                <ResizableTableCell columnId="immutable">
                                  {item.immutable ? <Badge variant="default">Yes</Badge> : <Badge variant="outline">No</Badge>}
                                </ResizableTableCell>
                                )}
                                {columnVisibility.isColumnVisible('age') && (
                                <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap">
                                  <AgeCell age={item.age} timestamp={item.creationTimestamp} />
                                </ResizableTableCell>
                                )}
                                {columnVisibility.isColumnVisible('lastModified') && (
                                <ResizableTableCell columnId="lastModified" className="text-muted-foreground whitespace-nowrap">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span><AgeCell age={item.age} timestamp={item.creationTimestamp} /></span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs max-w-xs">
                                      K8s does not expose last-modified time; showing creation time
                                    </TooltipContent>
                                  </Tooltip>
                                </ResizableTableCell>
                                )}
                                <TableCell>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="ConfigMap actions">
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-48">
                                      <CopyNameDropdownItem name={item.name} namespace={item.namespace} />
                                      <DropdownMenuItem onClick={() => navigate(`/configmaps/${item.namespace}/${item.name}`)} className="gap-2">
                                        View Details
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => navigate(`/configmaps/${item.namespace}/${item.name}?tab=data`)} className="gap-2">
                                        View Data
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => navigate(`/configmaps/${item.namespace}/${item.name}?tab=used-by`)} className="gap-2">
                                        View Consumers
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => handleClone(item)} className="gap-2">
                                        Clone / Duplicate
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem onClick={() => navigate(`/configmaps/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2">
                                        Download YAML
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}>
                                        <Trash2 className="h-4 w-4" /> Delete
                                      </DropdownMenuItem>
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
        </div>
        </ResourceListTableToolbar>
        <p className="text-xs text-muted-foreground mt-1">
          {listView === 'flat' ? 'flat list' : 'grouped by namespace'}
        </p>
      </motion.div>

      {showCreateWizard && (
        <ResourceCreator
          key={cloneInitialYaml ?? 'new'}
          resourceKind="ConfigMap"
          defaultYaml={cloneInitialYaml ?? DEFAULT_YAMLS.ConfigMap}
          onClose={handleCloseCreateWizard}
          onApply={() => {
            toast.success('ConfigMap created');
            handleCloseCreateWizard();
            refetch();
          }}
        />
      )}

      <DeleteConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null, bulk: open ? deleteDialog.bulk : false })}
        resourceType="ConfigMap"
        resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name || '')}
        namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace}
        onConfirm={handleDelete}
        requireNameConfirmation={!deleteDialog.bulk}
      />
    </>
  );
}
