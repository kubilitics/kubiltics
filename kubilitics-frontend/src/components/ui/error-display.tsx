/**
 * Error display component with icon, title, message, and action button.
 *
 * Renders structured API errors in a consistent, user-friendly card format
 * with appropriate icons, colors, and suggested actions. Supports dark mode,
 * Framer Motion entrance animation, and optional retry/dismiss callbacks.
 *
 * TASK-SCALE-004
 */

import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Ban,
  Clock,
  KeyRound,
  Loader2,
  RefreshCw,
  SearchX,
  ServerCrash,
  ShieldAlert,
  WifiOff,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ErrorCode, StructuredError } from '@/lib/errorHandling';

// ── Icon Map ───────────────────────────────────────────────────────────────────

const ERROR_ICONS: Record<ErrorCode, LucideIcon> = {
  AUTH_REQUIRED: KeyRound,
  FORBIDDEN: ShieldAlert,
  NOT_FOUND: SearchX,
  CONFLICT: AlertTriangle,
  RATE_LIMITED: Clock,
  K8S_UNAVAILABLE: ServerCrash,
  VALIDATION_FAILED: XCircle,
  TIMEOUT: Clock,
  NETWORK_ERROR: WifiOff,
  INTERNAL_ERROR: ServerCrash,
  UNKNOWN: Ban,
};

const ERROR_COLORS: Record<ErrorCode, { icon: string; bg: string; border: string }> = {
  AUTH_REQUIRED: {
    icon: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50/50 dark:bg-amber-950/20',
    border: 'border-amber-200/60 dark:border-amber-800/40',
  },
  FORBIDDEN: {
    icon: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50/50 dark:bg-red-950/20',
    border: 'border-red-200/60 dark:border-red-800/40',
  },
  NOT_FOUND: {
    icon: 'text-slate-600 dark:text-slate-400',
    bg: 'bg-slate-50/50 dark:bg-slate-800/20',
    border: 'border-slate-200/60 dark:border-slate-700/40',
  },
  CONFLICT: {
    icon: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50/50 dark:bg-amber-950/20',
    border: 'border-amber-200/60 dark:border-amber-800/40',
  },
  RATE_LIMITED: {
    icon: 'text-orange-600 dark:text-orange-400',
    bg: 'bg-orange-50/50 dark:bg-orange-950/20',
    border: 'border-orange-200/60 dark:border-orange-800/40',
  },
  K8S_UNAVAILABLE: {
    icon: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50/50 dark:bg-red-950/20',
    border: 'border-red-200/60 dark:border-red-800/40',
  },
  VALIDATION_FAILED: {
    icon: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-50/50 dark:bg-rose-950/20',
    border: 'border-rose-200/60 dark:border-rose-800/40',
  },
  TIMEOUT: {
    icon: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50/50 dark:bg-amber-950/20',
    border: 'border-amber-200/60 dark:border-amber-800/40',
  },
  NETWORK_ERROR: {
    icon: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50/50 dark:bg-red-950/20',
    border: 'border-red-200/60 dark:border-red-800/40',
  },
  INTERNAL_ERROR: {
    icon: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50/50 dark:bg-red-950/20',
    border: 'border-red-200/60 dark:border-red-800/40',
  },
  UNKNOWN: {
    icon: 'text-slate-600 dark:text-slate-400',
    bg: 'bg-slate-50/50 dark:bg-slate-800/20',
    border: 'border-slate-200/60 dark:border-slate-700/40',
  },
};

// ── Animation ──────────────────────────────────────────────────────────────────

const fadeIn = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
};

// ── Types ──────────────────────────────────────────────────────────────────────

export type ErrorDisplaySize = 'sm' | 'md' | 'lg';

export interface ErrorDisplayProps {
  /** Structured error object from parseError / parseResponseError */
  error: StructuredError;
  /** Override the action button handler */
  onAction?: () => void;
  /** Retry callback (takes precedence over onAction for retryable errors) */
  onRetry?: () => void;
  /** Dismiss callback */
  onDismiss?: () => void;
  /** Whether a retry is in progress */
  retrying?: boolean;
  /** Size variant */
  size?: ErrorDisplaySize;
  /** Render as inline (no card border) */
  inline?: boolean;
  /** Show technical detail */
  showDetail?: boolean;
  /** Additional className */
  className?: string;
}

// ── Size Config ────────────────────────────────────────────────────────────────

