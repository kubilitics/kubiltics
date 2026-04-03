/**
 * Remediation Detail modal — shows full context for an Auto-Pilot action.
 * Includes target resource info, why flagged, proposed fix, simulation result,
 * and approve/dismiss/re-simulate buttons.
 */
import {
  AlertTriangle,
  Check,
  X,
  Target,
  FileText,
  Wrench,
  Activity,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { AutoPilotAction } from '@/services/api/autopilot';
import { cn } from '@/lib/utils';

// ── Props ────────────────────────────────────────────────────────────────────

interface RemediationDetailProps {
  action: AutoPilotAction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove?: (actionId: string) => void;
  onDismiss?: (actionId: string) => void;
}

// ── Severity colors ──────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  high: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
  medium: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  low: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  applied: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  dismissed: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
  audit: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
};

// ── Component ────────────────────────────────────────────────────────────────

export function RemediationDetail({
  action,
  open,
  onOpenChange,
  onApprove,
  onDismiss,
}: RemediationDetailProps) {
  if (!action) return null;

  const isPending = action.status === 'pending';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Remediation Detail
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Target Resource Info */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Target className="h-3.5 w-3.5" />
              Target
            </div>
            <div className="rounded-lg border border-border/60 p-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">
                  {action.target_kind}/{action.target_namespace}/{action.target_name}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={cn('text-[10px] uppercase', SEVERITY_COLORS[action.severity] ?? SEVERITY_COLORS.medium)}>
                  {action.severity}
                </Badge>
                <Badge className={cn('text-[10px] uppercase', STATUS_COLORS[action.status] ?? STATUS_COLORS.pending)}>
                  {action.status}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  Rule: {action.rule_id}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Detected: {new Date(action.created_at).toLocaleString()}
              </p>
            </div>
          </div>

          <Separator />

          {/* Why Flagged */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              Why This Was Flagged
            </div>
            <p className="text-sm leading-relaxed">
              {action.description}
            </p>
          </div>

          <Separator />

          {/* Proposed Fix */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Wrench className="h-3.5 w-3.5" />
              Proposed Fix
            </div>
            <div className="rounded-lg border border-border/60 p-3 space-y-1.5">
              <p className="text-sm">
                <span className="font-medium">Action:</span> {action.action_type}
              </p>
              <p className="text-sm">
                <span className="font-medium">Target:</span> {action.target_kind} {action.target_namespace}/{action.target_name}
              </p>
              {action.proposed_patch && (
                <pre className="text-[11px] bg-muted/50 rounded p-2 overflow-x-auto mt-2 max-h-32">
                  {typeof action.proposed_patch === 'string'
                    ? action.proposed_patch
                    : JSON.stringify(action.proposed_patch, null, 2)}
                </pre>
              )}
            </div>
          </div>

          <Separator />

          {/* Simulation Result */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
              Simulation Result
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Health Delta</p>
                  <p className={cn(
                    'text-lg font-bold',
                    action.safety_delta > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : action.safety_delta < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-muted-foreground',
                  )}>
                    {action.safety_delta > 0 ? '+' : ''}{action.safety_delta.toFixed(1)} points
                  </p>
                </div>
              </div>
              {action.safety_delta < 0 && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                  Warning: Simulation indicates a negative health impact. Review carefully before approving.
                </p>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-2">
            {isPending && onApprove && (
              <Button
                size="sm"
                onClick={() => onApprove(action.id)}
              >
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Approve & Apply
              </Button>
            )}
            {isPending && onDismiss && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onDismiss(action.id)}
              >
                <X className="h-3.5 w-3.5 mr-1.5" />
                Dismiss
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {isPending ? 'Cancel' : 'Close'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
