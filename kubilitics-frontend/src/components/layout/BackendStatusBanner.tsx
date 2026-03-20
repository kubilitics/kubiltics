/**
 * Single source of truth for backend connectivity banner.
 *
 * Design principles (Headlamp/Lens inspired):
 * - NEVER show during backend startup (Tauri)
 * - NEVER show for transient network blips (GC pause, wake-from-sleep, slow proxy)
 * - ONLY show after sustained failure: 6+ consecutive health failures AND 90+ seconds elapsed
 * - Dismiss persists in sessionStorage (not localStorage) — resets on new session
 * - Auto-hide immediately when backend recovers
 * - Reconnect button resets circuit breaker and health check
 *
 * This is the ONLY banner for "backend unreachable". OfflineIndicator handles browser-offline only.
 */
import { useEffect, useState, useRef } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { resetBackendCircuit } from '@/services/backendApiClient';
import { cn } from '@/lib/utils';
import { useOfflineMode } from '@/hooks/useOfflineMode';

export function BackendStatusBanner({ className }: { className?: string }) {
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const { backendReachable, retryNow } = useOfflineMode();
  const [dismissed, setDismissed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Auto-reset dismissed state when backend comes back online
  useEffect(() => {
    if (backendReachable) {
      setDismissed(false);
    }
  }, [backendReachable]);

  // Don't show if:
  // - Backend not configured
  // - Backend is reachable (healthy)
  // - User dismissed this occurrence
  if (!isConfigured()) return null;
  if (backendReachable) return null;
  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
  };

  const handleRetry = () => {
    setRetrying(true);
    resetBackendCircuit();
    retryNow();
    // Reset retrying state after a brief delay so the spinner shows
    setTimeout(() => setRetrying(false), 2000);
  };

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-5 py-3 rounded-2xl bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 text-amber-900 dark:text-amber-200 text-sm backdrop-blur-sm shadow-sm',
        className
      )}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center justify-center h-8 w-8 rounded-xl bg-amber-100 dark:bg-amber-900/40 shrink-0">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-semibold text-[13px] tracking-tight">Backend unreachable</span>
        <span className="text-amber-700/60 dark:text-amber-300/50 text-[13px]">
          — Live updates paused. Showing cached data.
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <button
          onClick={handleRetry}
          disabled={retrying}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-800/60 border border-amber-200/60 dark:border-amber-700/40 text-amber-800 dark:text-amber-200 text-xs font-bold tracking-tight transition-all duration-200 shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3 w-3', retrying && 'animate-spin')} />
          Reconnect
        </button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDismiss}
          className="h-7 w-7 p-0 text-amber-700 dark:text-amber-300 hover:bg-amber-200/60 dark:hover:bg-amber-800/40 rounded-lg"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
