import { useState, useCallback } from 'react';

const STORAGE_KEY = 'kubilitics:log-filter-history';
const MAX_HISTORY = 20;

export interface FilterHistoryEntry {
  query: string;
  pinned: boolean;
  timestamp: number;
}

function loadHistory(): FilterHistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveHistory(entries: FilterHistoryEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function useLogFilterHistory() {
  const [history, setHistory] = useState<FilterHistoryEntry[]>(loadHistory);

  const addFilter = useCallback((query: string) => {
    if (!query.trim()) return;
    setHistory((prev) => {
      if (prev.some((e) => e.query === query)) return prev;
      const next = [{ query, pinned: false, timestamp: Date.now() }, ...prev];
      // Keep pinned + trim to MAX_HISTORY
      const pinned = next.filter((e) => e.pinned);
      const unpinned = next.filter((e) => !e.pinned);
      const trimmed = [...pinned, ...unpinned].slice(0, MAX_HISTORY);
      saveHistory(trimmed);
      return trimmed;
    });
  }, []);

  const togglePin = useCallback((query: string) => {
    setHistory((prev) => {
      const next = prev.map((e) => e.query === query ? { ...e, pinned: !e.pinned } : e);
      saveHistory(next);
      return next;
    });
  }, []);

  const removeFilter = useCallback((query: string) => {
    setHistory((prev) => {
      const next = prev.filter((e) => e.query !== query);
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  return { history, addFilter, togglePin, removeFilter, clearHistory };
}
