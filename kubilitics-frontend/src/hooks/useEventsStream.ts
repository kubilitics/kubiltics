/**
 * SSE hook for real-time event streaming from the Events Intelligence subsystem.
 * Connects to GET /events-intelligence/stream and yields WideEvent objects.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useActiveClusterId } from './useActiveClusterId';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { eventSourceUrl } from '@/lib/backendUrl';
import { API_PREFIX } from '@/services/api/client';
import type { WideEvent } from '@/services/api/eventsIntelligence';

const MAX_BUFFERED = 200;
const RECONNECT_DELAY = 3_000;

export function useEventsStream(namespace?: string): {
  events: WideEvent[];
  isConnected: boolean;
  clearEvents: () => void;
} {
  const [events, setEvents] = useState<WideEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const clusterId = useActiveClusterId();
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  const clearEvents = useCallback(() => setEvents([]), []);

  useEffect(() => {
    if (!clusterId || !isBackendConfigured) return;

    function connect() {
      let path = `${API_PREFIX}/clusters/${encodeURIComponent(clusterId!)}/events-intelligence/stream`;
      if (namespace) {
        path += `?namespace=${encodeURIComponent(namespace)}`;
      }
      const es = new EventSource(eventSourceUrl(path));
      esRef.current = es;

      es.onopen = () => setIsConnected(true);

      es.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as WideEvent;
          setEvents((prev) => {
            const next = [event, ...prev];
            return next.length > MAX_BUFFERED ? next.slice(0, MAX_BUFFERED) : next;
          });
        } catch {
          // skip malformed messages
        }
      };

      let retryCount = 0;
      es.onerror = () => {
        setIsConnected(false);
        es.close();
        esRef.current = null;
        retryCount++;
        // Max 3 retries with increasing delay — avoid infinite reconnect loop
        if (retryCount <= 3) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY * retryCount);
        }
      };
    }

    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      setIsConnected(false);
    };
  }, [clusterId, isBackendConfigured, namespace]);

  return { events, isConnected, clearEvents };
}
