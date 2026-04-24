import { useMemo } from 'react';
import { useActiveCluster } from '@/stores/clusterPresenceStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useK8sResourceList } from './useKubernetes';

import { useActiveClusterId } from '@/hooks/useActiveClusterId';
export interface ClusterOverviewData {
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
        version?: string;
    }>;
}

export function useClusterOverviewData() {
    const activeCluster = useActiveCluster();
    const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
    const currentClusterId = useActiveClusterId();
    const clusterId = currentClusterId ?? undefined;

    const fallbackEnabled = !!(activeCluster || clusterId);

    const nodes = useK8sResourceList('nodes', undefined, { enabled: fallbackEnabled, limit: 500 });
    const namespaces = useK8sResourceList('namespaces', undefined, { enabled: fallbackEnabled, limit: 500 });
    const events = useK8sResourceList('events', undefined, { enabled: fallbackEnabled, limit: 1000 });
    const apiServices = useK8sResourceList('apiservices', undefined, { enabled: fallbackEnabled, limit: 500 });

    const data = useMemo(() => {
        const items: ClusterOverviewData['resources'] = [];

        // Nodes
        (nodes.data?.items ?? []).forEach((n: Record<string, unknown>) => {
            const readyObj = (n.status as Record<string, unknown>)?.conditions as Array<Record<string, unknown>> | undefined;
            const readyCondition = (readyObj ?? []).find((c: Record<string, unknown>) => c.type === 'Ready');
            const metadata = n.metadata as Record<string, unknown>;
            const status = n.status as Record<string, unknown>;
            const nodeInfo = status?.nodeInfo as Record<string, unknown>;
            items.push({
                kind: 'Node',
                name: metadata?.name as string,
                namespace: 'N/A',
                status: readyCondition?.status === 'True' ? 'Ready' : 'NotReady',
                version: nodeInfo?.kubeletVersion as string | undefined,
            });
        });

        // Namespaces
        (namespaces.data?.items ?? []).forEach((ns: Record<string, unknown>) => {
            const metadata = ns.metadata as Record<string, unknown>;
            const nsStatus = ns.status as Record<string, unknown>;
            items.push({
                kind: 'Namespace',
                name: metadata?.name as string,
                namespace: 'N/A',
                status: (nsStatus?.phase as string) || 'Active',
            });
        });

        const total = items.length;
        const healthy = items.filter(i => ['Ready', 'Active'].includes(i.status)).length;

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
    }, [nodes.data, namespaces.data]);

    return {
        data,
        isLoading: nodes.isLoading || namespaces.isLoading,
        isError: nodes.isError || namespaces.isError,
    };
}
