/**
 * UpdateChecker — Slack/Docker-style auto-update experience.
 *
 * Shows a persistent bottom-right banner when updates are available.
 * States: checking → available (with release notes) → downloading (progress bar) → ready → restarting
 *
 * Features:
 * - Checks 5s after mount, then every 4 hours
 * - Download retry with exponential backoff (3 attempts)
 * - Dismiss skips checks for the remainder of the session
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { isTauri } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, RefreshCw, X, Sparkles, Check, Loader2 } from 'lucide-react';

const CHECK_DELAY_MS = 5_000;
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000; // 4 hours
const MAX_DOWNLOAD_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2_000;

type UpdateState =
  | 'idle'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'restarting'
  | 'error'
  | 'dismissed';

interface UpdateInfo {
  version: string;
  notes: string;
  update: unknown;
}

export function UpdateChecker() {
  const dismissed = useRef(false);
  const [state, setState] = useState<UpdateState>('idle');
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [downloadedMB, setDownloadedMB] = useState('0');
  const [totalMB, setTotalMB] = useState('0');
  const [error, setError] = useState('');

  const checkForUpdate = useCallback(async () => {
    if (!isTauri() || dismissed.current) return;

    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (!update) return;

      const notes = (update as { body?: string }).body || `Bug fixes and improvements`;
      setInfo({ version: update.version, notes, update });
      setState('available');
    } catch (err) {
      console.warn('[UpdateChecker] Failed to check:', err);
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    // Initial check after delay
    const initialTimer = setTimeout(checkForUpdate, CHECK_DELAY_MS);

    // Periodic re-check every 4 hours
    const interval = setInterval(checkForUpdate, RECHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  const handleRestart = useCallback(async () => {
    setState('restarting');
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch {
      try {
        const { exit } = await import('@tauri-apps/plugin-process');
        await exit(0);
      } catch {
        setError('Please quit (Cmd+Q) and reopen the app to apply the update.');
        setState('error');
      }
    }
  }, []);

  const handleUpdate = useCallback(async () => {
    if (!info?.update) return;
    const update = info.update as Awaited<ReturnType<typeof import('@tauri-apps/plugin-updater')['check']>> & object;

    setState('downloading');
    setProgress(0);

    for (let attempt = 1; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
      try {
        let downloaded = 0;
        let total = 0;

        await update.downloadAndInstall((event) => {
          if (event.event === 'Started' && event.data.contentLength) {
            total = event.data.contentLength;
            setTotalMB((total / 1_048_576).toFixed(1));
          } else if (event.event === 'Progress') {
            downloaded += event.data.chunkLength;
            if (total > 0) {
              setProgress(Math.min(Math.round((downloaded / total) * 100), 100));
              setDownloadedMB((downloaded / 1_048_576).toFixed(1));
            }
          } else if (event.event === 'Finished') {
            setProgress(100);
          }
        });

        setState('ready');
        // Auto-restart after download — seamless like Slack/Docker
        setTimeout(() => handleRestart(), 1500);
        return; // Success — exit retry loop
      } catch (err) {
        if (attempt < MAX_DOWNLOAD_RETRIES) {
          // Exponential backoff: 2s, 4s, 8s
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(`[UpdateChecker] Download attempt ${attempt} failed, retrying in ${delay}ms...`, err);
          await new Promise((resolve) => setTimeout(resolve, delay));
          setProgress(0);
        } else {
          setError(err instanceof Error ? err.message : 'Download failed after multiple attempts');
          setState('error');
        }
      }
    }
  }, [info, handleRestart]);

  const handleDismiss = useCallback(() => {
    dismissed.current = true;
    setState('dismissed');
  }, []);

  if (state === 'idle' || state === 'dismissed' || !info) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={cn(
          'fixed bottom-5 right-5 z-[9999] w-[360px]',
          'rounded-xl shadow-2xl',
          'border border-slate-200 dark:border-slate-700',
          'bg-white dark:bg-slate-900',
          'overflow-hidden',
        )}
      >
        {/* Header */}
        <div className={cn(
          'flex items-center justify-between px-4 py-3',
          'border-b border-slate-100 dark:border-slate-800',
          state === 'ready' ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-slate-50 dark:bg-slate-800/50',
        )}>
          <div className="flex items-center gap-2">
            {state === 'available' && <Sparkles className="h-4 w-4 text-blue-500" />}
            {state === 'downloading' && <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />}
            {state === 'ready' && <Check className="h-4 w-4 text-emerald-500" />}
            {state === 'restarting' && <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />}
            {state === 'error' && <X className="h-4 w-4 text-red-500" />}
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {state === 'available' && `Update Available — v${info.version}`}
              {state === 'downloading' && `Downloading v${info.version}...`}
              {state === 'ready' && `Ready to Update`}
              {state === 'restarting' && `Restarting...`}
              {state === 'error' && `Update Failed`}
            </span>
          </div>
          {(state === 'available' || state === 'error') && (
            <button
              onClick={handleDismiss}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-4 py-3">
          {/* Release notes */}
          {state === 'available' && (
            <div className="space-y-3">
              <div className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">
                What's new
              </div>
              <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed max-h-[120px] overflow-y-auto">
                {info.notes.split('\n').filter(Boolean).map((line, i) => (
                  <p key={i} className={line.startsWith('-') || line.startsWith('*') ? 'pl-2' : ''}>
                    {line}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Download progress */}
          {state === 'downloading' && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>{downloadedMB} / {totalMB} MB</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-blue-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                />
              </div>
            </div>
          )}

          {/* Ready to restart */}
          {state === 'ready' && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              v{info.version} has been downloaded and is ready to install. Restart to apply the update.
            </p>
          )}

          {/* Restarting */}
          {state === 'restarting' && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Restarting Kubilitics...
            </p>
          )}

          {/* Error */}
          {state === 'error' && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        {/* Actions */}
        {(state === 'available' || state === 'ready' || state === 'error') && (
          <div className={cn(
            'flex items-center gap-2 px-4 py-3',
            'border-t border-slate-100 dark:border-slate-800',
          )}>
            {state === 'available' && (
              <div className="flex items-center gap-2 w-full">
                <button
                  onClick={handleUpdate}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-semibold',
                    'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800',
                    'transition-colors shadow-sm',
                  )}
                >
                  <Download className="h-3.5 w-3.5" />
                  Update Now
                </button>
                <button
                  onClick={handleDismiss}
                  className={cn(
                    'h-10 px-5 rounded-lg text-sm font-semibold',
                    'border border-slate-200 dark:border-slate-700',
                    'text-slate-700 dark:text-slate-300',
                    'hover:bg-slate-100 dark:hover:bg-slate-800',
                    'transition-colors',
                  )}
                >
                  Later
                </button>
              </div>
            )}
            {state === 'ready' && (
              <button
                onClick={handleRestart}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 h-9 rounded-lg text-sm font-semibold',
                  'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800',
                  'transition-colors',
                )}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Restart Now
              </button>
            )}
            {state === 'error' && (
              <button
                onClick={handleUpdate}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 h-9 rounded-lg text-sm font-semibold',
                  'bg-slate-600 dark:bg-slate-700 text-white hover:bg-slate-700 dark:hover:bg-slate-600',
                  'transition-colors',
                )}
              >
                Try Again
              </button>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
