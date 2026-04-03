/**
 * StatusDot — Colored dot for removed / unreachable / degraded status.
 */
import { STATUS_COLORS, type StatusType } from '../design-tokens';

interface StatusDotProps {
  status: StatusType;
  size?: number;
  className?: string;
}

export function StatusDot({ status, size = 8, className = '' }: StatusDotProps) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: STATUS_COLORS[status],
      }}
      aria-label={status}
    />
  );
}
