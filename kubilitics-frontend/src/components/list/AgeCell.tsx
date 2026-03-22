import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AgeCellProps {
  /** Relative age string (e.g. "5m", "2d") */
  age: string;
  /** Full ISO timestamp for native browser tooltip on hover */
  timestamp?: string;
  className?: string;
}

/** Format timestamp for tooltip: always show exact ISO when available (TASK-080). */
function tooltipTitle(timestamp: string | undefined): string | undefined {
  if (!timestamp) return undefined;
  const d = new Date(timestamp);
  return isNaN(d.getTime()) ? timestamp : d.toISOString();
}

/** Determine recency tier for visual treatment */
function getRecencyTier(age: string): 'recent' | 'normal' | 'old' {
  const lower = age.toLowerCase().trim();
  // Recent: seconds or minutes (< 1h)
  if (/^\d+s$/.test(lower) || /^\d+m$/.test(lower)) return 'recent';
  // Old: > 30 days
  const dayMatch = lower.match(/^(\d+)d$/);
  if (dayMatch && parseInt(dayMatch[1]) > 30) return 'old';
  return 'normal';
}

const recencyStyles = {
  recent: 'text-emerald-600 dark:text-emerald-400',
  normal: 'text-muted-foreground',
  old: 'text-amber-600/70 dark:text-amber-400/70',
};

/**
 * Renders an Age column cell with optional tooltip showing the full ISO timestamp.
 * Includes subtle recency color coding: green for fresh, neutral for normal, amber for old.
 */
export function AgeCell({ age, timestamp, className }: AgeCellProps) {
  const tier = getRecencyTier(age);
  return (
    <span
      title={tooltipTitle(timestamp)}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-sm tabular-nums',
        recencyStyles[tier],
        className,
      )}
    >
      <Clock className="h-3 w-3 opacity-70 shrink-0" aria-hidden="true" />
      {age}
    </span>
  );
}
