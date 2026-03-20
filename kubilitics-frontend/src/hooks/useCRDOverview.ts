import { useMemo } from 'react';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useK8sResourceList } from './useKubernetes';

export function useCRDOverview() {
    const { activeCluster } = useClusterStore();
    const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
    const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
    const clusterId = currentClusterId ?? undefined;

    const fallbackEnabled = !!(activeCluster || clusterId);

    const crds = useK8sResourceList('customresourcedefinitions', undefined, { enabled: fallbackEnabled });

    const data = useMemo(() => {
        const items: any[] = [];

        (crds.data?.items ?? []).forEach((c: any) => {
            items.push({
                kind: 'CRD',
                name: c.metadata.name,
                namespace: 'N/A',
                status: 'Active',
                group: c.spec.group,
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
    }, [crds.data]);

    return { data, isLoading: crds.isLoading };
}
