/**
 * Generic ResourceListPage component driven by ResourceKindConfig.
 *
 * Renders a complete list page for any Kubernetes resource kind with:
 *  - Stat cards (total, status breakdown)
 *  - Search, namespace filter, column visibility
 *  - Sortable, filterable, resizable table
 *  - Row actions (delete, scale, etc.)
 *  - Pagination
 *  - Dark mode, keyboard navigation, Framer Motion row animation
 *
 * TASK-SCALE-002
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Search, RefreshCw, MoreHorizontal, Loader2, WifiOff, Plus, ChevronDown,
  ChevronLeft, ChevronRight, List, Layers,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ResizableTableProvider, ResizableTableHead, ResizableTableCell,
  type ResizableColumnConfig,
} from '@/components/ui/resizable-table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import {
  StatusPill, ListPagination, PAGE_SIZE_OPTIONS,
  resourceTableRowClassName, ROW_MOTION, ListPageHeader,
  TableEmptyState, TableErrorState, ListPageLoadingShell,
  NamespaceBadge, CopyNameDropdownItem, CriticalityBadge,
  type StatusPillVariant,
} from '@/components/list';
import { useCriticalityScores, type CriticalityEntry } from '@/hooks/useCriticalityScores';
import { cn } from '@/lib/utils';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  useK8sResourceList, useDeleteK8sResource, calculateAge,
  type KubernetesResource,
} from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useClusterStore } from '@/stores/clusterStore';
import { toast } from '@/components/ui/sonner';
import type {
  ResourceKindConfig, ResourceColumnDef, ResourceActionDef,
} from '@/lib/resourceKindConfig';
import { resolveAccessorPath } from '@/lib/resourceKindConfig';

// ── Props ──────────────────────────────────────────────────────────────────────

export interface ResourceListPageProps {
  /** Resource kind configuration */
  config: ResourceKindConfig;
  /** Override the namespace filter (e.g. from parent page) */
  namespace?: string;
  /** Extra header actions */
  headerActions?: React.ReactNode;
  /** Custom row click handler (overrides default navigation) */
  onRowClick?: (resource: KubernetesResource) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getStatusFromResource(resource: KubernetesResource): StatusPillVariant {
  const phase = (resource.status as Record<string, unknown>)?.phase;
  if (typeof phase === 'string') {
    const p = phase.toLowerCase();
    if (['running', 'active', 'bound', 'available', 'ready', 'succeeded'].includes(p)) return 'healthy';
    if (['pending', 'terminating'].includes(p)) return 'warning';
    if (['failed', 'error', 'crashloopbackoff'].includes(p)) return 'error';
  }
  // Check conditions
  const conditions = (resource.status as Record<string, unknown>)?.conditions;
  if (Array.isArray(conditions)) {
    const readyCond = conditions.find((c: Record<string, unknown>) => c.type === 'Ready' || c.type === 'Available');
    if (readyCond) {
      return (readyCond as Record<string, unknown>).status === 'True' ? 'healthy' : 'warning';
    }
  }
  return 'neutral';
}

