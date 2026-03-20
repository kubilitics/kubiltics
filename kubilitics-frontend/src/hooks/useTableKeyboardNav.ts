import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface UseTableKeyboardNavOptions {
  /** Number of data rows (excluding header/group headers) */
  rowCount: number;
  /** Called when Enter is pressed on the focused row; open detail for row at index */
  onOpenRow: (index: number) => void;
  /** Return the selection key for the row at index (e.g. namespace/name). Used for Space to toggle. */
  getRowKeyAt: (index: number) => string;
  /** Current set of selected row keys */
  selectedKeys: Set<string>;
  /** Toggle selection for the given row key */
  onToggleSelect: (key: string) => void;
  /** When false, keyboard nav is disabled (e.g. empty table) */
  enabled?: boolean;
}

export interface UseTableKeyboardNavResult {
  /** Current focused row index (-1 if none) */
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  /** Props to spread onto the scrollable table container (div wrapping Table) so it can receive focus and key events */
  tableContainerProps: {
    ref: React.RefObject<HTMLDivElement | null>;
    tabIndex: number;
    onKeyDown: (e: React.KeyboardEvent) => void;
    className?: string;
    'data-keyboard-nav'?: string;
  };
  /** Return props for the row at index: data attribute for scroll-into-view, and className for focus ring */
  getRowProps: (index: number) => { 'data-row-index': number; className?: string };
}

const ROW_ATTR = 'data-row-index';

/**
 * Hook for table keyboard navigation: Arrow Up/Down, Enter (open detail), Escape (clear), Space (toggle checkbox).
 * Apply tableContainerProps to the div that wraps the table; use getRowProps on each data row (e.g. motion.tr).
 */
export function useTableKeyboardNav({
  rowCount,
  onOpenRow,
  getRowKeyAt,
  selectedKeys,
  onToggleSelect,
  enabled = true,
}: UseTableKeyboardNavOptions): UseTableKeyboardNavResult {
  const [focusedIndex, setFocusedIndexState] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const setFocusedIndex = useCallback((index: number) => {
    setFocusedIndexState((prev) => {
      const next = index < 0 ? -1 : index >= rowCount ? rowCount - 1 : index;
      return next;
    });
  }, [rowCount]);

  useEffect(() => {
    if (!enabled || focusedIndex < 0 || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[${ROW_ATTR}="${focusedIndex}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedIndex, enabled]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled || rowCount === 0) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex(focusedIndex >= rowCount - 1 ? rowCount - 1 : focusedIndex + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex(focusedIndex <= 0 ? 0 : focusedIndex - 1);
          break;
        case 'Enter':
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < rowCount) {
            onOpenRow(focusedIndex);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setFocusedIndex(-1);
          break;
        case ' ':
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < rowCount) {
            const key = getRowKeyAt(focusedIndex);
            if (key) onToggleSelect(key);
          }
          break;
        default:
          break;
      }
    },
    [enabled, rowCount, focusedIndex, onOpenRow, getRowKeyAt, onToggleSelect]
  );

  const getRowProps = useCallback(
    (index: number) => ({
      [ROW_ATTR]: index,
      className: cn(index === focusedIndex && focusedIndex >= 0 && 'ring-2 ring-primary ring-inset'),
    }),
    [focusedIndex]
  );

  return {
    focusedIndex,
    setFocusedIndex,
    tableContainerProps: {
      ref: containerRef,
      tabIndex: enabled && rowCount > 0 ? 0 : -1,
      onKeyDown,
      'data-keyboard-nav': 'true',
      className: 'outline-none focus:ring-2 focus:ring-primary/20 focus:ring-inset rounded-xl',
    },
    getRowProps,
  };
}
