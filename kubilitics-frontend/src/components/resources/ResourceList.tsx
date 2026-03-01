import { useState, ReactNode, useRef, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Search,
  Filter,
  ChevronDown,
  RefreshCw,
  MoreHorizontal,
  Download,
  Plus,
  LucideIcon,
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
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ResourceExportDropdown, ResourceTableRow, resourceTableRowClassName, ListPagination, ResourceCommandBar, type ResourceExportConfig } from '@/components/list';
import { buildAutoWidthColumns } from '@/lib/tableSizing';

export interface ResourceListPagination {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  rangeLabel?: string;
  /** 1-based current page; when set with totalPages, page number buttons are shown. */
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
}

/** When item count exceeds this, the table body is virtualized (C2.1) to avoid freezing the UI. */
const VIRTUAL_THRESHOLD = 100;
const ROW_HEIGHT_PX = 48;
const VIRTUAL_LIST_HEIGHT = 500;

export interface Column<T> {
  key: string;
  header: string;
  render: (item: T) => ReactNode;
  className?: string;
}

export interface ResourceListProps<T extends object> {
  title: string;
  icon: LucideIcon;
  items: T[];
  columns: Column<T>[];
  getRowLink: (item: T) => string;
  getItemKey: (item: T) => string;
  searchPlaceholder?: string;
  filterKey?: keyof T;
  filterLabel?: string;
  actions?: { label: string; onClick?: (item: T) => void; destructive?: boolean }[];
  onRefresh?: () => void;
  onCreate?: () => void;
  isLoading?: boolean;
  pagination?: ResourceListPagination;
  /** When provided, the Export button becomes a dropdown with JSON, YAML, CSV, and optional K8s YAML. */
  exportConfig?: ResourceExportConfig<T>;
  /** When provided, table columns are resizable (drag column edges). Use a stable tableId per list (e.g. "configmaps"). */
  resizableTableId?: string;
  /** Optional column widths for resizable table. Defaults to 150px per column when resizableTableId is set. */
  resizableColumnConfig?: ResizableColumnConfig[];
  /** When provided with pagination, only this many items are shown per page (table shows current page slice of filteredItems). */
  pageSize?: number;
}

