/**
 * Single source of truth for the active cluster ID used in backend API paths.
 * P0-D: Use currentClusterId (backendConfigStore) only. Never use activeCluster.id
 * for API calls — it may be stale, demo (__demo__*), or out of sync with backend.
 */
import { useBackendConfigStore } from '@/stores/backendConfigStore';

export function useActiveClusterId(): string | null {
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  return currentClusterId ?? null;
}
