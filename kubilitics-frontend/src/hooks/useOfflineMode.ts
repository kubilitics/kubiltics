/**
 * Detects offline/degraded connectivity states.
 *
 * Inspired by Headlamp's AlertNotification pattern:
 *  - Monitors browser online/offline events
 *  - Polls backend /health with exponential backoff when offline
 *  - Provides state for the OfflineIndicator banner
 *
 * Unlike Headlamp's approach (polling cluster /healthz), we monitor:
 *  1. Browser navigator.onLine for network-level disconnection
 *  2. Backend health endpoint for backend reachability
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getEffectiveBackendBaseUrl, useBackendConfigStore } from '@/stores/backendConfigStore';
import { markBackendReady } from '@/services/backendApiClient';

export interface OfflineModeState {
  /** Browser is offline (no network) */
  isOffline: boolean;
  /** Backend API is reachable */
  backendReachable: boolean;
  /** Number of consecutive health check failures */
  failureCount: number;
  /** Manually trigger a health check */
  retryNow: () => void;
}

/**
 * Conservative failure threshold: require 6+ consecutive failures over at least
 * 90 seconds before reporting backend as unreachable.  The previous threshold
 * of 3 caused the amber banner to appear within ~15 seconds of any transient
 * hiccup (backend GC pause, slow proxy, laptop wake-from-sleep) which destroyed
 * trust in the application.  Headlamp/Lens never show connectivity banners for
 * brief interruptions — they only surface persistent issues.
 */
const FAILURE_THRESHOLD = 6;
const MIN_FAILURE_DURATION_MS = 90_000; // 90 seconds of sustained failure

/** How often to check health when backend is reachable.
 * 30s strikes a balance: fast enough to detect recovery quickly,
 * not so frequent as to spam the backend. Was 60s which meant the
 * banner stayed visible for up to a full minute after backend recovered. */
const HEALTHY_POLL_INTERVAL_MS = 30_000;

export function useOfflineMode(): OfflineModeState {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [backendReachable, setBackendReachable] = useState(true);
  const [failureCount, setFailureCount] = useState(0);

  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const backoffFactorRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstFailureTimeRef = useRef<number | null>(null);

  // Browser online/offline events
  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Backend health check with exponential backoff (Headlamp pattern)
  const checkHealth = useCallback(async () => {
    if (!isConfigured()) return;

    const baseUrl = getEffectiveBackendBaseUrl(storedUrl);
    // Use /health — the legacy endpoint that always returns 200 with {"status":"healthy"}.
    // IMPORTANT: The backend registers /healthz/live and /healthz/ready but NOT bare /healthz.
    // Previously this called /healthz which returned 404 on every poll, causing the
    // "Backend unreachable" banner to appear after 90 seconds — even when the backend
    // was perfectly healthy. This was the root cause of the persistent banner.
    const healthUrl = baseUrl ? `${baseUrl}/health` : '/health';

    try {
      const res = await fetch(healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(8000), // 8s timeout (was 5s — too aggressive for cold starts)
      });
      if (res.ok) {
        setBackendReachable(true);
        setFailureCount(0);
        backoffFactorRef.current = 0;
        firstFailureTimeRef.current = null;
        // Signal that backend has been healthy at least once (ends Tauri startup grace period)
        markBackendReady();
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      const now = Date.now();
      if (firstFailureTimeRef.current === null) {
        firstFailureTimeRef.current = now;
      }

      setFailureCount((c) => {
        const next = c + 1;
        const failureDuration = now - (firstFailureTimeRef.current || now);
        // Only mark unreachable after BOTH thresholds are met:
        // enough consecutive failures AND enough wall-clock time.
        if (next >= FAILURE_THRESHOLD && failureDuration >= MIN_FAILURE_DURATION_MS) {
          setBackendReachable(false);
        }
        return next;
      });
      backoffFactorRef.current += 1;

      // Schedule retry with exponential backoff: 10s, 20s, 30s, ...
      // Capped at 60s (was 30s — give the backend more breathing room)
      const delay = Math.min((backoffFactorRef.current + 1) * 10_000, 60_000);
      timerRef.current = setTimeout(checkHealth, delay);
    }
  }, [storedUrl, isConfigured]);

  // Retry immediately (resets backoff — like Headlamp's "Try Again" button)
  const retryNow = useCallback(() => {
    backoffFactorRef.current = 0;
    firstFailureTimeRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    checkHealth();
  }, [checkHealth]);

  // Run health check periodically when online
  useEffect(() => {
    if (isOffline || !isConfigured()) return;

    checkHealth();
    const interval = setInterval(checkHealth, HEALTHY_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isOffline, checkHealth, isConfigured]);

  return { isOffline, backendReachable, failureCount, retryNow };
}

export default useOfflineMode;