function formatCellValue(value: unknown, renderer?: ResourceColumnDef['cellRenderer']): string {
  if (value === undefined || value === null) return '-';

  switch (renderer) {
    case 'count':
      if (Array.isArray(value)) return String(value.length);
      if (typeof value === 'object' && value !== null) return String(Object.keys(value).length);
      return String(value ?? 0);
    case 'age':
      if (typeof value === 'string') return calculateAge(value);
      return '-';
    case 'status':
      if (typeof value === 'string') return value;
      return '-';
    default:
      if (Array.isArray(value)) return value.map(String).join(', ');
      if (typeof value === 'object' && value !== null) return JSON.stringify(value);
      return String(value);
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ResourceListPage({
  config,
  namespace: overrideNamespace,
  headerActions,
  onRowClick,
}: ResourceListPageProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isOnline } = useConnectionStatus();
  const activeNamespace = useClusterStore((s) => s.activeNamespace);
  const effectiveNamespace = overrideNamespace ?? (activeNamespace !== 'All Namespaces' ? activeNamespace : undefined);

  // ── State ────────────────────────────────────────────────────────────────

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<string | null>(config.defaultSortColumn ?? 'name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(config.defaultSortDirection ?? 'asc');

  // ── Data ─────────────────────────────────────────────────────────────────

  const { data, isLoading, isError, error, refetch, isFetching } = useK8sResourceList(
    config.plural as Parameters<typeof useK8sResourceList>[0],
    config.namespaced ? effectiveNamespace : undefined,
    { refetchInterval: 15_000 },
  );

  const items = useMemo(() => data?.items ?? [], [data]);

  // ── Criticality Scores ──────────────────────────────────────────────────
  const { data: criticalityMap } = useCriticalityScores(effectiveNamespace);

  const getCriticality = useCallback(
    (resource: KubernetesResource): CriticalityEntry | undefined => {
      if (!criticalityMap) return undefined;
      const kind = resource.kind ?? config.kind;
      const ns = resource.metadata.namespace;
      const name = resource.metadata.name;
      // Try namespaced key first, then simple key
      return criticalityMap.get(`${kind}/${ns}/${name}`) ?? criticalityMap.get(`${kind}/${name}`);
    },
    [criticalityMap, config.kind],
  );

  const deleteMutation = useDeleteK8sResource();

  // ── Filter & Sort ────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((item) => {
      const name = item.metadata.name?.toLowerCase() ?? '';
      const ns = item.metadata.namespace?.toLowerCase() ?? '';
      return name.includes(q) || ns.includes(q);
    });
  }, [items, search]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    // Special handling for criticality sort
    if (sortKey === 'criticality') {
      return [...filtered].sort((a, b) => {
        const ca = getCriticality(a);
        const cb = getCriticality(b);
        const sa = ca?.score ?? -1;
        const sb = cb?.score ?? -1;
        const cmp = sa - sb;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    const col = config.columns.find((c) => c.id === sortKey);
    if (!col) return filtered;
    return [...filtered].sort((a, b) => {
      const va = resolveAccessorPath(a as unknown as Record<string, unknown>, col.accessorPath);
      const vb = resolveAccessorPath(b as unknown as Record<string, unknown>, col.accessorPath);
      const sa = formatCellValue(va, col.cellRenderer);
      const sb = formatCellValue(vb, col.cellRenderer);
      const cmp = sa.localeCompare(sb, undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir, config.columns, getCriticality]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paginated = sorted.slice((page - 1) * pageSize, page * pageSize);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSort = useCallback((colId: string) => {
    if (sortKey === colId) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(colId);
      setSortDir('asc');
    }
  }, [sortKey]);

  const handleRowClick = useCallback((resource: KubernetesResource) => {
    if (onRowClick) {
      onRowClick(resource);
      return;
    }
    const ns = resource.metadata.namespace;
    const name = resource.metadata.name;
    const route = config.namespaced
      ? config.detailRoute.replace(':namespace', ns ?? '').replace(':name', name)
      : config.detailRoute.replace(':name', name);
    navigate(route);
  }, [onRowClick, config, navigate]);

  const handleAction = useCallback((action: ResourceActionDef, resource: KubernetesResource) => {
    switch (action.kind) {
      case 'delete':
        if (window.confirm(`Delete ${config.kind} "${resource.metadata.name}"?`)) {
          deleteMutation.mutate(
            {
              resourceType: config.plural as Parameters<typeof useDeleteK8sResource>[0] extends (...args: infer P) => unknown ? never : never,
              name: resource.metadata.name,
              namespace: resource.metadata.namespace,
            } as never,
            {
              onSuccess: () => toast.success(`Deleted ${resource.metadata.name}`),
              onError: (err) => toast.error(`Failed to delete: ${(err as Error).message}`),
            },
          );
        }
        break;
      default:
        toast.info(`Action "${action.label}" for ${resource.metadata.name}`);
    }
  }, [config, deleteMutation]);

  const toggleSelect = useCallback((uid: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === paginated.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginated.map((r) => r.metadata.uid)));
    }
  }, [paginated, selectedIds]);

  // ── Visible Columns ──────────────────────────────────────────────────────

  const visibleColumns = useMemo(
    () => config.columns.filter((c) => c.defaultVisible !== false),
    [config.columns],
  );

  const resizableColumns: ResizableColumnConfig[] = useMemo(
    () => visibleColumns.map((c) => ({
      id: c.id,
      header: c.header,
      minWidth: c.minWidth ?? 60,
      defaultWidth: c.defaultWidth ?? 120,
    })),
    [visibleColumns],
  );

  // ── Stat Cards ───────────────────────────────────────────────────────────

  const statTotal = items.length;
  const statHealthy = items.filter((r) => getStatusFromResource(r) === 'healthy').length;
  const statWarning = items.filter((r) => getStatusFromResource(r) === 'warning').length;
  const statError = items.filter((r) => getStatusFromResource(r) === 'error').length;

  // ── Loading / Error ──────────────────────────────────────────────────────

  if (isLoading) {
    return <ListPageLoadingShell />;
  }

  const Icon = config.icon;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground dark:text-foreground">
            {config.displayNamePlural}
          </h1>
          <Badge variant="secondary" className="text-xs">
            {statTotal}
          </Badge>
          {!isOnline && <WifiOff className="h-4 w-4 text-amber-500" />}
        </div>
        <div className="flex items-center gap-2">
          {headerActions}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={statTotal} />
        <StatCard label="Healthy" value={statHealthy} color="emerald" />
        <StatCard label="Warning" value={statWarning} color="amber" />
        <StatCard label="Error" value={statError} color="red" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={`Search ${config.displayNamePlural.toLowerCase()}...`}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
      </div>

      {/* Table */}
      {isError ? (
        <TableErrorState message={(error as Error)?.message ?? 'Failed to load resources'} onRetry={() => refetch()} />
      ) : paginated.length === 0 ? (
        <TableEmptyState resource={config.displayNamePlural} />
      ) : (
        <div className="rounded-lg border border-border dark:border-border bg-card dark:bg-card overflow-x-auto">
          <ResizableTableProvider columns={resizableColumns} tableId={`factory-${config.plural}`}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedIds.size === paginated.length && paginated.length > 0}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                  {visibleColumns.map((col) => (
                    <ResizableTableHead
                      key={col.id}
                      columnId={col.id}
                      className={cn(
                        col.sortable && 'cursor-pointer select-none',
                        'text-xs font-medium text-muted-foreground uppercase tracking-wider',
                      )}
                      onClick={col.sortable ? () => handleSort(col.id) : undefined}
                    >
                      <span className="flex items-center gap-1">
                        {col.header}
                        {sortKey === col.id && (
                          <span className="text-foreground">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
                        )}
                      </span>
                    </ResizableTableHead>
                  ))}
                  {criticalityMap && criticalityMap.size > 0 && (
                    <TableHead
                      className="cursor-pointer select-none text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-[100px] w-[120px]"
                      onClick={() => handleSort('criticality')}
                    >
                      <span className="flex items-center gap-1">
                        Criticality
                        {sortKey === 'criticality' && (
                          <span className="text-foreground">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
                        )}
                      </span>
                    </TableHead>
                  )}
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((resource) => {
                  const uid = resource.metadata.uid;
                  return (
                    <motion.tr
                      key={uid}
                      {...ROW_MOTION}
                      className={resourceTableRowClassName}
                      onClick={() => handleRowClick(resource)}
                    >
                      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(uid)}
                          onCheckedChange={() => toggleSelect(uid)}
                          aria-label={`Select ${resource.metadata.name}`}
                        />
                      </TableCell>
                      {visibleColumns.map((col) => {
                        const raw = resolveAccessorPath(resource as unknown as Record<string, unknown>, col.accessorPath);
                        return (
                          <ResizableTableCell key={col.id} columnId={col.id}>
                            {col.cellRenderer === 'status' ? (
                              <StatusPill variant={getStatusFromResource(resource)} label={formatCellValue(raw, col.cellRenderer)} />
                            ) : col.cellRenderer === 'namespace' ? (
                              <NamespaceBadge namespace={String(raw ?? '-')} />
                            ) : col.cellRenderer === 'age' ? (
                              <span className="text-muted-foreground text-xs">{formatCellValue(raw, 'age')}</span>
                            ) : col.cellRenderer === 'link' ? (
                              <span className="font-medium text-foreground dark:text-foreground">{String(raw ?? '-')}</span>
                            ) : (
                              <span className="text-sm">{formatCellValue(raw, col.cellRenderer)}</span>
                            )}
                          </ResizableTableCell>
                        );
                      })}
                      {criticalityMap && criticalityMap.size > 0 && (
                        <TableCell className="min-w-[100px] w-[120px]">
                          {(() => {
                            const entry = getCriticality(resource);
                            if (!entry) return null;
                            return (
                              <CriticalityBadge
                                level={entry.level}
                                blastRadius={entry.blastRadius}
                                isSPOF={entry.isSPOF}
                              />
                            );
                          })()}
                        </TableCell>
                      )}
                      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <CopyNameDropdownItem name={resource.metadata.name} />
                            <DropdownMenuSeparator />
                            {config.actions.map((action) => (
                              <DropdownMenuItem
                                key={action.kind}
                                onClick={() => handleAction(action, resource)}
                                className={action.destructive ? 'text-red-600 dark:text-red-400' : undefined}
                              >
                                <action.icon className="mr-2 h-4 w-4" />
                                {action.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </motion.tr>
                  );
                })}
              </TableBody>
            </Table>
          </ResizableTableProvider>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, sorted.length)} of {sorted.length}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm" disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button
            variant="outline" size="sm" disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

ResourceListPage.displayName = 'ResourceListPage';

// ── Stat Card Sub-Component ────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  const colorClasses = color
    ? `text-${color}-600 dark:text-${color}-400`
    : 'text-foreground dark:text-foreground';

  return (
    <div className="rounded-lg border border-border dark:border-border bg-card dark:bg-card p-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={cn('text-2xl font-bold', colorClasses)}>{value}</p>
    </div>
  );
}
