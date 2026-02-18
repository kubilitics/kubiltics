/**
 * WebSocket connection to Kubilitics backend with exponential backoff and max retries (B2.4).
 * Primary for real-time updates (topology, resources); polling is fallback when disconnected.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

const DEFAULT_MAX_RETRIES = 10;
const INITIAL_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

export interface BackendWebSocketMessage {
  type?: string;
  event?: string;
  resource?: Record<string, unknown>;
  timestamp?: string;
}

export interface UseBackendWebSocketOptions {
  clusterId?: string | null;
  maxRetries?: number;
  onMessage?: (data: BackendWebSocketMessage) => void;
  enabled?: boolean;
}

export function useBackendWebSocket(options: UseBackendWebSocketOptions = {}) {
  const {
    clusterId = null,
    maxRetries = DEFAULT_MAX_RETRIES,
    onMessage,
    enabled = true,
  } = options;

  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<BackendWebSocketMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable refs so connect/reconnect can call each other without circular useCallback deps
  const connectRef = useRef<() => void>(() => {});
  const reconnectRef = useRef<() => void>(() => {});

  // connect is declared FIRST so reconnect can safely reference it
  const connect = useCallback(() => {
    if (!isConfigured() || !enabled) return;

    const protocol = backendBaseUrl?.startsWith('https') ? 'wss' : 'ws';
    const host = backendBaseUrl
      ? backendBaseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')
      : (typeof window !== 'undefined' ? window.location.host : '');
    if (!host) return;
    const url = new URL('/ws/resources', `${protocol}//${host}`);
    if (clusterId) url.searchParams.set('cluster_id', clusterId);

    const ws = new WebSocket(url.toString());
    wsRef.current = ws;

    ws.onopen = () => {
      retryCountRef.current = 0;
      setConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as BackendWebSocketMessage;
        setLastMessage(data);
        onMessage?.(data);
      } catch {
        // ignore non-JSON
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setConnected(false);

      if (!enabled) return;
      if (retryCountRef.current >= maxRetries) {
        const errorMsg = `WebSocket disconnected after ${maxRetries} retries`;
        setError(errorMsg);

        // Show persistent toast with manual reconnect button
        // Use reconnectRef to avoid circular dependency in useCallback deps
        toast.error('WebSocket connection lost', {
          description: 'Real-time updates are disabled. Click to reconnect.',
          duration: Infinity, // Persist until user dismisses or reconnects
          action: {
            label: 'Reconnect',
            onClick: () => {
              reconnectRef.current();
              toast.dismiss();
            },
          },
        });
        return;
      }

      const delay = Math.min(
        INITIAL_RECONNECT_MS * Math.pow(BACKOFF_MULTIPLIER, retryCountRef.current),
        MAX_RECONNECT_MS
      );
      retryCountRef.current += 1;
      setError(`Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${retryCountRef.current}/${maxRetries})…`);

      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        // Use connectRef to avoid adding connect to deps (which would cause circular dep with reconnect)
        connectRef.current();
      }, delay);
    };

    ws.onerror = () => {
      setError('WebSocket error');
    };
  }, [backendBaseUrl, clusterId, enabled, isConfigured, maxRetries, onMessage]);

  // Keep connectRef in sync with the latest connect callback
  useEffect(() => { connectRef.current = connect; }, [connect]);

  // reconnect is declared AFTER connect so [connect] in its deps is safe (no TDZ)
  const reconnect = useCallback(() => {
    // Reset retry count and attempt reconnection
    retryCountRef.current = 0;
    setError(null);

    // Clear any pending reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Attempt to reconnect — connect is declared above, no TDZ
    connect();
  }, [connect]);

  // Keep reconnectRef in sync with the latest reconnect callback
  useEffect(() => { reconnectRef.current = reconnect; }, [reconnect]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    retryCountRef.current = maxRetries;
    setConnected(false);
    setError(null);
  }, [maxRetries]);

  useEffect(() => {
    if (enabled && isConfigured() && backendBaseUrl) {
      connect();
    }
    return () => disconnect();
  }, [enabled, backendBaseUrl, clusterId, isConfigured]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    connected,
    lastMessage,
    error,
    reconnect, // Manual reconnect function
    disconnect,
  };
}
