/**
 * Cluster-switch event bus.
 *
 * Phase 2 / Blocker B — Zustand stores that cache cluster-scoped data
 * (events, sidebar counters, topology, traces, …) used to hold stale
 * slices after the user switched clusters because the individual stores
 * had no cross-cutting signal to invalidate on. This module is the
 * single source of truth for "the active cluster just changed" — every
 * cache-holding store subscribes and clears its own slice.
 *
 * Semantics:
 *   - emitClusterSwitch(id) fires only when `id` differs from the
 *     previous emitted value (de-dupes accidental double-calls).
 *   - Listeners are invoked synchronously so they see the change before
 *     any network request tied to the new cluster lands.
 *   - __lastCluster() exposes the last emitted id so late subscribers
 *     (mounted after the first switch) can self-sync on mount.
 */

export type ClusterSwitchListener = (clusterId: string) => void;

const listeners = new Set<ClusterSwitchListener>();
let lastEmitted: string | null = null;

/**
 * Subscribe to cluster-switch events. Returns an unsubscribe function.
 */
export function onClusterSwitch(fn: ClusterSwitchListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Emit a cluster-switched event. No-ops when the id is unchanged so
 * stores can safely subscribe without worrying about redundant clears.
 */
export function emitClusterSwitch(clusterId: string): void {
  if (clusterId === lastEmitted) return;
  lastEmitted = clusterId;
  // Snapshot so a listener that unsubscribes during dispatch doesn't
  // mutate the set we're iterating.
  for (const fn of Array.from(listeners)) {
    try {
      fn(clusterId);
    } catch (err) {
      // Keep the bus alive — a broken listener must not block others.
      // eslint-disable-next-line no-console
      console.error('[clusterSwitch] listener threw', err);
    }
  }
}

/**
 * Test-only helper: drop all registered listeners.
 */
export function clearClusterSwitchListeners(): void {
  listeners.clear();
  lastEmitted = null;
}

/**
 * Expose the last-emitted cluster for late subscribers / diagnostics.
 */
export function __lastCluster(): string | null {
  return lastEmitted;
}
