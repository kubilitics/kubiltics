import { useState, useEffect, useCallback, useRef } from 'react';
import { WifiOff, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * P0-004-T05: Network Error with Auto-Retry UI
 *
 * Non-blocking banner for network errors with:
 * - Countdown timer before auto-retry
 * - Exponential backoff: 2s → 4s → 8s → 16s → max 30s
 * - Manual retry button
 * - Escalates after 3 failures to a prominent banner
 */

interface NetworkRetryBannerProps {
  /** Whether there's currently a network error */
  isError: boolean;
  /** Number of consecutive failures */
  failureCount?: number;
  /** Callback to retry the failed request */
  onRetry: () => void;
  /** Callback to dismiss the banner */
  onDismiss?: () => void;
  /** Number of pending requests waiting to retry */
  pendingRequests?: number;
  className?: string;
}

function getBackoffDelay(attempt: number): number {
  return Math.min(2 ** (attempt + 1), 30); // 2s, 4s, 8s, 16s, 30s max
}

export function NetworkRetryBanner({
  isError,
  failureCount = 1,
  onRetry,
  onDismiss,
  pendingRequests = 0,
  className,
}: NetworkRetryBannerProps) {
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const isEscalated = failureCount >= 3;

  const startCountdown = useCallback(() => {
    const delay = getBackoffDelay(failureCount);
    setCountdown(delay);
  }, [failureCount]);

  // Start countdown when error appears or failure count changes
  useEffect(() => {
    if (isError) {
      startCountdown();
    } else {
      setCountdown(0);
    }
  }, [isError, failureCount, startCountdown]);

  // Tick down the countdown
  useEffect(() => {
    if (countdown <= 0) return;
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          onRetry();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [countdown, onRetry]);

  if (!isError) return null;

  return (
    <div
      role="alert"
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-lg border transition-all',
        isEscalated
          ? 'bg-destructive/10 border-destructive/30 dark:bg-destructive/15'
          : 'bg-amber-500/10 border-amber-500/30 dark:bg-amber-500/15',
        className
      )}
    >
      <WifiOff
        className={cn(
          'h-5 w-5 shrink-0',
          isEscalated ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'
        )}
      />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          {isEscalated ? 'Connection lost' : 'Network error'}
        </p>
        <p className="text-xs text-muted-foreground">
          {countdown > 0 ? (
            <>Retrying in {countdown}s…</>
          ) : (
            <>Retrying…</>
          )}
          {pendingRequests > 0 && (
            <> · {pendingRequests} pending {pendingRequests === 1 ? 'request' : 'requests'}</>
          )}
          {failureCount > 1 && (
            <> · Attempt {failureCount}</>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            clearInterval(timerRef.current);
            setCountdown(0);
            onRetry();
          }}
          className="h-7 gap-1.5 text-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry now
        </Button>
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss} className="h-7 w-7 p-0">
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
