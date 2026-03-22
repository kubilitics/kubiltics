import { useMemo } from 'react';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useK8sResourceList } from './useKubernetes';

export function useResourcesOverview() {
    const { activeCluster } = useClusterStore();
    const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
    const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
    const clusterId = currentClusterId ?? undefined;

    const fallbackEnabled = !!(activeCluster || clusterId);

    const quotas = useK8sResourceList('resourcequotas', undefined, { enabled: fallbackEnabled });
    const limits = useK8sResourceList('limitranges', undefined, { enabled: fallbackEnabled });
    const slices = useK8sResourceList('resourceslices', undefined, { enabled: fallbackEnabled });
    const classes = useK8sResourceList('deviceclasses', undefined, { enabled: fallbackEnabled });

    const data = useMemo(() => {
        const items: Record<string, unknown>[] = [];

        (quotas.data?.items ?? []).forEach((q: Record<string, unknown>) => {
            const metadata = q.metadata as Record<string, unknown>;
            items.push({
                kind: 'ResourceQuota',
                name: metadata.name,
                namespace: metadata.namespace,
                status: 'Active',
            });
        });

        (limits.data?.items ?? []).forEach((l: Record<string, unknown>) => {
            const metadata = l.metadata as Record<string, unknown>;
            items.push({
                kind: 'LimitRange',
                name: metadata.name,
                namespace: metadata.namespace,
                status: 'Active',
            });
        });

        (slices.data?.items ?? []).forEach((s: Record<string, unknown>) => {
            const metadata = s.metadata as Record<string, unknown>;
            items.push({
                kind: 'ResourceSlice',
                name: metadata.name,
                namespace: metadata.namespace,
                status: 'Available',
            });
        });

        (classes.data?.items ?? []).forEach((c: Record<string, unknown>) => {
            const metadata = c.metadata as Record<string, unknown>;
            items.push({
                kind: 'DeviceClass',
                name: metadata.name,
                namespace: undefined,
                status: 'Configured',
            });
        });

        return {
            pulse: {
                total: items.length,
                healthy: items.length,
                warning: 0,
                critical: 0,
                optimal_percent: 100,
            },
            resources: items,
        };
    }, [quotas.data, limits.data, slices.data, classes.data]);

    return { data, isLoading: quotas.isLoading || limits.isLoading || slices.isLoading || classes.isLoading };
}
