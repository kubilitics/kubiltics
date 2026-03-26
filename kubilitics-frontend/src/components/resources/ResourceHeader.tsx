import { ReactNode, useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, Copy, Check, LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NamespaceBadge } from '@/components/list';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';

export type ResourceStatus = 'Running' | 'Pending' | 'Succeeded' | 'Failed' | 'Unknown' | 'Healthy' | 'Warning' | 'Error';

export interface ResourceAction {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  variant?: 'default' | 'outline' | 'destructive';
}

export interface ResourceHeaderProps {
  resourceType: string;
  resourceIcon: LucideIcon;
  name: string;
  namespace?: string;
  status: ResourceStatus;
  backLink: string;
  backLabel: string;
  actions?: ResourceAction[];
  metadata?: ReactNode;
  /** Relative created label (e.g. "2h ago"). Shown with tooltip when createdAt is provided. */
  createdLabel?: string;
  /** ISO timestamp for tooltip on created time */
  createdAt?: string;
}

const statusConfig: Record<ResourceStatus, { bg: string; text: string; icon: string }> = {
  Running: { bg: 'bg-[hsl(var(--success)/0.1)]', text: 'text-[hsl(var(--success))]', icon: '✓' },
  Healthy: { bg: 'bg-[hsl(var(--success)/0.1)]', text: 'text-[hsl(var(--success))]', icon: '✓' },
  Succeeded: { bg: 'bg-[hsl(var(--success)/0.1)]', text: 'text-[hsl(var(--success))]', icon: '✓' },
  Pending: { bg: 'bg-[hsl(var(--warning)/0.1)]', text: 'text-[hsl(var(--warning))]', icon: '◔' },
  Warning: { bg: 'bg-[hsl(var(--warning)/0.1)]', text: 'text-[hsl(var(--warning))]', icon: '⚠' },
  Failed: { bg: 'bg-[hsl(var(--error)/0.1)]', text: 'text-[hsl(var(--error))]', icon: '✗' },
  Error: { bg: 'bg-[hsl(var(--error)/0.1)]', text: 'text-[hsl(var(--error))]', icon: '✗' },
  Unknown: { bg: 'bg-muted', text: 'text-muted-foreground', icon: '?' },
};

export function ResourceHeader({
  resourceType,
  resourceIcon: Icon,
  name,
  namespace,
  status,
  backLink,
  backLabel,
  actions = [],
  metadata,
  createdLabel,
  createdAt,
}: ResourceHeaderProps) {
  const statusStyle = statusConfig[status] || statusConfig.Unknown;
  const [isCopied, setIsCopied] = useState(false);

  const copyDisplayName = useCallback(() => {
    const toCopy = namespace ? `${namespace}/${name}` : name;
    navigator.clipboard.writeText(toCopy);
    toast.success('Copied to clipboard');

    // Show checkmark animation for 1.5s
    setIsCopied(true);
    setTimeout(() => {
      setIsCopied(false);
    }, 1500);
  }, [namespace, name]);

  const createdTooltip = createdAt
    ? new Date(createdAt).toISOString()
    : createdLabel
      ? createdLabel
      : null;

  return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="space-y-4"
      >
        {/* Back Link */}
        <Link
          to={backLink}
          aria-label={`Back to ${backLabel}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to {backLabel}
        </Link>

        {/* Main Header - subtle depth */}
        <div
          role="banner"
          className="elevation-2 flex items-start justify-between rounded-xl border border-border/50 bg-card p-4"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-primary/10 shadow-sm">
              <Icon className="h-8 w-8 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="press-effect h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={copyDisplayName}
                        aria-label="Copy resource name"
                      >
                        <motion.div
                          initial={false}
                          animate={{ scale: isCopied ? 1 : 1, opacity: 1 }}
                          transition={{ duration: 0.2 }}
                        >
                          {isCopied ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </motion.div>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isCopied ? 'Copied!' : `Copy ${namespace ? 'namespace/name' : 'name'}`}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className={cn(
                  'flex items-center gap-2 px-2 py-1 rounded-full text-sm font-medium',
                  statusStyle.bg,
                  statusStyle.text
                )}>
                  <span>{statusStyle.icon}</span>
                  {status}
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 text-sm text-foreground/60 flex-wrap">
                <span className="flex items-center gap-2">
                  {resourceType}
                  {namespace ? (
                    <>
                      {' '}in
                      <NamespaceBadge namespace={namespace} className="ml-1" />
                      namespace
                    </>
                  ) : (
                    <Badge variant="secondary" className="ml-1">Cluster-scoped</Badge>
                  )}
                </span>
                {(createdLabel ?? createdAt) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-2">
                        Created {createdLabel ?? (createdAt ? new Date(createdAt).toLocaleString() : '')}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{createdTooltip}</TooltipContent>
                  </Tooltip>
                )}
                {metadata}
              </div>
            </div>
          </div>

          {/* Actions */}
          {actions.length > 0 && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {actions.map((action) => (
                <Button
                  key={action.label}
                  variant={action.variant || 'outline'}
                  size="sm"
                  onClick={action.onClick}
                  aria-label={action.label}
                  className="press-effect gap-2"
                >
                  <action.icon className="h-4 w-4" />
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
  );
}
