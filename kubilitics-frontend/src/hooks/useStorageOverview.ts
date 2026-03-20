import { useMemo } from 'react';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useK8sResourceList } from './useKubernetes';

export interface StorageOverviewData {
    pulse: {
        total: number;
        healthy: number;
        warning: number;
        critical: number;
        optimal_percent: number;
    };
    resources: Array<{
        kind: string;
        name: string;
        namespace: string;
        status: string;
        capacity?: string;
    }>;
}

export function useStorageOverview() {
    const { activeCluster } = useClusterStore();
    const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
    const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
    const clusterId = currentClusterId ?? undefined;

    const fallbackEnabled = !!(activeCluster || clusterId);

    const pvcs = useK8sResourceList('persistentvolumeclaims', undefined, { enabled: fallbackEnabled });
    const pvs = useK8sResourceList('persistentvolumes', undefined, { enabled: fallbackEnabled });
    const scs = useK8sResourceList('storageclasses', undefined, { enabled: fallbackEnabled });
    const configMaps = useK8sResourceList('configmaps', undefined, { enabled: fallbackEnabled });
    const secrets = useK8sResourceList('secrets', undefined, { enabled: fallbackEnabled });

    const data = useMemo(() => {
        const items: StorageOverviewData['resources'] = [];

        // PVCs
        (pvcs.data?.items ?? []).forEach((p: any) => {
            items.push({
                kind: 'PersistentVolumeClaim',
                name: p.metadata.name,
                namespace: p.metadata.namespace,
                status: p.status?.phase || 'Pending',
                capacity: p.status?.capacity?.storage,
            });
        });

        // PVs
        (pvs.data?.items ?? []).forEach((p: any) => {
            items.push({
                kind: 'PersistentVolume',
                name: p.metadata.name,
                namespace: 'N/A',
                status: p.status?.phase || 'Pending',
                capacity: p.spec?.capacity?.storage,
            });
        });

        // SCs
        (scs.data?.items ?? []).forEach((s: any) => {
            items.push({
                kind: 'StorageClass',
                name: s.metadata.name,
                namespace: 'N/A',
                status: 'Active',
            });
        });

        const total = items.length;
        const healthy = items.filter(i => ['Bound', 'Available', 'Active'].includes(i.status)).length;

        return {
            pulse: {
                total,
                healthy,
                warning: 0,
                critical: 0,
                optimal_percent: total > 0 ? (healthy / total) * 100 : 100,
            },
            resources: items,
        };
    }, [pvcs.data, pvs.data, scs.data]);

    return {
        data,
        isLoading: pvcs.isLoading || pvs.isLoading || scs.isLoading,
        isError: pvcs.isError || pvs.isError || scs.isError,
    };
}
