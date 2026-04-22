/**
 * UpdateBanner — thin banner that prompts the user to install an
 * auto-update when tauri-plugin-updater reports one is available.
 *
 * Replaces the old GitHub-Releases-polling UpdateChecker with the
 * signed-update flow wired via tauri.conf.json `updater` block.
 *
 * Flow:
 *   1. On mount, `check()` hits the configured endpoint (latest.json).
 *   2. If an update is available, show a non-blocking banner with
 *      "Install now" + "Later".
 *   3. "Install now" → `download_and_install()` → `relaunch()`.
 *
 * Graceful-degrades: on any error (offline, signature mismatch, endpoint
 * misconfigured), we log and stay silent — users are not spammed with
 * failed-update toasts.
 */
import { useEffect, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { Download, X, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await check();
        if (!cancelled && result) {
          setUpdate(result);
        }
      } catch (err) {
        console.warn('[UpdateBanner] check failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update || dismissed) return null;

  const handleInstall = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      await update.downloadAndInstall();
      toast.success('Update installed — restarting…');
      await relaunch();
    } catch (err) {
      console.error('[UpdateBanner] install failed:', err);
      toast.error(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
      setInstalling(false);
    }
  };

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 px-4 py-2 bg-blue-500/10 border-b border-blue-500/30 text-blue-900 dark:text-blue-100 text-sm"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Download className="h-4 w-4 shrink-0" />
        <span className="truncate">
          Update available: <strong>v{update.version}</strong>
          {update.currentVersion && (
            <span className="opacity-70"> (you're on v{update.currentVersion})</span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" variant="default" onClick={handleInstall} disabled={installing}>
          {installing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Installing…
            </>
          ) : (
            'Install now'
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss update notification"
          disabled={installing}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
