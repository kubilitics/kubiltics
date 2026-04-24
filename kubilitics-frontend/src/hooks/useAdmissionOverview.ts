import { useMemo } from 'react';
import { useActiveCluster } from '@/stores/clusterPresenceStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useK8sResourceList } from './useKubernetes';

export function useAdmissionOverview() {
    const activeCluster = useActiveCluster();
    const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
    const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
    const clusterId = currentClusterId ?? undefined;

    const fallbackEnabled = !!(activeCluster || clusterId);

    const mutating = useK8sResourceList('mutatingwebhookconfigurations', undefined, { enabled: fallbackEnabled, limit: 500 });
    const validating = useK8sResourceList('validatingwebhookconfigurations', undefined, { enabled: fallbackEnabled, limit: 500 });

    const data = useMemo(() => {
        const items: Record<string, unknown>[] = [];

        (mutating.data?.items ?? []).forEach((m: Record<string, unknown>) => {
            items.push({
                kind: 'MutatingWebhook',
                name: (m.metadata as Record<string, unknown>)?.name,
                namespace: 'N/A',
                status: 'Active',
            });
        });

        (validating.data?.items ?? []).forEach((v: Record<string, unknown>) => {
            items.push({
                kind: 'ValidatingWebhook',
                name: v.metadata.name,
                namespace: 'N/A',
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
    }, [mutating.data, validating.data]);

    return { data, isLoading: mutating.isLoading || validating.isLoading };
}
