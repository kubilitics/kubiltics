/**
 * Hook to list instances of a CRD by its full name (e.g. certificates.cert-manager.io).
 * Uses backend GET /clusters/{clusterId}/crd-instances/{crdName} when backend is configured.
 * For direct K8s, we cannot easily list arbitrary CRD instances without the GVR - this hook is backend-only for now.
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { listCRDInstances } from '@/services/backendApiClient';
import type { KubernetesResource } from './useKubernetes';

export interface CRDInstanceListResult {
  items: KubernetesResource[];
  metadata?: { resourceVersion?: string; continue?: string; remainingItemCount?: number };
  isLoading: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
  error: Error | null;
  refetch: () => void;
}

export function useCRDInstances(
  crdName: string | undefined,
  namespace?: string,
  options?: { enabled?: boolean; limit?: number }
): CRDInstanceListResult {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;

  const enabled = !!(isBackendConfigured() && clusterId && crdName && (options?.enabled !== false));

  const query = useQuery({
    queryKey: ['crd-instances', clusterId ?? '', crdName ?? '', namespace ?? '', options?.limit ?? 5000],
    queryFn: () =>
      listCRDInstances(backendBaseUrl!, clusterId!, crdName!, {
        namespace,
        limit: options?.limit ?? 5000,
      }),
    enabled,
    staleTime: 15000,
  });

  const items = (query.data?.items ?? []) as KubernetesResource[];

  return {
    items,
    metadata: query.data?.metadata,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    dataUpdatedAt: query.dataUpdatedAt ?? 0,
    error: query.error as Error | null,
    refetch: () => query.refetch(),
  };
}
