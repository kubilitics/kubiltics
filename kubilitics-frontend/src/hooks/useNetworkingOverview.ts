import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useK8sResourceList } from './useKubernetes';

export interface NetworkingOverviewData {
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
        type?: string;
        endpoints?: number;
    }>;
}

export function useNetworkingOverview() {
    const { activeCluster } = useClusterStore();
    const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
    const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
    const clusterId = currentClusterId ?? undefined;

    const fallbackEnabled = !!(activeCluster || clusterId);

    const services = useK8sResourceList('services', undefined, { enabled: fallbackEnabled });
    const ingresses = useK8sResourceList('ingresses', undefined, { enabled: fallbackEnabled });
    const networkPolicies = useK8sResourceList('networkpolicies', undefined, { enabled: fallbackEnabled });
    const endpoints = useK8sResourceList('endpoints', undefined, { enabled: fallbackEnabled });

    const data = useMemo(() => {
        const items: NetworkingOverviewData['resources'] = [];

        // Process Services
        (services.data?.items ?? []).forEach((s: any) => {
            items.push({
                kind: 'Service',
                name: s.metadata.name,
                namespace: s.metadata.namespace,
                status: s.spec?.clusterIP ? 'Active' : 'Pending',
                type: s.spec?.type,
            });
        });

        // Process Ingresses
        (ingresses.data?.items ?? []).forEach((i: any) => {
            items.push({
                kind: 'Ingress',
                name: i.metadata.name,
                namespace: i.metadata.namespace,
                status: 'Active',
            });
        });

        // Process Network Policies
        (networkPolicies.data?.items ?? []).forEach((p: any) => {
            items.push({
                kind: 'NetworkPolicy',
                name: p.metadata.name,
                namespace: p.metadata.namespace,
                status: 'Active',
            });
        });

        const total = items.length;
        const healthy = items.length; // Simplified for now

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
    }, [services.data, ingresses.data, networkPolicies.data]);

    return {
        data,
        isLoading: services.isLoading || ingresses.isLoading || networkPolicies.isLoading,
        isError: services.isError || ingresses.isError || networkPolicies.isError,
    };
}
