import { useEffect, useState, useRef } from 'react';
import { isTauri, invokeWithRetry } from '@/lib/tauri';
import { Loader2 } from 'lucide-react';
import { resetBackendCircuit } from '@/services/backendApiClient';
import { BrandLogo } from '@/components/BrandLogo';

/**
 * BackendStartupOverlay
 *
 * Performance optimization: Non-blocking overlay that only shows if backend takes > 3 seconds.
 * Allows UI to render immediately while backend starts in background (Headlamp/Lens pattern).
 * 
 * Changes:
 * - UI renders immediately, overlay only appears after delay if backend not ready
 * - Reduces perceived startup time from 30-90s to < 3s
 */
/**
 * BrowserStartupBanner — lightweight banner for browser / in-cluster mode.
 * In Tauri the full BackendStartupOverlay handles startup; in the browser we
 * just need a brief non-blocking banner that nudges the user when the backend
 * hasn't been configured yet or is unreachable.
 */
export function BrowserStartupBanner() {
  // In Tauri the full BackendStartupOverlay handles startup — this is browser-only.
  // Never show in Tauri mode.
  if (isTauri()) return null;

  // This is a no-op placeholder. The BackendStatusBanner and CircuitBreakerBanner
  // already handle the "backend unreachable" case for browser mode, so we don't
  // need a duplicate banner here.
  return null;
}

export function BackendStartupOverlay() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('Starting backend engine…');
  const [allowPointerEvents, setAllowPointerEvents] = useState(false);
  const pollIntervalRef = useRef<number | null>(null);
  const isHiddenRef = useRef(false);
  const showDelayTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isTauri()) return;

    let safetyTimeout: number | null = null;
    let unlisten: (() => void) | undefined;

    // Check backend status immediately on mount
    const checkInitialStatus = async () => {
      try {
        const status = await invokeWithRetry<{ status: string; message: string }>('get_backend_status');
        if (status.status === 'ready') {
          // Backend is already ready - hide immediately, no overlay needed
          resetBackendCircuit();
          setVisible(false);
          isHiddenRef.current = true;
          return true; // Backend already ready
        }
        setMessage(status.message);
      } catch (error) {
        console.warn('Failed to check initial backend status:', error);
      }
      return false; // Backend not ready yet
    };

    // Poll backend status every 500ms (less frequent, backend starts in background)
    const pollStatus = async () => {
      try {
        const status = await invokeWithRetry<{ status: string; message: string }>('get_backend_status');
        setMessage(status.message);

        if (status.status === 'ready') {
          if (!isHiddenRef.current) {
            isHiddenRef.current = true;
            resetBackendCircuit();
            // Hide overlay immediately when backend becomes ready
            setVisible(false);
          }
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          if (showDelayTimeoutRef.current) {
            clearTimeout(showDelayTimeoutRef.current);
            showDelayTimeoutRef.current = null;
          }
        } else if (status.status === 'error') {
          // Show overlay on error so user knows what happened
          if (!isHiddenRef.current) {
            isHiddenRef.current = true;
            setVisible(true);
          }
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      } catch (error) {
        console.warn('Failed to check backend status:', error);
      }
    };

    // Setup event listener
    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<{ status: string; message: string }>('backend-status', (event) => {
          const { status, message: msg } = event.payload;
          setMessage(msg);
          if (status === 'ready' && !isHiddenRef.current) {
            isHiddenRef.current = true;
            resetBackendCircuit();
            setVisible(false);
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            if (showDelayTimeoutRef.current) {
              clearTimeout(showDelayTimeoutRef.current);
              showDelayTimeoutRef.current = null;
            }
          } else if (status === 'error' && !isHiddenRef.current) {
            // Show overlay on error
            isHiddenRef.current = true;
            setVisible(true);
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
          }
        });
      } catch (error) {
        console.warn('Failed to set up event listener:', error);
      }
    };

    // Initialize: check status and start polling/listening if needed
    checkInitialStatus().then((alreadyReady) => {
      if (alreadyReady) return; // Backend already ready, no overlay needed

      // Backend not ready - start polling in background, but DON'T show overlay immediately
      // Only show overlay if backend takes > 3 seconds (allows UI to render first)
      isHiddenRef.current = false;

      // Start polling in background (less frequent - 500ms instead of 200ms)
      pollStatus();
      pollIntervalRef.current = window.setInterval(pollStatus, 500);
      setupListener();

      // Show overlay only after 5 seconds if backend still not ready
      // This allows UI to render immediately while backend starts
      showDelayTimeoutRef.current = window.setTimeout(() => {
        if (!isHiddenRef.current) {
          setVisible(true);
        }
      }, 5_000); // 5 second delay before showing overlay

      // TASK-FE-004: Safety timeout — hide after 60s ONLY if still in "starting" state.
      // If backend is in "error" state keep the error overlay visible so the user
      // understands what happened instead of seeing a silently broken UI.
      safetyTimeout = window.setTimeout(async () => {
        try {
          const s = await invokeWithRetry<{ status: string }>('get_backend_status');
          if (s.status === 'error') {
            // Leave overlay visible with error message — don't silently hide
            console.warn('Backend startup timed out with error — keeping overlay');
            return;
          }
        } catch {
          // Can't reach Tauri; fall through and hide overlay to unblock UI
        }
        console.warn('Backend startup timeout — hiding overlay to unblock UI');
        setVisible(false);
        isHiddenRef.current = true;
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        if (showDelayTimeoutRef.current) {
          clearTimeout(showDelayTimeoutRef.current);
          showDelayTimeoutRef.current = null;
        }
      }, 60_000); // Extended to 60s — Go binary cold-start on slow machines can take 30s+
    });

    // Cleanup function for when component unmounts
    return () => {
      if (safetyTimeout !== null) {
        clearTimeout(safetyTimeout);
      }
      if (showDelayTimeoutRef.current) {
        clearTimeout(showDelayTimeoutRef.current);
        showDelayTimeoutRef.current = null;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      unlisten?.();
    };
  }, []);

  // Non-blocking overlay - allow pointer events to pass through after 10 seconds
  // This ensures UI is always accessible even if overlay is visible
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        setAllowPointerEvents(true); // Allow clicking through after 10s
      }, 10_000);
      return () => clearTimeout(timer);
    } else {
      setAllowPointerEvents(false);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm ${allowPointerEvents ? 'pointer-events-none' : ''}`}
      aria-live="polite"
      aria-label="Application starting"
    >
      <div className="flex flex-col items-center gap-6 max-w-sm text-center px-8">
        {/* App logo / brand mark */}
        <div className="flex flex-col items-center gap-3 mb-2">
          <BrandLogo height={40} className="drop-shadow-xl" />
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
