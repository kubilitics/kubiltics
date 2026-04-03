/**
 * SeverityBadge — Colored pill badge for critical / high / medium / low.
 */
import { SEVERITY_COLORS, type SeverityLevel } from '../design-tokens';

interface SeverityBadgeProps {
  severity: SeverityLevel;
  count?: number;
  className?: string;
}

const BG_MAP: Record<SeverityLevel, string> = {
  critical: SEVERITY_COLORS.criticalBg,
  high: SEVERITY_COLORS.highBg,
  medium: SEVERITY_COLORS.mediumBg,
  low: SEVERITY_COLORS.lowBg,
};

export function SeverityBadge({ severity, count, className = '' }: SeverityBadgeProps) {
  const fg = SEVERITY_COLORS[severity];
  const bg = BG_MAP[severity];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${className}`}
      style={{ color: fg, backgroundColor: bg }}
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: fg }}
      />
      {severity}
      {count !== undefined && (
        <span className="font-bold">{count}</span>
      )}
    </span>
  );
}
