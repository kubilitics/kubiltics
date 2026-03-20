import { useMemo } from 'react';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useK8sResourceList } from './useKubernetes';

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
    const { activeCluster } = useClusterStore();
    const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
    const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
    const clusterId = currentClusterId ?? undefined;

    const fallbackEnabled = !!(activeCluster || clusterId);

    const nodes = useK8sResourceList('nodes', undefined, { enabled: fallbackEnabled });
    const namespaces = useK8sResourceList('namespaces', undefined, { enabled: fallbackEnabled });
    const events = useK8sResourceList('events', undefined, { enabled: fallbackEnabled });
    const apiServices = useK8sResourceList('apiservices', undefined, { enabled: fallbackEnabled });

    const data = useMemo(() => {
        const items: ClusterOverviewData['resources'] = [];

        // Nodes
        (nodes.data?.items ?? []).forEach((n: any) => {
            const readyObj = (n.status?.conditions ?? []).find((c: any) => c.type === 'Ready');
            items.push({
                kind: 'Node',
                name: n.metadata.name,
                namespace: 'N/A',
                status: readyObj?.status === 'True' ? 'Ready' : 'NotReady',
                version: n.status?.nodeInfo?.kubeletVersion,
            });
        });

        // Namespaces
        (namespaces.data?.items ?? []).forEach((ns: any) => {
            items.push({
                kind: 'Namespace',
                name: ns.metadata.name,
                namespace: 'N/A',
                status: ns.status?.phase || 'Active',
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
