import { A11Y } from "./constants/designTokens";

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
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center" role="alert" aria-live="assertive">
      <div className="max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-5">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
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
          <div className="mb-4 space-y-1 text-left" role="list" aria-label="Warnings">
            {partialWarnings.map((w, i) => (
              <div
                key={i}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                role="listitem"
              >
                {w}
              </div>
            ))}
          </div>
        )}

        {onRetry && (
          <button
            type="button"
            className={`rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 ${A11Y.focusRing} ${A11Y.transition}`}
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
    <div
      className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      role="alert"
    >
      <svg className="w-4 h-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
      </svg>
      <span className="flex-1">
        {warnings.length === 1
          ? warnings[0]
          : `${warnings.length} warnings — some connections may be missing.`}
      </span>
      {onRetry && (
        <button type="button" className={`font-semibold hover:underline ${A11Y.focusRing} rounded px-1`} onClick={onRetry}>
          Retry
        </button>
      )}
      {onDismiss && (
        <button type="button" className={`font-semibold hover:underline ${A11Y.focusRing} rounded px-1`} onClick={onDismiss} aria-label="Dismiss warnings">
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
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center gap-2 border-t border-amber-200 bg-amber-50 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      role="status"
      aria-live="polite"
    >
      <svg className="w-4 h-4 animate-spin text-amber-500" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Live updates paused. Reconnecting...
      {reconnectIn != null && ` (${Math.ceil(reconnectIn / 1000)}s)`}
    </div>
  );
}
