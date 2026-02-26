import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search, RefreshCw, MoreHorizontal, Loader2, History, ChevronDown, CheckSquare, Trash2, FileText, Filter,
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
import {
  ResourceCommandBar,
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
  NamespaceBadge,
  ResourceListTableToolbar,
} from '@/components/list';
import { useTableFiltersAndSort, type ColumnConfig } from '@/hooks/useTableFiltersAndSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { usePaginatedResourceList, useDeleteK8sResource, useCreateK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { DeleteConfirmDialog } from '@/components/resources';
import { ResourceCreator, DEFAULT_YAMLS } from '@/components/editor/ResourceCreator';
import { toast } from 'sonner';

interface ControllerRevision {
  name: string;
  namespace: string;
  ownerKind: string;
  ownerName: string;
  revision: number;
  age: string;
  creationTimestamp?: string;
}

interface K8sControllerRevision extends KubernetesResource {
  metadata: KubernetesResource['metadata'] & {
    ownerReferences?: Array<{ kind: string; name: string }>;
  };
  revision: number;
}

const CR_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'name', defaultWidth: 260, minWidth: 140 },
  { id: 'namespace', defaultWidth: 130, minWidth: 80 },
  { id: 'owner', defaultWidth: 220, minWidth: 140 },
  { id: 'revision', defaultWidth: 100, minWidth: 70 },
  { id: 'age', defaultWidth: 100, minWidth: 56 },
];

const CR_COLUMNS_FOR_VISIBILITY = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'owner', label: 'Owner' },
  { id: 'revision', label: 'Revision' },
  { id: 'age', label: 'Age' },
];

function mapCR(cr: K8sControllerRevision): ControllerRevision {
  const ownerRef = cr.metadata?.ownerReferences?.find((r) => r.kind === 'StatefulSet' || r.kind === 'DaemonSet');
  return {
    name: cr.metadata?.name ?? '',
    namespace: cr.metadata?.namespace ?? 'default',
    ownerKind: ownerRef?.kind ?? '—',
    ownerName: ownerRef?.name ?? '—',
    revision: (cr as { revision?: number }).revision ?? 0,
    age: calculateAge(cr.metadata?.creationTimestamp),
    creationTimestamp: cr.metadata?.creationTimestamp,
  };
}

function ownerLink(item: ControllerRevision): string | null {
  if (item.ownerKind === 'StatefulSet' && item.ownerName !== '—') {
    return `/statefulsets/${item.namespace}/${item.ownerName}`;
  }
  if (item.ownerKind === 'DaemonSet' && item.ownerName !== '—') {
    return `/daemonsets/${item.namespace}/${item.ownerName}`;
  }
  return null;
}

