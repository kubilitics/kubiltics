// AsyncSection — section-level error boundary + loading wrapper.
// Wraps an independent section of a page so that if it throws or its data
// is loading, only that section shows a skeleton/error — the rest of the page keeps working.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ErrorTracker } from '@/lib/errorTracker';

/* ─────────── Inline Error UI ─────────── */

interface SectionErrorProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}

function SectionError({ title, message, onRetry, compact }: SectionErrorProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center rounded-xl border border-destructive/20 bg-destructive/5',
        compact ? 'p-4 gap-2' : 'p-8 gap-3'
      )}
      role="alert"
    >
      <div className={cn(
        'rounded-full bg-destructive/10 flex items-center justify-center',
        compact ? 'h-8 w-8' : 'h-10 w-10'
      )}>
        <AlertCircle className={cn('text-destructive', compact ? 'h-4 w-4' : 'h-5 w-5')} />
      </div>
      <div className="space-y-1">
        <p className={cn('font-medium text-foreground', compact ? 'text-xs' : 'text-sm')}>
          {title ? `Failed to load ${title}` : 'Section failed to load'}
        </p>
        {message && (
          <p className={cn('text-muted-foreground max-w-sm', compact ? 'text-[11px]' : 'text-xs')}>
            {message}
          </p>
        )}
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className={cn('gap-1.5', compact && 'h-7 text-xs')}
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </Button>
      )}
    </div>
  );
}

/* ─────────── Default Section Skeleton ─────────── */

interface SectionSkeletonProps {
  /** Number of placeholder rows (default 3). */
  rows?: number;
  compact?: boolean;
}

function SectionSkeleton({ rows = 3, compact }: SectionSkeletonProps) {
  return (
    <div className={cn('space-y-3', compact ? 'p-3' : 'p-4')} aria-hidden>
      <Skeleton className="h-5 w-32" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-24 shrink-0" />
          <Skeleton className="h-4 flex-1 max-w-xs" />
        </div>
      ))}
    </div>
  );
}

/* ─────────── Class Error Boundary (inner) ─────────── */

interface BoundaryProps {
  children: ReactNode;
  title?: string;
  onRetry?: () => void;
  compact?: boolean;
  fallback?: ReactNode;
}

interface BoundaryState {
  hasError: boolean;
  error: Error | null;
}

class SectionErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`SECTION_ERROR [${this.props.title ?? 'unknown'}]:`, error);
    ErrorTracker.captureException(error, {
      extra: { componentStack: errorInfo.componentStack, section: this.props.title },
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <SectionError
          title={this.props.title}
          message={this.state.error?.message}
          onRetry={this.handleReset}
          compact={this.props.compact}
        />
      );
    }
    return this.props.children;
  }
}

/* ─────────── Public AsyncSection Component ─────────── */

export interface AsyncSectionProps {
  children: ReactNode;
  /** Label for error display (e.g. "Metrics", "Events"). */
  title?: string;
  /** When true, shows skeleton placeholder instead of children. */
  isLoading?: boolean;
  /** When set, shows inline error with retry button. */
  error?: Error | null;
  /** Called when user clicks "Retry" on either render-error or data-error. */
  onRetry?: () => void;
  /** Custom loading skeleton (overrides default SectionSkeleton). */
  loadingSkeleton?: ReactNode;
  /** Number of skeleton rows if using default skeleton (default 3). */
  skeletonRows?: number;
  /** Compact mode — smaller padding & fonts for tight layouts. */
  compact?: boolean;
  /** Custom error fallback (overrides default SectionError). */
  errorFallback?: ReactNode;
  className?: string;
}

export function AsyncSection({
  children,
  title,
  isLoading,
  error,
  onRetry,
  loadingSkeleton,
  skeletonRows = 3,
  compact,
  errorFallback,
  className,
}: AsyncSectionProps) {
  // Data-level error (from React Query or manual fetch)
  if (error) {
    return (
      <div className={className}>
        {errorFallback ?? (
          <SectionError title={title} message={error.message} onRetry={onRetry} compact={compact} />
        )}
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className={className}>
        {loadingSkeleton ?? <SectionSkeleton rows={skeletonRows} compact={compact} />}
      </div>
    );
  }

  // Render children inside error boundary to catch throw-time errors
  return (
    <div className={className}>
      <SectionErrorBoundary title={title} onRetry={onRetry} compact={compact} fallback={errorFallback}>
        {children}
      </SectionErrorBoundary>
    </div>
  );
}

/* ─────────── Re-exports ─────────── */
export { SectionError, SectionSkeleton, SectionErrorBoundary };
