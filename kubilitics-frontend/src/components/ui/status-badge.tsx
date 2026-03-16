/**
 * StatusBadge — WCAG 2.1 SC 1.4.1 compliant status indicator
 *
 * Uses both icon AND color to convey status information,
 * ensuring no color-only information is presented.
 *
 * TASK-UX-003: Status Indicators — Icon + Color
 */

import { cn } from '@/lib/utils';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Clock,
  Loader2,
  MinusCircle,
  Pause,
  Shield,
  Ban,
  Info,
  Circle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ─── Legacy API (backward-compatible) ────────────────────────────────────────

export type StatusBadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'loading';

// ─── Kubernetes Status Types ─────────────────────────────────────────────────

export type StatusType =
  | 'healthy'
  | 'running'
  | 'ready'
  | 'succeeded'
  | 'active'
  | 'bound'
  | 'available'
  | 'completed'
  | 'warning'
  | 'pending'
  | 'error'
  | 'failed'
  | 'crashloopbackoff'
  | 'imagepullbackoff'
  | 'terminated'
  | 'evicted'
  | 'unknown'
  | 'loading'
  | 'stopped'
  | 'paused'
  | 'protected';

interface StatusConfig {
  variant: StatusBadgeVariant;
  icon: LucideIcon;
  label: string;
}

/** Map of K8s status types to their visual configuration */
const STATUS_MAP: Record<StatusType, StatusConfig> = {
  healthy:           { variant: 'success', icon: CheckCircle2,  label: 'Healthy' },
  running:           { variant: 'success', icon: CheckCircle2,  label: 'Running' },
  ready:             { variant: 'success', icon: CheckCircle2,  label: 'Ready' },
  succeeded:         { variant: 'success', icon: CheckCircle2,  label: 'Succeeded' },
  active:            { variant: 'success', icon: CheckCircle2,  label: 'Active' },
  bound:             { variant: 'success', icon: CheckCircle2,  label: 'Bound' },
  available:         { variant: 'success', icon: CheckCircle2,  label: 'Available' },
  completed:         { variant: 'success', icon: CheckCircle2,  label: 'Completed' },
  warning:           { variant: 'warning', icon: AlertTriangle, label: 'Warning' },
  pending:           { variant: 'warning', icon: Clock,         label: 'Pending' },
  error:             { variant: 'error',   icon: XCircle,       label: 'Error' },
  failed:            { variant: 'error',   icon: XCircle,       label: 'Failed' },
  crashloopbackoff:  { variant: 'error',   icon: XCircle,       label: 'CrashLoopBackOff' },
  imagepullbackoff:  { variant: 'error',   icon: XCircle,       label: 'ImagePullBackOff' },
  terminated:        { variant: 'error',   icon: MinusCircle,   label: 'Terminated' },
  evicted:           { variant: 'error',   icon: Ban,           label: 'Evicted' },
  unknown:           { variant: 'neutral', icon: HelpCircle,    label: 'Unknown' },
  stopped:           { variant: 'neutral', icon: MinusCircle,   label: 'Stopped' },
  paused:            { variant: 'neutral', icon: Pause,         label: 'Paused' },
  protected:         { variant: 'neutral', icon: Shield,        label: 'Protected' },
  loading:           { variant: 'loading', icon: Loader2,       label: 'Loading' },
};

// ─── Variant Styling (WCAG AA compliant colors) ─────────────────────────────

const variantConfig: Record<StatusBadgeVariant, {
  bg: string;
  text: string;
  border: string;
  icon: LucideIcon;
  iconClass: string;
  dotClass: string;
}> = {
  success: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    text: 'text-emerald-700 dark:text-emerald-400',
    border: 'border-emerald-200/60 dark:border-emerald-800/40',
    icon: CheckCircle2,
    iconClass: 'text-emerald-600 dark:text-emerald-400',
    dotClass: 'bg-emerald-500 dark:bg-emerald-400',
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-700 dark:text-amber-400',
    border: 'border-amber-200/60 dark:border-amber-800/40',
    icon: AlertTriangle,
    iconClass: 'text-amber-600 dark:text-amber-400',
    dotClass: 'bg-amber-500 dark:bg-amber-400',
  },
  error: {
    bg: 'bg-red-50 dark:bg-red-950/40',
    text: 'text-red-700 dark:text-red-400',
    border: 'border-red-200/60 dark:border-red-800/40',
    icon: XCircle,
    iconClass: 'text-red-600 dark:text-red-400',
    dotClass: 'bg-red-500 dark:bg-red-400',
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    text: 'text-blue-700 dark:text-blue-400',
    border: 'border-blue-200/60 dark:border-blue-800/40',
    icon: Info,
    iconClass: 'text-blue-600 dark:text-blue-400',
    dotClass: 'bg-blue-500 dark:bg-blue-400',
  },
  neutral: {
    bg: 'bg-slate-50 dark:bg-slate-800/40',
    text: 'text-slate-600 dark:text-slate-400',
    border: 'border-slate-200/60 dark:border-slate-700/40',
    icon: Circle,
    iconClass: 'text-slate-500 dark:text-slate-400',
    dotClass: 'bg-slate-400 dark:bg-slate-500',
  },
  loading: {
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-200/60 dark:border-blue-800/40',
    icon: Loader2,
    iconClass: 'text-blue-500 dark:text-blue-400 animate-spin',
    dotClass: 'bg-blue-500 dark:bg-blue-400 animate-pulse',
  },
};

// ─── Size Configuration ──────────────────────────────────────────────────────

type BadgeSize = 'sm' | 'default' | 'lg';

