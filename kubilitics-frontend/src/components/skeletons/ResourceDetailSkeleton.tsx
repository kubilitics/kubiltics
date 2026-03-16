/**
 * ResourceDetailSkeleton -- full-page skeleton matching resource detail pages.
 *
 * Sections mirrored:
 *   1. Breadcrumb trail
 *   2. Header (icon + resource name + namespace + status badges + actions)
 *   3. Tabs bar
 *   4. Content sections (key-value metadata rows)
 *
 * Uses staggered reveal (50ms per zone) via Framer Motion.
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

export interface ResourceDetailSkeletonProps {
  /** Number of tabs to show (default 4). */
  tabCount?: number;
  /** Number of content sections below tabs (default 2). */
  sectionCount?: number;
  /** Show breadcrumb line at top (default true). */
  showBreadcrumb?: boolean;
  className?: string;
}

export function ResourceDetailSkeleton({
  tabCount = 4,
  sectionCount = 2,
  showBreadcrumb = true,
  className,
}: ResourceDetailSkeletonProps) {
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className={cn('space-y-6', className)}
      aria-hidden
    >
      {/* Breadcrumb */}
      {showBreadcrumb && (
        <motion.div variants={item} className="flex items-center gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-3" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-3" />
          <Skeleton className="h-4 w-32" />
        </motion.div>
      )}

      {/* Header: icon + title + badges + actions */}
      <motion.div variants={item} className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-2xl" />
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-36" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
      </motion.div>

      {/* Tab bar */}
      <motion.div variants={item} className="flex items-center gap-1 border-b border-border pb-px">
        {Array.from({ length: tabCount }, (_, i) => (
          <Skeleton key={i} className={cn('h-9 rounded-t-md', i === 0 ? 'w-24' : 'w-20')} />
        ))}
      </motion.div>

      {/* Content sections */}
      {Array.from({ length: sectionCount }, (_, sIdx) => (
        <motion.div
          key={sIdx}
          variants={item}
          className="rounded-xl border border-border p-5 space-y-4"
        >
          {/* Section header */}
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-20" />
          </div>
          {/* Key-value rows with staggered reveal */}
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, j) => (
              <motion.div
                key={j}
                className="flex items-center gap-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 + sIdx * 0.1 + j * 0.05 }}
              >
                <Skeleton className="h-4 w-28 shrink-0" />
                <Skeleton
                  className={cn(
                    'h-4 flex-1 max-w-sm',
                    j % 2 === 0 ? 'max-w-xs' : 'max-w-md',
                  )}
                />
              </motion.div>
            ))}
          </div>
        </motion.div>
      ))}

      {/* Extra: events/conditions table placeholder */}
      <motion.div variants={item} className="rounded-xl border border-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <motion.div
              key={i}
              className="flex items-center gap-3 py-2 border-b border-border/30 last:border-b-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35 + i * 0.05 }}
            >
              <Skeleton className="h-4 w-4 rounded-full shrink-0" />
              <Skeleton className="h-4 w-24 shrink-0" />
              <Skeleton className="h-4 flex-1 max-w-lg" />
              <Skeleton className="h-4 w-16 shrink-0" />
            </motion.div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
