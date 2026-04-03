/**
 * DeltaIndicator — Arrow up/down with colored delta value.
 */

interface DeltaIndicatorProps {
  delta: number;
  /** Display suffix, e.g. "pts" */
  suffix?: string;
  className?: string;
}

export function DeltaIndicator({ delta, suffix = '', className = '' }: DeltaIndicatorProps) {
  if (delta === 0) {
    return (
      <span className={`inline-flex items-center gap-0.5 text-xs text-[#64748b] ${className}`}>
        &mdash;
      </span>
    );
  }

  const isNegative = delta < 0;
  const color = isNegative ? '#ef4444' : '#22c55e';
  const arrow = isNegative ? '\u25BC' : '\u25B2'; // ▼ / ▲

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${className}`}
      style={{ color }}
    >
      <span className="text-[9px]">{arrow}</span>
      {delta > 0 ? '+' : ''}
      {delta}
      {suffix && <span className="text-[10px]">{suffix}</span>}
    </span>
  );
}