export function ResourceList<T extends object>({
  title,
  icon: Icon,
  items,
  columns,
  getRowLink,
  getItemKey,
  searchPlaceholder = 'Search...',
  filterKey,
  filterLabel = 'Filter',
  actions = [],
  onRefresh,
  onCreate,
  pagination,
  exportConfig,
  resizableTableId,
  resizableColumnConfig,
  pageSize: pageSizeProp,
}: ResourceListProps<T>) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<string>('all');

  const tableId = resizableTableId ?? title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const defaultColumnConfig = (key: string, idx: number): { defaultWidth: number; minWidth: number } => {
    if (key === 'name' || idx === 0) return { defaultWidth: 220, minWidth: 120 };
    if (key === 'age') return { defaultWidth: 90, minWidth: 56 };
    return { defaultWidth: 150, minWidth: 70 };
  };

  const filterValues = filterKey 
    ? ['all', ...Array.from(new Set(items.map(item => String(item[filterKey]))))]
    : [];

  const filteredItems = items.filter((item) => {
    const searchableString = Object.values(item).join(' ').toLowerCase();
    const matchesSearch = searchableString.includes(searchQuery.toLowerCase());
    const matchesFilter = !filterKey || selectedFilter === 'all' || String(item[filterKey]) === selectedFilter;
    return matchesSearch && matchesFilter;
  });

  const pageSize = pageSizeProp ?? 0;
  const [internalPage, setInternalPage] = useState(1);
  useEffect(() => {
    setInternalPage(1);
  }, [searchQuery, selectedFilter]);

  const effectivePagination = useMemo(() => {
    if (pagination) return pagination;
    if (pageSize <= 0 || filteredItems.length <= pageSize) return null;
    const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
    const safePage = Math.min(internalPage, totalPages);
    const start = (safePage - 1) * pageSize;
    const end = Math.min(start + pageSize, filteredItems.length);
    return {
      hasPrev: safePage > 1,
      hasNext: end < filteredItems.length,
      onPrev: () => setInternalPage((p) => Math.max(1, p - 1)),
      onNext: () => setInternalPage((p) => Math.min(totalPages, p + 1)),
      rangeLabel: `Showing ${start + 1}–${end} of ${filteredItems.length}`,
      currentPage: safePage,
      totalPages,
      onPageChange: (p: number) => setInternalPage(Math.max(1, Math.min(p, totalPages))),
    };
  }, [pagination, pageSize, filteredItems.length, internalPage]);

  const displayItems =
    effectivePagination && pageSize > 0 && effectivePagination.currentPage
      ? filteredItems.slice(
          (effectivePagination.currentPage - 1) * pageSize,
          effectivePagination.currentPage * pageSize
        )
      : filteredItems;

  // Base column config (static defaults), before applying data-aware sizing.
  const baseResizableConfig: ResizableColumnConfig[] = useMemo(
    () =>
      resizableColumnConfig ??
      (tableId
        ? columns.map((col, idx) => ({ id: col.key, ...defaultColumnConfig(col.key, idx) }))
        : []),
    [resizableColumnConfig, tableId, columns],
  );

  // Data-aware default widths for ResourceList columns when using the built-in
  // resizable behavior. If the caller supplies resizableColumnConfig explicitly,
  // we respect it as-is and do not override with auto-sizing.
  const effectiveResizableConfig: ResizableColumnConfig[] = useMemo(() => {
    if (!tableId || !baseResizableConfig.length) return baseResizableConfig;
    if (resizableColumnConfig) return baseResizableConfig;
    if (!displayItems.length) return baseResizableConfig;

    const valueGetters: Record<string, (row: T) => unknown> = {};
    for (const col of columns) {
      valueGetters[col.key] = (row: T) => {
        const rendered = col.render(row);
        if (typeof rendered === 'string' || typeof rendered === 'number') {
          return rendered;
        }
        const asAny = row as any;
        // Fallback: try the raw field on the row; otherwise, empty string.
        return asAny?.[col.key] ?? '';
      };
    }

    return buildAutoWidthColumns(baseResizableConfig, displayItems, valueGetters);
  }, [tableId, baseResizableConfig, resizableColumnConfig, displayItems, columns]);

  const useResizable = tableId.length > 0 && effectiveResizableConfig.length > 0;

  const useVirtual = displayItems.length > VIRTUAL_THRESHOLD;
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    enabled: useVirtual,
  });

  const headerRowClass = 'bg-muted/40 hover:bg-muted/40 border-b border-border/80';
  const stickyHeaderClass = 'sticky top-0 z-10 bg-card shadow-sm';

  const renderRow = (item: T, index: number, useMotion: boolean) => {
    const rowContent = (
      <>
        {columns.map((col, idx) =>
        useResizable ? (
          <ResizableTableCell key={col.key} columnId={col.key} className={col.className}>
            {idx === 0 ? (
              <Link to={getRowLink(item)} className="font-medium text-primary hover:underline truncate block min-w-0">
                {col.render(item)}
              </Link>
            ) : (
              <span className="truncate block min-w-0">{col.render(item)}</span>
            )}
          </ResizableTableCell>
        ) : (
          <TableCell key={col.key} className={col.className}>
            {idx === 0 ? (
              <Link to={getRowLink(item)} className="font-medium text-primary hover:underline">
                {col.render(item)}
              </Link>
            ) : (
              col.render(item)
            )}
          </TableCell>
        ),
      )}
      {actions.length > 0 && (
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                aria-label="Row actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.map((action) => (
                <DropdownMenuItem
                  key={action.label}
                  onClick={() => action.onClick?.(item)}
                  className={action.destructive ? 'text-destructive' : ''}
                >
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      )}
      </>
    );
    const key = getItemKey(item);
    if (useMotion) {
      return (
        <ResourceTableRow key={key} asMotion motionIndex={index} className="even:bg-muted/5">
          {rowContent}
        </ResourceTableRow>
      );
    }
    return (
      <TableRow key={key} className={cn(resourceTableRowClassName, 'even:bg-muted/5')}>
        {rowContent}
      </TableRow>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">
              {effectivePagination?.rangeLabel ?? (filteredItems.length === 0 ? `No ${title.toLowerCase()} found` : `${filteredItems.length} ${title.toLowerCase()} found`)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onCreate && (
            <Button size="sm" className="gap-2" onClick={onCreate}>
              <Plus className="h-4 w-4" />
              Create
            </Button>
          )}
          {exportConfig ? (
            <ResourceExportDropdown
              items={filteredItems}
              selectedKeys={new Set()}
              getKey={getItemKey}
              config={exportConfig}
              selectionLabel={`All visible ${title.toLowerCase()}`}
              onToast={(msg, type) => (type === 'info' ? toast.info(msg) : toast.success(msg))}
            />
          ) : (
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>
          )}
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ResourceCommandBar
        scope={
          filterKey && filterValues.length > 1 ? (
            <div className="w-full min-w-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full min-w-0 h-10 gap-2 justify-between truncate rounded-lg border border-border bg-background font-medium shadow-sm hover:bg-muted/50 hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary/20"
                  >
                    <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{selectedFilter === 'all' ? `All ${filterLabel}` : selectedFilter}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {filterValues.map((value) => (
                    <DropdownMenuItem
                      key={value}
                      onClick={() => setSelectedFilter(value)}
                      className={cn(selectedFilter === value && 'bg-accent')}
                    >
                      {value === 'all' ? `All ${filterLabel}` : value}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <span className="text-sm font-medium text-muted-foreground">{filterLabel}</span>
          )
        }
        search={
          <div className="relative w-full min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 pl-9 rounded-lg border border-border bg-background text-sm font-medium shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all"
              aria-label={searchPlaceholder}
            />
          </div>
        }
      />

      {/* Table: virtualized body when item count > VIRTUAL_THRESHOLD (C2.1) */}
      <div className="border border-border rounded-xl overflow-hidden bg-card">
        {useVirtual ? (
          <div
            ref={parentRef}
            className="overflow-auto"
            style={{ height: Math.min(VIRTUAL_LIST_HEIGHT, displayItems.length * ROW_HEIGHT_PX) }}
          >
            {useResizable ? (
              <ResizableTableProvider tableId={tableId} columnConfig={effectiveResizableConfig}>
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className={cn(headerRowClass, stickyHeaderClass)}>
                      {columns.map((col) => (
                        <ResizableTableHead key={col.key} columnId={col.key} className={cn('font-semibold overflow-hidden', col.className)}>
                          {col.header}
                        </ResizableTableHead>
                      ))}
                      {actions.length > 0 && <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>}
                    </TableRow>
                  </TableHeader>
              <TableBody>
                {(() => {
                  const virtualItems = rowVirtualizer.getVirtualItems();
                  const totalSize = rowVirtualizer.getTotalSize();
                  const start = virtualItems[0]?.start ?? 0;
                  const end = virtualItems[virtualItems.length - 1]?.end ?? totalSize;
                  return (
                    <>
                      {start > 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={columns.length + (actions.length > 0 ? 1 : 0)}
                            className="p-0 border-0"
                            style={{ height: start }}
                          />
                        </TableRow>
                      )}
                      {virtualItems.map((virtualRow) => renderRow(displayItems[virtualRow.index], virtualRow.index, false))}
                      {end < totalSize && (
                        <TableRow>
                          <TableCell
                            colSpan={columns.length + (actions.length > 0 ? 1 : 0)}
                            className="p-0 border-0"
                            style={{ height: totalSize - end }}
                          />
                        </TableRow>
                      )}
                    </>
                  );
                })()}
              </TableBody>
                </Table>
              </ResizableTableProvider>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className={cn(headerRowClass, stickyHeaderClass)}>
                    {columns.map((col) => (
                      <TableHead key={col.key} className={cn('font-semibold', col.className)}>
                        {col.header}
                      </TableHead>
                    ))}
                    {actions.length > 0 && <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const virtualItems = rowVirtualizer.getVirtualItems();
                    const totalSize = rowVirtualizer.getTotalSize();
                    const start = virtualItems[0]?.start ?? 0;
                    const end = virtualItems[virtualItems.length - 1]?.end ?? totalSize;
                    return (
                      <>
                        {start > 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={columns.length + (actions.length > 0 ? 1 : 0)}
                              className="p-0 border-0"
                              style={{ height: start }}
                            />
                          </TableRow>
                        )}
                        {virtualItems.map((virtualRow) => renderRow(displayItems[virtualRow.index], virtualRow.index, false))}
                        {end < totalSize && (
                          <TableRow>
                            <TableCell
                              colSpan={columns.length + (actions.length > 0 ? 1 : 0)}
                              className="p-0 border-0"
                              style={{ height: totalSize - end }}
                            />
                          </TableRow>
                        )}
                      </>
                    );
                  })()}
                </TableBody>
              </Table>
            )}
          </div>
        ) : useResizable ? (
          <ResizableTableProvider tableId={tableId} columnConfig={effectiveResizableConfig}>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className={headerRowClass}>
                  {columns.map((col) => (
                    <ResizableTableHead key={col.key} columnId={col.key} className={cn('font-semibold overflow-hidden', col.className)}>
                      {col.header}
                    </ResizableTableHead>
                  ))}
                  {actions.length > 0 && <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
{displayItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length + (actions.length > 0 ? 1 : 0)} className="h-32 text-center">
                    <p className="text-muted-foreground">No {title.toLowerCase()} found</p>
                  </TableCell>
                </TableRow>
              ) : (
                displayItems.map((item, i) => renderRow(item, i, true))
              )}
              </TableBody>
            </Table>
          </ResizableTableProvider>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className={headerRowClass}>
                {columns.map((col) => (
                  <TableHead key={col.key} className={cn('font-semibold', col.className)}>
                    {col.header}
                  </TableHead>
                ))}
                {actions.length > 0 && <TableHead className="w-12 text-center"><span className="sr-only">Actions</span><MoreHorizontal className="h-4 w-4 inline-block text-muted-foreground" aria-hidden /></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length + (actions.length > 0 ? 1 : 0)} className="h-32 text-center">
                    <p className="text-muted-foreground">No {title.toLowerCase()} found</p>
                  </TableCell>
                </TableRow>
              ) : (
                displayItems.map((item, i) => renderRow(item, i, true))
              )}
            </TableBody>
          </Table>
        )}
      </div>
      {effectivePagination && (
        <ListPagination
          hasPrev={effectivePagination.hasPrev}
          hasNext={effectivePagination.hasNext}
          onPrev={effectivePagination.onPrev}
          onNext={effectivePagination.onNext}
          rangeLabel={effectivePagination.rangeLabel}
          currentPage={effectivePagination.currentPage}
          totalPages={effectivePagination.totalPages}
          onPageChange={effectivePagination.onPageChange}
        />
      )}
    </motion.div>
  );
}
