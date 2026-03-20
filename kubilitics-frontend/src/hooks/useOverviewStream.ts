/**
 * useOverviewStream — subscribes to the backend's WebSocket overview stream
 * (GET /api/v1/clusters/{clusterId}/overview/stream) and writes each incoming
 * update directly into the React Query cache under the same key that
 * useClusterOverview uses.
 *
 * This means:
 *  - Dashboard health/counts/alerts update in real-time from Kubernetes informers
 *  - useClusterOverview needs NO refetchInterval — the stream replaces polling
 *  - A single persistent connection per cluster handles all overview consumers
 *
 * Headlamp/Lens approach: server pushes changes, client never polls.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import type { ClusterOverview } from '@/services/backendApiClient';

// Exponential backoff: 1s → 2s → 4s → 8s → 16s → cap 30s
function nextBackoff(prev: number): number {
  return Math.min(prev * 2, 30_000);
}

export function useOverviewStream(clusterId: string | undefined) {
  const queryClient = useQueryClient();
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1_000);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    if (!isConfigured || !clusterId) return;
    unmountedRef.current = false;

    const baseUrl = getEffectiveBackendBaseUrl(stored);
    // Convert http(s):// → ws(s)://
    const wsBase = baseUrl.replace(/^http/, 'ws');
    const url = `${wsBase}/api/v1/clusters/${encodeURIComponent(clusterId)}/overview/stream`;

    function connect() {
      if (unmountedRef.current) return;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        backoffRef.current = 1_000; // reset backoff on successful connect
      };

      ws.onmessage = (event) => {
        try {
          const overview = JSON.parse(event.data as string) as ClusterOverview;
          // Write into React Query cache — all useClusterOverview consumers
          // pick this up instantly without any refetch
          queryClient.setQueryData(
            ['backend', 'clusterOverview', baseUrl, clusterId],
            overview
          );
        } catch {
          // Ignore malformed frames (e.g. ping/pong text frames)
        }
      };

      ws.onerror = () => {
        // onerror is always followed by onclose — let onclose handle reconnect
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (unmountedRef.current) return;
        // Reconnect with backoff
        reconnectTimer.current = setTimeout(() => {
          backoffRef.current = nextBackoff(backoffRef.current);
          connect();
        }, backoffRef.current);
      };
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [clusterId, isConfigured, stored, queryClient]);
}
