/**
 * TopologySkeleton -- full-page skeleton matching the Topology page layout.
 *
 * Sections mirrored:
 *   1. Header (icon + title + namespace selector + action buttons)
 *   2. Canvas area with faded graph placeholder (circles + connecting lines)
 *
 * Uses staggered reveal via Framer Motion and SVG for graph placeholders.
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

/** Placeholder node positions for the faded graph visualization. */
const PLACEHOLDER_NODES = [
  { cx: 120, cy: 80, r: 18 },
  { cx: 300, cy: 60, r: 22 },
  { cx: 480, cy: 100, r: 16 },
  { cx: 200, cy: 200, r: 20 },
  { cx: 380, cy: 220, r: 18 },
  { cx: 560, cy: 180, r: 14 },
  { cx: 140, cy: 320, r: 16 },
  { cx: 320, cy: 340, r: 20 },
  { cx: 500, cy: 310, r: 18 },
  { cx: 660, cy: 280, r: 14 },
  { cx: 240, cy: 440, r: 16 },
  { cx: 440, cy: 420, r: 22 },
];

/** Edges connecting placeholder nodes (index pairs). */
const PLACEHOLDER_EDGES: [number, number][] = [
  [0, 1], [1, 2], [0, 3], [1, 4], [2, 5],
  [3, 4], [4, 5], [3, 6], [4, 7], [5, 8],
  [6, 7], [7, 8], [8, 9], [7, 10], [7, 11],
  [10, 11],
];

export interface TopologySkeletonProps {
  className?: string;
}

export function TopologySkeleton({ className }: TopologySkeletonProps) {
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className={cn('flex flex-col gap-3 h-full min-h-[600px] p-4', className)}
      aria-hidden
    >
      {/* Header toolbar */}
      <motion.div variants={item} className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-[160px] rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </motion.div>

      {/* View mode tabs */}
      <motion.div variants={item} className="flex items-center gap-1 flex-shrink-0">
        {['Application', 'Dependencies', 'Infrastructure'].map((label, i) => (
          <Skeleton
            key={label}
            className={cn('h-8 rounded-md', i === 0 ? 'w-28' : 'w-32')}
          />
        ))}
        <div className="flex-1" />
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-md" />
      </motion.div>

      {/* Canvas area with faded graph placeholder */}
      <motion.div
        variants={item}
        className="flex-1 relative min-h-0 rounded-xl overflow-hidden border border-border/50 bg-card/20"
      >
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 780 500"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Edges */}
          {PLACEHOLDER_EDGES.map(([from, to], i) => {
            const a = PLACEHOLDER_NODES[from];
            const b = PLACEHOLDER_NODES[to];
            return (
              <motion.line
                key={`edge-${i}`}
                x1={a.cx}
                y1={a.cy}
                x2={b.cx}
                y2={b.cy}
                className="stroke-muted-foreground/15"
                strokeWidth={1.5}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.15 + i * 0.03 }}
              />
            );
          })}
          {/* Nodes */}
          {PLACEHOLDER_NODES.map((node, i) => (
            <motion.circle
              key={`node-${i}`}
              cx={node.cx}
              cy={node.cy}
              r={node.r}
              className="fill-muted/60 stroke-muted-foreground/10"
              strokeWidth={1}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.05 + i * 0.04 }}
            />
          ))}
        </svg>

        {/* Center loading pulse */}
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            className="flex flex-col items-center gap-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-3 w-28" />
          </motion.div>
        </div>

        {/* Mini controls placeholder (bottom-left) */}
        <div className="absolute bottom-3 left-3 flex flex-col gap-1">
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-7 w-7 rounded" />
        </div>

        {/* Minimap placeholder (bottom-right) */}
        <Skeleton className="absolute bottom-3 right-3 h-24 w-36 rounded-lg opacity-50" />
      </motion.div>
    </motion.div>
  );
}
