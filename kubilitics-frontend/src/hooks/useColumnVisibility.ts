import { useCallback, useMemo, useState } from 'react';

const STORAGE_PREFIX = 'kubilitics-columns-';

export interface ColumnVisibilityOption {
  id: string;
  label: string;
}

export interface UseColumnVisibilityOptions {
  /** Unique table id (e.g. "deployments", "pods") for localStorage key */
  tableId: string;
  /** All columns that can be toggled (excludes Name and Actions which are always visible) */
  columns: ColumnVisibilityOption[];
  /** Column ids that are always visible and not shown in the dropdown (default ["name"]) */
  alwaysVisible?: string[];
}

export interface UseColumnVisibilityResult {
  /** Set of column ids that should be visible (includes alwaysVisible) */
  visibleColumns: Set<string>;
  /** Set visibility for a single column and persist to localStorage */
  setColumnVisible: (id: string, visible: boolean) => void;
  /** Whether the column id should be rendered */
  isColumnVisible: (id: string) => boolean;
}

function loadStoredVisible(tableId: string, toggleableIds: string[], alwaysVisible: string[]): Set<string> {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${tableId}`);
    if (!raw) return new Set([...alwaysVisible, ...toggleableIds]);
    const stored = JSON.parse(raw) as string[];
    const valid = stored.filter((id) => toggleableIds.includes(id));
    return new Set([...alwaysVisible, ...valid]);
  } catch {
    return new Set([...alwaysVisible, ...toggleableIds]);
  }
}

function saveStoredVisible(tableId: string, visible: Set<string>, alwaysVisible: string[]) {
  const toStore = [...visible].filter((id) => !alwaysVisible.includes(id));
  localStorage.setItem(`${STORAGE_PREFIX}${tableId}`, JSON.stringify(toStore));
}

/**
 * Hook for per–resource-type column visibility with localStorage persistence.
 * Name and Actions are always visible; other columns can be toggled via ColumnVisibilityDropdown.
 */
export function useColumnVisibility({
  tableId,
  columns,
  alwaysVisible = ['name'],
}: UseColumnVisibilityOptions): UseColumnVisibilityResult {
  const allIds = useMemo(() => columns.map((c) => c.id), [columns]);

  const [visibleColumns, setVisibleColumnsState] = useState<Set<string>>(() =>
    loadStoredVisible(tableId, allIds, alwaysVisible)
  );

  const setColumnVisible = useCallback(
    (id: string, visible: boolean) => {
      setVisibleColumnsState((prev) => {
        const next = new Set(prev);
        if (visible) next.add(id);
        else next.delete(id);
        saveStoredVisible(tableId, next, alwaysVisible);
        return next;
      });
    },
    [tableId, alwaysVisible]
  );

  const isColumnVisible = useCallback(
    (id: string) => visibleColumns.has(id),
    [visibleColumns]
  );

  return { visibleColumns, setColumnVisible, isColumnVisible };
}