export default function ControllerRevisions() {
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const { data, isLoading, refetch, pagination: hookPagination } = usePaginatedResourceList<K8sControllerRevision>('controllerrevisions');
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: ControllerRevision | null; bulk?: boolean }>({ open: false, item: null });
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const deleteCR = useDeleteK8sResource('controllerrevisions');
  const createCR = useCreateK8sResource('controllerrevisions');

  const allItems = (data?.allItems ?? []) as K8sControllerRevision[];
  const items: ControllerRevision[] = useMemo(() => (isConnected ? allItems.map(mapCR) : []), [isConnected, allItems]);

  const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.namespace))).sort()], [items]);
  const itemsAfterNs = useMemo(() => (selectedNamespace === 'all' ? items : items.filter((i) => i.namespace === selectedNamespace)), [items, selectedNamespace]);

  const itemsAfterSearch = useMemo(
    () => itemsAfterNs.filter((i) =>
      i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.namespace.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.ownerName.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [itemsAfterNs, searchQuery]
  );

  const tableConfig: ColumnConfig<ControllerRevision>[] = useMemo(
    () => [
      { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
      { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
      { columnId: 'owner', getValue: (i) => `${i.ownerKind}/${i.ownerName}`, sortable: true, filterable: true },
      { columnId: 'revision', getValue: (i) => String(i.revision), sortable: true, filterable: false },
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
  } = useTableFiltersAndSort(itemsAfterSearch, { columns: tableConfig, defaultSortKey: 'name', defaultSortOrder: 'asc' });
  const columnVisibility = useColumnVisibility({ tableId: 'controllerrevisions', columns: CR_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

  const stats = useMemo(() => ({
    total: items.length,
    statefulSets: items.filter((i) => i.ownerKind === 'StatefulSet').length,
    daemonSets: items.filter((i) => i.ownerKind === 'DaemonSet').length,
  }), [items]);

  const totalFiltered = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const itemsOnPage = filteredItems.slice(start, start + pageSize);

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
      for (const key of selectedItems) {
        const [ns, n] = key.split('/');
        if (n && ns) await deleteCR.mutateAsync({ name: n, namespace: ns });
      }
      toast.success(`Deleted ${selectedItems.size} controller revision(s)`);
      setSelectedItems(new Set());
    } else if (deleteDialog.item) {
      await deleteCR.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
      toast.success(`ControllerRevision ${deleteDialog.item.name} deleted`);
    }
    setDeleteDialog({ open: false, item: null });
    refetch();
  };
  const handleCreate = () => setShowCreateWizard(true);
  const handleApplyCreate = async (yaml: string) => {
    try {
      await createCR.mutateAsync({ yaml });
      setShowCreateWizard(false);
      refetch();
    } catch (err) {
      // toast handled in hook
    }
  };

  const getItemKey = (item: ControllerRevision) => `${item.namespace}/${item.name}`;
  const toggleSelection = (item: ControllerRevision) => {
    const key = getItemKey(item);
    const next = new Set(selectedItems);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedItems(next);
  };
  const toggleAll = () => {
    if (selectedItems.size === itemsOnPage.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(itemsOnPage.map(getItemKey)));
  };
  const isAllSelected = itemsOnPage.length > 0 && selectedItems.size === itemsOnPage.length;
  const isSomeSelected = selectedItems.size > 0 && selectedItems.size < itemsOnPage.length;

  const pagination = {
    rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No controller revisions',
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
    filenamePrefix: 'controllerrevisions',
    resourceLabel: 'ControllerRevisions',
    getExportData: (v: ControllerRevision) => ({ name: v.name, namespace: v.namespace, owner: `${v.ownerKind}/${v.ownerName}`, revision: v.revision, age: v.age }),
    csvColumns: [
      { label: 'Name', getValue: (v: ControllerRevision) => v.name },
      { label: 'Namespace', getValue: (v: ControllerRevision) => v.namespace },
      { label: 'Owner', getValue: (v: ControllerRevision) => `${v.ownerKind}/${v.ownerName}` },
      { label: 'Revision', getValue: (v: ControllerRevision) => String(v.revision) },
      { label: 'Age', getValue: (v: ControllerRevision) => v.age },
    ],
    toK8sYaml: () => 'ControllerRevisions are managed by StatefulSets and DaemonSets.',
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <ListPageHeader
        icon={<History className="h-6 w-6 text-primary" />}
        title="Controller Revisions"
        resourceCount={filteredItems.length}
        subtitle="Namespace-scoped · StatefulSet/DaemonSet history"
        demoMode={!isConnected}
        isLoading={isLoading}
        onRefresh={() => refetch()}
        createLabel="Create Controller Revision"
        onCreate={handleCreate}
        actions={
          <>
            <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={getItemKey} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected revisions' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
            {selectedItems.size > 0 && (
              <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete {selectedItems.size} selected
              </Button>
            )}
          </>
        }
      />

      <div className={cn('grid grid-cols-2 sm:grid-cols-3 gap-4', !isConnected && 'opacity-60')}>
        <ListPageStatCard label="Total" value={stats.total} icon={History} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && 'ring-2 ring-primary')} />
        <ListPageStatCard label="StatefulSets" value={stats.statefulSets} icon={History} iconColor="text-muted-foreground" selected={false} onClick={() => { }} />
        <ListPageStatCard label="DaemonSets" value={stats.daemonSets} icon={History} iconColor="text-muted-foreground" selected={false} onClick={() => { }} />
      </div>

      {selectedItems.size > 0 && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <Badge variant="secondary" className="gap-1.5">
            <CheckSquare className="h-3.5 w-3.5" />
            {selectedItems.size} selected
          </Badge>
          <div className="flex items-center gap-2">
            <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={getItemKey} config={exportConfig} selectionLabel="Selected revisions" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleteDialog({ open: true, item: null, bulk: true })}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete selected
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedItems(new Set())}>Clear</Button>
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
                <Input placeholder="Search controller revisions..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search controller revisions" />
              </div>
            }
          />
        }
        hasActiveFilters={hasActiveFilters}
        onClearAllFilters={clearAllFilters}
        showTableFilters={showTableFilters}
        onToggleTableFilters={() => setShowTableFilters((v) => !v)}
        columns={CR_COLUMNS_FOR_VISIBILITY}
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
        <ResizableTableProvider tableId="controllerrevisions" columnConfig={CR_TABLE_COLUMNS}>
          <Table className="table-fixed" style={{ minWidth: 780 }}>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
                <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
                <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                {columnVisibility.isColumnVisible('namespace') && <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>}
                {columnVisibility.isColumnVisible('owner') && <ResizableTableHead columnId="owner"><TableColumnHeaderWithFilterAndSort columnId="owner" label="Owner" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>}
                {columnVisibility.isColumnVisible('revision') && <ResizableTableHead columnId="revision"><TableColumnHeaderWithFilterAndSort columnId="revision" label="Revision" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>}
                {columnVisibility.isColumnVisible('age') && <ResizableTableHead columnId="age"><TableColumnHeaderWithFilterAndSort columnId="age" label="Age" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>}
                <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>
              </TableRow>
              {showTableFilters && (
                <TableRow className="bg-muted/30 hover:bg-muted/30 border-b-2 border-border">
                  <TableCell className="w-10 p-1.5" />
                  <ResizableTableCell columnId="name" className="p-1.5" />
                  {columnVisibility.isColumnVisible('namespace') && (
                    <ResizableTableCell columnId="namespace" className="p-1.5">
                      <TableFilterCell columnId="namespace" label="Namespace" distinctValues={distinctValuesByColumn.namespace ?? []} selectedFilterValues={columnFilters.namespace ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.namespace} />
                    </ResizableTableCell>
                  )}
                  {columnVisibility.isColumnVisible('owner') && (
                    <ResizableTableCell columnId="owner" className="p-1.5">
                      <TableFilterCell columnId="owner" label="Owner" distinctValues={distinctValuesByColumn.owner ?? []} selectedFilterValues={columnFilters.owner ?? new Set()} onFilterChange={setColumnFilter} valueCounts={valueCountsByColumn.owner} />
                    </ResizableTableCell>
                  )}
                  {columnVisibility.isColumnVisible('revision') && <ResizableTableCell columnId="revision" className="p-1.5" />}
                  {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
                  <TableCell className="w-12 p-1.5" />
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {isLoading && isConnected ? (
                <TableSkeletonRows columnCount={8} />
              ) : itemsOnPage.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-40 text-center">
                    <TableEmptyState
                      icon={<History className="h-8 w-8" />}
                      title="No Controller Revisions found"
                      subtitle={searchQuery || hasActiveFilters || selectedNamespace !== 'all' ? 'Clear filters to see resources.' : 'ControllerRevisions store revision history for StatefulSets and DaemonSets. They are created automatically when you update workloads.'}
                      hasActiveFilters={!!(searchQuery || hasActiveFilters || selectedNamespace !== 'all')}
                      onClearFilters={() => { setSearchQuery(''); setSelectedNamespace('all'); clearAllFilters(); }}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                itemsOnPage.map((item, idx) => {
                  const link = ownerLink(item);
                  return (
                    <motion.tr key={getItemKey(item)} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(getItemKey(item)) && 'bg-primary/5')}>
                      <TableCell><Checkbox checked={selectedItems.has(getItemKey(item))} onCheckedChange={() => toggleSelection(item)} /></TableCell>
                      <ResizableTableCell columnId="name">
                        <Link to={`/controllerrevisions/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
                          <History className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="truncate font-mono text-sm">{item.name}</span>
                        </Link>
                      </ResizableTableCell>
                      {columnVisibility.isColumnVisible('namespace') && <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} /></ResizableTableCell>}
                      {columnVisibility.isColumnVisible('owner') && <ResizableTableCell columnId="owner">{link ? (<Link to={link} className="text-primary hover:underline font-mono text-sm truncate block">{item.ownerKind}/{item.ownerName}</Link>) : (<span className="truncate text-muted-foreground">{item.ownerKind}/{item.ownerName}</span>)}</ResizableTableCell>}
                      {columnVisibility.isColumnVisible('revision') && <ResizableTableCell columnId="revision"><Badge variant="outline" className="font-mono">{item.revision}</Badge></ResizableTableCell>}
                      {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="text-muted-foreground whitespace-nowrap"><AgeCell age={item.age} timestamp={item.creationTimestamp} /></ResizableTableCell>}
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" aria-label="Actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <CopyNameDropdownItem name={item.name} />
                            <DropdownMenuItem onClick={() => navigate(`/controllerrevisions/${item.namespace}/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
                            {link && (
                              <DropdownMenuItem asChild>
                                <Link to={link} className="gap-2">View {item.ownerKind}</Link>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => navigate(`/controllerrevisions/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="gap-2 text-[hsl(0,72%,51%)]" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
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

      <DeleteConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
        resourceType="ControllerRevision"
        resourceName={deleteDialog.bulk ? `${selectedItems.size} controller revisions` : (deleteDialog.item?.name || '')}
        namespace={deleteDialog.item?.namespace}
        onConfirm={handleDelete}
      />

      {showCreateWizard && (
        <ResourceCreator
          resourceKind="ControllerRevision"
          onClose={() => setShowCreateWizard(false)}
          onApply={handleApplyCreate}
          defaultYaml={DEFAULT_YAMLS.ControllerRevision}
        />
      )}
    </motion.div>
  );
}
