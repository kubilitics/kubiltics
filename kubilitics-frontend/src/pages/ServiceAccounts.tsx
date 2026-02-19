import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { UserCircle, Search, RefreshCw, MoreHorizontal, Loader2, WifiOff, Plus, ChevronDown, Filter, List, Layers, CheckSquare, Trash2 } from 'lucide-react';
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
import { usePaginatedResourceList, useDeleteK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { getServiceAccountTokenCounts } from '@/services/backendApiClient';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor';
import { DeleteConfirmDialog } from '@/components/resources';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ResourceCommandBar,
  ResourceExportDropdown,
  ListViewSegmentedControl,
  ListPagination,
  ListPageStatCard,
  ListPageHeader,
  TableColumnHeaderWithFilterAndSort,
  resourceTableRowClassName,
  ROW_MOTION,
  PAGE_SIZE_OPTIONS,
  AgeCell,
  TableEmptyState,
  CopyNameDropdownItem,
  NamespaceBadge,
  ResourceListTableToolbar,
  TableFilterCell,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';

interface ServiceAccountResource extends KubernetesResource {
  secrets?: Array<{ name?: string }>;
  imagePullSecrets?: Array<{ name?: string }>;
  automountServiceAccountToken?: boolean;
}

interface ServiceAccount {
  name: string;
  namespace: string;
  secrets: number;
  imagePullSecrets: number;
  tokens: number;
  usedByPods: string;
  roles: string;
  clusterRoles: string;
  permissions: string;
  automountToken: boolean;
  age: string;
  creationTimestamp?: string;
  isSystem: boolean;
  hasSecrets: boolean;
}

function transformServiceAccount(sa: ServiceAccountResource): ServiceAccount {
  const ns = sa.metadata.namespace || '';
  const name = sa.metadata.name || '';
  const isSystem = ns === 'kube-system' || name.startsWith('system:');
  const secretsCount = sa.secrets?.length ?? 0;
  return {
    name,
    namespace: ns || 'default',
    secrets: secretsCount,
    imagePullSecrets: sa.imagePullSecrets?.length ?? 0,
    tokens: 0,
    usedByPods: '–',
    roles: '–',
    clusterRoles: '–',
    permissions: '–',
    automountToken: sa.automountServiceAccountToken !== false,
    age: calculateAge(sa.metadata.creationTimestamp),
    creationTimestamp: sa.metadata?.creationTimestamp,
    isSystem,
    hasSecrets: secretsCount > 0,
  };
}

const SA_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'name', defaultWidth: 180, minWidth: 100 },
  { id: 'namespace', defaultWidth: 130, minWidth: 80 },
  { id: 'secrets', defaultWidth: 80, minWidth: 50 },
  { id: 'imagePullSecrets', defaultWidth: 120, minWidth: 80 },
  { id: 'tokens', defaultWidth: 70, minWidth: 50 },
  { id: 'usedByPods', defaultWidth: 90, minWidth: 60 },
  { id: 'roles', defaultWidth: 70, minWidth: 50 },
  { id: 'clusterRoles', defaultWidth: 90, minWidth: 60 },
  { id: 'permissions', defaultWidth: 100, minWidth: 70 },
  { id: 'automountToken', defaultWidth: 110, minWidth: 80 },
  { id: 'age', defaultWidth: 90, minWidth: 56 },
];

const SA_COLUMNS_FOR_VISIBILITY = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'imagePullSecrets', label: 'Image Pull Secrets' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'usedByPods', label: 'Used By Pods' },
  { id: 'roles', label: 'Roles' },
  { id: 'clusterRoles', label: 'Cluster Roles' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'automountToken', label: 'Auto-Mount Token' },
  { id: 'age', label: 'Age' },
];

