/**
 * Compact criticality indicator for resource list tables.
 *
 * Design: small severity dot + label (inspired by Linear's priority icons).
 * - Critical: red dot + "Critical"
 * - High: orange dot + "High"
 * - Medium: yellow dot + "Medium"
 * - Low: green dot only (no text — reduces noise for healthy resources)
 * - SPOF: appends a "!" indicator
 */

import { cn } from '@/lib/utils';

export interface CriticalityBadgeProps {
  level: 'critical' | 'high' | 'medium' | 'low';
  blastRadius: number;
  isSPOF: boolean;
}

const DOT_COLORS: Record<CriticalityBadgeProps['level'], string> = {
  critical: 'bg-red-600',
  high: 'bg-amber-500',
  medium: 'bg-yellow-500',
  low: 'bg-emerald-500',
};

const LABEL_COLORS: Record<CriticalityBadgeProps['level'], string> = {
  critical: 'text-red-600 dark:text-red-400',
  high: 'text-amber-600 dark:text-amber-400',
  medium: 'text-yellow-600 dark:text-yellow-400',
  low: 'text-emerald-600 dark:text-emerald-400',
};

export function CriticalityBadge({ level, blastRadius, isSPOF }: CriticalityBadgeProps) {
  const showLabel = level !== 'low';

  return (
    <span className="inline-flex items-center gap-1">
      {/* Severity dot */}
      <span className={cn('inline-block h-2 w-2 rounded-full shrink-0', DOT_COLORS[level])} />

      {/* Label (hidden for low to reduce noise) */}
      {showLabel && (
        <span className={cn('text-xs font-medium leading-none', LABEL_COLORS[level])}>
          {level.charAt(0).toUpperCase() + level.slice(1)}
        </span>
      )}

      {/* SPOF indicator */}
      {isSPOF && (
        <span className="text-[10px] font-bold text-red-600 dark:text-red-400 leading-none" title="Single Point of Failure">
          !
        </span>
      )}

      {/* Blast radius count */}
      {blastRadius > 0 && (
        <span
          className="text-[10px] text-muted-foreground leading-none"
          title={`Blast radius: ${blastRadius} dependent resources`}
        >
          ({blastRadius})
        </span>
      )}
    </span>
  );
}

CriticalityBadge.displayName = 'CriticalityBadge';
