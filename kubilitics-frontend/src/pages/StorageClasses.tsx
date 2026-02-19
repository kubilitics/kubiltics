import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  RefreshCw,
  MoreHorizontal,
  Layers,
  Loader2,
  WifiOff,
  Plus,
  ChevronDown,
  CheckSquare,
  Trash2,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { ResourceCommandBar, ClusterScopedScope, ResourceExportDropdown, ListPagination, PAGE_SIZE_OPTIONS, ListPageStatCard, ListPageHeader, TableColumnHeaderWithFilterAndSort, TableFilterCell, resourceTableRowClassName, ROW_MOTION, AgeCell, TableEmptyState, TableSkeletonRows, ResourceListTableToolbar } from '@/components/list';
import { StorageIcon } from '@/components/icons/KubernetesIcons';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { usePaginatedResourceList, useDeleteK8sResource, usePatchK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { getStorageClassPVCounts } from '@/services/backendApiClient';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { DeleteConfirmDialog } from '@/components/resources';
import { Star } from 'lucide-react';
import { toast } from 'sonner';

interface StorageClass {
  name: string;
  provisioner: string;
  reclaimPolicy: string;
  volumeBindingMode: string;
  allowVolumeExpansion: boolean;
  isDefault: boolean;
  age: string;
  creationTimestamp?: string;
}

interface K8sStorageClass extends KubernetesResource {
  provisioner?: string;
  reclaimPolicy?: string;
  volumeBindingMode?: string;
  allowVolumeExpansion?: boolean;
}

const SC_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'name', defaultWidth: 200, minWidth: 100 },
  { id: 'provisioner', defaultWidth: 180, minWidth: 100 },
  { id: 'reclaimPolicy', defaultWidth: 120, minWidth: 80 },
  { id: 'volumeBindingMode', defaultWidth: 130, minWidth: 90 },
  { id: 'allowVolumeExpansion', defaultWidth: 100, minWidth: 70 },
  { id: 'pvCount', defaultWidth: 90, minWidth: 70 },
  { id: 'default', defaultWidth: 90, minWidth: 70 },
  { id: 'age', defaultWidth: 90, minWidth: 56 },
];

const SC_COLUMNS_FOR_VISIBILITY = [
  { id: 'provisioner', label: 'Provisioner' },
  { id: 'reclaimPolicy', label: 'Reclaim Policy' },
  { id: 'volumeBindingMode', label: 'Volume Binding' },
  { id: 'allowVolumeExpansion', label: 'Expansion' },
  { id: 'pvCount', label: 'PVs' },
  { id: 'default', label: 'Default' },
  { id: 'age', label: 'Age' },
];

function mapSC(sc: K8sStorageClass): StorageClass {
  const isDefault = sc.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true';
  return {
    name: sc.metadata?.name ?? '',
    provisioner: sc.provisioner || '—',
    reclaimPolicy: sc.reclaimPolicy || 'Delete',
    volumeBindingMode: sc.volumeBindingMode || 'Immediate',
    allowVolumeExpansion: sc.allowVolumeExpansion ?? false,
    isDefault,
    age: calculateAge(sc.metadata?.creationTimestamp),
    creationTimestamp: sc.metadata?.creationTimestamp,
  };
}

