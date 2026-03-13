/**
 * DetailPageSkeleton — shimmer placeholder for resource detail pages.
 * Mirrors: breadcrumb, header with icon/title/badges, tab bar, and content sections.
 *
 * Usage:
 *   if (isLoading) return <DetailPageSkeleton tabCount={4} sectionCount={3} />;
 */
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface DetailPageSkeletonProps {
  /** Number of tabs to show (default 4). */
  tabCount?: number;
  /** Number of content sections below tabs (default 2). */
  sectionCount?: number;
  /** Show breadcrumb line at top (default true). */
  showBreadcrumb?: boolean;
  className?: string;
}

export function DetailPageSkeleton({
  tabCount = 4,
  sectionCount = 2,
  showBreadcrumb = true,
  className,
}: DetailPageSkeletonProps) {
  return (
    <div className={cn('space-y-6 animate-in fade-in-0 duration-300', className)} aria-hidden>
      {/* Breadcrumb */}
      {showBreadcrumb && (
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-3" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-3" />
          <Skeleton className="h-4 w-32" />
        </div>
      )}

      {/* Header: icon + title + badges + actions */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-2xl" />
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border pb-px">
        {Array.from({ length: tabCount }, (_, i) => (
          <Skeleton key={i} className={cn('h-9 rounded-t-md', i === 0 ? 'w-24' : 'w-20')} />
        ))}
      </div>

      {/* Content sections */}
      {Array.from({ length: sectionCount }, (_, i) => (
        <div key={i} className="rounded-xl border border-border p-5 space-y-4">
          {/* Section header */}
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-20" />
          </div>
          {/* Section rows */}
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, j) => (
              <div key={j} className="flex items-center gap-4">
                <Skeleton className="h-4 w-28 shrink-0" />
                <Skeleton className="h-4 flex-1 max-w-sm" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
