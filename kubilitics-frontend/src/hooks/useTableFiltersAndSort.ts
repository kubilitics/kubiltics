import { useMemo, useCallback, useState } from 'react';

export interface ColumnConfig<T> {
  columnId: string;
  /** Used for filter dropdown values, distinct counts, and as the sort fallback. */
  getValue: (item: T) => string | number;
  /**
   * Optional value used for sorting only. Use this when the displayed value is
   * a derived/formatted string (e.g. "5m", "2h") whose lexical order does not
   * match the underlying quantity. Common pattern for age columns:
   *   sortValue: (i) => i.creationTimestamp ? Date.parse(i.creationTimestamp) : 0
   * Then `compare` (default numeric) sorts by absolute timestamp regardless of
   * how the string is rendered. Newer rows have larger timestamps; combine
   * with `defaultSortOrder: 'desc'` for "newest first" first-click behavior.
   */
  sortValue?: (item: T) => string | number;
  sortable: boolean;
  filterable: boolean;
  compare?: (a: T, b: T) => number;
}

export interface TableFiltersSortConfig<T> {
  columns: ColumnConfig<T>[];
  defaultSortKey?: string;
  defaultSortOrder?: 'asc' | 'desc';
}

/** Parse age strings like "5h", "3d", "2wk", "45s", "12m" to seconds for sorting. Returns -1 if not an age string. */
function ageToSeconds(val: string): number {
  const trimmed = val.trim().toLowerCase();
  if (trimmed === 'just now' || trimmed === '<1s') return 0;
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d|wk|mo|y)$/);
  if (!match) return -1;
  const num = parseFloat(match[1]);
  switch (match[2]) {
    case 's': return num;
    case 'm': return num * 60;
    case 'h': return num * 3600;
    case 'd': return num * 86400;
    case 'wk': return num * 604800;
    case 'mo': return num * 2592000;
    case 'y': return num * 31536000;
    default: return -1;
  }
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
    // Try age-string comparison before falling back to locale
    const ageA = ageToSeconds(sa);
    const ageB = ageToSeconds(sb);
    if (ageA >= 0 && ageB >= 0) return ageA - ageB;
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

/**
 * The set of sort fields the backend's resource cache understands. See
 * `kubilitics-backend/internal/api/rest/resources.go canSortUnstructured`.
 */
export type ServerSortField = 'name' | 'namespace' | 'creationTimestamp';

/**
 * Map a client-side column sort (sortKey + 'asc'/'desc') to the server's
 * paginator parameters. Use in pages that hit useServerPaginatedResourceList
 * so user clicks on column headers produce correct CROSS-PAGE ordering, not
 * just per-page re-sorting of an alphabetically-paginated slice.
 *
 * Mapping:
 *   - 'name' / 'namespace' → passthrough.
 *   - 'age' → server sortBy='creationTimestamp'. Client uses negated-timestamp
 *     so client 'asc' means newest-first; map that to server 'desc' (and vice
 *     versa) so the user-visible ordering matches.
 *   - everything else → server falls back to creationTimestamp desc so the
 *     visible page is at least a stable newest-first cohort. Client-side
 *     re-sort then orders the visible 10 by the unsupported column.
 */
export function mapClientSortToServerSort(
  sortKey: string | null,
  sortOrder: 'asc' | 'desc',
): { sortBy: ServerSortField; sortOrder: 'asc' | 'desc' } {
  if (sortKey === 'name' || sortKey === 'namespace') {
    return { sortBy: sortKey, sortOrder };
  }
  if (sortKey === 'age') {
    return { sortBy: 'creationTimestamp', sortOrder: sortOrder === 'asc' ? 'desc' : 'asc' };
  }
  return { sortBy: 'creationTimestamp', sortOrder: 'desc' };
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
      // Prefer custom compare; otherwise fall back to defaultCompare against
      // sortValue (when provided) and finally against the display getValue.
      const compare = sortCol.compare ?? defaultCompare(sortCol.sortValue ?? sortCol.getValue);
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
