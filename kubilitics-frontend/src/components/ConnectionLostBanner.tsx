/**
 * Graceful disconnection banner — shown when the cluster connection is lost.
 *
 * Instead of greying out the entire UI (previous behavior), this shows a thin
 * amber banner at the top of the content area. The app remains fully interactive
 * with cached data. Includes a "Reconnect" button and auto-dismisses when
 * connection is restored.
 *
 * This handles the "cluster disconnected" case (useConnectionStatus).
 * Browser-offline is handled by OfflineIndicator.
 * Backend-unreachable is handled by BackendStatusBanner.
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useOfflineMode } from '@/hooks/useOfflineMode';
import { cn } from '@/lib/utils';

export function ConnectionLostBanner() {
  const { isConnected } = useConnectionStatus();
  const { isOffline } = useOfflineMode();
  const queryClient = useQueryClient();
  const [wasConnected, setWasConnected] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [lastConnectedAt, setLastConnectedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState('');

  // Track if we were ever connected (so we don't show this on first load before connecting)
  useEffect(() => {
    if (isConnected) {
      setWasConnected(true);
      setLastConnectedAt(Date.now());
    }
  }, [isConnected]);

  // Update elapsed time display
  useEffect(() => {
    if (isConnected || !lastConnectedAt) return;
    const tick = () => {
      const ms = Date.now() - lastConnectedAt;
      const seconds = Math.floor(ms / 1000);
      if (seconds < 60) setElapsed(`${seconds}s ago`);
      else {
        const minutes = Math.floor(seconds / 60);
        setElapsed(minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isConnected, lastConnectedAt]);

  // Don't show if:
  // - Never been connected (fresh load, user needs to connect first)
  // - Currently connected
  // - Browser is completely offline (OfflineIndicator handles that)
  if (!wasConnected || isConnected || isOffline) return null;

  const handleReconnect = () => {
    setRetrying(true);
    // Invalidate all queries to trigger refetch when connection restores
    queryClient.invalidateQueries();
    setTimeout(() => setRetrying(false), 3000);
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 text-amber-900 dark:text-amber-200 text-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-amber-100 dark:bg-amber-900/40 shrink-0">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
      </div>
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <span className="font-semibold text-[13px] tracking-tight">Cluster connection lost.</span>
        <span className="text-amber-700/70 dark:text-amber-300/60 text-[13px]">
          Showing cached data.
        </span>
        {lastConnectedAt && elapsed && (
          <span className="text-amber-600/50 dark:text-amber-400/40 text-xs ml-1">
            Last connected {elapsed}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleReconnect}
          disabled={retrying}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-800/60 border border-amber-200/60 dark:border-amber-700/40 text-amber-800 dark:text-amber-200 text-xs font-semibold tracking-tight transition-all duration-200 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3 w-3', retrying && 'animate-spin')} />
          Reconnect
        </button>
        <Link
          to="/clusters"
          className="text-xs text-amber-700/70 dark:text-amber-300/60 hover:text-amber-800 dark:hover:text-amber-200 underline underline-offset-2"
        >
          Switch cluster
        </Link>
      </div>
    </div>
  );
}

export default ConnectionLostBanner;