const sizeConfig: Record<BadgeSize, { badge: string; icon: string; dot: string }> = {
  sm: {
    badge: 'px-1.5 py-0.5 text-[9px] h-5 gap-1',
    icon: 'w-2.5 h-2.5',
    dot: 'h-1.5 w-1.5',
  },
  default: {
    badge: 'px-2.5 py-1 text-[11px] gap-1.5',
    icon: 'w-3 h-3',
    dot: 'h-2 w-2',
  },
  lg: {
    badge: 'px-3 py-1.5 text-xs gap-2',
    icon: 'w-3.5 h-3.5',
    dot: 'h-2.5 w-2.5',
  },
};

// ─── Component Props ─────────────────────────────────────────────────────────

export interface StatusBadgeProps {
  /** The status variant controlling color and default icon */
  variant: StatusBadgeVariant;
  /** Display label (e.g. "Active", "Good State", "Running") */
  label: string;
  /** Override the default icon for the variant */
  icon?: LucideIcon;
  /** Show a pulsing dot instead of an icon */
  dot?: boolean;
  /** Show as icon-only (no text label) */
  iconOnly?: boolean;
  /** Additional className overrides */
  className?: string;
  /** Size variant */
  size?: BadgeSize;
}

/**
 * StatusBadge — Accessible status indicator with icon + color
 *
 * Compliant with WCAG 2.1 SC 1.4.1 (no color-only information).
 * Every status uses both a distinct icon shape AND a color.
 *
 * @example
 * // By variant (legacy)
 * <StatusBadge variant="success" label="Active" />
 * <StatusBadge variant="warning" label="Needs Attention" dot />
 *
 * // By K8s status (new)
 * <K8sStatusBadge status="running" />
 * <K8sStatusBadge status="crashloopbackoff" size="lg" />
 */
export function StatusBadge({
  variant,
  label,
  icon: CustomIcon,
  dot = false,
  iconOnly = false,
  className,
  size = 'default',
}: StatusBadgeProps) {
  const config = variantConfig[variant];
  const Icon = CustomIcon ?? config.icon;
  const sizes = sizeConfig[size];

  if (iconOnly) {
    return (
      <span
        className={cn('inline-flex items-center', className)}
        role="status"
        aria-label={label}
        title={label}
      >
        <Icon className={cn(sizes.icon, config.iconClass)} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-semibold shadow-sm backdrop-blur-sm',
        config.bg,
        config.text,
        config.border,
        sizes.badge,
        className,
      )}
      role="status"
      aria-label={label}
    >
      {dot ? (
        <span className="relative flex" style={{ width: sizes.dot.match(/w-(\S+)/)?.[0], height: sizes.dot.match(/h-(\S+)/)?.[0] }}>
          <span className={cn('absolute inset-0 rounded-full opacity-40 animate-ping', config.dotClass)} />
          <span className={cn('relative inline-flex rounded-full', sizes.dot, config.dotClass)} />
        </span>
      ) : (
        <Icon className={cn(sizes.icon, config.iconClass)} aria-hidden="true" />
      )}
      <span>{label}</span>
    </span>
  );
}

// ─── K8s Status Badge (new API using StatusType) ─────────────────────────────

export interface K8sStatusBadgeProps {
  /** Kubernetes status string */
  status: StatusType;
  /** Override the display label */
  label?: string;
  /** Badge size */
  size?: BadgeSize;
  /** Show as dot only */
  dot?: boolean;
  /** Show as icon only */
  iconOnly?: boolean;
  /** Pulsing animation for live statuses */
  pulse?: boolean;
  /** Additional className */
  className?: string;
}

/**
 * K8sStatusBadge — Status badge that maps Kubernetes status strings
 * to the correct icon, color, and label.
 *
 * @example
 * <K8sStatusBadge status="running" />
 * <K8sStatusBadge status="crashloopbackoff" size="lg" />
 * <K8sStatusBadge status="pending" dot pulse />
 */
export function K8sStatusBadge({
  status,
  label: labelOverride,
  size = 'default',
  dot = false,
  iconOnly = false,
  pulse = false,
  className,
}: K8sStatusBadgeProps) {
  const config = STATUS_MAP[status] ?? STATUS_MAP.unknown;
  const displayLabel = labelOverride ?? config.label;

  return (
    <StatusBadge
      variant={config.variant}
      label={displayLabel}
      icon={config.icon}
      dot={dot || pulse}
      iconOnly={iconOnly}
      size={size}
      className={className}
    />
  );
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Convert a raw Kubernetes status string to StatusType
 */
export function k8sStatusToType(status: string): StatusType {
  const normalized = status.toLowerCase().replace(/[\s_-]/g, '');

  if (normalized in STATUS_MAP) return normalized as StatusType;

  const mappings: Record<string, StatusType> = {
    'containercreating': 'pending',
    'podinitialized': 'pending',
    'scheduling': 'pending',
    'containerstatusunknown': 'unknown',
    'oomkilled': 'error',
    'errimagepull': 'imagepullbackoff',
    'invalidimagerr': 'error',
    'createcontainererror': 'error',
    'createcontainerconfigerror': 'error',
    'preempting': 'warning',
    'backoff': 'warning',
    'shutdown': 'stopped',
    'nodenotready': 'error',
    'networknotready': 'error',
    'true': 'healthy',
    'false': 'error',
  };

  return mappings[normalized] ?? 'unknown';
}

/**
 * Get the variant for a K8s status type
 */
export function getStatusVariant(status: StatusType): StatusBadgeVariant {
  return (STATUS_MAP[status] ?? STATUS_MAP.unknown).variant;
}