export default function StorageClasses() {
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const { data, isLoading, refetch, pagination: hookPagination } = usePaginatedResourceList<K8sStorageClass>('storageclasses');
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: StorageClass | null; bulk?: boolean }>({ open: false, item: null });
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const deleteSC = useDeleteK8sResource('storageclasses');
  const patchSC = usePatchK8sResource('storageclasses');
  const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore((s) => s.backendBaseUrl));
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;

  const { data: pvCounts } = useQuery({
    queryKey: ['storageclass-pv-counts', clusterId],
    queryFn: () => getStorageClassPVCounts(backendBaseUrl!, clusterId!),
    enabled: !!(isBackendConfigured() && clusterId && backendBaseUrl),
    staleTime: 60_000,
  });

  const allItems = (data?.allItems ?? []) as K8sStorageClass[];
  const items: StorageClass[] = useMemo(() => (isConnected ? allItems.map(mapSC) : []), [isConnected, allItems]);

  const stats = useMemo(() => {
    const fullList = isConnected ? allItems.map(mapSC) : [];
    const withPVs = pvCounts ? fullList.filter((sc) => (pvCounts[sc.name] ?? 0) > 0).length : 0;
    return {
      total: fullList.length,
      defaultCount: fullList.filter((sc) => sc.isDefault).length,
      withPVs,
      provisioners: new Set(fullList.map((sc) => sc.provisioner)).size,
    };
  }, [isConnected, allItems, pvCounts]);

  const itemsAfterSearch = useMemo(
    () => items.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.provisioner.toLowerCase().includes(searchQuery.toLowerCase())),
    [items, searchQuery]
  );

  const tableConfig: ColumnConfig<StorageClass>[] = useMemo(
    () => [
      { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
      { columnId: 'provisioner', getValue: (i) => i.provisioner, sortable: true, filterable: true },
      { columnId: 'reclaimPolicy', getValue: (i) => i.reclaimPolicy, sortable: true, filterable: true },
      { columnId: 'volumeBindingMode', getValue: (i) => i.volumeBindingMode, sortable: true, filterable: true },
      { columnId: 'allowVolumeExpansion', getValue: (i) => (i.allowVolumeExpansion ? 'Yes' : 'No'), sortable: true, filterable: true },
      { columnId: 'pvCount', getValue: () => '', sortable: false, filterable: false },
      { columnId: 'hasPVs', getValue: (i) => (pvCounts && (pvCounts[i.name] ?? 0) > 0 ? 'Yes' : 'No'), sortable: false, filterable: true },
      { columnId: 'isDefault', getValue: (i) => (i.isDefault ? 'Yes' : 'No'), sortable: true, filterable: true },
      { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
    ],
    [pvCounts]
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
  } = useTableFiltersAndSort(itemsAfterSearch, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
  const columnVisibility = useColumnVisibility({ tableId: 'storageclasses', columns: SC_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

  const totalFiltered = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = filteredItems.slice(start, start + pageSize);

  const toggleDefaultFilter = () => {
    if (columnFilters.isDefault?.size === 1 && columnFilters.isDefault.has('Yes')) {
      setColumnFilter('isDefault', null);
    } else {
      setColumnFilter('isDefault', new Set(['Yes']));
    }
  };

  useEffect(() => {
    if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
  }, [safePageIndex, pageIndex]);

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPageIndex(0);
  };

  const handleDelete = async () => {
    if (!isConnected) {
      toast.info('Connect cluster to delete resources');
      return;
    }
    if (deleteDialog.bulk && selectedItems.size > 0) {
      for (const name of selectedItems) {
        await deleteSC.mutateAsync({ name });
      }
      toast.success(`Deleted ${selectedItems.size} storage class(es)`);
      setSelectedItems(new Set());
    } else if (deleteDialog.item) {
      await deleteSC.mutateAsync({ name: deleteDialog.item.name });
      toast.success(`StorageClass ${deleteDialog.item.name} deleted`);
    }
    setDeleteDialog({ open: false, item: null });
    refetch();
  };

  const toggleSelection = (sc: StorageClass) => {
    const next = new Set(selectedItems);
    if (next.has(sc.name)) next.delete(sc.name);
    else next.add(sc.name);
    setSelectedItems(next);
  };
  const toggleAll = () => {
    if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(itemsOnPage.map((sc) => sc.name)));
  };
  const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
  const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

  const pagination = {
    rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No storage classes',
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

  const exportConfig = {
    filenamePrefix: 'storageclasses',
    resourceLabel: 'StorageClasses',
    getExportData: (sc: StorageClass) => ({ name: sc.name, provisioner: sc.provisioner, reclaimPolicy: sc.reclaimPolicy, volumeBindingMode: sc.volumeBindingMode, allowVolumeExpansion: sc.allowVolumeExpansion, age: sc.age }),
    csvColumns: [
      { label: 'Name', getValue: (sc: StorageClass) => sc.name },
      { label: 'Provisioner', getValue: (sc: StorageClass) => sc.provisioner },
      { label: 'Reclaim Policy', getValue: (sc: StorageClass) => sc.reclaimPolicy },
      { label: 'Volume Binding', getValue: (sc: StorageClass) => sc.volumeBindingMode },
      { label: 'Age', getValue: (sc: StorageClass) => sc.age },
    ],
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <ListPageHeader
          icon={<StorageIcon className="h-6 w-6 text-primary" />}
          title="Storage Classes"
          resourceCount={filteredItems.length}
          subtitle="Cluster-scoped"
          demoMode={!isConnected}
          isLoading={isLoading}
          onRefresh={() => refetch()}
          createLabel="Create"
          onCreate={() => setShowCreateWizard(true)}
          actions={
            <>
              <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={(sc) => sc.name} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected storage classes' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
          <ListPageStatCard
            label="Total Classes"
            value={stats.total}
            icon={Layers}
            iconColor="text-primary"
            selected={!hasActiveFilters}
            onClick={clearAllFilters}
            className={cn(!hasActiveFilters && 'ring-2 ring-primary')}
          />
          <ListPageStatCard
            label="Default"
            value={stats.defaultCount}
            icon={Layers}
            iconColor="text-[hsl(142,76%,36%)]"
            valueClassName="text-[hsl(142,76%,36%)]"
            selected={columnFilters.isDefault?.size === 1 && columnFilters.isDefault.has('Yes')}
            onClick={toggleDefaultFilter}
            className={cn(columnFilters.isDefault?.size === 1 && columnFilters.isDefault.has('Yes') && 'ring-2 ring-[hsl(142,76%,36%)]')}
          />
          <ListPageStatCard
            label="With PVs"
            value={pvCounts ? stats.withPVs : '—'}
            icon={Layers}
            iconColor="text-muted-foreground"
            valueClassName={pvCounts && stats.withPVs > 0 ? 'text-muted-foreground' : undefined}
            selected={pvCounts != null && columnFilters.hasPVs?.size === 1 && columnFilters.hasPVs.has('Yes')}
            onClick={() => {
              if (!pvCounts) return;
              if (columnFilters.hasPVs?.size === 1 && columnFilters.hasPVs.has('Yes')) {
                setColumnFilter('hasPVs', null);
              } else {
                setColumnFilter('hasPVs', new Set(['Yes']));
              }
            }}
            className={cn(pvCounts != null && columnFilters.hasPVs?.size === 1 && columnFilters.hasPVs.has('Yes') && 'ring-2 ring-primary')}
          />
          <ListPageStatCard
            label="Provisioners"
            value={stats.provisioners}
            icon={Layers}
            iconColor="text-muted-foreground"
            selected={!hasActiveFilters}
            onClick={clearAllFilters}
            className={cn(!hasActiveFilters && 'ring-2 ring-primary')}
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
              <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={(sc) => sc.name} config={exportConfig} selectionLabel="Selected storage classes" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
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
              <Input placeholder="Search storage classes..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search storage classes" />
            </div>
          }
        />
          }
          hasActiveFilters={hasActiveFilters}
          onClearAllFilters={clearAllFilters}
          showTableFilters={showTableFilters}
          onToggleTableFilters={() => setShowTableFilters((v) => !v)}
          columns={SC_COLUMNS_FOR_VISIBILITY}
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
          <ResizableTableProvider tableId="storageclasses" columnConfig={SC_TABLE_COLUMNS}>
            <Table className="table-fixed" style={{ minWidth: 900 }}>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
                  <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
                  <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="provisioner"><TableColumnHeaderWithFilterAndSort columnId="provisioner" label="Provisioner" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="reclaimPolicy"><TableColumnHeaderWithFilterAndSort columnId="reclaimPolicy" label="Reclaim Policy" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="volumeBindingMode"><TableColumnHeaderWithFilterAndSort columnId="volumeBindingMode" label="Volume Binding" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="allowVolumeExpansion"><TableColumnHeaderWithFilterAndSort columnId="allowVolumeExpansion" label="Expansion" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="pvCount" title="PV Count"><span className="text-xs font-medium text-muted-foreground">PVs</span></ResizableTableHead>
                  <ResizableTableHead columnId="default"><TableColumnHeaderWithFilterAndSort columnId="isDefault" label="Default" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
                </TableRow>
                {showTableFilters && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
                    <TableCell className="w-10 p-1.5" />
                    <ResizableTableCell columnId="name" className="p-1.5" />
                    <ResizableTableCell columnId="provisioner" className="p-1.5"><TableFilterCell columnId="provisioner" label="Provisioner" distinctValues={distinctValuesByColumn.provisioner ?? []} selectedFilterValues={columnFilters.provisioner ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.provisioner} /></ResizableTableCell>
                    <ResizableTableCell columnId="reclaimPolicy" className="p-1.5"><TableFilterCell columnId="reclaimPolicy" label="Reclaim Policy" distinctValues={distinctValuesByColumn.reclaimPolicy ?? []} selectedFilterValues={columnFilters.reclaimPolicy ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.reclaimPolicy} /></ResizableTableCell>
                    <ResizableTableCell columnId="volumeBindingMode" className="p-1.5"><TableFilterCell columnId="volumeBindingMode" label="Volume Binding" distinctValues={distinctValuesByColumn.volumeBindingMode ?? []} selectedFilterValues={columnFilters.volumeBindingMode ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.volumeBindingMode} /></ResizableTableCell>
                    <ResizableTableCell columnId="allowVolumeExpansion" className="p-1.5"><TableFilterCell columnId="allowVolumeExpansion" label="Expansion" distinctValues={['Yes', 'No']} selectedFilterValues={columnFilters.allowVolumeExpansion ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.allowVolumeExpansion} /></ResizableTableCell>
                    <ResizableTableCell columnId="pvCount" className="p-1.5" />
                    <ResizableTableCell columnId="default" className="p-1.5"><TableFilterCell columnId="isDefault" label="Default" distinctValues={['Yes', 'No']} selectedFilterValues={columnFilters.isDefault ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.isDefault} /></ResizableTableCell>
                    <ResizableTableCell columnId="age" className="p-1.5" />
                    <TableCell className="w-12 p-1.5" />
                  </TableRow>
                )}
              </TableHeader>
              <TableBody>
                {isLoading && isConnected ? (
                  <TableSkeletonRows columnCount={10} />
                ) : filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-40 text-center">
                      <TableEmptyState
                        icon={<Layers className="h-8 w-8" />}
                        title="No StorageClasses found"
                        subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Define storage classes for dynamic volume provisioning.'}
                        hasActiveFilters={!!(searchQuery || hasActiveFilters)}
                        onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
                        createLabel="Create StorageClass"
                        onCreate={() => setShowCreateWizard(true)}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  itemsOnPage.map((item, idx) => (
                    <motion.tr key={item.name} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(item.name) && 'bg-primary/5')}>
                      <TableCell><Checkbox checked={selectedItems.has(item.name)} onCheckedChange={() => toggleSelection(item)} aria-label={`Select ${item.name}`} /></TableCell>
                      <ResizableTableCell columnId="name">
                        <Link to={`/storageclasses/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
                          <Layers className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">{item.name}</span>
                          {item.isDefault && <Badge variant="default" className="text-xs">Default</Badge>}
                        </Link>
                      </ResizableTableCell>
                      <ResizableTableCell columnId="provisioner" className="font-mono text-sm">{item.provisioner}</ResizableTableCell>
                      <ResizableTableCell columnId="reclaimPolicy"><Badge variant="outline">{item.reclaimPolicy}</Badge></ResizableTableCell>
                      <ResizableTableCell columnId="volumeBindingMode" className="text-sm">{item.volumeBindingMode}</ResizableTableCell>
                      <ResizableTableCell columnId="allowVolumeExpansion"><Badge variant={item.allowVolumeExpansion ? 'default' : 'secondary'}>{item.allowVolumeExpansion ? 'Yes' : 'No'}</Badge></ResizableTableCell>
                      <ResizableTableCell columnId="pvCount" className="font-mono text-sm">
                        {pvCounts ? (pvCounts[item.name] ?? 0) : '—'}
                      </ResizableTableCell>
                      <ResizableTableCell columnId="default">
                        <Badge variant={item.isDefault ? 'default' : 'outline'}>{item.isDefault ? 'Yes' : 'No'}</Badge>
                      </ResizableTableCell>
                      <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="StorageClass actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => navigate(`/storageclasses/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/storageclasses/${item.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
                            {!item.isDefault && isConnected && (
                              <DropdownMenuItem
                                className="gap-2"
                                onClick={async () => {
                                  try {
                                    const DEFAULT_ANNO = 'storageclass.kubernetes.io/is-default-class';
                                    await patchSC.mutateAsync({
                                      name: item.name,
                                      namespace: '',
                                      patch: {
                                        metadata: {
                                          annotations: {
                                            [DEFAULT_ANNO]: 'true',
                                          },
                                        },
                                      },
                                    });
                                    const otherDefaults = items.filter((sc) => sc.isDefault && sc.name !== item.name);
                                    for (const sc of otherDefaults) {
                                      await patchSC.mutateAsync({
                                        name: sc.name,
                                        namespace: '',
                                        patch: {
                                          metadata: {
                                            annotations: {
                                              [DEFAULT_ANNO]: 'false',
                                            },
                                          },
                                        },
                                      });
                                    }
                                    toast.success(`"${item.name}" set as default StorageClass`);
                                    refetch();
                                  } catch (e) {
                                    toast.error(e instanceof Error ? e.message : 'Set as default failed');
                                  }
                                }}
                              >
                                <Star className="h-4 w-4" /> Set as Default
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}>Delete</DropdownMenuItem>
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

      {showCreateWizard && <ResourceCreator resourceKind="StorageClass" defaultYaml={DEFAULT_YAMLS.StorageClass} onClose={() => setShowCreateWizard(false)} onApply={() => { toast.success('StorageClass created'); setShowCreateWizard(false); refetch(); }} />}
      <DeleteConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null, bulk: open ? deleteDialog.bulk : false })}
        resourceType="StorageClass"
        resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name ?? '')}
        onConfirm={handleDelete}
        requireNameConfirmation={!deleteDialog.bulk}
      />
    </>
  );
}
