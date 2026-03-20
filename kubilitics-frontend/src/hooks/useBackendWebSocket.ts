/**
 * WebSocket connection to Kubilitics backend with exponential backoff and infinite resilience.
 * Primary for real-time updates (topology, resources); polling is fallback when disconnected.
 *
 * Resilience model (inspired by Lens/Headlamp):
 *  1. Fast reconnect: exponential backoff (2s→30s) for first 20 attempts
 *  2. Slow reconnect: periodic retry every 30s indefinitely (never gives up)
 *  3. Tab visibility: immediate reconnect when tab becomes visible again
 *  4. Persistent toast: stays visible until connection is restored
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

/** Fast phase: exponential backoff for this many attempts */
const FAST_RETRY_ATTEMPTS = 20;
const INITIAL_RECONNECT_MS = 2000;
const MAX_RECONNECT_MS = 30_000;
const BACKOFF_MULTIPLIER = 1.5;

/** Slow phase: retry every 30s indefinitely after fast phase exhausted */
const SLOW_RETRY_INTERVAL_MS = 30_000;

/** Stable toast ID so we never stack multiple "live updates paused" toasts. */
const WS_TOAST_ID = 'ws-live-updates-paused';

export interface BackendWebSocketMessage {
  type?: string;
  event?: string;
  resource?: Record<string, unknown>;
  timestamp?: string;
}

export interface UseBackendWebSocketOptions {
  clusterId?: string | null;
  onMessage?: (data: BackendWebSocketMessage) => void;
  enabled?: boolean;
}

export function useBackendWebSocket(options: UseBackendWebSocketOptions = {}) {
  const {
    clusterId = null,
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
    const url = new URL('/ws/resources', `${protocol}://${host}`);
    if (clusterId) url.searchParams.set('cluster_id', clusterId);

    const ws = new WebSocket(url.toString());
    wsRef.current = ws;

    ws.onopen = () => {
      retryCountRef.current = 0;
      setConnected(true);
      setError(null);
      // Dismiss any lingering "live updates paused" toast on successful reconnect
      toast.dismiss(WS_TOAST_ID);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as BackendWebSocketMessage;
        setLastMessage(data);
        onMessage?.(data);
      } catch (parseErr) {
        console.warn('[ws] failed to parse WebSocket message:', parseErr, 'raw:', typeof event.data === 'string' ? event.data.slice(0, 200) : '(binary)');
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setConnected(false);

      if (!enabled) return;

      const attempt = retryCountRef.current;
      let delay: number;

      if (attempt < FAST_RETRY_ATTEMPTS) {
        // Fast phase: exponential backoff (2s → 30s)
        delay = Math.min(
          INITIAL_RECONNECT_MS * Math.pow(BACKOFF_MULTIPLIER, attempt),
          MAX_RECONNECT_MS
        );
        retryCountRef.current += 1;
        // Don't set error string during fast phase — transient disconnects are normal
        // (e.g. tab hidden, laptop sleep, backend restart). No user-facing indication needed.
      } else {
        // Slow phase: periodic retry every 30s — never gives up.
        // Show a brief toast only once (when entering slow phase) — NOT persistent.
        // BackendStatusBanner is the authoritative "backend unreachable" banner;
        // this toast is supplementary and auto-dismisses to avoid visual duplication.
        delay = SLOW_RETRY_INTERVAL_MS;
        retryCountRef.current += 1;

        if (attempt === FAST_RETRY_ATTEMPTS) {
          toast.warning('Live updates paused', {
            id: WS_TOAST_ID,
            description: 'Real-time connection lost. Retrying automatically.',
            duration: 8000, // Brief — BackendStatusBanner handles sustained outages
          });
        }
        setError('Connection lost. Retrying every 30s…');
      }

      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connectRef.current();
      }, delay);
    };

    ws.onerror = () => {
      setError('WebSocket error');
    };
  }, [backendBaseUrl, clusterId, enabled, isConfigured, onMessage]);

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
    retryCountRef.current = 0;
    setConnected(false);
    setError(null);
    toast.dismiss(WS_TOAST_ID);
  }, []);

  useEffect(() => {
    if (enabled && isConfigured() && backendBaseUrl) {
      connect();
    }
    return () => disconnect();
  }, [enabled, backendBaseUrl, clusterId, isConfigured]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reconnect immediately when tab becomes visible again (user switches back).
  // Lens and Headlamp both do this — avoids stale "paused" state sitting there.
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !wsRef.current) {
        // Tab is visible and WS is disconnected — reconnect immediately
        reconnectRef.current();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled]);

  return {
    connected,
    lastMessage,
    error,
    reconnect, // Manual reconnect function
    disconnect,
  };
}
