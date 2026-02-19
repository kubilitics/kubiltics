import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Folder, Search, MoreHorizontal, ChevronDown, CheckSquare, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { usePaginatedResourceList, useK8sResourceList, useDeleteK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { getNamespaceCounts } from '@/services/backendApiClient';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { DeleteConfirmDialog } from '@/components/resources';
import { StatusPill, type StatusPillVariant } from '@/components/list';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ResourceCommandBar,
  ClusterScopedScope,
  ResourceExportDropdown,
  ListPagination,
  ListPageStatCard,
  ListPageHeader,
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
} from '@/components/list';
import { NamespaceIcon } from '@/components/icons/KubernetesIcons';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';

interface NamespaceResource extends KubernetesResource {
  status?: {
    phase?: string;
  };
}

interface Namespace {
  name: string;
  status: string;
  labels: Record<string, string>;
  age: string;
  creationTimestamp?: string;
  pods: string;
  services: string;
  deployments: string;
  configmaps: string;
  secrets: string;
}

const namespaceStatusVariant: Record<string, StatusPillVariant> = {
  Active: 'success',
  Terminating: 'error',
};

const SYSTEM_NS = new Set(['kube-system', 'kube-public', 'kube-node-lease', 'default']);

function transformNamespaceResource(resource: NamespaceResource): Namespace {
  return {
    name: resource.metadata.name,
    status: resource.status?.phase || 'Active',
    labels: resource.metadata.labels || {},
    age: calculateAge(resource.metadata.creationTimestamp),
    creationTimestamp: resource.metadata?.creationTimestamp,
    pods: '–',
    services: '–',
    deployments: '–',
    configmaps: '–',
    secrets: '–',
  };
}

const NS_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'name', defaultWidth: 180, minWidth: 100 },
  { id: 'status', defaultWidth: 110, minWidth: 80 },
  { id: 'pods', defaultWidth: 80, minWidth: 50 },
  { id: 'deployments', defaultWidth: 100, minWidth: 70 },
  { id: 'services', defaultWidth: 90, minWidth: 60 },
  { id: 'configmaps', defaultWidth: 100, minWidth: 70 },
  { id: 'secrets', defaultWidth: 80, minWidth: 50 },
  { id: 'labels', defaultWidth: 160, minWidth: 80 },
  { id: 'age', defaultWidth: 90, minWidth: 56 },
];

const NS_COLUMNS_FOR_VISIBILITY = [
  { id: 'status', label: 'Status' },
  { id: 'pods', label: 'Pods' },
  { id: 'deployments', label: 'Deployments' },
  { id: 'services', label: 'Services' },
  { id: 'configmaps', label: 'ConfigMaps' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'labels', label: 'Labels' },
  { id: 'age', label: 'Age' },
];

