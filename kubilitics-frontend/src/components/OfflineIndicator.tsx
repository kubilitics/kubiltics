/**
 * Persistent connection status banner — inspired by Headlamp's AlertNotification.
 *
 * Headlamp uses a fixed top-center MUI Alert banner that stays visible until
 * connectivity restores. We follow the same pattern but with our design system:
 *
 *  - Shows when browser is offline OR backend is unreachable
 *  - Non-dismissable — disappears automatically when connection restores
 *  - "Reconnect" button resets backoff and retries immediately
 *  - Subtle but persistent — users always know when data may be stale
 *
 * This replaces the old toast-based approach where the "Live updates paused"
 * toast would disappear after 8 seconds, leaving users unaware.
 */
import { WifiOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { useOfflineMode } from '@/hooks/useOfflineMode';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';

export function OfflineIndicator() {
  const { isOffline, backendReachable, retryNow } = useOfflineMode();
  const { isConnected } = useConnectionStatus();

  // Don't show if not connected to a cluster at all (different banner handles that)
  if (!isConnected) return null;

  // Browser completely offline
  if (isOffline) {
    return (
      <div
        className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-red-50/80 dark:bg-red-950/20 border border-red-200/60 dark:border-red-800/40 text-red-900 dark:text-red-200 text-sm backdrop-blur-sm shadow-sm"
        role="alert"
        aria-live="assertive"
      >
        <div className="flex items-center justify-center h-8 w-8 rounded-xl bg-red-100 dark:bg-red-900/40 shrink-0">
          <WifiOff className="h-4 w-4 text-red-600 dark:text-red-400" />
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-semibold text-[13px] tracking-tight">You're offline</span>
          <span className="text-red-700/60 dark:text-red-300/50 text-[13px]">
            — Check your network connection. Showing cached data.
          </span>
        </div>
      </div>
    );
  }

  // Backend unreachable (but browser is online)
  if (!backendReachable) {
    return (
      <div
        className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 text-amber-900 dark:text-amber-200 text-sm backdrop-blur-sm shadow-sm"
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
        <button
          onClick={retryNow}
          className="ml-auto inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-800/60 border border-amber-200/60 dark:border-amber-700/40 text-amber-800 dark:text-amber-200 text-xs font-bold tracking-tight transition-all duration-200 press-effect shrink-0"
        >
          <RefreshCw className="h-3 w-3" />
          Reconnect
        </button>
      </div>
    );
  }

  return null;
}

export default OfflineIndicator;
