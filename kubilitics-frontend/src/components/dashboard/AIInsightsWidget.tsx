/**
 * AIInsightsWidget — Dashboard widget showing top AI-detected issues.
 * Shows 3 most critical insights across the cluster. Each is clickable
 * to expand the AI investigation panel.
 */
import { Sparkles, AlertTriangle, TrendingUp, Shield, ChevronRight, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAIStatus } from '@/hooks/useAIStatus';
import { cn } from '@/lib/utils';

interface Insight {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  resourceKind?: string;
  resourceName?: string;
  namespace?: string;
}

/**
 * Static placeholder insights — in production, these would come from
 * the AI backend's anomaly detection engine. This demonstrates the UI
 * pattern that gets wired to real data.
 */
const PLACEHOLDER_INSIGHTS: Insight[] = [
  {
    id: '1',
    severity: 'critical',
    title: 'High restart rate detected',
    description: '3 pods in the default namespace have restarted 5+ times in the last hour.',
    resourceKind: 'Pod',
  },
  {
    id: '2',
    severity: 'warning',
    title: 'Memory pressure trending up',
    description: '2 nodes approaching 90% memory utilization. Consider scaling.',
    resourceKind: 'Node',
  },
  {
    id: '3',
    severity: 'info',
    title: 'Unused ConfigMaps detected',
    description: '7 ConfigMaps are not referenced by any pod or deployment.',
    resourceKind: 'ConfigMap',
  },
];

const severityConfig = {
  critical: { color: 'text-red-500', bg: 'bg-red-500/10', icon: AlertTriangle, badge: 'destructive' as const },
  warning: { color: 'text-amber-500', bg: 'bg-amber-500/10', icon: TrendingUp, badge: 'secondary' as const },
  info: { color: 'text-blue-500', bg: 'bg-blue-500/10', icon: Shield, badge: 'outline' as const },
};

export function AIInsightsWidget({ className }: { className?: string }) {
  const aiStatus = useAIStatus();
  const navigate = useNavigate();

  // Show setup prompt when AI is not configured
  if (aiStatus.status === 'unconfigured') {
    return (
      <Card className={cn('', className)}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 mb-3">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Configure an AI provider to get intelligent cluster insights, anomaly detection, and remediation suggestions.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/settings')}
              className="gap-1.5"
            >
              <Settings className="h-4 w-4" />
              Set Up AI
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Hide entirely when AI is unavailable
  if (aiStatus.status === 'unavailable') return null;

  const handleInvestigate = (insight: Insight) => {
    window.dispatchEvent(
      new CustomEvent('kubilitics:ai-investigate', {
        detail: {
          prompt: `Investigate: ${insight.title}. ${insight.description}`,
          resourceKind: insight.resourceKind,
          resourceName: insight.resourceName,
          namespace: insight.namespace,
        },
      })
    );
  };

  return (
    <Card className={cn('', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Insights
          </CardTitle>
          <Badge variant="secondary" className="text-[10px]">
            {aiStatus.provider || 'AI'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {PLACEHOLDER_INSIGHTS.map((insight) => {
          const config = severityConfig[insight.severity];
          const SeverityIcon = config.icon;

          return (
            <button
              key={insight.id}
              onClick={() => handleInvestigate(insight)}
              className="w-full flex items-start gap-3 p-3 rounded-xl border border-border/60 hover:border-border hover:bg-accent/30 transition-all text-left group"
            >
              <div className={cn('p-1.5 rounded-lg shrink-0 mt-0.5', config.bg)}>
                <SeverityIcon className={cn('h-3.5 w-3.5', config.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-foreground">{insight.title}</span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{insight.description}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 mt-1" />
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
