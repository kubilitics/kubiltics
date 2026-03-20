/**
 * Single source of truth for "connected to a cluster" in Kubilitics.
 * Connected = (backend configured AND activeCluster set) OR (direct K8s API connected).
 * We require activeCluster so the app never shows "connected" when the user cannot
 * access protected routes (e.g. after refresh when only currentClusterId was persisted).
 */
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useKubernetesConfigStore } from '@/stores/kubernetesConfigStore';

export function useConnectionStatus(): { isConnected: boolean } {
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const { config } = useKubernetesConfigStore();

  const isConnected =
    (isBackendConfigured() && !!activeCluster) || config.isConnected;

  return { isConnected };
}