export default function Namespaces() {
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const clusterId = currentClusterId ?? null;

  const { data, isLoading, refetch, pagination: hookPagination } = usePaginatedResourceList<NamespaceResource>('namespaces');
  const deleteResource = useDeleteK8sResource('namespaces');

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: Namespace | null; bulk?: boolean }>({ open: false, item: null });
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showCreator, setShowCreator] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const allItems = (data?.allItems ?? []) as NamespaceResource[];

  const { data: backendNsCounts } = useQuery({
    queryKey: ['backend', 'namespace-counts', clusterId],
    queryFn: () => getNamespaceCounts(backendBaseUrl, clusterId!),
    enabled: !!(isBackendConfigured() && clusterId && isConnected),
    staleTime: 30_000,
  });

  const { data: podsData } = useK8sResourceList('pods', undefined, { limit: 5000, enabled: !backendNsCounts && isConnected });
  const { data: svcsData } = useK8sResourceList('services', undefined, { limit: 5000, enabled: !backendNsCounts && isConnected });
  const { data: deploymentsData } = useK8sResourceList('deployments', undefined, { limit: 5000 });
  const { data: configmapsData } = useK8sResourceList('configmaps', undefined, { limit: 5000 });
  const { data: secretsData } = useK8sResourceList('secrets', undefined, { limit: 5000 });

  const nsCountMap = useMemo(() => {
    const countBy = (items: Array<{ metadata: { namespace?: string } }>) => {
      const m: Record<string, number> = {};
      for (const item of items) {
        const ns = item.metadata?.namespace ?? '';
        if (ns) m[ns] = (m[ns] ?? 0) + 1;
      }
      return m;
    };
    return {
      pods: countBy((podsData?.items ?? []) as Array<{ metadata: { namespace?: string } }>),
      services: countBy((svcsData?.items ?? []) as Array<{ metadata: { namespace?: string } }>),
      deployments: countBy((deploymentsData?.items ?? []) as Array<{ metadata: { namespace?: string } }>),
      configmaps: countBy((configmapsData?.items ?? []) as Array<{ metadata: { namespace?: string } }>),
      secrets: countBy((secretsData?.items ?? []) as Array<{ metadata: { namespace?: string } }>),
    };
  }, [podsData, svcsData, deploymentsData, configmapsData, secretsData]);

  const namespaces: Namespace[] = useMemo(() => {
    if (!isConnected) return [];
    return allItems.map((r) => {
      const ns = transformNamespaceResource(r);
      const name = ns.name;
      if (backendNsCounts && backendNsCounts[name]) {
        ns.pods = String(backendNsCounts[name].pods);
        ns.services = String(backendNsCounts[name].services);
      } else {
        ns.pods = String(nsCountMap.pods[name] ?? 0);
        ns.services = String(nsCountMap.services[name] ?? 0);
      }
      ns.deployments = String(nsCountMap.deployments[name] ?? 0);
      ns.configmaps = String(nsCountMap.configmaps[name] ?? 0);
      ns.secrets = String(nsCountMap.secrets[name] ?? 0);
      return ns;
    });
  }, [isConnected, allItems, nsCountMap, backendNsCounts]);

  const tableConfig: ColumnConfig<Namespace>[] = useMemo(() => [
    { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
    { columnId: 'status', getValue: (i) => i.status, sortable: true, filterable: true },
    { columnId: 'isSystem', getValue: (i) => (SYSTEM_NS.has(i.name) ? 'Yes' : 'No'), sortable: false, filterable: true },
    { columnId: 'pods', getValue: (i) => i.pods, sortable: true, filterable: false },
    { columnId: 'deployments', getValue: (i) => i.deployments, sortable: true, filterable: false },
    { columnId: 'services', getValue: (i) => i.services, sortable: true, filterable: false },
    { columnId: 'configmaps', getValue: (i) => i.configmaps, sortable: true, filterable: false },
    { columnId: 'secrets', getValue: (i) => i.secrets, sortable: true, filterable: false },
    { columnId: 'labels', getValue: (i) => Object.entries(i.labels).map(([k, v]) => `${k}=${v}`).join(', '), sortable: true, filterable: false },
    { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
  ], []);

  const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(namespaces, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
  const columnVisibility = useColumnVisibility({ tableId: 'namespaces', columns: NS_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

  const toggleStatFilter = (columnId: 'status' | 'isSystem', value: string) => {
    const current = columnFilters[columnId];
    if (current?.size === 1 && current.has(value)) {
      setColumnFilter(columnId, null);
    } else {
      setColumnFilter(columnId, new Set([value]));
    }
  };

  const searchFiltered = useMemo(() => {
    if (!searchQuery.trim()) return filteredItems;
    const q = searchQuery.toLowerCase();
    return filteredItems.filter((ns) => ns.name.toLowerCase().includes(q) || Object.entries(ns.labels).some(([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q)));
  }, [filteredItems, searchQuery]);

  const stats = useMemo(() => {
    const total = namespaces.length;
    const active = namespaces.filter((n) => n.status === 'Active').length;
    const terminating = namespaces.filter((n) => n.status === 'Terminating').length;
    const system = namespaces.filter((n) => SYSTEM_NS.has(n.name)).length;
    return { total, active, terminating, system };
  }, [namespaces]);

  const totalFiltered = searchFiltered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = searchFiltered.slice(start, start + pageSize);

  useEffect(() => {
    if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
  }, [safePageIndex, pageIndex]);

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPageIndex(0);
  };

  const pagination = {
    rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No namespaces',
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

  const handleDelete = async () => {
    if (!isConnected) {
      toast.info('Connect cluster to delete resources');
      return;
    }
    if (deleteDialog.bulk && selectedItems.size > 0) {
      for (const name of selectedItems) {
        await deleteResource.mutateAsync({ name });
      }
      toast.success(`Deleted ${selectedItems.size} namespace(s)`);
      setSelectedItems(new Set());
    } else if (deleteDialog.item) {
      await deleteResource.mutateAsync({ name: deleteDialog.item.name });
      toast.success(`Namespace ${deleteDialog.item.name} deleted`);
    }
    setDeleteDialog({ open: false, item: null });
    refetch();
  };

  const toggleSelection = (ns: Namespace) => {
    const next = new Set(selectedItems);
    if (next.has(ns.name)) next.delete(ns.name);
    else next.add(ns.name);
    setSelectedItems(next);
  };
  const toggleAll = () => {
    if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(itemsOnPage.map((ns) => ns.name)));
  };
  const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
  const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

  const exportConfig = {
    filenamePrefix: 'namespaces',
    resourceLabel: 'Namespaces',
    getExportData: (ns: Namespace) => ({ name: ns.name, status: ns.status, age: ns.age, pods: ns.pods, services: ns.services, deployments: ns.deployments, configmaps: ns.configmaps }),
    csvColumns: [
      { label: 'Name', getValue: (ns: Namespace) => ns.name },
      { label: 'Status', getValue: (ns: Namespace) => ns.status },
      { label: 'Pods', getValue: (ns: Namespace) => ns.pods },
      { label: 'Deployments', getValue: (ns: Namespace) => ns.deployments },
      { label: 'Services', getValue: (ns: Namespace) => ns.services },
      { label: 'ConfigMaps', getValue: (ns: Namespace) => ns.configmaps },
      { label: 'Age', getValue: (ns: Namespace) => ns.age },
    ],
  };

  if (showCreator) {
    return (
      <ResourceCreator
        resourceKind="Namespace"
        defaultYaml={DEFAULT_YAMLS.Namespace}
        onClose={() => setShowCreator(false)}
        onApply={() => {
          toast.success('Namespace created');
          setShowCreator(false);
          refetch();
        }}
      />
    );
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <ListPageHeader
          icon={<NamespaceIcon className="h-6 w-6 text-primary" />}
          title="Namespaces"
          resourceCount={filteredItems.length}
          demoMode={!isConnected}
          isLoading={isLoading}
          onRefresh={() => refetch()}
          createLabel="Create"
          onCreate={() => setShowCreator(true)}
          actions={
            <>
              <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(ns) => ns.name} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected namespaces' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
              {selectedItems.size > 0 && (
                <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete {selectedItems.size} selected
                </Button>
              )}
            </>
          }
        />

        <div className={cn('grid grid-cols-1 sm:grid-cols-3 gap-4', !isConnected && 'opacity-60')}>
          <ListPageStatCard
            label="Total"
            value={stats.total}
            icon={Folder}
            iconColor="text-primary"
            selected={!hasActiveFilters}
            onClick={clearAllFilters}
            className={cn(!hasActiveFilters && 'ring-2 ring-primary')}
          />
          <ListPageStatCard
            label="Active"
            value={stats.active}
            icon={Folder}
            iconColor="text-[hsl(142,76%,36%)]"
            valueClassName="text-[hsl(142,76%,36%)]"
            selected={columnFilters.status?.size === 1 && columnFilters.status.has('Active')}
            onClick={() => toggleStatFilter('status', 'Active')}
            className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Active') && 'ring-2 ring-[hsl(142,76%,36%)]')}
          />
          <ListPageStatCard
            label="Terminating"
            value={stats.terminating}
            icon={Folder}
            iconColor="text-[hsl(0,72%,51%)]"
            valueClassName="text-[hsl(0,72%,51%)]"
            selected={columnFilters.status?.size === 1 && columnFilters.status.has('Terminating')}
            onClick={() => toggleStatFilter('status', 'Terminating')}
            className={cn(columnFilters.status?.size === 1 && columnFilters.status.has('Terminating') && 'ring-2 ring-[hsl(0,72%,51%)]')}
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
              <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(ns) => ns.name} config={exportConfig} selectionLabel="Selected namespaces" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
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
          scope={<ClusterScopedScope />}
          search={
            <div className="relative w-full min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search namespaces..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search namespaces" />
            </div>
          }
        />
          }
          hasActiveFilters={hasActiveFilters}
          onClearAllFilters={clearAllFilters}
          showTableFilters={showTableFilters}
          onToggleTableFilters={() => setShowTableFilters((v) => !v)}
          columns={NS_COLUMNS_FOR_VISIBILITY}
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
          <ResizableTableProvider tableId="namespaces" columnConfig={NS_TABLE_COLUMNS}>
            <Table className="table-fixed" style={{ minWidth: 900 }}>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
                  <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
                  <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="status"><TableColumnHeaderWithFilterAndSort columnId="status" label="Status" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="pods"><TableColumnHeaderWithFilterAndSort columnId="pods" label="Pods" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="deployments"><TableColumnHeaderWithFilterAndSort columnId="deployments" label="Deployments" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="services"><TableColumnHeaderWithFilterAndSort columnId="services" label="Services" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="configmaps"><TableColumnHeaderWithFilterAndSort columnId="configmaps" label="ConfigMaps" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="secrets"><TableColumnHeaderWithFilterAndSort columnId="secrets" label="Secrets" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="labels"><TableColumnHeaderWithFilterAndSort columnId="labels" label="Labels" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
                </TableRow>
                {showTableFilters && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
                    <TableCell className="w-10 p-1.5" />
                    <ResizableTableCell columnId="name" className="p-1.5" />
                    <ResizableTableCell columnId="status" className="p-1.5"><TableFilterCell columnId="status" label="Status" distinctValues={distinctValuesByColumn.status ?? []} selectedFilterValues={columnFilters.status ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.status} /></ResizableTableCell>
                    <ResizableTableCell columnId="pods" className="p-1.5" />
                    <ResizableTableCell columnId="deployments" className="p-1.5" />
                    <ResizableTableCell columnId="services" className="p-1.5" />
                    <ResizableTableCell columnId="configmaps" className="p-1.5" />
                    <ResizableTableCell columnId="secrets" className="p-1.5" />
                    <ResizableTableCell columnId="labels" className="p-1.5" />
                    <ResizableTableCell columnId="age" className="p-1.5" />
                    <TableCell className="w-12 p-1.5" />
                  </TableRow>
                )}
              </TableHeader>
              <TableBody>
                {isLoading && isConnected ? (
                  <TableSkeletonRows columnCount={11} />
                ) : searchFiltered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="h-40 text-center">
                      <TableEmptyState
                        icon={<Folder className="h-8 w-8" />}
                        title="No namespaces found"
                        subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Create a namespace to isolate resources.'}
                        hasActiveFilters={!!(searchQuery || hasActiveFilters)}
                        onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
                        createLabel="Create Namespace"
                        onCreate={() => setShowCreator(true)}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  itemsOnPage.map((ns, idx) => (
                    <motion.tr key={ns.name} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(ns.name) && 'bg-primary/5')}>
                      <TableCell><Checkbox checked={selectedItems.has(ns.name)} onCheckedChange={() => toggleSelection(ns)} aria-label={`Select ${ns.name}`} /></TableCell>
                      <ResizableTableCell columnId="name">
                        <Link to={`/namespaces/${ns.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
                          <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">{ns.name}</span>
                        </Link>
                      </ResizableTableCell>
                      <ResizableTableCell columnId="status"><StatusPill label={ns.status} variant={namespaceStatusVariant[ns.status] || 'neutral'} /></ResizableTableCell>
                      <ResizableTableCell columnId="pods" className="font-mono text-sm">{ns.pods}</ResizableTableCell>
                      <ResizableTableCell columnId="deployments" className="font-mono text-sm">{ns.deployments}</ResizableTableCell>
                      <ResizableTableCell columnId="services" className="font-mono text-sm">{ns.services}</ResizableTableCell>
                      <ResizableTableCell columnId="configmaps" className="font-mono text-sm">{ns.configmaps}</ResizableTableCell>
                      <ResizableTableCell columnId="secrets" className="font-mono text-sm">{ns.secrets}</ResizableTableCell>
                      <ResizableTableCell columnId="labels">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(ns.labels).slice(0, 2).map(([k, v]) => (
                            <Badge key={k} variant="secondary" className="text-xs font-mono">{k}={v}</Badge>
                          ))}
                          {Object.keys(ns.labels).length > 2 && <Badge variant="outline" className="text-xs">+{Object.keys(ns.labels).length - 2}</Badge>}
                        </div>
                      </ResizableTableCell>
                      <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={ns.age} timestamp={ns.creationTimestamp} /></ResizableTableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="Namespace actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <CopyNameDropdownItem name={ns.name} />
                            <DropdownMenuItem onClick={() => navigate(`/namespaces/${ns.name}`)} className="gap-2">View Details</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/pods?namespace=${encodeURIComponent(ns.name)}`)} className="gap-2">View Resources</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => navigate(`/namespaces/${ns.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteDialog({ open: true, item: ns })} disabled={!isConnected}>Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </motion.tr>
                  ))
                )}
              </TableBody>
            </Table>
          </ResizableTableProvider>
        </ResourceListTableToolbar>
      </motion.div>

      <DeleteConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null, bulk: open ? deleteDialog.bulk : false })}
        resourceType="Namespace"
        resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name || '')}
        onConfirm={handleDelete}
        requireNameConfirmation={!deleteDialog.bulk}
      />
    </>
  );
}
