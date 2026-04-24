import { useEffect, useRef } from 'react';
import type { PresenceSnapshot } from '@/types/resilient';
import { useClusterPresenceStore } from '@/stores/clusterPresenceStore';

const PRESENCE_URL = '/api/v1/presence';
const SSE_URL = '/api/v1/presence/events';

// useClusterPresence subscribes to the backend's presence layer:
//   1. On mount, fetch the current snapshot and apply it.
//   2. Open an EventSource to /api/v1/presence/events and apply deltas.
// Reconnect on error with exponential backoff (1s → 2s → 4s → cap 30s).
export function useClusterPresence(): void {
  const applySnapshot = useClusterPresenceStore((s) => s.applySnapshot);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    let backoff = 1000;

    async function fetchSnapshot() {
      try {
        const r = await fetch(PRESENCE_URL, { credentials: 'include' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const snap = (await r.json()) as PresenceSnapshot;
        if (!cancelled) applySnapshot(snap);
      } catch (err) {
        console.warn('presence snapshot fetch failed:', err);
      }
    }

    function openStream() {
      if (cancelled) return;
      const es = new EventSource(SSE_URL, { withCredentials: true } as EventSourceInit);
      esRef.current = es;
      es.onmessage = async () => {
        // Simplest correct impl: re-fetch snapshot on any event. Cheap
        // (cached in backend). Future optimization: patch store deltas
        // from the event payload directly.
        await fetchSnapshot();
      };
      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (cancelled) return;
        setTimeout(() => {
          backoff = Math.min(backoff * 2, 30_000);
          openStream();
        }, backoff);
      };
    }

    void fetchSnapshot().then(openStream);

    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, [applySnapshot]);
}
