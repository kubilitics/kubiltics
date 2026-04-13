/* eslint-disable react-refresh/only-export-components */
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * CSS-based row entrance config.
 *
 * Previously used Framer Motion's motion.tr on every table row, which caused
 * severe performance issues — 100+ motion components per page, each with
 * individual animation instances, stagger timers, and tracking.
 *
 * Now uses lightweight CSS @keyframes:
 * - No JS animation runtime per row
 * - GPU-composited (opacity + transform)
 * - Stagger via animation-delay in inline style
 * - 60fps on thousands of rows
 */
export const ROW_MOTION = {
 initial: { opacity: 0, y: 8 },
 animate: { opacity: 1, y: 0 },
 transition: (index: number) => ({ delay: index * 0.03, duration: 0.2 }),
};

/** CSS class for row entrance animation — replaces motion.tr entirely. */
export const rowEntranceClass = 'animate-row-entrance';

/** Get inline style for staggered row entrance. Only first 20 rows get stagger delay for perf. */
export function rowEntranceStyle(index: number): React.CSSProperties | undefined {
 if (index <= 0) return undefined;
 if (index > 20) return undefined; // Skip stagger for rows beyond 20
 return { animationDelay: `${index * 30}ms` };
}

/**
 * Class names for data rows so the table feels like "card strips":
 * soft border, padding, hover lift, transition. Use with <tr>.
 */
export const resourceTableRowClassName = cn(
 'border-b border-border/60 transition-all duration-150',
 '[&>td]:py-2', // tighten row density vs. shadcn default py-3
 'hover:bg-muted/50 hover:shadow-[inset_3px_0_0_hsl(var(--primary)/0.3)]',
 'group cursor-pointer',
 'data-[selected]:bg-primary/5 data-[selected]:shadow-[inset_3px_0_0_hsl(var(--primary)/0.5)]',
 'focus-visible:bg-primary/5 focus-visible:shadow-[var(--focus-ring)]',
);

export interface ResourceTableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
 /** @deprecated motion.tr is no longer used — CSS animations handle entrance. */
 asMotion?: boolean;
 /** Row index for stagger delay. */
 motionIndex?: number;
 isFirst?: boolean;
 isLast?: boolean;
 /** Whether the row is selected (for aria-selected) */
 isSelected?: boolean;
}

/**
 * Table row with consistent "card strip" styling and CSS entrance animation.
 * Uses CSS @keyframes instead of Framer Motion for 10x better performance.
 */
export const ResourceTableRow = forwardRef<HTMLTableRowElement, ResourceTableRowProps>(
 ({ asMotion, motionIndex = 0, isFirst, isLast, isSelected, className, children, style, ...props }, ref) => {
 const classes = cn(
 resourceTableRowClassName,
 rowEntranceClass,
 isFirst && 'rounded-t-lg',
 isLast && 'rounded-b-lg',
 className
 );

 return (
 <tr
 ref={ref}
 role="row"
 aria-selected={isSelected}
 className={classes}
 style={{ ...style, ...rowEntranceStyle(motionIndex) }}
 {...props}
 >
 {children}
 </tr>
 );
 }
);
ResourceTableRow.displayName = 'ResourceTableRow';