export default function ServiceAccounts() {
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const clusterId = currentClusterId ?? null;

  const { data, isLoading, refetch, pagination: hookPagination } = usePaginatedResourceList<ServiceAccountResource>('serviceaccounts');
  const deleteResource = useDeleteK8sResource('serviceaccounts');

  const { data: tokenCounts } = useQuery({
    queryKey: ['backend', 'serviceaccount-token-counts', clusterId],
    queryFn: () => getServiceAccountTokenCounts(backendBaseUrl, clusterId!),
    enabled: !!(isBackendConfigured() && clusterId && isConnected),
    staleTime: 30_000,
  });

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: ServiceAccount | null; bulk?: boolean }>({ open: false, item: null });
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showCreator, setShowCreator] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [listView, setListView] = useState<'flat' | 'byNamespace'>('flat');
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  const allItems = (data?.allItems ?? []) as ServiceAccountResource[];
  const items: ServiceAccount[] = useMemo(() => {
    if (!isConnected) return [];
    const base = allItems.map(transformServiceAccount);
    if (!tokenCounts) return base;
    return base.map((sa) => ({
      ...sa,
      tokens: tokenCounts[`${sa.namespace}/${sa.name}`] ?? 0,
    }));
  }, [isConnected, allItems, tokenCounts]);

  const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.namespace)))], [items]);
  const itemsAfterNs = useMemo(() => (selectedNamespace === 'all' ? items : items.filter((i) => i.namespace === selectedNamespace)), [items, selectedNamespace]);

  const tableConfig: ColumnConfig<ServiceAccount>[] = useMemo(() => [
    { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
    { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
    { columnId: 'hasTokens', getValue: (i) => i.tokens > 0 ? 'Yes' : 'No', sortable: true, filterable: true },
    { columnId: 'hasImagePullSecrets', getValue: (i) => i.imagePullSecrets > 0 ? 'Yes' : 'No', sortable: true, filterable: true },
    { columnId: 'secrets', getValue: (i) => String(i.secrets), sortable: true, filterable: false, compare: (a, b) => a.secrets - b.secrets },
    { columnId: 'imagePullSecrets', getValue: (i) => String(i.imagePullSecrets), sortable: true, filterable: false, compare: (a, b) => a.imagePullSecrets - b.imagePullSecrets },
    { columnId: 'tokens', getValue: (i) => String(i.tokens), sortable: true, filterable: false, compare: (a, b) => a.tokens - b.tokens },
    { columnId: 'usedByPods', getValue: (i) => i.usedByPods, sortable: true, filterable: false },
    { columnId: 'roles', getValue: (i) => i.roles, sortable: true, filterable: false },
    { columnId: 'clusterRoles', getValue: (i) => i.clusterRoles, sortable: true, filterable: false },
    { columnId: 'permissions', getValue: (i) => i.permissions, sortable: true, filterable: false },
    { columnId: 'automountToken', getValue: (i) => String(i.automountToken), sortable: true, filterable: true },
    { columnId: 'age', getValue: (i) => i.age, sortable: true, filterable: false },
  ], []);

  const { filteredAndSortedItems: filteredItems, distinctValuesByColumn, valueCountsByColumn, columnFilters, setColumnFilter, sortKey, sortOrder, setSort, clearAllFilters, hasActiveFilters } = useTableFiltersAndSort(itemsAfterNs, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
  const columnVisibility = useColumnVisibility({ tableId: 'serviceaccounts', columns: SA_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

  const searchFiltered = useMemo(() => {
    if (!searchQuery.trim()) return filteredItems;
    const q = searchQuery.toLowerCase();
    return filteredItems.filter((sa) => sa.name.toLowerCase().includes(q) || sa.namespace.toLowerCase().includes(q));
  }, [filteredItems, searchQuery]);

  const stats = useMemo(() => {
    const total = items.length;
    const withTokens = items.filter((s) => s.tokens > 0).length;
    const withImagePullSecrets = items.filter((s) => s.imagePullSecrets > 0).length;
    const defaultNamed = items.filter((s) => s.name === 'default').length;
    return { total, withTokens, withImagePullSecrets, defaultNamed };
  }, [items]);

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
    rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No service accounts',
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
      for (const key of selectedItems) {
        const [ns, n] = key.split('/');
        if (n && ns) await deleteResource.mutateAsync({ name: n, namespace: ns });
      }
      toast.success(`Deleted ${selectedItems.size} service account(s)`);
      setSelectedItems(new Set());
    } else if (deleteDialog.item) {
      await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
      toast.success(`Service account ${deleteDialog.item.name} deleted`);
    }
    setDeleteDialog({ open: false, item: null });
    refetch();
  };

  const toggleSelection = (sa: ServiceAccount) => {
    const key = `${sa.namespace}/${sa.name}`;
    const next = new Set(selectedItems);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedItems(next);
  };
  const toggleAll = () => {
    if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(itemsOnPage.map((sa) => `${sa.namespace}/${sa.name}`)));
  };
  const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
  const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

  const exportConfig = {
    filenamePrefix: 'serviceaccounts',
    resourceLabel: 'Service Accounts',
    getExportData: (sa: ServiceAccount) => ({ name: sa.name, namespace: sa.namespace, secrets: sa.secrets, imagePullSecrets: sa.imagePullSecrets, tokens: sa.tokens, automountToken: sa.automountToken, age: sa.age }),
    csvColumns: [
      { label: 'Name', getValue: (sa: ServiceAccount) => sa.name },
      { label: 'Namespace', getValue: (sa: ServiceAccount) => sa.namespace },
      { label: 'Secrets', getValue: (sa: ServiceAccount) => String(sa.secrets) },
      { label: 'Image Pull Secrets', getValue: (sa: ServiceAccount) => String(sa.imagePullSecrets) },
      { label: 'Tokens', getValue: (sa: ServiceAccount) => String(sa.tokens) },
      { label: 'Age', getValue: (sa: ServiceAccount) => sa.age },
    ],
  };

  if (showCreator) {
    return (
      <ResourceCreator
        resourceKind="ServiceAccount"
        defaultYaml={DEFAULT_YAMLS.ServiceAccount}
        onClose={() => setShowCreator(false)}
        onApply={() => {
          toast.success('ServiceAccount created');
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
          icon={<UserCircle className="h-6 w-6 text-primary" />}
          title="Service Accounts"
          resourceCount={searchFiltered.length}
          subtitle={namespaces.length > 1 ? `across ${namespaces.length - 1} namespaces` : undefined}
          demoMode={!isConnected}
          isLoading={isLoading}
          onRefresh={() => refetch()}
          createLabel="Create"
          onCreate={() => setShowCreator(true)}
          actions={
            <>
              <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(sa) => `${sa.namespace}/${sa.name}`} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected service accounts' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
          <ListPageStatCard label="Total" value={stats.total} icon={UserCircle} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && 'ring-2 ring-primary')} />
          <ListPageStatCard label="With Tokens" value={stats.withTokens} icon={UserCircle} iconColor="text-[hsl(142,76%,36%)]" valueClassName="text-[hsl(142,76%,36%)]" selected={columnFilters.hasTokens?.size === 1 && columnFilters.hasTokens.has('Yes')} onClick={() => setColumnFilter('hasTokens', new Set(['Yes']))} className={cn(columnFilters.hasTokens?.size === 1 && columnFilters.hasTokens.has('Yes') && 'ring-2 ring-[hsl(142,76%,36%)]')} />
          <ListPageStatCard label="With Image Pull Secrets" value={stats.withImagePullSecrets} icon={UserCircle} iconColor="text-[hsl(217,91%,60%)]" valueClassName="text-[hsl(217,91%,60%)]" selected={columnFilters.hasImagePullSecrets?.size === 1 && columnFilters.hasImagePullSecrets.has('Yes')} onClick={() => setColumnFilter('hasImagePullSecrets', new Set(['Yes']))} className={cn(columnFilters.hasImagePullSecrets?.size === 1 && columnFilters.hasImagePullSecrets.has('Yes') && 'ring-2 ring-[hsl(217,91%,60%)]')} />
          <ListPageStatCard label="Default" value={stats.defaultNamed} icon={UserCircle} iconColor="text-muted-foreground" title="Named &quot;default&quot;" />
        </div>

        {/* Bulk Actions Bar */}
        {selectedItems.size > 0 && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <Badge variant="secondary" className="gap-1.5">
              <CheckSquare className="h-3.5 w-3.5" />
              {selectedItems.size} selected
            </Badge>
            <div className="flex items-center gap-2">
              <ResourceExportDropdown items={searchFiltered} selectedKeys={selectedItems} getKey={(sa) => `${sa.namespace}/${sa.name}`} config={exportConfig} selectionLabel="Selected service accounts" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
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
          hasActiveFilters={hasActiveFilters}
          onClearAllFilters={clearAllFilters}
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
              <Input placeholder="Search service accounts..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search service accounts" />
            </div>
          }
          structure={
            <ListViewSegmentedControl
              value={listView}
              onChange={(v) => setListView(v as 'flat' | 'byNamespace')}
              options={[
                { id: 'flat', label: 'Flat', icon: List },
                { id: 'byNamespace', label: 'By Namespace', icon: Layers },
              ]}
              label=""
              ariaLabel="List structure"
            />
          }
        />
          }
          showTableFilters={showTableFilters}
          onToggleTableFilters={() => setShowTableFilters((v) => !v)}
          columns={SA_COLUMNS_FOR_VISIBILITY}
          visibleColumns={columnVisibility.visibleColumns}
          onColumnToggle={columnVisibility.setColumnVisible}
          footer={
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">{pagination.rangeLabel}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">{pageSize} per page<ChevronDown className="h-4 w-4 opacity-50" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <DropdownMenuItem key={size} onClick={() => handlePageSizeChange(size)} className={cn(pageSize === size && 'bg-accent')}>{size} per page</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <ListPagination hasPrev={pagination.hasPrev} hasNext={pagination.hasNext} onPrev={pagination.onPrev} onNext={pagination.onNext} rangeLabel={undefined} currentPage={pagination.currentPage} totalPages={pagination.totalPages} onPageChange={pagination.onPageChange} dataUpdatedAt={pagination.dataUpdatedAt} isFetching={pagination.isFetching} />
          </div>
          }
        >
          <ResizableTableProvider tableId="serviceaccounts" columnConfig={SA_TABLE_COLUMNS}>
            <Table className="table-fixed" style={{ minWidth: 1100 }}>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
                  <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
                  <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="secrets"><TableColumnHeaderWithFilterAndSort columnId="secrets" label="Secrets" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="imagePullSecrets"><TableColumnHeaderWithFilterAndSort columnId="imagePullSecrets" label="Image Pull Secrets" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="tokens"><TableColumnHeaderWithFilterAndSort columnId="tokens" label="Tokens" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="usedByPods"><TableColumnHeaderWithFilterAndSort columnId="usedByPods" label="Used By Pods" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="roles"><TableColumnHeaderWithFilterAndSort columnId="roles" label="Roles" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="clusterRoles"><TableColumnHeaderWithFilterAndSort columnId="clusterRoles" label="Cluster Roles" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="permissions"><TableColumnHeaderWithFilterAndSort columnId="permissions" label="Permissions" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="automountToken"><TableColumnHeaderWithFilterAndSort columnId="automountToken" label="Auto-Mount Token" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => {}} /></ResizableTableHead>
                  <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
                </TableRow>
                {showTableFilters && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
                    <TableCell className="w-10" />
                    <ResizableTableCell columnId="name" className="p-1.5" />
                    <ResizableTableCell columnId="namespace" className="p-1.5"><TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} /></ResizableTableCell>
                    <ResizableTableCell columnId="secrets" className="p-1.5" />
                    <ResizableTableCell columnId="imagePullSecrets" className="p-1.5"><TableFilterCell columnId="hasImagePullSecrets" label="Image Pull Secrets" distinctValues={['Yes', 'No']} selectedFilterValues={columnFilters.hasImagePullSecrets ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.hasImagePullSecrets} /></ResizableTableCell>
                    <ResizableTableCell columnId="tokens" className="p-1.5"><TableFilterCell columnId="hasTokens" label="Has Tokens" distinctValues={['Yes', 'No']} selectedFilterValues={columnFilters.hasTokens ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.hasTokens} /></ResizableTableCell>
                    <ResizableTableCell columnId="usedByPods" className="p-1.5" />
                    <ResizableTableCell columnId="roles" className="p-1.5" />
                    <ResizableTableCell columnId="clusterRoles" className="p-1.5" />
                    <ResizableTableCell columnId="permissions" className="p-1.5" />
                    <ResizableTableCell columnId="automountToken" className="p-1.5"><TableFilterCell columnId="automountToken" label="Auto-Mount Token" distinctValues={distinctValuesByColumn.automountToken ?? []} selectedFilterValues={columnFilters.automountToken ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.automountToken} /></ResizableTableCell>
                    <ResizableTableCell columnId="age" className="p-1.5" />
                    <TableCell className="w-12" />
                  </TableRow>
                )}
              </TableHeader>
              <TableBody>
                {isLoading && isConnected ? (
                  <TableRow>
                    <TableCell colSpan={13} className="h-32 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Loading...</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : searchFiltered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="h-40 text-center">
                      <TableEmptyState
                        icon={<UserCircle className="h-8 w-8" />}
                        title="No ServiceAccounts found"
                        subtitle={searchQuery || hasActiveFilters ? 'Clear filters to see resources.' : 'Create a ServiceAccount for pod identity.'}
                        hasActiveFilters={!!(searchQuery || hasActiveFilters)}
                        onClearFilters={() => { setSearchQuery(''); clearAllFilters(); }}
                        createLabel="Create ServiceAccount"
                        onCreate={() => setShowCreator(true)}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  itemsOnPage.map((sa, idx) => (
                    <motion.tr key={`${sa.namespace}/${sa.name}`} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(`${sa.namespace}/${sa.name}`) && 'bg-primary/5')}>
                      <TableCell><Checkbox checked={selectedItems.has(`${sa.namespace}/${sa.name}`)} onCheckedChange={() => toggleSelection(sa)} aria-label={`Select ${sa.name}`} /></TableCell>
                      <ResizableTableCell columnId="name">
                        <Link to={`/serviceaccounts/${sa.namespace}/${sa.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
                          <UserCircle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">{sa.name}</span>
                        </Link>
                      </ResizableTableCell>
                      <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={sa.namespace} /></ResizableTableCell>
                      <ResizableTableCell columnId="secrets" className="font-mono text-sm">{sa.secrets}</ResizableTableCell>
                      <ResizableTableCell columnId="imagePullSecrets" className="font-mono text-sm">{sa.imagePullSecrets}</ResizableTableCell>
                      <ResizableTableCell columnId="tokens" className="font-mono text-sm">{sa.tokens}</ResizableTableCell>
                      <ResizableTableCell columnId="usedByPods" className="text-muted-foreground">{sa.usedByPods}</ResizableTableCell>
                      <ResizableTableCell columnId="roles" className="text-muted-foreground">{sa.roles}</ResizableTableCell>
                      <ResizableTableCell columnId="clusterRoles" className="text-muted-foreground">{sa.clusterRoles}</ResizableTableCell>
                      <ResizableTableCell columnId="permissions" className="text-muted-foreground">{sa.permissions}</ResizableTableCell>
                      <ResizableTableCell columnId="automountToken">{sa.automountToken ? 'Yes' : 'No'}</ResizableTableCell>
                      <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={sa.age} timestamp={sa.creationTimestamp} /></ResizableTableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60" aria-label="Service account actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <CopyNameDropdownItem name={sa.name} namespace={sa.namespace} />
                            <DropdownMenuItem onClick={() => navigate(`/serviceaccounts/${sa.namespace}/${sa.name}`)} className="gap-2">View Details</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/serviceaccounts/${sa.namespace}/${sa.name}?tab=permissions`)} className="gap-2">View Permissions</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/pods?namespace=${encodeURIComponent(sa.namespace)}`)} className="gap-2">View Pods</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => toast.info('Create Token not implemented')} className="gap-2">Create Token</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => navigate(`/serviceaccounts/${sa.namespace}/${sa.name}?tab=yaml`)} className="gap-2">Download YAML</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="gap-2 text-destructive" onClick={() => setDeleteDialog({ open: true, item: sa })} disabled={!isConnected}>Delete</DropdownMenuItem>
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
        resourceType="ServiceAccount"
        resourceName={deleteDialog.bulk ? `${selectedItems.size} selected` : (deleteDialog.item?.name || '')}
        namespace={deleteDialog.bulk ? undefined : deleteDialog.item?.namespace}
        onConfirm={handleDelete}
        requireNameConfirmation={!deleteDialog.bulk}
      />
    </>
  );
}
