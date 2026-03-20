/**
 * CircuitBreakerBanner — inline banner shown when the backend circuit breaker is open.
 * Shows a live countdown and "Retry Now" button so the user doesn't have to wait
 * the full 60s cooldown.
 *
 * Usage:
 *   <CircuitBreakerBanner />
 *   // or per-cluster:
 *   <CircuitBreakerBanner clusterId="docker-desktop" />
 */
import { AlertTriangle, RefreshCw, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useBackendCircuitState } from '@/hooks/useBackendCircuitOpen';
import { useQueryClient } from '@tanstack/react-query';

export interface CircuitBreakerBannerProps {
  clusterId?: string | null;
  className?: string;
  /** Compact single-line mode for tight layouts. */
  compact?: boolean;
}

export function CircuitBreakerBanner({ clusterId, className, compact }: CircuitBreakerBannerProps) {
  const { isOpen, remainingSeconds, resetAndRetry } = useBackendCircuitState(clusterId);
  const queryClient = useQueryClient();

  if (!isOpen) return null;

  const handleRetry = () => {
    resetAndRetry();
    // Invalidate all queries so they refetch immediately
    queryClient.invalidateQueries();
  };

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeDisplay = minutes > 0
    ? `${minutes}:${seconds.toString().padStart(2, '0')}`
    : `${seconds}s`;

  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg',
          'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50',
          'text-amber-800 dark:text-amber-200',
          className
        )}
        role="alert"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-medium flex-1">
          Connection paused
          {remainingSeconds > 0 && (
            <span className="text-amber-600 dark:text-amber-300 ml-1">
              — auto-retry in {timeDisplay}
            </span>
          )}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRetry}
          className="h-6 px-2 text-xs gap-1 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/50"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-4 px-5 py-4 rounded-xl',
        'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50',
        className
      )}
      role="alert"
    >
      <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center shrink-0">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
          Backend connection temporarily paused
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
          {remainingSeconds > 0 ? (
            <>
              Requests are held to prevent overload. Auto-retry in{' '}
              <span className="font-mono font-semibold tabular-nums inline-flex items-center gap-0.5">
                <Timer className="h-3 w-3" />
                {timeDisplay}
              </span>
            </>
          ) : (
            'Circuit will close momentarily...'
          )}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleRetry}
        className="gap-1.5 shrink-0 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/50"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Retry Now
      </Button>
    </div>
  );
}
