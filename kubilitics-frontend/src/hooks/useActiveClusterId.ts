/**
 * Single source of truth for the active cluster ID used in every backend API path.
 *
 * Phase 7 Task 4 clean-up: the legacy fallbacks are gone.
 * `clusterPresenceStore` is the canonical source for "which cluster is
 * active and what is its backend session UUID?".
 *
 * Returns the `session_id` of the currently-active connected cluster, or
 * `null` when no cluster is selected or when the selected logical identity
 * has been discovered but not yet registered. Callers must guard against
 * the `null` case before making cluster-scoped API calls.
 */
import { useClusterPresenceStore } from '@/stores/clusterPresenceStore';
import { logicalIdentityEqual } from '@/types/resilient';

export function useActiveClusterId(): string | null {
  return useClusterPresenceStore((s) => {
    const id = s.activeLogicalIdentity;
    if (!id) return null;
    const hit =
      s.connected.find((c) => logicalIdentityEqual(c.identity, id))
      ?? s.registered.find((c) => logicalIdentityEqual(c.identity, id));
    return hit?.session_id || null;
  });
}
