import * as React from 'react';
import { ChevronDown, Filter, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface TableFilterCellProps {
  columnId: string;
  label: string;
  distinctValues: string[];
  selectedFilterValues: Set<string>;
  onFilterChange: (columnId: string, values: Set<string> | null) => void;
  valueCounts?: Array<{ value: string; count: number }>;
  className?: string;
}

/**
 * Inline filter cell for the filter row - appears under each column header.
 * Renders an input with placeholder "Filter by {label}" that opens a dropdown
 * with searchable checkbox list when clicked.
 */
export function TableFilterCell({
  columnId,
  label,
  distinctValues,
  selectedFilterValues,
  onFilterChange,
  valueCounts,
  className,
}: TableFilterCellProps) {
  const [search, setSearch] = React.useState('');
  const [open, setOpen] = React.useState(false);

  const valuesWithCounts = valueCounts ?? distinctValues.map((v) => ({ value: v, count: 1 }));
  const filteredValues = React.useMemo(() => {
    if (!search.trim()) return valuesWithCounts;
    const q = search.toLowerCase();
    return valuesWithCounts.filter((v) => v.value.toLowerCase().includes(q));
  }, [valuesWithCounts, search]);

  const toggleValue = (value: string) => {
    const next = new Set(selectedFilterValues);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onFilterChange(columnId, next.size === 0 ? null : next);
  };

  const selectAll = () => {
    onFilterChange(columnId, new Set(distinctValues));
  };

  const clearFilter = () => {
    onFilterChange(columnId, null);
    setSearch('');
  };

  const hasFilter = selectedFilterValues.size > 0;
  const displayText = hasFilter
    ? `${selectedFilterValues.size} selected`
    : '';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'w-full flex items-center gap-2 min-w-0 rounded-md px-2.5 py-2 text-sm text-left',
            'border-2 transition-all duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            hasFilter
              ? 'border-primary bg-primary/10 text-primary shadow-sm'
              : 'border-border bg-background text-foreground/90 hover:border-muted-foreground/40 hover:bg-muted/50 shadow-sm',
            open && 'border-primary/70 ring-2 ring-primary/20',
            className
          )}
          aria-label={hasFilter ? `Filter by ${label}: ${displayText} (click to change)` : `Filter by ${label}`}
        >
          <Filter
            className={cn(
              'h-3.5 w-3.5 shrink-0',
              hasFilter ? 'text-primary' : 'text-muted-foreground'
            )}
            aria-hidden
          />
          <span className="truncate flex-1 font-medium">
            {hasFilter ? displayText : `Filter by ${label}`}
          </span>
          {hasFilter && (
            <span
              className="shrink-0 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/20 px-1.5 text-xs font-semibold text-primary tabular-nums"
              aria-hidden
            >
              {selectedFilterValues.size}
            </span>
          )}
          <div className="flex items-center gap-0.5 shrink-0">
            {hasFilter && (
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  clearFilter();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    clearFilter();
                  }
                }}
                className="p-0.5 rounded hover:bg-primary/20 transition-colors"
                aria-label="Clear filter"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                open && 'rotate-180',
                hasFilter ? 'text-primary' : 'text-muted-foreground'
              )}
              aria-hidden
            />
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Filter by {label}</p>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={`Search ${label}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={selectAll}>
              Select all
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={clearFilter}>
              Clear
            </Button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {filteredValues.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No matches</p>
            ) : (
              filteredValues.map((item) => {
                const value = typeof item === 'string' ? item : item.value;
                const count = typeof item === 'string' ? undefined : item.count;
                return (
                  <label
                    key={value}
                    className="flex items-center gap-2 cursor-pointer text-sm hover:bg-muted/50 rounded px-1.5 py-1"
                  >
                    <Checkbox
                      checked={selectedFilterValues.has(value)}
                      onCheckedChange={() => toggleValue(value)}
                      aria-label={value}
                    />
                    <span className="truncate flex-1">{value}</span>
                    {count != null && (
                      <span className="text-xs text-muted-foreground tabular-nums">({count})</span>
                    )}
                  </label>
                );
              })
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
