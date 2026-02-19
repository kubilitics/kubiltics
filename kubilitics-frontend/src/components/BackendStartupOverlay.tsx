import { useEffect, useState } from 'react';
import { isTauri } from '@/lib/tauri';
import { Loader2 } from 'lucide-react';

/**
 * BackendStartupOverlay
 *
 * Shows a non-blocking startup screen while the Go sidecar backend is initialising.
 * Listens for the `backend-status` Tauri event emitted by sidecar.rs:
 *
 *   { status: 'starting' | 'ready' | 'error', message: string }
 *
 * Disappears once the backend emits 'ready' (or after a 10-second timeout so it
 * never permanently blocks the UI). If the backend fails, the overlay hides and
 * the app renders normally — BackendStatusBanner in AppLayout will show the error.
 *
 * This is the key UX fix that prevents the "frozen blank screen" users see on cold
 * start while the Go binary initialises (can take 2–5 seconds on first launch).
 */
export function BackendStartupOverlay() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('Starting backend engine…');

  useEffect(() => {
    // Only show in Tauri desktop mode — in browser/helm mode there's no sidecar
    if (!isTauri()) return;

    // Show the overlay immediately on mount (backend always starts on app open)
    setVisible(true);

    // Maximum time to show the overlay — never block the UI indefinitely
    const maxTimeout = setTimeout(() => setVisible(false), 12_000);

    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<{ status: string; message: string }>('backend-status', (event) => {
          const { status, message: msg } = event.payload;
          setMessage(msg);
          if (status === 'ready' || status === 'error') {
            // Small delay so "ready" flashes briefly before hiding
            setTimeout(() => setVisible(false), 400);
          }
        });
      } catch {
        // Tauri events API not available — hide overlay after short delay
        setTimeout(() => setVisible(false), 3_000);
      }
    };

    setupListener();

    return () => {
      clearTimeout(maxTimeout);
      unlisten?.();
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm"
      aria-live="polite"
      aria-label="Application starting"
    >
      <div className="flex flex-col items-center gap-6 max-w-sm text-center px-8">
        {/* App logo / brand mark */}
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
            <span className="text-blue-400 font-bold text-lg">K</span>
          </div>
          <span className="text-xl font-semibold text-foreground">Kubilitics</span>
        </div>

        {/* Spinner */}
        <Loader2 className="h-8 w-8 animate-spin text-blue-500/70" />

        {/* Dynamic status message from sidecar */}
        <p className="text-sm text-muted-foreground">{message}</p>

        {/* Reassurance — no local dependencies needed */}
        <p className="text-xs text-muted-foreground/60 leading-relaxed">
          Kubilitics works with any kubeconfig file. No kubectl, Docker, or local
          Kubernetes installation required.
        </p>
      </div>
    </div>
  );
}
