import { useEffect } from 'react';
import { useClusterStore } from '@/stores/clusterStore';

/**
 * Headlamp-style cluster sync.
 *
 * Run once at the app root. Triggers `syncClusters()`:
 *   - on mount
 *   - every 30s
 *   - on window focus (catches the case where the user backgrounds the app,
 *     restarts Docker Desktop / kind, then comes back)
 *   - on `online` (best-effort React Query reconnect substitute)
 *
 * Without this, a cluster re-registered externally keeps a stale UUID in the
 * store, the sidebar counters return zero, and the chat panel sends a dead
 * `focus_cluster_id` to the brain.
 */
export function useClusterSync(intervalMs = 30_000) {
  const syncClusters = useClusterStore((s) => s.syncClusters);

  useEffect(() => {
    let cancelled = false;
    const safeSync = () => {
      if (cancelled) return;
      void syncClusters();
    };

    safeSync();
    const id = window.setInterval(safeSync, intervalMs);
    window.addEventListener('focus', safeSync);
    window.addEventListener('online', safeSync);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', safeSync);
      window.removeEventListener('online', safeSync);
    };
  }, [syncClusters, intervalMs]);
}
