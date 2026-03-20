import { useMemo, useCallback, useState } from 'react';

export interface ColumnConfig<T> {
  columnId: string;
  getValue: (item: T) => string | number;
  sortable: boolean;
  filterable: boolean;
  compare?: (a: T, b: T) => number;
}

export interface TableFiltersSortConfig<T> {
  columns: ColumnConfig<T>[];
  defaultSortKey?: string;
  defaultSortOrder?: 'asc' | 'desc';
}

function defaultCompare<T>(getValue: (item: T) => string | number): (a: T, b: T) => number {
  return (a, b) => {
    const va = getValue(a);
    const vb = getValue(b);
    if (va === vb) return 0;
    const sa = String(va);
    const sb = String(vb);
    const na = Number(va);
    const nb = Number(vb);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return sa.localeCompare(sb, undefined, { numeric: true });
  };
}

export interface ValueWithCount {
  value: string;
  count: number;
}

export interface UseTableFiltersAndSortResult<T> {
  /** Items after applying column filters and sort. */
  filteredAndSortedItems: T[];
  /** Distinct values per filterable column (from current items). */
  distinctValuesByColumn: Record<string, string[]>;
  /** Distinct values with counts per filterable column (for filter dropdown display). */
  valueCountsByColumn: Record<string, ValueWithCount[]>;
  /** Current column filters: columnId -> set of allowed values; empty/missing = no filter. */
  columnFilters: Record<string, Set<string>>;
  /** Set filter for a column. Pass null to clear. */
  setColumnFilter: (columnId: string, values: Set<string> | null) => void;
  /** Current sort column id. */
  sortKey: string | null;
  /** Current sort order. */
  sortOrder: 'asc' | 'desc';
  /** Set sort; order optional (toggles if key same). */
  setSort: (key: string, order?: 'asc' | 'desc') => void;
  /** Clear all column filters. */
  clearAllFilters: () => void;
  /** Whether any column filter is active. */
  hasActiveFilters: boolean;
}

export function useTableFiltersAndSort<T>(
  items: T[],
  config: TableFiltersSortConfig<T>,
): UseTableFiltersAndSortResult<T> {
  const { columns, defaultSortKey, defaultSortOrder = 'asc' } = config;

  const [columnFiltersState, setColumnFiltersState] = useState<Record<string, Set<string>>>({});
  const [sortState, setSortState] = useState<{ key: string | null; order: 'asc' | 'desc' }>({
    key: defaultSortKey ?? null,
    order: defaultSortOrder,
  });
  const sortKey = sortState.key;
  const sortOrder = sortState.order;

  const setColumnFilter = useCallback((columnId: string, values: Set<string> | null) => {
    setColumnFiltersState((prev) => {
      const next = { ...prev };
      if (values === null || values.size === 0) {
        delete next[columnId];
      } else {
        next[columnId] = new Set(values);
      }
      return next;
    });
  }, []);

  const setSort = useCallback((key: string, order?: 'asc' | 'desc') => {
    setSortState((prev) => {
      const nextOrder =
        order ?? (prev.key === key ? (prev.order === 'asc' ? 'desc' : 'asc') : 'asc');
      return { key, order: nextOrder };
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setColumnFiltersState({});
  }, []);

  const filterableColumns = useMemo(
    () => columns.filter((c) => c.filterable),
    [columns],
  );

  const distinctValuesByColumn = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const col of filterableColumns) {
      const values = [...new Set(items.map((item) => String(col.getValue(item)).trim()).filter(Boolean))].sort();
      out[col.columnId] = values;
    }
    return out;
  }, [items, filterableColumns]);

  const valueCountsByColumn = useMemo(() => {
    const out: Record<string, Array<{ value: string; count: number }>> = {};
    for (const col of filterableColumns) {
      const countMap = new Map<string, number>();
      for (const item of items) {
        const v = String(col.getValue(item)).trim();
        if (v) countMap.set(v, (countMap.get(v) ?? 0) + 1);
      }
      out[col.columnId] = [...countMap.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
    }
    return out;
  }, [items, filterableColumns]);

  const filteredAndSortedItems = useMemo(() => {
    let result = items;

    for (const col of columns) {
      if (!col.filterable) continue;
      const allowed = columnFiltersState[col.columnId];
      if (!allowed || allowed.size === 0) continue;
      result = result.filter((item) => {
        const v = String(col.getValue(item)).trim();
        return v && allowed.has(v);
      });
    }

    const sortCol = columns.find((c) => c.columnId === sortKey && c.sortable);
    if (sortCol) {
      const compare = sortCol.compare ?? defaultCompare(sortCol.getValue);
      result = [...result].sort((a, b) => {
        const cmp = compare(a, b);
        return sortOrder === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [items, columns, columnFiltersState, sortKey, sortOrder]);

  const hasActiveFilters = useMemo(() => {
    return Object.values(columnFiltersState).some((s) => s && s.size > 0);
  }, [columnFiltersState]);

  return {
    filteredAndSortedItems,
    distinctValuesByColumn,
    valueCountsByColumn,
    columnFilters: columnFiltersState,
    setColumnFilter,
    sortKey,
    sortOrder,
    setSort,
    clearAllFilters,
    hasActiveFilters,
  };
}
