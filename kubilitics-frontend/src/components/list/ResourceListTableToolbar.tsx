/**
 * Universal toolbar for resource list tables.
 * Groups filter bar + column visibility + table in one bordered container
 * so users clearly understand these controls are table-related.
 */
import { Filter, FilterX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ColumnVisibilityDropdown } from './ColumnVisibilityDropdown';
import { TableFilterProvider } from './TableFilterContext';
import { TopLoadingBar } from '@/components/loading';
import type { ColumnVisibilityOption } from '@/hooks/useColumnVisibility';
import { cn } from '@/lib/utils';

export interface ResourceListTableToolbarProps {
  /** Global filter bar (search, namespace, group by). Always visible when provided. */
  globalFilterBar?: React.ReactNode;
  /** Whether the filter row (under column headers) is visible */
  showTableFilters: boolean;
  /** Toggle filter row visibility */
  onToggleTableFilters: () => void;
  /** Whether any column filter is active (shows "Clear all" when true) */
  hasActiveFilters?: boolean;
  /** Called when "Clear all" filters is clicked */
  onClearAllFilters?: () => void;
  /** Columns for visibility dropdown (toggleable columns only) */
  columns: ColumnVisibilityOption[];
  /** Currently visible column ids */
  visibleColumns: Set<string>;
  /** Toggle a column's visibility */
  onColumnToggle: (columnId: string, visible: boolean) => void;
  /** Table content (the actual table element) */
  children: React.ReactNode;
  /** Optional footer (e.g. pagination) rendered inside the block below the table */
  footer?: React.ReactNode;
  /** Optional extra class for the outer container */
  className?: string;
  /** Optional: table container props (e.g. for keyboard nav) */
  tableContainerProps?: React.HTMLAttributes<HTMLDivElement>;
  /** When true, shows the top loading bar (primary-colored progress indicator) */
  isLoading?: boolean;
}

/**
 * Wraps filter bar + table controls + table in one bordered block.
 * Toolbar row: "Table" label + [Show/hide filters] [Show/hide columns]
 * Filter bar (when visible)
 * Table (children)
 */
export function ResourceListTableToolbar({
  globalFilterBar,
  showTableFilters,
  onToggleTableFilters,
  hasActiveFilters,
  onClearAllFilters,
  columns,
  visibleColumns,
  onColumnToggle,
  children,
  footer,
  className,
  tableContainerProps,
  isLoading = false,
}: ResourceListTableToolbarProps) {
  return (
    <div
      className={cn(
        'relative rounded-xl border border-border bg-card overflow-hidden shadow-sm',
        className
      )}
    >
      <TopLoadingBar isLoading={isLoading} />
      {/* Global filter bar (search, namespace, group by) - always visible */}
      {globalFilterBar != null && (
        <div className="border-b border-border px-4 py-3">
          {globalFilterBar}
        </div>
      )}
      {/* Toolbar row: table controls */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/30"
        role="toolbar"
        aria-label="Table toolbar"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-muted-foreground">
            Table
          </span>
          {hasActiveFilters && onClearAllFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-muted-foreground hover:text-foreground press-effect"
              onClick={onClearAllFilters}
            >
              <X className="h-3.5 w-3.5" />
              Clear all filters
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8 shrink-0 press-effect"
            onClick={onToggleTableFilters}
            aria-label={showTableFilters ? 'Hide table column filters' : 'Show table column filters'}
            aria-expanded={showTableFilters}
          >
            {showTableFilters ? <Filter className="h-3.5 w-3.5" /> : <FilterX className="h-3.5 w-3.5" />}
            {showTableFilters ? 'Hide filters' : 'Show filters'}
          </Button>
          {columns.length > 0 && (
            <ColumnVisibilityDropdown
              columns={columns}
              visibleColumns={visibleColumns}
              onToggle={onColumnToggle}
              ariaLabel="Show or hide table columns"
            />
          )}
        </div>
      </div>

      {/* Table - wrap in TableFilterProvider so filter row shows when showTableFilters */}
      <TableFilterProvider value={showTableFilters}>
        <div
          {...tableContainerProps}
          className={cn('overflow-x-auto overflow-y-hidden', tableContainerProps?.className)}
        >
          {children}
        </div>
      </TableFilterProvider>

      {footer != null && (
        <div className="border-t border-border bg-muted/10 px-4 py-3">
          {footer}
        </div>
      )}
    </div>
  );
}
