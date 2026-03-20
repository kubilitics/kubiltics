/**
 * Needs Attention — Actionable issues only.
 * Resource counts (nodes, pods, deployments, services) live in MetricCardsGrid.
 * This panel shows ONLY what needs fixing: failed/pending pods, node pressure, restarts, alerts.
 */
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Clock,
  Server,
  Loader2,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { useLiveSignals } from '@/hooks/useLiveSignals';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Issue = {
  id: string;
  label: string;
  count: number;
  severity: 'critical' | 'warning';
  link: string;
  icon: typeof AlertCircle;
};

export function ClusterOverviewPanel() {
  const signals = useLiveSignals();

  const issues: Issue[] = [];
  if (signals.failedPods > 0) {
    issues.push({
      id: 'failed',
      label: 'Failed pods',
      count: signals.failedPods,
      severity: 'critical',
      link: '/pods',
      icon: AlertCircle,
    });
  }
  if (signals.pendingPods > 2) {
    issues.push({
      id: 'pending',
      label: 'Pending pods',
      count: signals.pendingPods,
      severity: 'warning',
      link: '/pods',
      icon: Clock,
    });
  }
  if (signals.nodePressureCount > 0) {
    issues.push({
      id: 'pressure',
      label: 'Nodes under pressure',
      count: signals.nodePressureCount,
      severity: 'critical',
      link: '/nodes',
      icon: Server,
    });
  }
  if (signals.podRestarts > 100) {
    issues.push({
      id: 'restarts',
      label: 'Pod restarts',
      count: signals.podRestarts,
      severity: signals.podRestarts > 500 ? 'critical' : 'warning',
      link: '/pods',
      icon: AlertTriangle,
    });
  }
  const alertsCount = signals.warningEvents + signals.errorEvents;
  if (alertsCount > 5) {
    issues.push({
      id: 'alerts',
      label: 'Active alerts',
      count: alertsCount,
      severity: 'warning',
      link: '/events',
      icon: AlertTriangle,
    });
  }

  // Show loading spinner only on initial load when no cached data exists
  if (signals.isLoading) {
    return (
      <Card className="h-full min-h-[320px] border-none glass-panel relative overflow-hidden flex flex-col" aria-label="Needs attention">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/80 to-blue-500/80" />
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/60" />
            <span className="text-sm text-muted-foreground">Loading</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show error message instead of empty data when queries fail
  if (signals.isError) {
    return (
      <Card className="h-full min-h-[320px] border-none glass-panel relative overflow-hidden flex flex-col" aria-label="Needs attention">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/80 to-blue-500/80" />
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center px-4">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm font-medium text-foreground">Unable to load cluster data</p>
            <p className="text-xs text-muted-foreground">
              {signals.error?.message || 'Failed to fetch cluster information'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show "connect cluster" message only if no nodes/pods AND no error (genuinely empty)
  if (!signals.totalNodes && !signals.runningPods && !signals.isError) {
    return (
      <Card className="h-full min-h-[320px] border-none glass-panel relative overflow-hidden flex flex-col" aria-label="Needs attention">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/80 to-blue-500/80" />
        <CardContent className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Connect a cluster to see issues</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full min-h-[320px] border-none glass-panel relative overflow-hidden flex flex-col" aria-label="Needs attention">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/80 to-blue-500/80" />
      <CardHeader className="pb-4 pt-5 px-6">
        <CardTitle className="flex items-center gap-2.5 text-base font-semibold text-foreground">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
          </div>
          <span>Needs attention</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1.5 font-normal">
          Issues requiring action — resource counts are in the cards above
        </p>
      </CardHeader>
      <CardContent className="flex-1 px-6 pb-6 pt-0">
        {issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-border/40 bg-emerald-500/5">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="mt-4 text-base font-semibold text-foreground">All systems nominal</p>
            <p className="mt-1 text-xs text-muted-foreground">No failed pods, node pressure, or critical alerts</p>
          </div>
        ) : (
          <div className="space-y-2">
            {issues.map((issue) => (
              <Link
                key={issue.id}
                to={issue.link}
                className="group flex items-center gap-3 rounded-xl border border-border/40 bg-muted/30 p-4 transition-all hover:border-primary/30 hover:bg-muted/50"
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    issue.severity === 'critical' ? 'bg-rose-500/10' : 'bg-amber-500/10'
                  }`}
                >
                  <issue.icon
                    className={`h-4 w-4 ${issue.severity === 'critical' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{issue.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {issue.count} {issue.count === 1 ? 'item' : 'items'} — tap to investigate
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold tabular-nums text-foreground">{issue.count}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
