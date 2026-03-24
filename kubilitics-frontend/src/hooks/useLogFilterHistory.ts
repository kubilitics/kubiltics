/**
 * useLogFilterHistory — stores the last 20 log search filters in localStorage.
 * Supports pinning favorites to keep them at the top regardless of recency.
 */
import { useState, useCallback } from 'react';

export interface FilterHistoryEntry {
  query: string;
  /** Unix timestamp (ms) when the filter was last used */
  usedAt: number;
  /** Pinned filters are surfaced first and never auto-evicted */
  pinned: boolean;
}

const STORAGE_KEY = 'kubilitics-log-filter-history';
const MAX_HISTORY = 20;

function readHistory(): FilterHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as FilterHistoryEntry[];
  } catch {
    return [];
  }
}

function writeHistory(entries: FilterHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage unavailable — silently ignore
  }
}

/**
 * Returns sorted history: pinned first (by usedAt desc), then unpinned by usedAt desc.
 */
function sortedHistory(entries: FilterHistoryEntry[]): FilterHistoryEntry[] {
  const pinned = entries.filter(e => e.pinned).sort((a, b) => b.usedAt - a.usedAt);
  const unpinned = entries.filter(e => !e.pinned).sort((a, b) => b.usedAt - a.usedAt);
  return [...pinned, ...unpinned];
}

export function useLogFilterHistory() {
  const [history, setHistory] = useState<FilterHistoryEntry[]>(() =>
    sortedHistory(readHistory())
  );

  /** Call whenever a non-empty filter is submitted. Deduplicates by query. */
  const addFilter = useCallback((query: string) => {
    if (!query.trim()) return;
    setHistory(prev => {
      const existing = prev.find(e => e.query === query);
      let next: FilterHistoryEntry[];
      if (existing) {
        // Bump usedAt, keep pinned state
        next = prev.map(e =>
          e.query === query ? { ...e, usedAt: Date.now() } : e
        );
      } else {
        const entry: FilterHistoryEntry = {
          query,
          usedAt: Date.now(),
          pinned: false,
        };
        // Keep only MAX_HISTORY unpinned entries; pinned entries are never evicted
        const unpinned = prev.filter(e => !e.pinned);
        const trimmed =
          unpinned.length >= MAX_HISTORY
            ? unpinned.slice(0, MAX_HISTORY - 1)
            : unpinned;
        next = [...prev.filter(e => e.pinned), entry, ...trimmed];
      }
      const sorted = sortedHistory(next);
      writeHistory(sorted);
      return sorted;
    });
  }, []);

  /** Toggle the pinned state for a given query. */
  const togglePin = useCallback((query: string) => {
    setHistory(prev => {
      const next = prev.map(e =>
        e.query === query ? { ...e, pinned: !e.pinned } : e
      );
      const sorted = sortedHistory(next);
      writeHistory(sorted);
      return sorted;
    });
  }, []);

  /** Remove a specific entry from history. */
  const removeFilter = useCallback((query: string) => {
    setHistory(prev => {
      const next = prev.filter(e => e.query !== query);
      writeHistory(next);
      return next;
    });
  }, []);

  /** Clear all non-pinned history entries. */
  const clearHistory = useCallback(() => {
    setHistory(prev => {
      const next = prev.filter(e => e.pinned);
      writeHistory(next);
      return next;
    });
  }, []);

  return { history, addFilter, togglePin, removeFilter, clearHistory };
}
