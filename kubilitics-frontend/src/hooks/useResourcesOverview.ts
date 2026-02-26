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
        const items: any[] = [];

        (quotas.data?.items ?? []).forEach((q: any) => {
            items.push({
                kind: 'ResourceQuota',
                name: q.metadata.name,
                namespace: q.metadata.namespace,
                status: 'Active',
            });
        });

        (limits.data?.items ?? []).forEach((l: any) => {
            items.push({
                kind: 'LimitRange',
                name: l.metadata.name,
                namespace: l.metadata.namespace,
                status: 'Active',
            });
        });

        (slices.data?.items ?? []).forEach((s: any) => {
            items.push({
                kind: 'ResourceSlice',
                name: s.metadata.name,
                namespace: s.metadata.namespace,
                status: 'Available',
            });
        });

        (classes.data?.items ?? []).forEach((c: any) => {
            items.push({
                kind: 'DeviceClass',
                name: c.metadata.name,
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
