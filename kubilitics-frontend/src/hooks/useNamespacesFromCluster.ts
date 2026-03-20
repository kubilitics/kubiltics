/**
 * Hook to fetch namespaces from a specific cluster managed by the backend.
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { listResources } from '@/services/backendApiClient';

export function useNamespacesFromCluster(clusterId: string | null) {
    const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
    const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
    const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);

    return useQuery({
        queryKey: ['backend', 'clusters', clusterId, 'namespaces'],
        queryFn: async () => {
            if (!clusterId) return [];
            const response = await listResources(backendBaseUrl, clusterId, 'namespaces', { limit: 1000 });
            return (response.items as any[]).map(item => item.metadata?.name).filter(Boolean) as string[];
        },
        enabled: isBackendConfigured() && !!clusterId,
        staleTime: 60_000,
    });
}
