import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBackendWebSocket } from './useBackendWebSocket';
import { useBackendConfigStore } from '@/stores/backendConfigStore';

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

    // Throttle: batch rapid-fire WebSocket events and invalidate at most once per 500ms per resource type
    const pendingInvalidations = useRef<Set<string>>(new Set());
    const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flushInvalidations = useCallback(() => {
        const pending = pendingInvalidations.current;
        if (pending.size === 0) return;

        // Invalidate topology once (not per-event)
        queryClient.invalidateQueries({ queryKey: ['topology', clusterId] });

        // Invalidate each unique resource type
        for (const normalizedKind of pending) {
            // FIX: Match the actual queryKey pattern used in useK8sResourceList:
            // ['backend', 'resources', clusterId, activeProjectId, resourceType, ...]
            // Use partial matching — invalidate any query starting with ['backend', 'resources', clusterId]
            // that matches the resource type at index 4.
            queryClient.invalidateQueries({
                predicate: (query) => {
                    const key = query.queryKey;
                    return (
                        key[0] === 'backend' &&
                        key[1] === 'resources' &&
                        key[2] === clusterId &&
                        key[4] === normalizedKind
                    );
                },
            });
        }

        pending.clear();
        flushTimer.current = null;
    }, [clusterId, queryClient]);

    const onMessage = useCallback(
        (data: any) => {
            if (!clusterId) return;

            const type = data.type;

            if (type === 'resource_update') {
                const resource = data.resource;

                if (resource && resource.type) {
                    const normalizedKind = normalizeKind(resource.type);
                    pendingInvalidations.current.add(normalizedKind);
                }

                // Batch invalidations: wait 500ms for more events before flushing
                if (!flushTimer.current) {
                    flushTimer.current = setTimeout(flushInvalidations, 500);
                }
            } else if (type === 'topology_update') {
                queryClient.invalidateQueries({ queryKey: ['topology', clusterId] });
            }
        },
        [clusterId, queryClient, flushInvalidations]
    );

    useBackendWebSocket({
        clusterId: clusterId ?? null,
        onMessage,
        enabled: enabled && !!clusterId,
    });
}
