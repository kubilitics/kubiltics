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

/**
 * Renders an Age column cell with optional tooltip showing the full ISO timestamp.
 * Use on every list page Age column so users see exact time on hover.
 */
export function AgeCell({ age, timestamp, className }: AgeCellProps) {
  return (
    <span
      title={tooltipTitle(timestamp)}
      className={cn('text-muted-foreground whitespace-nowrap', className)}
    >
      {age}
    </span>
  );
}
