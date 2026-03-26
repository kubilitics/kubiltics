/**
 * Persistent connection status banner — inspired by Headlamp's AlertNotification.
 *
 * Headlamp uses a fixed top-center MUI Alert banner that stays visible until
 * connectivity restores. We follow the same pattern but with our design system:
 *
 *  - Shows ONLY when browser is truly offline (navigator.onLine === false)
 *  - Backend-unreachable is handled by BackendStatusBanner (deduplicated)
 *  - Non-dismissable — disappears automatically when connection restores
 *
 * Previous issue: TWO banners were competing (OfflineIndicator + BackendStatusBanner)
 * both showing "Backend unreachable" with different thresholds.  This created
 * a confusing, unreliable UX.  Now OfflineIndicator ONLY handles browser-offline;
 * BackendStatusBanner handles backend health.
 */
import { WifiOff } from 'lucide-react';
import { useOfflineMode } from '@/hooks/useOfflineMode';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';

export function OfflineIndicator() {
  const { isOffline } = useOfflineMode();
  const { isConnected } = useConnectionStatus();

  // Don't show if not connected to a cluster at all (different banner handles that)
  if (!isConnected) return null;

  // Only show when browser is completely offline (no network)
  if (!isOffline) return null;

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
        <span className="font-semibold text-sm tracking-tight">You're offline</span>
        <span className="text-red-700/60 dark:text-red-300/50 text-sm">
          — Check your network connection. Showing cached data.
        </span>
      </div>
    </div>
  );
}

export default OfflineIndicator;
