import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  Shield,
  AlertTriangle,
  Activity,
  Check,
  X,
  ChevronRight,
  Loader2,
  Search,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  useAutoPilotFindings,
  useAutoPilotActions,
  useApproveAction,
  useDismissAction,
  useTriggerScan,
  useAutoPilotConfig,
} from '@/hooks/useAutoPilot';
import { RemediationDetail } from '@/components/autopilot/RemediationDetail';
import type { AutoPilotAction } from '@/services/api/autopilot';
import { cn } from '@/lib/utils';

// ── Severity helpers ─────────────────────────────────────────────────────────

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

function severityBadge(severity: string) {
  return (
    <Badge className={cn('text-[10px] uppercase', SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.medium)}>
      {severity}
    </Badge>
  );
}

function statusBadge(status: string) {
  return (
    <Badge className={cn('text-[10px] uppercase', STATUS_COLORS[status] ?? STATUS_COLORS.pending)}>
      {status}
    </Badge>
  );
}

// ── Page Component ───────────────────────────────────────────────────────────

const AutoPilotDashboard = () => {
  const { data: findings = [], isLoading: findingsLoading } = useAutoPilotFindings();
  const { data: pendingActions = [], isLoading: pendingLoading } = useAutoPilotActions('pending', 20, 0);
  const { data: recentActions = [], isLoading: recentLoading } = useAutoPilotActions(undefined, 10, 0);
  const { data: config = [] } = useAutoPilotConfig();
  const approveAction = useApproveAction();
  const dismissAction = useDismissAction();
  const triggerScan = useTriggerScan();

  const [selectedAction, setSelectedAction] = useState<AutoPilotAction | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Derive summary stats
  const findingsBySeverity = findings.reduce(
    (acc, f) => {
      acc[f.severity] = (acc[f.severity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const appliedCount = recentActions.filter((a) => a.status === 'applied').length;
  const pendingCount = pendingActions.length;
  const blockedCount = recentActions.filter((a) => a.status === 'dismissed').length;

  // Determine global mode from config (most common mode across enabled rules)
  const enabledModes = config.filter((c) => c.enabled).map((c) => c.mode);
  const globalMode = enabledModes.length > 0
    ? enabledModes.sort((a, b) =>
        enabledModes.filter((m) => m === b).length - enabledModes.filter((m) => m === a).length,
      )[0]
    : 'audit';

  const handleApprove = (actionId: string) => {
    approveAction.mutate(actionId);
  };

  const handleDismiss = (actionId: string) => {
    dismissAction.mutate(actionId);
  };

  const handleScan = () => {
    triggerScan.mutate();
  };

  const handleViewDetail = (action: AutoPilotAction) => {
    setSelectedAction(action);
    setDetailOpen(true);
  };

  const isLoading = findingsLoading || pendingLoading || recentLoading;

  return (
    <div className="page-container" role="main" aria-label="Auto-Pilot Dashboard">
      <div className="page-inner p-6 gap-6 flex flex-col">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Auto-Pilot</h1>
            <p className="text-sm text-muted-foreground">
              Autonomous architectural remediation
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/auto-pilot/config">
            <Button variant="outline" size="sm">
              Configure
            </Button>
          </Link>
          <Button
            size="sm"
            onClick={handleScan}
            disabled={triggerScan.isPending}
          >
            {triggerScan.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Search className="h-4 w-4 mr-1.5" />
            )}
            Scan Now
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Mode Card */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Shield className="h-4.5 w-4.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Mode</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-lg font-bold capitalize">{globalMode}</p>
                  <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[10px]">
                    Active
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Findings Card */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <AlertTriangle className="h-4.5 w-4.5 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Findings</p>
                <p className="text-lg font-bold mt-0.5">{findings.length}</p>
                {!findingsLoading && (
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {findingsBySeverity.critical > 0 && (
                      <span className="text-[10px] text-red-600 dark:text-red-400 font-medium">
                        {findingsBySeverity.critical} critical
                      </span>
                    )}
                    {findingsBySeverity.high > 0 && (
                      <span className="text-[10px] text-orange-600 dark:text-orange-400 font-medium">
                        {findingsBySeverity.high} high
                      </span>
                    )}
                    {findingsBySeverity.medium > 0 && (
                      <span className="text-[10px] text-yellow-600 dark:text-yellow-400 font-medium">
                        {findingsBySeverity.medium} medium
                      </span>
                    )}
                    {findingsBySeverity.low > 0 && (
                      <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                        {findingsBySeverity.low} low
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Remediations Card */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Activity className="h-4.5 w-4.5 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Remediations (recent)</p>
                <p className="text-lg font-bold mt-0.5">{recentActions.length}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {appliedCount > 0 && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                      {appliedCount} applied
                    </span>
                  )}
                  {pendingCount > 0 && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                      {pendingCount} pending
                    </span>
                  )}
                  {blockedCount > 0 && (
                    <span className="text-[10px] text-slate-600 dark:text-slate-400 font-medium">
                      {blockedCount} dismissed
                    </span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Approvals */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Pending Approvals</CardTitle>
            {pendingCount > 0 && (
              <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">
                {pendingCount}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {pendingLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading...
            </div>
          ) : pendingActions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No pending approvals. All clear.
            </p>
          ) : (
            pendingActions.map((action) => (
              <div
                key={action.id}
                className="rounded-lg border border-border/60 p-4 space-y-2 hover:border-border transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                      <span className="text-sm font-medium truncate">{action.description}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Rule: {action.rule_id} | Target: {action.target_kind}/{action.target_namespace}/{action.target_name}
                    </p>
                    <div className="flex items-center gap-2">
                      {severityBadge(action.severity)}
                      {action.safety_delta !== 0 && (
                        <span className={cn(
                          'text-[10px] font-medium',
                          action.safety_delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                        )}>
                          Health {action.safety_delta > 0 ? '+' : ''}{action.safety_delta.toFixed(1)} points
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs"
                    onClick={() => handleApprove(action.id)}
                    disabled={approveAction.isPending}
                  >
                    <Check className="h-3 w-3 mr-1" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => handleDismiss(action.id)}
                    disabled={dismissAction.isPending}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Dismiss
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => handleViewDetail(action)}
                  >
                    Details
                    <ChevronRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Recent Actions Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Recent Actions</CardTitle>
        </CardHeader>
        <CardContent>
          {recentLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading...
            </div>
          ) : recentActions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No actions recorded yet. Run a scan to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Time</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Action</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {recentActions.map((action) => (
                    <tr
                      key={action.id}
                      className="border-b border-border/30 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => handleViewDetail(action)}
                    >
                      <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(action.created_at).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-sm truncate block max-w-md">{action.description}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {action.target_kind}/{action.target_namespace}/{action.target_name}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">{statusBadge(action.status)}</td>
                      <td className="py-2.5 px-3">{severityBadge(action.severity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {recentActions.length > 0 && (
            <div className="pt-3 text-center">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                View Full Audit Log
                <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Remediation Detail Modal */}
      <RemediationDetail
        action={selectedAction}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onApprove={(id) => {
          handleApprove(id);
          setDetailOpen(false);
        }}
        onDismiss={(id) => {
          handleDismiss(id);
          setDetailOpen(false);
        }}
      />
      </div>
    </div>
  );
};

export default AutoPilotDashboard;
