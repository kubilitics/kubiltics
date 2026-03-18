/**
 * PERF Area 5: Track and display data freshness.
 *
 * Provides a human-readable "Last updated: Xs ago" string that updates
 * every second. Shows users whether they're looking at live or stale data.
 */
import { useState, useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

function formatAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/**
 * Returns a live-updating "last updated" string for a React Query key.
 * Updates every second when data is older than 5s.
 */
export function useDataFreshness(queryKey: QueryKey): {
  lastUpdated: string;
  dataUpdatedAt: number;
  isStale: boolean;
} {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(Date.now());
  const hasKey = queryKey.length > 0;

  useEffect(() => {
    // Skip interval when called with empty key (e.g. DataFreshnessIndicator in direct mode)
    if (!hasKey) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasKey]);

  const state = queryClient.getQueryState(queryKey);
  const dataUpdatedAt = state?.dataUpdatedAt ?? 0;
  const elapsed = dataUpdatedAt ? now - dataUpdatedAt : 0;

  return {
    lastUpdated: dataUpdatedAt ? formatAgo(elapsed) : '',
    dataUpdatedAt,
    isStale: elapsed > 60_000, // Consider stale after 60s without update
  };
}
