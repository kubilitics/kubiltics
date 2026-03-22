/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableRow, TableCell } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/* ── Slow-load timeout thresholds ── */
// With informer cache in the backend, most requests complete in <100ms.
// If we hit 3s, something is genuinely slow (cold cache, network issue).
const SLOW_THRESHOLD_MS = 3_000;
const VERY_SLOW_THRESHOLD_MS = 10_000;

/* ── Hook: track loading phase timing ── */
function useLoadingPhase(isLoading: boolean) {
  const [phase, setPhase] = useState<'normal' | 'slow' | 'very-slow'>('normal');

  useEffect(() => {
    if (!isLoading) {
      setPhase('normal');
      return;
    }

    setPhase('normal');
    const slowTimer = setTimeout(() => setPhase('slow'), SLOW_THRESHOLD_MS);
    const verySlowTimer = setTimeout(() => setPhase('very-slow'), VERY_SLOW_THRESHOLD_MS);

    return () => {
      clearTimeout(slowTimer);
      clearTimeout(verySlowTimer);
    };
  }, [isLoading]);

  return phase;
}

/* ── Enhanced skeleton rows with context ── */

export interface ListPageLoadingShellProps {
  /** Number of table columns to render skeleton cells */
  columnCount: number;
  /** Number of skeleton rows (default 8) */
  rowCount?: number;
  /** Resource type name, e.g. "Deployments", "StatefulSets" */
  resourceName?: string;
  /** Whether loading is active (drives timeout tracking) */
  isLoading: boolean;
  /** Retry handler — shown after very slow loading */
  onRetry?: () => void;
  /** Optional row className */
  rowClassName?: string;
}

/**
 * Enhanced loading shell for list page tables. Replaces bare `TableSkeletonRows`
 * with contextual messaging and timeout handling.
 *
 * Phases:
 * 1. Normal (0-8s): Skeleton rows + subtle "Loading…" indicator
 * 2. Slow (8-20s): "Taking longer than expected…" message
 * 3. Very slow (20s+): Shows retry button
 *
 * Place inside <TableBody> when isLoading is true.
 */
export function ListPageLoadingShell({
  columnCount,
  rowCount = 8,
  resourceName = 'resources',
  isLoading,
  onRetry,
  rowClassName,
}: ListPageLoadingShellProps) {
  const phase = useLoadingPhase(isLoading);

  return (
    <div
      role="status"
      aria-busy={isLoading}
      aria-label={`Loading ${resourceName}. Please wait.`}
    >
      {/* Loading indicator row */}
      <TableRow className="hover:bg-transparent border-b-0">
        <TableCell colSpan={columnCount} className="py-3 text-center">
          <div className="flex items-center justify-center gap-2.5">
            <Loader2 className={cn(
              'h-4 w-4 animate-spin',
              phase === 'normal' ? 'text-primary' : 'text-muted-foreground',
            )} />
            <span className={cn(
              'text-sm',
              phase === 'normal' ? 'text-muted-foreground' : 'text-foreground',
            )}>
              {phase === 'normal' && `Loading ${resourceName}…`}
              {phase === 'slow' && 'Taking longer than expected…'}
              {phase === 'very-slow' && 'The cluster may be slow to respond.'}
            </span>
            {phase === 'very-slow' && onRetry && (
              <Button variant="outline" size="sm" className="gap-1.5 h-7 ml-2" onClick={onRetry}>
                <RefreshCw className="h-3 w-3" />
                Retry
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      {/* Skeleton rows — give visual structure */}
      {Array.from({ length: rowCount - 1 }, (_, i) => (
        <TableRow key={i} className={cn('hover:bg-transparent', rowClassName)} data-skeleton-row>
          {Array.from({ length: columnCount }, (_, j) => (
            <TableCell key={j} className="py-3">
              <Skeleton
                className={cn(
                  'skeleton-shimmer h-5 min-w-[2rem]',
                  j === 0 ? 'w-3/4' : 'w-full',
                  // Staggered opacity for visual depth
                  i > 4 && 'opacity-60',
                  i > 6 && 'opacity-30',
                )}
                style={{
                  // Staggered animation delay for shimmer effect
                  animationDelay: `${i * 50}ms`,
                }}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </div>
  );
}

export { useLoadingPhase };
