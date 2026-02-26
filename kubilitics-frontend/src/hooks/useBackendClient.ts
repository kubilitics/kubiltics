/**
 * Hook that returns the Kubilitics backend API client bound to the current backend base URL.
 * Use when backend is configured (backendConfigStore.backendBaseUrl set).
 * Per TASKS A3.1: client used by topology and cluster list.
 */
import { useMemo } from 'react';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import {
  createBackendApiClient,
  getClusters,
  getTopology,
  getHealth,
} from '@/services/backendApiClient';

export function useBackendClient() {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  const client = useMemo(() => {
    if (!isConfigured()) return null;
    return createBackendApiClient(backendBaseUrl);
  }, [backendBaseUrl, isConfigured]);

  return {
    client,
    backendBaseUrl,
    isBackendConfigured: isConfigured,
    getClusters: isConfigured() ? () => getClusters(backendBaseUrl) : null,
    getTopology: isConfigured()
      ? (clusterId: string, params?: { namespace?: string; resource_types?: string[] }) =>
        getTopology(backendBaseUrl, clusterId, params)
      : null,
    getHealth: isConfigured() ? () => getHealth(backendBaseUrl) : null,
  };
}
