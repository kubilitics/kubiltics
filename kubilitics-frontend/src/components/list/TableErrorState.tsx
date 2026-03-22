import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface TableErrorStateProps {
  /** Error message to display */
  message?: string;
  /** Retry callback — refetches the query */
  onRetry?: () => void;
  className?: string;
}

/**
 * Standard error state for list page tables. Shows when a query fails
 * after all retries are exhausted, replacing the skeleton loader.
 */
export function TableErrorState({
  message = 'Failed to load resources. The cluster may be unreachable.',
  onRetry,
  className,
}: TableErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-5 py-16 animate-slide-up', className)}
    >
      <div className="relative">
        <div className="rounded-2xl bg-gradient-to-br from-destructive/10 to-destructive/5 p-5 flex items-center justify-center shadow-sm border border-destructive/10">
          <AlertTriangle className="h-8 w-8 text-destructive/70" />
        </div>
        <div className="absolute -inset-1 rounded-2xl bg-destructive/5 -z-10 blur-md" />
      </div>
      <div className="text-center space-y-1.5">
        <p className="text-base font-semibold text-foreground">Something went wrong</p>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" className="gap-2 press-effect rounded-lg mt-1" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      )}
    </div>
  );
}
