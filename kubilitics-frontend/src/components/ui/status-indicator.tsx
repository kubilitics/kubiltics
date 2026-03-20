import { cn } from '@/lib/utils';

export type StatusType = 'healthy' | 'running' | 'warning' | 'error' | 'failed' | 'pending' | 'info' | 'unknown' | 'terminated';

interface StatusIndicatorProps {
  status: StatusType;
  /** Label displayed next to the indicator */
  label?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show pulse animation for active/running states */
  pulse?: boolean;
  className?: string;
}

/**
 * StatusIndicator — Accessible status display using shape + color + label.
 *
 * WCAG 2.1 AA compliant: never relies on color alone.
 * Each status has a unique shape AND color:
 *   - healthy/running: filled circle (green)
 *   - warning: triangle (amber)
 *   - error/failed: diamond (red)
 *   - pending: hollow circle (blue, pulse)
 *   - info: square (blue)
 *   - unknown/terminated: dash (gray)
 */
export function StatusIndicator({
  status,
  label,
  size = 'md',
  pulse,
  className,
}: StatusIndicatorProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
  const sizeClasses = SIZE_MAP[size];
  const showPulse = pulse ?? (status === 'pending' || status === 'running');

  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      role="status"
      aria-label={label ?? config.ariaLabel}
    >
      <span className={cn('relative shrink-0', sizeClasses.wrapper)}>
        {showPulse && (
          <span
            className={cn(
              'absolute inset-0 rounded-full animate-ping opacity-30',
              config.bgClass
            )}
          />
        )}
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className={cn('relative', sizeClasses.svg)}
          aria-hidden="true"
        >
          {config.shape}
        </svg>
      </span>
      {label && (
        <span className={cn('font-medium', sizeClasses.text, config.textClass)}>
          {label}
        </span>
      )}
    </span>
  );
}

/* ── Shape + Color Configurations ── */

const STATUS_CONFIG: Record<
  StatusType,
  {
    shape: React.ReactNode;
    bgClass: string;
    textClass: string;
    ariaLabel: string;
  }
> = {
  healthy: {
    shape: <circle cx="8" cy="8" r="6" className="fill-success" />,
    bgClass: 'bg-success',
    textClass: 'text-success',
    ariaLabel: 'Healthy',
  },
  running: {
    shape: <circle cx="8" cy="8" r="6" className="fill-success" />,
    bgClass: 'bg-success',
    textClass: 'text-success',
    ariaLabel: 'Running',
  },
  warning: {
    shape: (
      <path
        d="M8 2L14 13H2L8 2Z"
        className="fill-warning"
        strokeLinejoin="round"
      />
    ),
    bgClass: 'bg-warning',
    textClass: 'text-warning',
    ariaLabel: 'Warning',
  },
  error: {
    shape: (
      <rect
        x="3"
        y="3"
        width="10"
        height="10"
        rx="1"
        className="fill-error"
        transform="rotate(45 8 8)"
      />
    ),
    bgClass: 'bg-error',
    textClass: 'text-error',
    ariaLabel: 'Error',
  },
  failed: {
    shape: (
      <rect
        x="3"
        y="3"
        width="10"
        height="10"
        rx="1"
        className="fill-error"
        transform="rotate(45 8 8)"
      />
    ),
    bgClass: 'bg-error',
    textClass: 'text-error',
    ariaLabel: 'Failed',
  },
  pending: {
    shape: (
      <circle
        cx="8"
        cy="8"
        r="5"
        className="stroke-info"
        strokeWidth="2"
        fill="none"
      />
    ),
    bgClass: 'bg-info',
    textClass: 'text-info',
    ariaLabel: 'Pending',
  },
  info: {
    shape: (
      <rect x="3" y="3" width="10" height="10" rx="2" className="fill-info" />
    ),
    bgClass: 'bg-info',
    textClass: 'text-info',
    ariaLabel: 'Info',
  },
  unknown: {
    shape: (
      <rect
        x="3"
        y="7"
        width="10"
        height="2"
        rx="1"
        className="fill-muted-foreground"
      />
    ),
    bgClass: 'bg-muted-foreground',
    textClass: 'text-muted-foreground',
    ariaLabel: 'Unknown',
  },
  terminated: {
    shape: (
      <rect
        x="3"
        y="7"
        width="10"
        height="2"
        rx="1"
        className="fill-muted-foreground"
      />
    ),
    bgClass: 'bg-muted-foreground',
    textClass: 'text-muted-foreground',
    ariaLabel: 'Terminated',
  },
};

const SIZE_MAP = {
  sm: { wrapper: 'w-3 h-3', svg: 'w-3 h-3', text: 'text-xs' },
  md: { wrapper: 'w-4 h-4', svg: 'w-4 h-4', text: 'text-sm' },
  lg: { wrapper: 'w-5 h-5', svg: 'w-5 h-5', text: 'text-base' },
};
