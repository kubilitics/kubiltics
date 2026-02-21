/**
 * Banner shown ONLY for persistent, actionable backend connection issues.
 * Headlamp/Lens style: Never show banner for transient failures or startup issues.
 * 
 * Rules:
 * - NEVER show during backend startup (Tauri)
 * - NEVER show when circuit is open (already handled)
 * - NEVER show for transient network errors
 * - ONLY show after 10+ consecutive failures over 2+ minutes
 * - Hide immediately when health succeeds
 * - Dismissible with localStorage persistence
 */
import { useEffect, useState, useRef } from 'react';
import { AlertCircle, RefreshCw, Settings, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBackendHealth } from '@/hooks/useBackendHealth';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { BackendApiError, isBackendCircuitOpen, resetBackendCircuit } from '@/services/backendApiClient';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { isTauri, invokeWithRetry } from '@/lib/tauri';

const CONSECUTIVE_FAILURES_THRESHOLD = 10; // Show banner only after 10+ consecutive failures (very conservative)
const MIN_FAILURE_DURATION_MS = 120_000; // Must fail for at least 2 minutes before showing banner

export function BackendStatusBanner({ className }: { className?: string }) {
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const [dismissed, setDismissed] = useState(() => {
    // Check localStorage for dismissal state
    if (typeof window !== 'undefined') {
      return localStorage.getItem('backend-status-banner-dismissed') === 'true';
    }
    return false;
  });
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [showBanner, setShowBanner] = useState(false);
  const firstFailureTimeRef = useRef<number | null>(null);
  const [backendStarting, setBackendStarting] = useState(false);

  const circuitOpen = isBackendCircuitOpen();
  
  // Check if backend is starting up (Tauri only) - never show banner during startup
  useEffect(() => {
    if (!isTauri()) return;
    let mounted = true;
    const checkBackendStatus = async () => {
      try {
        const status = await invokeWithRetry<{ status: string }>('get_backend_status');
        if (mounted) {
          setBackendStarting(status.status === 'starting');
        }
      } catch {
        // Ignore errors - assume not starting if we can't check
        if (mounted) setBackendStarting(false);
      }
    };
    // Check once immediately, then slow-poll at 10s.
    // The banner only matters during the brief startup window — once the backend
    // is ready the status won't change so 10s is more than enough.
    checkBackendStatus();
    const interval = setInterval(checkBackendStatus, 10_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const health = useBackendHealth({
    enabled: isConfigured() && !circuitOpen && !backendStarting, // Don't check health during startup
    refetchInterval: 60_000, // Check every 60s (less frequent, less disruptive)
    retry: 3, // Use retry with exponential backoff
  });

  // Track consecutive failures and show banner only after threshold AND duration
  useEffect(() => {
    if (!isConfigured()) return;
    if (dismissed) return;
    if (circuitOpen) return; // Don't count failures when circuit is open
    if (backendStarting) return; // Never show banner during backend startup

    if (health.error) {
      const now = Date.now();
      if (firstFailureTimeRef.current === null) {
        firstFailureTimeRef.current = now;
      }
      
      setConsecutiveFailures((prev) => {
        const newCount = prev + 1;
        const failureDuration = now - (firstFailureTimeRef.current || now);
        
        // Show banner only after threshold failures AND minimum duration
        if (newCount >= CONSECUTIVE_FAILURES_THRESHOLD && failureDuration >= MIN_FAILURE_DURATION_MS) {
          setShowBanner(true);
        }
        return newCount;
      });
    } else if (health.isSuccess && health.data) {
      // Health succeeded — reset everything and clear the dismissed flag so the
      // banner can reappear if the backend goes down again later (ROOT CAUSE K).
      setConsecutiveFailures(0);
      firstFailureTimeRef.current = null;
      setShowBanner(false);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('backend-status-banner-dismissed');
      }
      setDismissed(false);
    }
  }, [health.error, health.isSuccess, health.data, isConfigured, dismissed, circuitOpen, backendStarting, showBanner]);

  // Never show banner if backend is starting, circuit is open, or queries are disabled
  if (!isConfigured()) return null;
  if (dismissed) return null;
  if (circuitOpen) return null;
  if (backendStarting) return null;
  if (!showBanner) return null;

  const handleDismiss = () => {
    setDismissed(true);
    setShowBanner(false);
    if (typeof window !== 'undefined') {
      localStorage.setItem('backend-status-banner-dismissed', 'true');
    }
  };

  const handleRetry = () => {
    setDismissed(false);
    setConsecutiveFailures(0);
    firstFailureTimeRef.current = null;
    setShowBanner(false);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('backend-status-banner-dismissed');
    }
    resetBackendCircuit();
    health.refetch();
  };

  const requestId = health.error instanceof BackendApiError ? health.error.requestId : undefined;
  const desktop = isTauri();
  const headline = desktop ? 'Connection issue' : 'Backend unreachable';
  const detail = desktop ? 'Data below may be cached. Use Retry when the connection is back.' : (health.error instanceof Error ? health.error.message : 'Load failed') + ' (data below may be cached and outdated).';

  return (
    <div
      className={cn(
        'flex flex-col gap-1 px-4 py-3 rounded-lg border border-destructive/50 bg-destructive/10 text-destructive',
        className
      )}
      role="alert"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium truncate">
            {headline}: {detail}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRetry}
            disabled={health.isFetching}
            className="gap-1"
          >
            <RefreshCw className={cn('h-4 w-4', health.isFetching && 'animate-spin')} />
            Retry
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDismiss}
            className="h-8 w-8 p-0"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
          {!desktop && (
            <Button size="sm" variant="outline" asChild className="gap-1">
              <Link to="/settings">
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </Button>
          )}
        </div>
      </div>
      {requestId && (
        <p className="text-xs text-muted-foreground pl-7">
          Request ID: <code className="bg-muted px-1 rounded">{requestId}</code> (for support)
        </p>
      )}
    </div>
  );
}
