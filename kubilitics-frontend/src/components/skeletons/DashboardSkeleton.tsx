/**
 * DashboardSkeleton -- full-page skeleton matching the Gateway dashboard layout.
 *
 * Zones mirrored:
 *   1. Page header (icon + title + live badge)
 *   2. Health Pulse Strip (6 pill cards)
 *   3. Hero health gauge + AI insight
 *   4. Three-column command surface (AI | Cluster overview | Activity feed)
 *   5. Workload + Health detail row (2-col)
 *   6. Cluster details strip
 *
 * Uses staggered reveal (50ms per item) via Framer Motion.
 */
import { motion } from 'framer-motion';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.05 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] } },
};

export interface DashboardSkeletonProps {
  className?: string;
}

export function DashboardSkeleton({ className }: DashboardSkeletonProps) {
  return (
    <div className={cn('p-4 md:p-6 -m-2', className)} aria-hidden>
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="space-y-5 md:space-y-6"
      >
        {/* Zone 1: Page header */}
        <motion.div variants={item} className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-3.5 w-48" />
            </div>
          </div>
          <Skeleton className="h-8 w-20 rounded-full" />
        </motion.div>

        {/* Zone 2: Health Pulse Strip */}
        <motion.div variants={item}>
          <div className="w-full flex items-center gap-1 py-2 px-4 rounded-lg border border-border/50 bg-card/50 overflow-hidden">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-md" />
            ))}
          </div>
        </motion.div>

        {/* Zone 3: Hero health gauge + AI insight */}
        <motion.div variants={item}>
          <div className="rounded-xl border border-border/50 bg-card/30 p-6 flex flex-col md:flex-row gap-6 min-h-[180px]">
            {/* Gauge placeholder */}
            <div className="flex items-center justify-center w-full md:w-1/3">
              <Skeleton className="h-32 w-32 rounded-full" />
            </div>
            {/* Insight text area */}
            <div className="flex-1 space-y-3 py-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="h-4 w-full max-w-sm" />
              <Skeleton className="h-4 w-full max-w-xs" />
              <div className="flex gap-2 pt-2">
                <Skeleton className="h-8 w-24 rounded-md" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            </div>
          </div>
        </motion.div>

        {/* Zone 4: Three-column command surface */}
        <motion.div
          variants={item}
          className={cn(
            'grid gap-4 md:gap-5',
            'grid-cols-1 lg:grid-cols-[minmax(0,30%)_1fr_minmax(0,25%)]',
          )}
          style={{ minHeight: 'min(460px, 52vh)' }}
        >
          {/* Left: AI Insights Panel */}
          <div className="rounded-xl border border-border/50 bg-card/30 p-4 min-h-[300px] lg:min-h-[420px] space-y-3 order-2 lg:order-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-48" />
            <div className="space-y-2 pt-2">
              {Array.from({ length: 5 }, (_, i) => (
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

          {/* Center: Cluster overview */}
          <div className="rounded-xl border border-border/50 bg-card/30 p-5 min-h-[340px] space-y-4 order-1 lg:order-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-16" />
            </div>
            {/* Stat cards grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="rounded-lg border border-border/40 p-3 space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-7 w-12" />
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
              ))}
            </div>
            {/* Chart area */}
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>

          {/* Right: Activity Feed */}
          <div className="rounded-xl border border-border/50 bg-card/30 overflow-hidden min-h-[300px] order-3">
            <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="p-4 space-y-3">
              {Array.from({ length: 6 }, (_, i) => (
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
        </motion.div>

        {/* Zone 5: Workload + Health detail row */}
        <motion.div variants={item} className="grid gap-4 md:gap-5 grid-cols-1 lg:grid-cols-2">
          {/* Workload Capacity */}
          <div className="rounded-xl border border-border/50 bg-card/30 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
              ))}
            </div>
          </div>

          {/* Health Score */}
          <div className="rounded-xl border border-border/50 bg-card/30 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="flex items-center gap-6">
              <Skeleton className="h-24 w-24 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Skeleton className="h-3 w-3 rounded-full" />
                    <Skeleton className="h-3 w-20" />
                    <div className="flex-1" />
                    <Skeleton className="h-3 w-8" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Zone 6: Cluster details strip */}
        <motion.div variants={item}>
          <div className="rounded-xl border border-border/50 bg-card/30 p-4 flex flex-wrap gap-6">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
