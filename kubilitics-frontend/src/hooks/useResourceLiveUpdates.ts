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
    if (s === 'storageclass') return 'storageclasses';
    if (s === 'ingressclass') return 'ingressclasses';
    if (s === 'priorityclass') return 'priorityclasses';
    if (s === 'runtimeclass') return 'runtimeclasses';
    if (s === 'endpoints') return 'endpoints';
    return s + 's';
}

// ── PERF Area 6: Row Animation Tracking ────────────────────────────────────────
// Global registry of recently-changed resource UIDs with their event type.
// Table rows read from this to apply CSS animation classes (fade-in, pulse, fade-out).
// Entries auto-expire after ANIMATION_DURATION_MS to avoid memory leaks.

type RowAnimationType = 'added' | 'modified' | 'deleted';

interface RowAnimationEntry {
    type: RowAnimationType;
    expires: number;
}

const ANIMATION_DURATION_MS = 1500;

/** Global map: resourceUID → animation entry */
const rowAnimations = new Map<string, RowAnimationEntry>();

/** Periodic cleanup timer (shared, runs only when there are entries) */
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCleanup() {
    if (cleanupTimer) return;
    cleanupTimer = setTimeout(() => {
        const now = Date.now();
        for (const [uid, entry] of rowAnimations) {
            if (now >= entry.expires) rowAnimations.delete(uid);
        }
        cleanupTimer = null;
        if (rowAnimations.size > 0) scheduleCleanup();
    }, ANIMATION_DURATION_MS);
}

/**
 * Track a resource change for row animation.
 * Called from WebSocket event handlers to trigger CSS animations on table rows.
 */
export function trackRowAnimation(uid: string, type: RowAnimationType) {
    rowAnimations.set(uid, { type, expires: Date.now() + ANIMATION_DURATION_MS });
    scheduleCleanup();
}

/**
 * Get the CSS animation class for a resource row, or empty string if no animation active.
 * Call this from table row rendering to apply .animate-row-added / .animate-row-update / .animate-row-deleted.
 */
export function getRowAnimationClass(uid: string | undefined): string {
    if (!uid) return '';
    const entry = rowAnimations.get(uid);
    if (!entry) return '';
    if (Date.now() >= entry.expires) {
        rowAnimations.delete(uid);
        return '';
    }
    switch (entry.type) {
        case 'added': return 'animate-row-added';
        case 'modified': return 'animate-row-update';
        case 'deleted': return 'animate-row-deleted';
        default: return '';
    }
}

/**
 * Global hook to handle real-time resource updates via WebSocket.
 * When a resource is added/modified/deleted in the cluster, the backend
 * broadcasts a 'resource_update' event. This hook captures it and
 * invalidates matching React Query lists so the UI stays in sync.
 *
 * PERF Area 6: Also tracks per-UID animation events so table rows
 * can show brief highlight/fade animations on real-time changes.
 */
export function useResourceLiveUpdates({
    clusterId,
    enabled = true,
}: UseResourceLiveUpdatesOptions) {
    const queryClient = useQueryClient();

    // Throttle: batch rapid-fire WebSocket events and invalidate at most once per 200ms per resource type
    const pendingInvalidations = useRef<Set<string>>(new Set());
    const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flushInvalidations = useCallback(() => {
        const pending = pendingInvalidations.current;
        if (pending.size === 0) return;

        // Invalidate topology once (not per-event)
        queryClient.invalidateQueries({ queryKey: ['topology', clusterId] });

        // Invalidate each unique resource type
        for (const normalizedKind of pending) {
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
        (data: Record<string, unknown>) => {
            if (!clusterId) return;

            const type = data.type as string | undefined;

            if (type === 'resource_update') {
                const resource = data.resource;

                if (resource && resource.type) {
                    const normalizedKind = normalizeKind(resource.type);
                    pendingInvalidations.current.add(normalizedKind);

                    // PERF Area 6: Track per-UID animation if the event includes object details
                    const uid = resource.uid || resource.metadata?.uid;
                    const eventAction: string | undefined = resource.action || resource.event_type;
                    if (uid && eventAction) {
                        const animType: RowAnimationType =
                            eventAction === 'ADDED' ? 'added' :
                            eventAction === 'DELETED' ? 'deleted' : 'modified';
                        trackRowAnimation(uid, animType);
                    }
                }

                // Batch invalidations: wait 200ms for more events before flushing.
                if (!flushTimer.current) {
                    flushTimer.current = setTimeout(flushInvalidations, 200);
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
