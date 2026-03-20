import { useMemo } from 'react';
import { useK8sResourceList } from './useKubernetes';

export interface SecurityAsset {
    kind: string;
    name: string;
    namespace?: string;
    creationTimestamp: string;
    labels: Record<string, string>;
}

export function useSecurityAssets() {
    const serviceAccounts = useK8sResourceList('serviceaccounts');
    const roles = useK8sResourceList('roles');
    const clusterRoles = useK8sResourceList('clusterroles');
    const roleBindings = useK8sResourceList('rolebindings');
    const clusterRoleBindings = useK8sResourceList('clusterrolebindings');

    const isLoading =
        serviceAccounts.isLoading ||
        roles.isLoading ||
        clusterRoles.isLoading ||
        roleBindings.isLoading ||
        clusterRoleBindings.isLoading;

    const assets = useMemo(() => {
        const list: SecurityAsset[] = [];

        const mapResource = (items: any[], kind: string) => {
            return items.map(item => ({
                kind,
                name: item.metadata?.name || '',
                namespace: item.metadata?.namespace,
                creationTimestamp: item.metadata?.creationTimestamp || '',
                labels: item.metadata?.labels || {},
            }));
        };

        if (serviceAccounts.data?.items) list.push(...mapResource(serviceAccounts.data.items, 'ServiceAccount'));
        if (roles.data?.items) list.push(...mapResource(roles.data.items, 'Role'));
        if (clusterRoles.data?.items) list.push(...mapResource(clusterRoles.data.items, 'ClusterRole'));
        if (roleBindings.data?.items) list.push(...mapResource(roleBindings.data.items, 'RoleBinding'));
        if (clusterRoleBindings.data?.items) list.push(...mapResource(clusterRoleBindings.data.items, 'ClusterRoleBinding'));

        return list;
    }, [
        serviceAccounts.data?.items,
        roles.data?.items,
        clusterRoles.data?.items,
        roleBindings.data?.items,
        clusterRoleBindings.data?.items
    ]);

    const counts = {
        serviceAccounts: serviceAccounts.data?.items?.length || 0,
        roles: roles.data?.items?.length || 0,
        clusterRoles: clusterRoles.data?.items?.length || 0,
        roleBindings: roleBindings.data?.items?.length || 0,
        clusterRoleBindings: clusterRoleBindings.data?.items?.length || 0,
        total: (serviceAccounts.data?.items?.length || 0) +
            (roles.data?.items?.length || 0) +
            (clusterRoles.data?.items?.length || 0) +
            (roleBindings.data?.items?.length || 0) +
            (clusterRoleBindings.data?.items?.length || 0)
    };

    return {
        assets,
        counts,
        isLoading,
        refetch: () => {
            serviceAccounts.refetch();
            roles.refetch();
            clusterRoles.refetch();
            roleBindings.refetch();
            clusterRoleBindings.refetch();
        }
    };
}
