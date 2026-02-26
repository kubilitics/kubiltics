import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search, RefreshCw, MoreHorizontal, Loader2, Layers, ChevronDown, CheckSquare, Trash2, FileText, Filter,
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

interface PodTemplate {
  name: string;
  namespace: string;
  labels: string;
  labelCount: number;
  age: string;
  creationTimestamp?: string;
}

interface K8sPodTemplate extends KubernetesResource {
  template?: { metadata?: { labels?: Record<string, string> }; spec?: unknown };
}

const PT_TABLE_COLUMNS: ResizableColumnConfig[] = [
  { id: 'name', defaultWidth: 220, minWidth: 120 },
  { id: 'namespace', defaultWidth: 130, minWidth: 80 },
  { id: 'labels', defaultWidth: 240, minWidth: 120 },
  { id: 'age', defaultWidth: 100, minWidth: 56 },
];

const PT_COLUMNS_FOR_VISIBILITY = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'labels', label: 'Labels' },
  { id: 'age', label: 'Age' },
];

function formatLabels(labels?: Record<string, string>): { str: string; count: number } {
  if (!labels || Object.keys(labels).length === 0) return { str: '—', count: 0 };
  const entries = Object.entries(labels).map(([k, v]) => `${k}=${v}`);
  return { str: entries.join(', '), count: entries.length };
}

function mapPodTemplate(pt: K8sPodTemplate): PodTemplate {
  const labels = pt.metadata?.labels ?? {};
  const { str, count } = formatLabels(labels);
  return {
    name: pt.metadata?.name ?? '',
    namespace: pt.metadata?.namespace ?? 'default',
    labels: str,
    labelCount: count,
    age: calculateAge(pt.metadata?.creationTimestamp),
    creationTimestamp: pt.metadata?.creationTimestamp,
  };
}

