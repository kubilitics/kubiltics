/**
 * PERF Area 7: Periodic memory self-check and cache trimming.
 *
 * Engineers keep Kubilitics open all day. This hook monitors memory usage
 * every 30 minutes and proactively trims React Query caches when memory
 * exceeds 500MB, preventing degradation over long sessions.
 *
 * Uses the Performance Memory API (Chrome/Edge) when available, with a
 * no-op fallback for Firefox/Safari.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** Memory threshold in bytes (500MB). Above this, caches are trimmed. */
const MEMORY_THRESHOLD = 500 * 1024 * 1024;

/** Check interval: 30 minutes */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** Max age for stale queries to keep (5 minutes). Queries older than this with no subscribers are removed. */
const MAX_STALE_AGE_MS = 5 * 60 * 1000;

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function getMemoryUsage(): PerformanceMemory | null {
  const perf = performance as typeof performance & { memory?: PerformanceMemory };
  return perf.memory ?? null;
}

export function useMemoryMonitor() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const check = () => {
      const memory = getMemoryUsage();
      if (!memory) return;

      const usedMB = Math.round(memory.usedJSHeapSize / (1024 * 1024));

      if (memory.usedJSHeapSize > MEMORY_THRESHOLD) {
        // Remove queries with no active subscribers that haven't been updated recently
        const cache = queryClient.getQueryCache();
        const now = Date.now();
        let trimmed = 0;

        for (const query of cache.getAll()) {
          const hasSubscribers = query.getObserversCount() > 0;
          const age = now - (query.state.dataUpdatedAt || 0);

          if (!hasSubscribers && age > MAX_STALE_AGE_MS) {
            cache.remove(query);
            trimmed++;
          }
        }

      }
    };

    // Run first check after 5 minutes (let app stabilize first)
    const initialTimer = setTimeout(check, 5 * 60 * 1000);
    const interval = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [queryClient]);
}
