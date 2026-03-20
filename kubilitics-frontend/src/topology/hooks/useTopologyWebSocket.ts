import { useEffect, useRef, useCallback, useState } from "react";
import { getEffectiveBackendBaseUrl } from "@/stores/backendConfigStore";
import type { TopologyNode, TopologyEdge } from "../types/topology";

export interface TopologyEvent {
  type: "node_added" | "node_updated" | "node_removed" | "edge_added" | "edge_removed";
  payload: TopologyNode | TopologyEdge;
  timestamp: string;
}

export interface UseTopologyWebSocketOptions {
  clusterId: string | null;
  enabled?: boolean;
  onNodeAdded?: (node: TopologyNode) => void;
  onNodeUpdated?: (node: TopologyNode) => void;
  onNodeRemoved?: (id: string) => void;
  onEdgeAdded?: (edge: TopologyEdge) => void;
  onEdgeRemoved?: (id: string) => void;
}

const MAX_RECONNECT_DELAY = 30000;
const INITIAL_RECONNECT_DELAY = 1000;
const BATCH_INTERVAL = 100;

/**
 * useTopologyWebSocket: Real-time topology updates with auto-reconnect.
 * - Connects to WS /api/v1/ws/topology/{clusterId}/v2
 * - Batches events in 100ms windows to prevent render flooding
 * - Reconnects with exponential backoff (1s, 2s, 4s, 8s... max 30s)
 */
export function useTopologyWebSocket({
  clusterId,
  enabled = true,
  onNodeAdded,
  onNodeUpdated,
  onNodeRemoved,
  onEdgeAdded,
  onEdgeRemoved,
}: UseTopologyWebSocketOptions) {
  const [connected, setConnected] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const retriesRef = useRef(0);
  const MAX_RETRIES = 3;
  const eventBufferRef = useRef<TopologyEvent[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processEventBatch = useCallback(() => {
    const events = eventBufferRef.current;
    eventBufferRef.current = [];
    if (events.length === 0) return;

    for (const event of events) {
      switch (event.type) {
        case "node_added":
          onNodeAdded?.(event.payload as TopologyNode);
          break;
        case "node_updated":
          onNodeUpdated?.(event.payload as TopologyNode);
          break;
        case "node_removed":
          onNodeRemoved?.((event.payload as TopologyNode).id);
          break;
        case "edge_added":
          onEdgeAdded?.(event.payload as TopologyEdge);
          break;
        case "edge_removed":
          onEdgeRemoved?.((event.payload as TopologyEdge).id);
          break;
      }
    }

    setLastUpdateTime(events[events.length - 1].timestamp);
  }, [onNodeAdded, onNodeUpdated, onNodeRemoved, onEdgeAdded, onEdgeRemoved]);

  const connect = useCallback(() => {
    if (!clusterId || !enabled) return;

    const baseUrl = getEffectiveBackendBaseUrl();
    if (!baseUrl) return;

    const wsUrl = baseUrl
      .replace(/^http/, "ws")
      .replace(/\/$/, "");
    const url = `${wsUrl}/api/v1/ws/topology/${clusterId}/v2`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
        retriesRef.current = 0; // Reset on successful connection
      };

      ws.onmessage = (msg) => {
        try {
          const event: TopologyEvent = JSON.parse(msg.data);
          eventBufferRef.current.push(event);

          // Batch events in 100ms windows
          if (!batchTimerRef.current) {
            batchTimerRef.current = setTimeout(() => {
              batchTimerRef.current = null;
              processEventBatch();
            }, BATCH_INTERVAL);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;

        retriesRef.current += 1;
        // Stop reconnecting after MAX_RETRIES - endpoint may not be available
        if (enabled && clusterId && retriesRef.current <= MAX_RETRIES) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectDelayRef.current = Math.min(
              reconnectDelayRef.current * 2,
              MAX_RECONNECT_DELAY
            );
            connect();
          }, reconnectDelayRef.current);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket creation failed
    }
  }, [clusterId, enabled, processEventBatch]);

  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
      }
    };
  }, [connect]);

  const sendMessage = useCallback(
    (type: string, payload?: Record<string, unknown>) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type, payload }));
      }
    },
    []
  );

  const changeViewMode = useCallback(
    (mode: string) => sendMessage("change_view", { mode }),
    [sendMessage]
  );

  return { connected, lastUpdateTime, sendMessage, changeViewMode };
}
