export interface TopologyErrorStateProps {
  error: string;
  onRetry?: () => void;
  lastSuccessTime?: string;
  partialWarnings?: string[];
}

/**
 * TopologyErrorState: Displays error information with retry action.
 * Supports full errors (centered) and partial warnings (banner).
 */
export function TopologyErrorState({
  error,
  onRetry,
  lastSuccessTime,
  partialWarnings,
}: TopologyErrorStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
      <div className="max-w-md">
        <div className="mb-4 text-4xl">{"⚠️"}</div>
        <h2 className="mb-2 text-lg font-semibold text-foreground">
          Unable to load topology
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">{error}</p>

        {lastSuccessTime && (
          <p className="mb-4 text-xs text-muted-foreground">
            Last successful load: {new Date(lastSuccessTime).toLocaleTimeString()}
          </p>
        )}

        {partialWarnings && partialWarnings.length > 0 && (
          <div className="mb-4 space-y-1 text-left">
            {partialWarnings.map((w, i) => (
              <div
                key={i}
                className="rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
              >
                {w}
              </div>
            ))}
          </div>
        )}

        {onRetry && (
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={onRetry}
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Partial error banner — shown at top of canvas when some resources failed to load.
 */
export function TopologyPartialErrorBanner({
  warnings,
  onDismiss,
  onRetry,
}: {
  warnings: string[];
  onDismiss?: () => void;
  onRetry?: () => void;
}) {
  if (warnings.length === 0) return null;

  return (
    <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <span className="flex-1">
        {warnings.length === 1
          ? warnings[0]
          : `${warnings.length} warnings — some connections may be missing.`}
      </span>
      {onRetry && (
        <button type="button" className="font-medium underline" onClick={onRetry}>
          Retry
        </button>
      )}
      {onDismiss && (
        <button type="button" className="font-medium underline" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}

/**
 * WebSocket disconnection banner.
 */
export function TopologyWsDisconnectBanner({ reconnectIn }: { reconnectIn?: number }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center border-t border-amber-200 bg-amber-50 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      Live updates paused. Reconnecting...
      {reconnectIn != null && ` (${Math.ceil(reconnectIn / 1000)}s)`}
    </div>
  );
}
