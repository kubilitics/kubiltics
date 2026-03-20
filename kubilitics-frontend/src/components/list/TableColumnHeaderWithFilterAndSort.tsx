import * as React from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTableFilterVisible } from './TableFilterContext';
import { cn } from '@/lib/utils';

export interface TableColumnHeaderWithFilterAndSortProps {
  columnId: string;
  label: string;
  sortable?: boolean;
  sortKey: string | null;
  sortOrder: 'asc' | 'desc';
  onSort: (key: string) => void;
  filterable: boolean;
  distinctValues: string[];
  selectedFilterValues: Set<string>;
  onFilterChange: (columnId: string, values: Set<string> | null) => void;
  className?: string;
  /** Optional: render extra content (e.g. resize handle is outside). */
  children?: React.ReactNode;
}

/**
 * Column header with sort. Filter UI is in the filter row below (TableFilterCell).
 */
export function TableColumnHeaderWithFilterAndSort({
  columnId,
  label,
  sortable = true,
  sortKey,
  sortOrder,
  onSort,
  filterable,
  distinctValues,
  selectedFilterValues,
  onFilterChange,
  className,
  children,
}: TableColumnHeaderWithFilterAndSortProps) {
  const showFilters = useTableFilterVisible();
  const isSorted = sortKey === columnId;
  const hasFilter = selectedFilterValues.size > 0;

  return (
    <div className={cn('flex items-center gap-1 min-w-0', className)}>
      <span
        className={cn(
          'truncate font-semibold',
          hasFilter && showFilters && 'text-primary'
        )}
        title={label}
      >
        {label}
      </span>

      {sortable && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 flex-shrink-0"
          onClick={() => onSort(columnId)}
          aria-label={isSorted ? `Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}` : `Sort by ${label}`}
        >
          {isSorted ? (
            sortOrder === 'asc' ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </Button>
      )}
      {children}
    </div>
  );
}
