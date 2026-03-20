/**
 * ResourceListSkeleton -- full-page skeleton matching resource list pages.
 *
 * Sections mirrored:
 *   1. Page header (icon + title + count badge + action buttons)
 *   2. Stat cards row
 *   3. Search bar + filter toolbar
 *   4. Table (header + 8 shimmer rows with varying widths)
 *   5. Pagination bar
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

/** Width classes for row cells to create natural-looking variation. */
const ROW_WIDTH_PATTERNS = [
  ['w-3/4', 'w-2/3', 'w-full', 'w-1/2', 'w-3/5', 'w-2/5'],
  ['w-2/3', 'w-full', 'w-1/2', 'w-3/4', 'w-2/5', 'w-3/5'],
  ['w-full', 'w-1/2', 'w-3/4', 'w-2/3', 'w-3/5', 'w-2/5'],
  ['w-1/2', 'w-3/4', 'w-2/3', 'w-full', 'w-2/5', 'w-3/5'],
  ['w-3/5', 'w-2/3', 'w-full', 'w-1/2', 'w-3/4', 'w-2/5'],
  ['w-2/5', 'w-full', 'w-3/4', 'w-2/3', 'w-1/2', 'w-3/5'],
  ['w-3/4', 'w-1/2', 'w-2/3', 'w-3/5', 'w-full', 'w-2/5'],
  ['w-2/3', 'w-3/5', 'w-1/2', 'w-3/4', 'w-2/5', 'w-full'],
];

export interface ResourceListSkeletonProps {
  /** Number of stat cards (default 4, set 0 to hide). */
  statCount?: number;
  /** Number of table columns (default 6). */
  columnCount?: number;
  /** Number of table rows (default 8). */
  rowCount?: number;
  className?: string;
}

export function ResourceListSkeleton({
  statCount = 4,
  columnCount = 6,
  rowCount = 8,
  className,
}: ResourceListSkeletonProps) {
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className={cn('space-y-6', className)}
      aria-hidden
    >
      {/* Header: icon + title + badge + buttons */}
      <motion.div variants={item} className="flex items-center justify-between">
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
      </motion.div>

      {/* Stat cards */}
      {statCount > 0 && (
        <motion.div
          variants={item}
          className={cn(
            'grid gap-4',
            statCount <= 3
              ? 'grid-cols-1 sm:grid-cols-3'
              : statCount <= 4
                ? 'grid-cols-2 sm:grid-cols-4'
                : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
          )}
        >
          {Array.from({ length: statCount }, (_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </motion.div>
      )}

      {/* Search toolbar */}
      <motion.div variants={item} className="flex items-center gap-3">
        <Skeleton className="h-9 w-64 rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md" />
        <div className="flex-1" />
        <Skeleton className="h-9 w-20 rounded-md" />
      </motion.div>

      {/* Table */}
      <motion.div variants={item} className="rounded-xl border border-border overflow-hidden">
        {/* Table header */}
        <div className="flex gap-2 px-4 py-3 bg-muted/30 border-b border-border">
          {Array.from({ length: columnCount }, (_, j) => (
            <Skeleton key={j} className="h-4 flex-1 max-w-[160px]" />
          ))}
        </div>

        {/* Table rows with varying widths and staggered opacity */}
        {Array.from({ length: rowCount }, (_, i) => {
          const widths = ROW_WIDTH_PATTERNS[i % ROW_WIDTH_PATTERNS.length];
          return (
            <motion.div
              key={i}
              className="flex gap-2 px-4 py-3 border-b border-border/50 last:border-b-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 + i * 0.05 }}
            >
              {Array.from({ length: columnCount }, (_, j) => (
                <Skeleton
                  key={j}
                  className={cn(
                    'h-5 flex-1 max-w-[160px]',
                    j === 0 && 'max-w-[200px]',
                    widths[j % widths.length],
                    i > 5 && 'opacity-60',
                    i > 6 && 'opacity-30',
                  )}
                />
              ))}
            </motion.div>
          );
        })}
      </motion.div>

      {/* Pagination */}
      <motion.div variants={item} className="flex items-center justify-between">
        <Skeleton className="h-4 w-36" />
        <div className="flex items-center gap-1">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
        <Skeleton className="h-4 w-24" />
      </motion.div>
    </motion.div>
  );
}
