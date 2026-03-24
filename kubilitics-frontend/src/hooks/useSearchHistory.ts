import { useState, useCallback } from 'react';

const STORAGE_KEY = 'kubilitics:search-history';
const MAX_HISTORY = 15;

export interface SearchHistoryEntry {
  query: string;
  timestamp: number;
  resultType?: string; // 'pod', 'deployment', etc.
}

function load(): SearchHistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); }
  catch { return []; }
}

function save(entries: SearchHistoryEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function useSearchHistory() {
  const [history, setHistory] = useState<SearchHistoryEntry[]>(load);

  const addSearch = useCallback((query: string, resultType?: string) => {
    if (!query.trim()) return;
    setHistory(prev => {
      const filtered = prev.filter(e => e.query !== query);
      const next = [{ query, timestamp: Date.now(), resultType }, ...filtered].slice(0, MAX_HISTORY);
      save(next);
      return next;
    });
  }, []);

  const removeSearch = useCallback((query: string) => {
    setHistory(prev => {
      const next = prev.filter(e => e.query !== query);
      save(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    save([]);
  }, []);

  return { history, addSearch, removeSearch, clearHistory };
}
