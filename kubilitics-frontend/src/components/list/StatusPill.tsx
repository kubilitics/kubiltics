import { type LucideIcon } from 'lucide-react';
import { CheckCircle2, AlertTriangle, XCircle, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Semantic status variants for consistent pill styling across list pages. */
export type StatusPillVariant = 'success' | 'warning' | 'error' | 'neutral';

const variantStyles: Record<StatusPillVariant, {
  bg: string;
  color: string;
  border: string;
  defaultIcon: LucideIcon;
}> = {
  success: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    color: 'text-emerald-700 dark:text-emerald-400',
    border: 'border border-emerald-200/50 dark:border-emerald-800/30',
    defaultIcon: CheckCircle2,
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    color: 'text-amber-700 dark:text-amber-400',
    border: 'border border-amber-200/50 dark:border-amber-800/30',
    defaultIcon: AlertTriangle,
  },
  error: {
    bg: 'bg-rose-50 dark:bg-rose-950/30',
    color: 'text-rose-700 dark:text-rose-400',
    border: 'border border-rose-200/50 dark:border-rose-800/30',
    defaultIcon: XCircle,
  },
  neutral: {
    bg: 'bg-slate-50 dark:bg-slate-800/40',
    color: 'text-slate-600 dark:text-slate-400',
    border: 'border border-slate-200/50 dark:border-slate-700/30',
    defaultIcon: Circle,
  },
};

export interface StatusPillProps {
  label: string;
  variant: StatusPillVariant;
  icon?: LucideIcon;
  className?: string;
}

/**
 * Standard status pill for list tables. Use for status, readiness, or state columns
 * so Pods, Deployments, and ResourceList pages share the same look.
 *
 * WCAG 2.1 SC 1.4.1 compliant: always shows icon + color (never color-only).
 */
export function StatusPill({ label, variant, icon: CustomIcon, className }: StatusPillProps) {
  const style = variantStyles[variant] || variantStyles.neutral;
  const Icon = CustomIcon ?? style.defaultIcon;
  return (
    <div
      role="status"
      aria-label={`${label} status`}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
        'min-w-0 max-w-full shadow-sm backdrop-blur-sm',
        'animate-fade-in',
        style.bg,
        style.color,
        style.border,
        className
      )}
    >
      <Icon className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </div>
  );
}
