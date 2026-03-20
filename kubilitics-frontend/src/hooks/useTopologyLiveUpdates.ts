/**
 * Task 8.4: Real-time topology updates via WebSocket
 * When backend broadcasts resource_update or topology_update, invalidate topology query
 * so useClusterTopology refetches and the graph updates without full page refresh.
 *
 * NOTE: Resource changes are silently applied — no toast per event. Showing a toast
 * for every pod/deployment change would flood the UI in any real cluster.
 */
import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBackendWebSocket } from './useBackendWebSocket';

export interface UseTopologyLiveUpdatesOptions {
  clusterId: string | null | undefined;
  enabled?: boolean;
}

/** Batch invalidation window (ms) to avoid rapid-fire refetches. */
const INVALIDATION_DEBOUNCE_MS = 500;

/**
 * Subscribes to backend WebSocket; on resource_update or topology_update
 * invalidates ['topology', clusterId, ...] so topology refetches.
 */
export function useTopologyLiveUpdates({
  clusterId,
  enabled = true,
}: UseTopologyLiveUpdatesOptions) {
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMessage = useCallback(
    (data: { type?: string; event?: string; resource?: Record<string, unknown> }) => {
      if (!clusterId) return;
      const type = data.type;

      if (type === 'resource_update' || type === 'topology_update') {
        // Debounce: batch rapid events into a single invalidation
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;
          queryClient.invalidateQueries({ queryKey: ['topology', clusterId] });
        }, INVALIDATION_DEBOUNCE_MS);
      }
    },
    [clusterId, queryClient]
  );

  useBackendWebSocket({
    clusterId: clusterId ?? null,
    onMessage,
    enabled: enabled && !!clusterId,
  });
}
