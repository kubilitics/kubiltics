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
        (pvcs.data?.items ?? []).forEach((p: Record<string, unknown>) => {
            const metadata = p.metadata as Record<string, unknown>;
            const status = p.status as Record<string, unknown>;
            const capacity = status?.capacity as Record<string, unknown> | undefined;
            items.push({
                kind: 'PersistentVolumeClaim',
                name: metadata.name as string,
                namespace: metadata.namespace as string,
                status: (status?.phase as string) || 'Pending',
                capacity: capacity?.storage as string | undefined,
            });
        });

        // PVs
        (pvs.data?.items ?? []).forEach((p: Record<string, unknown>) => {
            const metadata = p.metadata as Record<string, unknown>;
            const status = p.status as Record<string, unknown>;
            const spec = p.spec as Record<string, unknown>;
            const specCapacity = spec?.capacity as Record<string, unknown> | undefined;
            items.push({
                kind: 'PersistentVolume',
                name: metadata.name as string,
                namespace: 'N/A',
                status: (status?.phase as string) || 'Pending',
                capacity: specCapacity?.storage as string | undefined,
            });
        });

        // SCs
        (scs.data?.items ?? []).forEach((s: Record<string, unknown>) => {
            const metadata = s.metadata as Record<string, unknown>;
            items.push({
                kind: 'StorageClass',
                name: metadata.name as string,
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
