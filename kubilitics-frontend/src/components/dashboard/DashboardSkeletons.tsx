/**
 * Skeleton placeholders for Gateway zones — mirror final layout for three-second rule.
 */
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function PulseStripSkeleton() {
  return (
    <div
      className="w-full flex items-center gap-1 py-2 px-4 rounded-inner border border-border/50 bg-card/50 overflow-hidden"
      aria-hidden
    >
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-badge" />
      ))}
    </div>
  );
}

export function InsightsPanelSkeleton() {
  return (
    <div className="rounded-xl border border-border/50 bg-card/30 flex flex-col overflow-hidden min-h-[280px] p-4">
      <Skeleton className="h-4 w-24 mb-1" />
      <Skeleton className="h-3 w-48 mb-4" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-2 py-2">
            <Skeleton className="h-4 w-4 shrink-0 rounded" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3 w-full max-w-[180px]" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActivityFeedSkeleton() {
  return (
    <div className="rounded-xl border border-border/50 bg-card/30 overflow-hidden min-h-[280px]">
      <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-3 w-20" />
      </div>
      <div className="p-4 space-y-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
