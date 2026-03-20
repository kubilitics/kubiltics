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
      className={cn('flex flex-col items-center justify-center gap-4 py-12 animate-slide-up', className)}
    >
      <div className="rounded-full bg-destructive/10 p-8 flex items-center justify-center h-24 w-24">
        <AlertTriangle className="h-12 w-12 text-destructive opacity-70" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-base font-medium text-foreground">Something went wrong</p>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" className="gap-2 press-effect" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      )}
    </div>
  );
}
