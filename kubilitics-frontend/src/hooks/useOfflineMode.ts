/**
 * Detects offline/degraded connectivity states.
 *
 * Inspired by Headlamp's AlertNotification pattern:
 *  - Monitors browser online/offline events
 *  - Polls backend /healthz with exponential backoff when offline
 *  - Provides state for the OfflineIndicator banner
 *
 * Unlike Headlamp's approach (polling cluster /healthz), we monitor:
 *  1. Browser navigator.onLine for network-level disconnection
 *  2. Backend health endpoint for backend reachability
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getEffectiveBackendBaseUrl, useBackendConfigStore } from '@/stores/backendConfigStore';

export interface OfflineModeState {
  /** Browser is offline (no network) */
  isOffline: boolean;
  /** Backend API is reachable */
  aiBackendReachable: boolean;
  /** Number of consecutive health check failures */
  failureCount: number;
  /** Manually trigger a health check */
  retryNow: () => void;
}

export function useOfflineMode(): OfflineModeState {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [aiBackendReachable, setAiBackendReachable] = useState(true);
  const [failureCount, setFailureCount] = useState(0);

  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const backoffFactorRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (!baseUrl) return;

    try {
      const res = await fetch(`${baseUrl}/healthz`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        setAiBackendReachable(true);
        setFailureCount(0);
        backoffFactorRef.current = 0;
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      setAiBackendReachable(false);
      setFailureCount((c) => c + 1);
      backoffFactorRef.current += 1;

      // Schedule retry with exponential backoff: 5s, 10s, 15s, 20s, ...
      // Capped at 30s (Headlamp caps at similar intervals)
      const delay = Math.min((backoffFactorRef.current + 1) * 5000, 30_000);
      timerRef.current = setTimeout(checkHealth, delay);
    }
  }, [storedUrl, isConfigured]);

  // Retry immediately (resets backoff — like Headlamp's "Try Again" button)
  const retryNow = useCallback(() => {
    backoffFactorRef.current = 0;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    checkHealth();
  }, [checkHealth]);

  // Run health check periodically when online (every 30s when healthy)
  useEffect(() => {
    if (isOffline || !isConfigured()) return;

    checkHealth();
    const interval = setInterval(checkHealth, 30_000);

    return () => {
      clearInterval(interval);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isOffline, checkHealth, isConfigured]);

  return { isOffline, aiBackendReachable, failureCount, retryNow };
}

export default useOfflineMode;
