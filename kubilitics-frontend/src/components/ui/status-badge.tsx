import { type LucideIcon, CheckCircle2, AlertTriangle, XCircle, Info, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StatusBadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

const variantConfig: Record<StatusBadgeVariant, { bg: string; text: string; border: string; icon: LucideIcon }> = {
  success: {
    bg: 'bg-[hsl(142,76%,36%)]/10',
    text: 'text-[hsl(142,76%,36%)]',
    border: 'border-[hsl(142,76%,36%)]/20',
    icon: CheckCircle2,
  },
  warning: {
    bg: 'bg-[hsl(45,93%,47%)]/10',
    text: 'text-[hsl(45,93%,47%)]',
    border: 'border-[hsl(45,93%,47%)]/20',
    icon: AlertTriangle,
  },
  error: {
    bg: 'bg-[hsl(0,72%,51%)]/10',
    text: 'text-[hsl(0,72%,51%)]',
    border: 'border-[hsl(0,72%,51%)]/20',
    icon: XCircle,
  },
  info: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    border: 'border-primary/20',
    icon: Info,
  },
  neutral: {
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    border: 'border-border',
    icon: Circle,
  },
};

export interface StatusBadgeProps {
  /** The status variant controlling color and default icon */
  variant: StatusBadgeVariant;
  /** Display label (e.g. "Active", "Good State", "Running") */
  label: string;
  /** Override the default icon for the variant */
  icon?: LucideIcon;
  /** Show a pulsing dot instead of an icon */
  dot?: boolean;
  /** Additional className overrides */
  className?: string;
  /** Size variant — 'sm' for compact inline, 'default' for standard */
  size?: 'sm' | 'default';
}

/**
 * Unified status badge used across the app for consistent status display.
 * Combines color + icon/dot + label for accessible, recognizable status indicators.
 *
 * Usage:
 *   <StatusBadge variant="success" label="Active" dot />
 *   <StatusBadge variant="success" label="Good State" />
 *   <StatusBadge variant="warning" label="Needs Attention" />
 */
export function StatusBadge({
  variant,
  label,
  icon: CustomIcon,
  dot = false,
  className,
  size = 'default',
}: StatusBadgeProps) {
  const config = variantConfig[variant];
  const Icon = CustomIcon ?? config.icon;

  const sizeClasses = size === 'sm'
    ? 'px-1.5 py-0.5 text-[9px] h-5 gap-1'
    : 'px-2.5 py-1 text-[11px] gap-1.5';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-semibold shadow-sm backdrop-blur-sm',
        config.bg,
        config.text,
        config.border,
        sizeClasses,
        className,
      )}
      role="status"
    >
      {dot ? (
        <span className="relative flex h-2 w-2">
          <span className={cn('absolute inset-0 rounded-full opacity-40 animate-ping', config.bg.replace('/10', ''))} />
          <span className={cn('relative inline-flex h-2 w-2 rounded-full', config.bg.replace('/10', ''))} />
        </span>
      ) : (
        <Icon className={size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
      )}
      <span>{label}</span>
    </span>
  );
}