export default function PodTemplates() {
  const navigate = useNavigate();
  const { isConnected } = useConnectionStatus();
  const { data, isLoading, refetch, pagination: hookPagination } = usePaginatedResourceList<K8sPodTemplate>('podtemplates');
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: PodTemplate | null; bulk?: boolean }>({ open: false, item: null });
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const deleteResource = useDeleteK8sResource('podtemplates');
  const createPT = useCreateK8sResource('podtemplates');

  const allItems = (data?.allItems ?? []) as K8sPodTemplate[];
  const items: PodTemplate[] = useMemo(() => (isConnected ? allItems.map(mapPodTemplate) : []), [isConnected, allItems]);

  const namespaces = useMemo(() => ['all', ...Array.from(new Set(items.map((i) => i.namespace))).sort()], [items]);
  const itemsAfterNs = useMemo(() => (selectedNamespace === 'all' ? items : items.filter((i) => i.namespace === selectedNamespace)), [items, selectedNamespace]);

  const itemsAfterSearch = useMemo(
    () => itemsAfterNs.filter((i) =>
      i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.namespace.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.labels.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [itemsAfterNs, searchQuery]
  );

  const tableConfig: ColumnConfig<PodTemplate>[] = useMemo(
    () => [
      { columnId: 'name', getValue: (i) => i.name, sortable: true, filterable: false },
      { columnId: 'namespace', getValue: (i) => i.namespace, sortable: true, filterable: true },
      { columnId: 'labels', getValue: (i) => i.labels, sortable: true, filterable: false },
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
  const columnVisibility = useColumnVisibility({ tableId: 'podtemplates', columns: PT_COLUMNS_FOR_VISIBILITY, alwaysVisible: ['name'] });

  const stats = useMemo(() => ({
    total: items.length,
    namespaces: new Set(items.map((i) => i.namespace)).size,
    withLabels: items.filter((i) => i.labelCount > 0).length,
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
        if (n && ns) await deleteResource.mutateAsync({ name: n, namespace: ns });
      }
      toast.success(`Deleted ${selectedItems.size} pod template(s)`);
      setSelectedItems(new Set());
    } else if (deleteDialog.item) {
      await deleteResource.mutateAsync({ name: deleteDialog.item.name, namespace: deleteDialog.item.namespace });
      toast.success(`PodTemplate ${deleteDialog.item.name} deleted`);
    }
    setDeleteDialog({ open: false, item: null });
    refetch();
  };
  const handleCreate = () => setShowCreateWizard(true);
  const handleApplyCreate = async (yaml: string) => {
    try {
      await createPT.mutateAsync({ yaml });
      setShowCreateWizard(false);
      refetch();
    } catch (err) {
      // toast handled in hook
    }
  };

  const getItemKey = (item: PodTemplate) => `${item.namespace}/${item.name}`;
  const toggleSelection = (item: PodTemplate) => {
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
    rangeLabel: totalFiltered > 0 ? `Showing ${start + 1}–${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}` : 'No pod templates',
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
    filenamePrefix: 'podtemplates',
    resourceLabel: 'PodTemplates',
    getExportData: (v: PodTemplate) => ({ name: v.name, namespace: v.namespace, labels: v.labels, age: v.age }),
    csvColumns: [
      { label: 'Name', getValue: (v: PodTemplate) => v.name },
      { label: 'Namespace', getValue: (v: PodTemplate) => v.namespace },
      { label: 'Labels', getValue: (v: PodTemplate) => v.labels },
      { label: 'Age', getValue: (v: PodTemplate) => v.age },
    ],
    toK8sYaml: (v: PodTemplate) => `---
apiVersion: v1
kind: PodTemplate
metadata:
  name: ${v.name}
  namespace: ${v.namespace}
template:
  spec:
    containers: []
`,
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <ListPageHeader
        icon={<Layers className="h-6 w-6 text-primary" />}
        title="Pod Templates"
        resourceCount={filteredItems.length}
        subtitle="Namespaced · Pod template specs for workload controllers"
        demoMode={!isConnected}
        isLoading={isLoading}
        onRefresh={() => refetch()}
        createLabel="Create Pod Template"
        onCreate={handleCreate}
        actions={
          <>
            <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={getItemKey} config={exportConfig} selectionLabel={selectedItems.size > 0 ? 'Selected templates' : 'All visible'} onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} />
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
        <ListPageStatCard label="Total" value={stats.total} icon={Layers} iconColor="text-primary" selected={!hasActiveFilters} onClick={clearAllFilters} className={cn(!hasActiveFilters && 'ring-2 ring-primary')} />
        <ListPageStatCard label="Namespaces" value={stats.namespaces} icon={Layers} iconColor="text-muted-foreground" selected={false} onClick={() => { }} />
        <ListPageStatCard label="With Labels" value={stats.withLabels} icon={Layers} iconColor="text-muted-foreground" selected={false} onClick={() => { }} />
      </div>

      {selectedItems.size > 0 && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <Badge variant="secondary" className="gap-1.5">
            <CheckSquare className="h-3.5 w-3.5" />
            {selectedItems.size} selected
          </Badge>
          <div className="flex items-center gap-2">
            <ResourceExportDropdown items={filteredItems} selectedKeys={selectedItems} getKey={getItemKey} config={exportConfig} selectionLabel="Selected templates" onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))} triggerLabel={`Export (${selectedItems.size})`} />
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
                <Input placeholder="Search pod templates..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Search pod templates" />
              </div>
            }
          />
        }
        hasActiveFilters={hasActiveFilters}
        onClearAllFilters={clearAllFilters}
        showTableFilters={showTableFilters}
        onToggleTableFilters={() => setShowTableFilters((v) => !v)}
        columns={PT_COLUMNS_FOR_VISIBILITY}
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
        <ResizableTableProvider tableId="podtemplates" columnConfig={PT_TABLE_COLUMNS}>
          <Table className="table-fixed" style={{ minWidth: 680 }}>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50 border-b-2 border-border">
                <TableHead className="w-10"><Checkbox checked={isAllSelected} onCheckedChange={toggleAll} aria-label="Select all" className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')} /></TableHead>
                <ResizableTableHead columnId="name"><TableColumnHeaderWithFilterAndSort columnId="name" label="Name" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>
                {columnVisibility.isColumnVisible('namespace') && <ResizableTableHead columnId="namespace"><TableColumnHeaderWithFilterAndSort columnId="namespace" label="Namespace" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>}
                {columnVisibility.isColumnVisible('labels') && <ResizableTableHead columnId="labels"><TableColumnHeaderWithFilterAndSort columnId="labels" label="Labels" sortKey={sortKey} sortOrder={sortOrder} onSort={setSort} filterable={false} distinctValues={[]} selectedFilterValues={new Set()} onFilterChange={() => { }} /></ResizableTableHead>}
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
                  {columnVisibility.isColumnVisible('labels') && <ResizableTableCell columnId="labels" className="p-1.5" />}
                  {columnVisibility.isColumnVisible('age') && <ResizableTableCell columnId="age" className="p-1.5" />}
                  <TableCell className="w-12 p-1.5" />
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {isLoading && isConnected ? (
                <TableSkeletonRows columnCount={7} />
              ) : itemsOnPage.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-40 text-center">
                    <TableEmptyState
                      icon={<Layers className="h-8 w-8" />}
                      title="No Pod Templates found"
                      subtitle={searchQuery || hasActiveFilters || selectedNamespace !== 'all' ? 'Clear filters to see resources.' : 'PodTemplates define reusable pod specs. Used by Jobs, ReplicationControllers, and other workload controllers.'}
                      hasActiveFilters={!!(searchQuery || hasActiveFilters || selectedNamespace !== 'all')}
                      onClearFilters={() => { setSearchQuery(''); setSelectedNamespace('all'); clearAllFilters(); }}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                itemsOnPage.map((item, idx) => (
                  <motion.tr key={getItemKey(item)} initial={ROW_MOTION.initial} animate={ROW_MOTION.animate} transition={ROW_MOTION.transition(idx)} className={cn(resourceTableRowClassName, idx % 2 === 1 && 'bg-muted/5', selectedItems.has(getItemKey(item)) && 'bg-primary/5')}>
                    <TableCell><Checkbox checked={selectedItems.has(getItemKey(item))} onCheckedChange={() => toggleSelection(item)} /></TableCell>
                    <ResizableTableCell columnId="name">
                      <Link to={`/podtemplates/${item.namespace}/${item.name}`} className="font-medium text-primary hover:underline flex items-center gap-2 truncate">
                        <Layers className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="truncate">{item.name}</span>
                      </Link>
                    </ResizableTableCell>
                    {columnVisibility.isColumnVisible('namespace') && <ResizableTableCell columnId="namespace"><NamespaceBadge namespace={item.namespace} /></ResizableTableCell>}
                    {columnVisibility.isColumnVisible('labels') && <ResizableTableCell columnId="labels" className="text-sm text-muted-foreground truncate max-w-[200px]" title={item.labels}>{item.labels}</ResizableTableCell>}
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
                          <DropdownMenuItem onClick={() => navigate(`/podtemplates/${item.namespace}/${item.name}`)} className="gap-2">View Details</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => navigate(`/podtemplates/${item.namespace}/${item.name}?tab=yaml`)} className="gap-2"><FileText className="h-4 w-4" />Download YAML</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="gap-2 text-[hsl(0,72%,51%)]" onClick={() => setDeleteDialog({ open: true, item })} disabled={!isConnected}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
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

      <DeleteConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, item: open ? deleteDialog.item : null })}
        resourceType="PodTemplate"
        resourceName={deleteDialog.bulk ? `${selectedItems.size} pod templates` : (deleteDialog.item?.name || '')}
        namespace={deleteDialog.item?.namespace}
        onConfirm={handleDelete}
      />

      {showCreateWizard && (
        <ResourceCreator
          resourceKind="PodTemplate"
          onClose={() => setShowCreateWizard(false)}
          onApply={handleApplyCreate}
          defaultYaml={DEFAULT_YAMLS.PodTemplate}
        />
      )}
    </motion.div>
  );
}
