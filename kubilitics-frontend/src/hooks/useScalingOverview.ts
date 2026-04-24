import { useMemo } from 'react';
import { useActiveCluster } from '@/stores/clusterPresenceStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useK8sResourceList } from './useKubernetes';

import { useActiveClusterId } from '@/hooks/useActiveClusterId';
export function useScalingOverview() {
    const activeCluster = useActiveCluster();
    const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
    const currentClusterId = useActiveClusterId();
    const clusterId = currentClusterId ?? undefined;

    const fallbackEnabled = !!(activeCluster || clusterId);

    const hpas = useK8sResourceList('horizontalpodautoscalers', undefined, { enabled: fallbackEnabled, limit: 1000 });
    const vpas = useK8sResourceList('verticalpodautoscalers', undefined, { enabled: fallbackEnabled, limit: 1000 });
    const pdbs = useK8sResourceList('poddisruptionbudgets', undefined, { enabled: fallbackEnabled, limit: 1000 });

    const data = useMemo(() => {
        const items: Record<string, unknown>[] = [];

        (hpas.data?.items ?? []).forEach((h: Record<string, unknown>) => {
            const metadata = h.metadata as Record<string, unknown>;
            const status = h.status as Record<string, unknown> | undefined;
            items.push({
                kind: 'HPA',
                name: metadata.name,
                namespace: metadata.namespace,
                status: status?.currentReplicas ? 'Active' : 'Pending',
            });
        });

        (vpas.data?.items ?? []).forEach((v: Record<string, unknown>) => {
            const metadata = v.metadata as Record<string, unknown>;
            items.push({
                kind: 'VPA',
                name: metadata.name,
                namespace: metadata.namespace,
                status: 'Active',
            });
        });

        (pdbs.data?.items ?? []).forEach((p: Record<string, unknown>) => {
            const metadata = p.metadata as Record<string, unknown>;
            items.push({
                kind: 'PDB',
                name: metadata.name,
                namespace: metadata.namespace,
                status: 'Active',
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
    }, [hpas.data, vpas.data, pdbs.data]);

    return { data, isLoading: hpas.isLoading || vpas.isLoading || pdbs.isLoading };
}