const SIZE_CONFIG: Record<ErrorDisplaySize, {
  wrapper: string;
  icon: string;
  title: string;
  message: string;
}> = {
  sm: { wrapper: 'p-3 gap-2', icon: 'h-5 w-5', title: 'text-sm font-semibold', message: 'text-xs' },
  md: { wrapper: 'p-6 gap-3', icon: 'h-8 w-8', title: 'text-base font-semibold', message: 'text-sm' },
  lg: { wrapper: 'p-10 gap-4', icon: 'h-12 w-12', title: 'text-lg font-semibold', message: 'text-sm' },
};

// ── Component ──────────────────────────────────────────────────────────────────

export function ErrorDisplay({
  error,
  onAction,
  onRetry,
  onDismiss,
  retrying = false,
  size = 'md',
  inline = false,
  showDetail = false,
  className,
}: ErrorDisplayProps) {
  const Icon = ERROR_ICONS[error.code] ?? Ban;
  const colors = ERROR_COLORS[error.code] ?? ERROR_COLORS.UNKNOWN;
  const s = SIZE_CONFIG[size];

  const handleAction = () => {
    if (error.retryable && onRetry) {
      onRetry();
    } else if (onAction) {
      onAction();
    } else if (error.actionHref) {
      window.location.href = error.actionHref;
    }
  };

  const actionLabel = error.retryable && onRetry
    ? (retrying ? 'Retrying...' : 'Retry')
    : error.actionLabel;

  return (
    <motion.div
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      role="alert"
      aria-live="assertive"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        s.wrapper,
        !inline && [
          'rounded-lg border',
          colors.bg,
          colors.border,
        ],
        className,
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          'flex items-center justify-center rounded-full',
          'bg-muted/60 dark:bg-muted/30',
          size === 'sm' ? 'p-1.5' : size === 'md' ? 'p-3' : 'p-4',
        )}
        aria-hidden="true"
      >
        <Icon className={cn(s.icon, colors.icon)} strokeWidth={1.5} />
      </div>

      {/* Text */}
      <div className="flex flex-col gap-1">
        <h3 className={cn(s.title, 'text-foreground dark:text-foreground')}>
          {error.title}
        </h3>
        <p className={cn(s.message, 'max-w-md text-muted-foreground dark:text-muted-foreground')}>
          {error.message}
        </p>
        {showDetail && error.detail && error.detail !== error.message && (
          <p className="mt-1 max-w-md font-mono text-xs text-muted-foreground/70 dark:text-muted-foreground/50">
            {error.detail}
          </p>
        )}
        {error.retryAfterSeconds != null && (
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">
            Retry after {error.retryAfterSeconds}s
          </p>
        )}
        {error.resource?.name && (
          <p className="text-xs text-muted-foreground/80 dark:text-muted-foreground/60">
            Resource: {error.resource.kind && `${error.resource.kind}/`}
            {error.resource.namespace && `${error.resource.namespace}/`}
            {error.resource.name}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="mt-2 flex items-center gap-2">
        {actionLabel && (
          <Button
            size={size === 'sm' ? 'sm' : 'default'}
            variant="default"
            onClick={handleAction}
            disabled={retrying}
          >
            {retrying && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {!retrying && error.retryable && <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            {actionLabel}
          </Button>
        )}
        {onDismiss && (
          <Button
            size={size === 'sm' ? 'sm' : 'default'}
            variant="outline"
            onClick={onDismiss}
          >
            Dismiss
          </Button>
        )}
      </div>

      {/* Error code footer */}
      <p className="mt-1 text-[10px] font-mono text-muted-foreground/50 dark:text-muted-foreground/40">
        {error.code}{error.httpStatus ? ` (${error.httpStatus})` : ''}
      </p>
    </motion.div>
  );
}

ErrorDisplay.displayName = 'ErrorDisplay';

// ── Inline variant for table rows / smaller contexts ───────────────────────────

export interface InlineErrorProps {
  error: StructuredError;
  onRetry?: () => void;
  className?: string;
}

export function InlineError({ error, onRetry, className }: InlineErrorProps) {
  const Icon = ERROR_ICONS[error.code] ?? Ban;
  const colors = ERROR_COLORS[error.code] ?? ERROR_COLORS.UNKNOWN;

  return (
    <div className={cn('flex items-center gap-2 text-sm', className)} role="alert">
      <Icon className={cn('h-4 w-4 flex-shrink-0', colors.icon)} />
      <span className="text-muted-foreground dark:text-muted-foreground truncate">
        {error.message}
      </span>
      {error.retryable && onRetry && (
        <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={onRetry}>
          <RefreshCw className="mr-1 h-3 w-3" />
          Retry
        </Button>
      )}
    </div>
  );
}

InlineError.displayName = 'InlineError';
