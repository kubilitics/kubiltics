/**
 * CriticalityBadge — Compact severity indicator for blast radius analysis.
 *
 * Colors follow a traffic-light convention:
 *   critical = red, high = orange, medium = amber, low = emerald
 */

export interface CriticalityBadgeProps {
  level: 'critical' | 'high' | 'medium' | 'low';
  score?: number;
}

const BADGE_STYLES: Record<
  CriticalityBadgeProps['level'],
  { bg: string; text: string; ring: string }
> = {
  critical: { bg: 'bg-red-600', text: 'text-white', ring: 'ring-red-600/20' },
  high: { bg: 'bg-orange-500', text: 'text-white', ring: 'ring-orange-500/20' },
  medium: { bg: 'bg-amber-400', text: 'text-amber-950', ring: 'ring-amber-400/20' },
  low: { bg: 'bg-emerald-500', text: 'text-white', ring: 'ring-emerald-500/20' },
};

export function CriticalityBadge({ level, score }: CriticalityBadgeProps) {
  const s = BADGE_STYLES[level];

  return (
    <span
      className={`
        inline-flex items-center gap-1 rounded-full px-2 py-0.5
        text-[10px] font-semibold uppercase tracking-wider leading-tight
        ring-1 ring-inset select-none
        ${s.bg} ${s.text} ${s.ring}
      `}
    >
      {level}
      {score !== undefined && (
        <span className="font-mono tabular-nums opacity-80">
          {Math.round(score)}
        </span>
      )}
    </span>
  );
}
