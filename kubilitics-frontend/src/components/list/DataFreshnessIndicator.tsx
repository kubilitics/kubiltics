/**
 * PERF Area 5: Visual indicator showing when data was last refreshed.
 *
 * Displays "Updated: Xs ago" in the list page header. Turns amber when
 * data is older than 60s (WebSocket likely disconnected), giving users
 * confidence about data currency.
 *
 * Supports two modes:
 * - queryKey mode: reads dataUpdatedAt from React Query cache (used with useDataFreshness)
 * - dataUpdatedAt mode: accepts a timestamp directly (used with ListPageHeader)
 */
import { useState, useEffect } from 'react';
import { type QueryKey } from '@tanstack/react-query';
import { useDataFreshness } from '@/hooks/useDataFreshness';
import { cn } from '@/lib/utils';

function formatAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

interface DataFreshnessIndicatorProps {
  /** React Query key — reads dataUpdatedAt from cache */
  queryKey?: QueryKey;
  /** Direct timestamp (ms since epoch) — bypass queryKey lookup */
  dataUpdatedAt?: number;
  className?: string;
}

export function DataFreshnessIndicator({ queryKey, dataUpdatedAt: directTimestamp, className }: DataFreshnessIndicatorProps) {
  // If queryKey provided, use the hook; otherwise use the direct timestamp
  const fromHook = useDataFreshness(queryKey ?? []);
  const effectiveTimestamp = directTimestamp ?? fromHook.dataUpdatedAt;

  // Live clock for "Xs ago" display
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!directTimestamp) return; // Only need our own ticker when using direct mode
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [directTimestamp]);

  const timestamp = effectiveTimestamp;
  if (!timestamp) return null;

  const elapsed = (directTimestamp ? now : Date.now()) - timestamp;
  const isStale = directTimestamp ? elapsed > 60_000 : fromHook.isStale;
  const label = directTimestamp ? formatAgo(elapsed) : fromHook.lastUpdated;

  return (
    <span
      className={cn(
        'text-xs tabular-nums transition-colors',
        isStale
          ? 'text-amber-500 dark:text-amber-400'
          : 'text-muted-foreground',
        className,
      )}
      title={new Date(timestamp).toLocaleTimeString()}
    >
      Updated {label}
    </span>
  );
}
