import { useEffect } from 'react';
import { useInvalidateAI } from './useInvalidateAI';

/**
 * useBrainStatusListener — subscribes to the Tauri `brain-status` event
 * (emitted by kubilitics-desktop/src-tauri/src/sidecar.rs) and refetches
 * every AI query when the event fires. Closes the bootstrap race where the
 * brain becomes ready *after* the UI has mounted; without this, ChatPanel
 * would only learn about the new state on the next polled refetch (up to
 * 5–30s later).
 *
 * MUST be mounted exactly once at the app root (App.tsx). Mounting it
 * elsewhere registers duplicate listeners.
 *
 * In non-Tauri contexts (browser, CI, in-cluster web behind nginx) this
 * hook is a no-op — there is no Tauri event channel to subscribe to and
 * the polled refetch is the only refresh signal.
 *
 * Spec: docs/superpowers/specs/2026-04-26-ai-status-single-source-design.md
 */
export function useBrainStatusListener(): void {
  const invalidateAI = useInvalidateAI();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
    if (!w.__TAURI_INTERNALS__ && !w.__TAURI__) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const off = await listen('brain-status', () => {
          // Fire-and-forget — the AI queries refetch in the background.
          // Errors swallowed; the polled cadence is the safety net.
          void invalidateAI();
        });
        if (cancelled) {
          off();
        } else {
          unlisten = off;
        }
      } catch {
        // Module not present (browser dev), ignore.
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [invalidateAI]);
}
