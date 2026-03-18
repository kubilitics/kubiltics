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
  const { isOffline, aiBackendReachable, retryNow } = useOfflineMode();
  const { isConnected } = useConnectionStatus();

  // Don't show if not connected to a cluster at all (different banner handles that)
  if (!isConnected) return null;

  // Browser completely offline
  if (isOffline) {
    return (
      <div
        className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-800 dark:text-red-200 text-sm"
        role="alert"
        aria-live="assertive"
      >
        <WifiOff className="h-4 w-4 flex-shrink-0" />
        <span className="font-medium">You're offline</span>
        <span className="text-red-600/70 dark:text-red-300/70">
          — Check your network connection. Showing cached data.
        </span>
      </div>
    );
  }

  // Backend unreachable (but browser is online)
  if (!aiBackendReachable) {
    return (
      <div
        className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-200 text-sm"
        role="alert"
        aria-live="polite"
      >
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span className="font-medium">Backend unreachable</span>
        <span className="text-amber-600/70 dark:text-amber-300/70">
          — Live updates paused. Showing cached data.
        </span>
        <button
          onClick={retryNow}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-800 dark:text-amber-200 text-xs font-medium transition-colors"
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
