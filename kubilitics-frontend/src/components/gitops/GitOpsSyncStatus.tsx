/**
 * GitOpsSyncStatus — ArgoCD/Flux sync status badge component.
 *
 * Displays a visual badge indicating the GitOps sync state of a Kubernetes resource.
 * Supports synced, out-of-sync, progressing, degraded, suspended, and unknown states.
 * Detects GitOps-managed resources via annotations on ArgoCD and Flux patterns.
 *
 * @example
 * ```tsx
 * <GitOpsSyncStatus
 *   kind="Deployment"
 *   name="my-app"
 *   namespace="default"
 *   annotations={resource.metadata?.annotations}
 * />
 * ```
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  PauseCircle,
  HelpCircle,
  GitBranch,
  ExternalLink,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  useGitOpsStatus,
  type GitOpsSyncState,
  type GitOpsProvider,
  type UseGitOpsStatusArgs,
} from '@/hooks/useGitOpsStatus';

/** Visual configuration for each sync state. */
interface SyncStateConfig {
  icon: React.ElementType;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  animate: boolean;
}

const SYNC_STATE_CONFIG: Record<GitOpsSyncState, SyncStateConfig> = {
  synced: {
    icon: CheckCircle2,
    label: 'Synced',
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-500/10 dark:bg-emerald-500/20',
    borderColor: 'border-emerald-500/30',
    animate: false,
  },
  'out-of-sync': {
    icon: AlertTriangle,
    label: 'Out of Sync',
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-500/10 dark:bg-amber-500/20',
    borderColor: 'border-amber-500/30',
    animate: true,
  },
  progressing: {
    icon: Loader2,
    label: 'Progressing',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-500/10 dark:bg-blue-500/20',
    borderColor: 'border-blue-500/30',
    animate: true,
  },
  degraded: {
    icon: XCircle,
    label: 'Degraded',
    color: 'text-rose-600 dark:text-rose-400',
    bgColor: 'bg-rose-500/10 dark:bg-rose-500/20',
    borderColor: 'border-rose-500/30',
    animate: true,
  },
  suspended: {
    icon: PauseCircle,
    label: 'Suspended',
    color: 'text-slate-600 dark:text-slate-400',
    bgColor: 'bg-slate-500/10 dark:bg-slate-500/20',
    borderColor: 'border-slate-500/30',
    animate: false,
  },
  unknown: {
    icon: HelpCircle,
    label: 'Unknown',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/50',
    borderColor: 'border-border',
    animate: false,
  },
};

/** Provider display names and colors. */
const PROVIDER_CONFIG: Record<GitOpsProvider, { label: string; color: string }> = {
  argocd: { label: 'ArgoCD', color: 'text-orange-600 dark:text-orange-400' },
  flux: { label: 'Flux', color: 'text-blue-600 dark:text-blue-400' },
  none: { label: '', color: '' },
};

/** Props for the GitOpsSyncStatus component. */
export interface GitOpsSyncStatusProps extends UseGitOpsStatusArgs {
  /** Display size variant. */
  size?: 'sm' | 'md' | 'lg';
  /** Show provider label alongside the status. */
  showProvider?: boolean;
  /** Show the application name. */
  showAppName?: boolean;
  /** Additional CSS classes. */
  className?: string;
  /** Render nothing if not GitOps-managed (default true). */
  hideIfUnmanaged?: boolean;
}

/**
 * GitOps sync status badge for ArgoCD and Flux managed resources.
 *
 * Renders a colored badge with icon, label, and optional provider/app info.
 * When the resource is not managed by a GitOps tool, renders nothing by default.
 */
export function GitOpsSyncStatus({
  kind,
  name,
  namespace,
  annotations,
  enabled = true,
  size = 'sm',
  showProvider = true,
  showAppName = false,
  className,
  hideIfUnmanaged = true,
}: GitOpsSyncStatusProps) {
  const { status, isLoading } = useGitOpsStatus({
    kind,
    name,
    namespace,
    annotations,
    enabled,
  });

  const config = useMemo(
    () => SYNC_STATE_CONFIG[status.syncState],
    [status.syncState],
  );

  const providerConfig = useMemo(
    () => PROVIDER_CONFIG[status.provider],
    [status.provider],
  );

  // Don't render if not managed and hideIfUnmanaged is true
  if (!status.managed && hideIfUnmanaged) return null;

  // Loading state
  if (isLoading) {
    return (
      <Badge variant="outline" className={cn('gap-1 text-muted-foreground', className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">Checking...</span>
      </Badge>
    );
  }

  const Icon = config.icon;
  const iconSize = size === 'lg' ? 'h-4 w-4' : size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3';
  const textSize = size === 'lg' ? 'text-sm' : size === 'md' ? 'text-xs' : 'text-[11px]';

  const badgeContent = (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      <Badge
        variant="outline"
        className={cn(
          'gap-1.5 font-medium border',
          config.bgColor,
          config.borderColor,
          config.color,
          textSize,
          className,
        )}
      >
        <GitBranch className={cn(iconSize, 'opacity-60')} />
        {showProvider && status.provider !== 'none' && (
          <span className={cn('font-semibold', providerConfig.color)}>
            {providerConfig.label}
          </span>
        )}
        <Icon
          className={cn(
            iconSize,
            status.syncState === 'progressing' && 'animate-spin',
          )}
        />
        <span>{config.label}</span>
        {showAppName && status.appName && (
          <span className="text-muted-foreground truncate max-w-[120px]">
            {status.appName}
          </span>
        )}
      </Badge>
    </motion.div>
  );

  // Wrap in tooltip with detailed info
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badgeContent}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 font-medium">
            <GitBranch className="h-3.5 w-3.5" />
            GitOps Status
          </div>
          <div className="text-xs space-y-1 text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">Provider:</span>{' '}
              {providerConfig.label || 'Unknown'}
            </div>
            <div>
              <span className="font-medium text-foreground">State:</span>{' '}
              <span className={config.color}>{config.label}</span>
            </div>
            {status.appName && (
              <div>
                <span className="font-medium text-foreground">Application:</span>{' '}
                {status.appName}
              </div>
            )}
            {status.revision && (
              <div>
                <span className="font-medium text-foreground">Revision:</span>{' '}
                <span className="font-mono">{status.revision.slice(0, 12)}</span>
              </div>
            )}
            {status.message && (
              <div className="pt-1 border-t border-border/50">{status.message}</div>
            )}
            {status.repoUrl && (
              <div className="flex items-center gap-1 pt-1">
                <ExternalLink className="h-3 w-3" />
                <span className="truncate">{status.repoUrl}</span>
              </div>
            )}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default GitOpsSyncStatus;
