/**
 * BudgetExceededBanner — surfaced when the brain emits an
 * AssistantEvent_Error with code="budget_exceeded". The chat stream
 * stops at that point (the brain follows the event with a partial Done).
 * The user can either reset the cap in Settings or wait for the next
 * monthly rollover.
 *
 * Phase 2 / Gap 3.
 */
import { AlertCircle, ExternalLink, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface BudgetExceededBannerProps {
  /** Cumulative spend that tripped the cap, in dollars. */
  spentUSD?: number;
  /** Active cap, in dollars. 0 ⇒ "unlimited", won't render. */
  capUSD?: number;
  /** Optional message from the server (defaults to a localized phrase). */
  message?: string;
  /** Fired when the user clicks "Open Settings". Router-agnostic. */
  onOpenSettings?: () => void;
  /** Fired when the user clicks "Reset". Wired by the chat panel to
   *  the `reset_budget` Tauri command so the user can unblock the
   *  stream without leaving the panel. */
  onReset?: () => void;
  /** Presentational override (e.g. "embedded" vs "overlay"). */
  className?: string;
}

export function BudgetExceededBanner({
  spentUSD,
  capUSD,
  message,
  onOpenSettings,
  onReset,
  className,
}: BudgetExceededBannerProps): JSX.Element {
  const costLine =
    spentUSD != null && capUSD != null && capUSD > 0
      ? `$${spentUSD.toFixed(2)} of $${capUSD.toFixed(2)} used`
      : null;

  return (
    <div
      data-testid="budget-exceeded-banner"
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3',
        'dark:border-amber-800 dark:bg-amber-950/40',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          Monthly AI budget reached
        </p>
        <p className="text-xs text-amber-800/90 dark:text-amber-300/90">
          {message ?? 'The chat stream stopped before contacting the model.'}
          {costLine ? ` (${costLine})` : ''} Reset the cap in Settings or wait for the monthly rollover.
        </p>
      </div>
      {onReset && (
        <Button
          size="sm"
          variant="outline"
          onClick={onReset}
          className="flex-shrink-0"
          data-testid="budget-exceeded-reset"
        >
          Reset
          <RotateCcw className="ml-1.5 h-3 w-3" />
        </Button>
      )}
      {onOpenSettings && (
        <Button
          size="sm"
          variant="outline"
          onClick={onOpenSettings}
          className="flex-shrink-0"
          data-testid="budget-exceeded-open-settings"
        >
          Open Settings
          <ExternalLink className="ml-1.5 h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

/**
 * Helper — detects a `budget_exceeded` server error frame. The chat
 * panel can switch on this to decide whether to render
 * BudgetExceededBanner vs a generic error toast.
 */
export function isBudgetExceededError(code?: string): boolean {
  return code === 'budget_exceeded';
}
