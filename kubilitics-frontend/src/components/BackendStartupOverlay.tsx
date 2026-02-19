import { useEffect, useState } from 'react';
import { isTauri } from '@/lib/tauri';
import { Loader2 } from 'lucide-react';
import { resetBackendCircuit } from '@/services/backendApiClient';

/**
 * BackendStartupOverlay
 *
 * Shows a startup screen while the Go sidecar backend is initialising.
 * Listens for the `backend-status` Tauri event emitted by sidecar.rs:
 *   { status: 'starting' | 'ready' | 'error', message: string }
 *
 * P0-E: Overlay hides ONLY on backend-status: ready or error (no short timeout).
 * Backend wait_for_ready() runs up to 30s; overlay must stay visible at least that long.
 * On "ready", resetBackendCircuit() is called so any circuit opened during startup is cleared.
 */
export function BackendStartupOverlay() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('Starting backend engine…');

  useEffect(() => {
    if (!isTauri()) return;

    setVisible(true);

    let unlisten: (() => void) | undefined;
    // Safety: if event never fires (e.g. Tauri version mismatch), hide after 90s
    const safetyTimeout = setTimeout(() => setVisible(false), 90_000);

    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<{ status: string; message: string }>('backend-status', (event) => {
          const { status, message: msg } = event.payload;
          setMessage(msg);
          if (status === 'ready') {
            resetBackendCircuit();
            setTimeout(() => setVisible(false), 400);
          } else if (status === 'error') {
            setTimeout(() => setVisible(false), 400);
          }
        });
      } catch {
        setTimeout(() => setVisible(false), 5_000);
      }
    };

    setupListener();

    return () => {
      clearTimeout(safetyTimeout);
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
