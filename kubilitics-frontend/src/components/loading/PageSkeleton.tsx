/**
 * PageSkeleton — shimmer placeholder that mirrors the ListPageHeader + stat cards + table layout.
 * Drop into any list page's `isLoading && !data` branch to prevent blank-screen flash.
 *
 * Usage:
 *   if (isLoading) return <PageSkeleton statCount={4} columnCount={7} />;
 */
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface PageSkeletonProps {
  /** Number of stat cards to show (default 4). Set 0 to hide stats row. */
  statCount?: number;
  /** Number of table columns (default 6). */
  columnCount?: number;
  /** Number of table rows (default 8). */
  rowCount?: number;
  /** Show search/toolbar area (default true). */
  showToolbar?: boolean;
  className?: string;
}

export function PageSkeleton({
  statCount = 4,
  columnCount = 6,
  rowCount = 8,
  showToolbar = true,
  className,
}: PageSkeletonProps) {
  return (
    <div className={cn('space-y-6 animate-in fade-in-0 duration-300', className)} aria-hidden>
      {/* Header skeleton: icon + title + badge + buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-xl" />
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-5 w-10 rounded-full" />
            </div>
            <Skeleton className="h-4 w-52" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>

      {/* Stat cards */}
      {statCount > 0 && (
        <div className={cn(
          'grid gap-4',
          statCount <= 3 ? 'grid-cols-1 sm:grid-cols-3' :
          statCount <= 4 ? 'grid-cols-2 sm:grid-cols-4' :
          'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
        )}>
          {Array.from({ length: statCount }, (_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      )}

      {/* Toolbar (search + filters) */}
      {showToolbar && (
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-64 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
          <div className="flex-1" />
          <Skeleton className="h-9 w-20 rounded-md" />
        </div>
      )}

      {/* Table skeleton */}
      <div className="rounded-xl border border-border overflow-hidden">
        {/* Table header */}
        <div className="flex gap-2 px-4 py-3 bg-muted/30 border-b border-border">
          {Array.from({ length: columnCount }, (_, j) => (
            <Skeleton key={j} className="h-4 flex-1 max-w-[160px]" />
          ))}
        </div>
        {/* Table rows */}
        {Array.from({ length: rowCount }, (_, i) => (
          <div
            key={i}
            className="flex gap-2 px-4 py-3 border-b border-border/50 last:border-b-0"
          >
            {Array.from({ length: columnCount }, (_, j) => (
              <Skeleton
                key={j}
                className={cn('h-5 flex-1 max-w-[160px]', j === 0 && 'max-w-[200px]')}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
