import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBackendWebSocket } from './useBackendWebSocket';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { toast } from 'sonner';

export interface UseResourceLiveUpdatesOptions {
    clusterId: string | null | undefined;
    enabled?: boolean;
}

/**
 * Normalizes Kubernetes Kind to the lowercase plural format used in query keys.
 * Matches internal/k8s/resources.go:NormalizeKindToResource logic.
 */
function normalizeKind(kind: string): string {
    const s = kind.toLowerCase().trim();
    if (s.endsWith('s')) return s;
    // Special cases if any (e.g. StorageClass -> storageclasses is handled by endsWith('s') -> storageclasss? No)
    // Actually, NormalizeKindToResource in backend adds 's' if it doesn't have it.
    // StorageClass -> storageclasss (wait, let's check that logic again)
    if (s === 'storageclass') return 'storageclasses';
    if (s === 'ingressclass') return 'ingressclasses';
    if (s === 'priorityclass') return 'priorityclasses';
    if (s === 'runtimeclass') return 'runtimeclasses';
    if (s === 'endpoints') return 'endpoints';
    return s + 's';
}

/**
 * Global hook to handle real-time resource updates via WebSocket.
 * When a resource is added/modified/deleted in the cluster, the backend
 * broadcasts a 'resource_update' event. This hook captures it and
 * invalidates matching React Query lists so the UI stays in sync.
 */
export function useResourceLiveUpdates({
    clusterId,
    enabled = true,
}: UseResourceLiveUpdatesOptions) {
    const queryClient = useQueryClient();
    const stored = useBackendConfigStore((s) => s.backendBaseUrl);
    const baseUrl = getEffectiveBackendBaseUrl(stored);

    const onMessage = useCallback(
        (data: any) => {
            if (!clusterId) return;

            const type = data.type;
            const event = data.event; // 'added', 'modified', 'deleted', 'updated'

            if (type === 'resource_update' && event) {
                const resource = data.resource;

                // 1. Invalidate Topology (all resources affect topology)
                queryClient.invalidateQueries({ queryKey: ['topology', clusterId] });

                // 2. Invalidate specific Resource Lists
                if (resource && resource.type) {
                    const kind = resource.type;
                    const normalizedKind = normalizeKind(kind);
                    queryClient.invalidateQueries({
                        queryKey: ['backend', 'resourceList', baseUrl, clusterId, normalizedKind],
                    });
                }

                // 3. Optional: Notification
                const label = event === 'added' ? 'New resource added' : event === 'modified' ? 'Resource updated' : 'Resource deleted';
                toast.info(label);

            } else if (type === 'topology_update') {
                queryClient.invalidateQueries({ queryKey: ['topology', clusterId] });
                toast.info('Topology updated');
            }
        },
        [clusterId, baseUrl, queryClient]
    );

    useBackendWebSocket({
        clusterId: clusterId ?? null,
        onMessage,
        enabled: enabled && !!clusterId,
    });
}
