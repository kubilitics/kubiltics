/**
 * Single source of truth for the active cluster ID used in every backend API path.
 *
 * Phase 7: now reads primarily from `clusterPresenceStore` — the presence layer
 * is the canonical source for "which cluster is active and what's its session
 * UUID?". The legacy `clusterStore.activeCluster.id` and
 * `backendConfigStore.currentClusterId` are kept as fallbacks during the
 * transition window where some code paths still write to those stores.
 *
 * Resolution order:
 *   1. `clusterPresenceStore.activeCluster().session_id` — authoritative
 *      connected session UUID. Empty string when a logical identity is
 *      selected but the cluster has not yet been registered — callers must
 *      treat that as "not yet ready for session-scoped API calls".
 *   2. `useClusterStore.activeCluster.id` — legacy store, still updated by
 *      `useRestoreClusterFromBackend` in App.tsx.
 *   3. `useBackendConfigStore.currentClusterId` — localStorage-persisted ID.
 *
 * Demo clusters (`__demo__*`) are excluded because they never hit the backend.
 */
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useClusterPresenceStore } from '@/stores/clusterPresenceStore';

export function useActiveClusterId(): string | null {
  // Select the session id from the presence store. Using a selector (not
  // activeCluster()) lets Zustand re-render when the id changes.
  const presenceSessionId = useClusterPresenceStore((s) => {
    const id = s.activeLogicalIdentity;
    if (!id) return null;
    const c = s.connected.find(
      (c) => c.identity.name === id.name && c.identity.serverUrl === id.serverUrl,
    );
    return c?.session_id || null;
  });
  const activeClusterId = useClusterStore((s) => s.activeCluster?.id);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);

  if (presenceSessionId) return presenceSessionId;
  if (activeClusterId && !activeClusterId.startsWith('__demo__')) {
    return activeClusterId;
  }
  return currentClusterId ?? null;
}
