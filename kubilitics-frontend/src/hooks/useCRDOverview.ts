import { useMemo } from 'react';
import { useActiveCluster } from '@/stores/clusterPresenceStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useK8sResourceList } from './useKubernetes';

import { useActiveClusterId } from '@/hooks/useActiveClusterId';
export function useCRDOverview() {
    const activeCluster = useActiveCluster();
    const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
    const currentClusterId = useActiveClusterId();
    const clusterId = currentClusterId ?? undefined;

    const fallbackEnabled = !!(activeCluster || clusterId);

    const crds = useK8sResourceList('customresourcedefinitions', undefined, { enabled: fallbackEnabled, limit: 1000 });

    const data = useMemo(() => {
        const items: Record<string, unknown>[] = [];

        (crds.data?.items ?? []).forEach((c: Record<string, unknown>) => {
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
