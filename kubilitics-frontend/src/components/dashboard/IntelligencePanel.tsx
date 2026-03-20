/**
 * Intelligence Panel — AI-derived insights: severity-coded cards with expandable
 * detail and one-click investigation. Ranked by urgency (critical > warning > info).
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Loader2,
  ChevronRight,
  ChevronDown,
  Search,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { useInsights, type Insight, type InsightSeverity } from '@/hooks/useInsights';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const severityConfig: Record<
  InsightSeverity,
  {
    icon: typeof AlertTriangle;
    border: string;
    iconBg: string;
    text: string;
    label: string;
    badge: string;
  }
> = {
  critical: {
    icon: AlertCircle,
    border: 'border-l-[hsl(var(--error))]',
    iconBg: 'bg-[hsl(var(--error)/0.1)]',
    text: 'text-[hsl(var(--error))]',
    label: 'Critical',
    badge: 'bg-[hsl(var(--error)/0.1)] text-[hsl(var(--error))]',
  },
  warning: {
    icon: AlertTriangle,
    border: 'border-l-[hsl(var(--warning))]',
    iconBg: 'bg-[hsl(var(--warning)/0.1)]',
    text: 'text-[hsl(var(--warning)/0.85)]',
    label: 'Warning',
    badge: 'bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning)/0.85)]',
  },
  info: {
    icon: Info,
    border: 'border-l-[hsl(var(--ring))]',
    iconBg: 'bg-[hsl(var(--accent))]',
    text: 'text-[hsl(var(--primary))]',
    label: 'Info',
    badge: 'bg-[hsl(var(--accent))] text-[hsl(var(--primary))]',
  },
};

function InsightCard({ insight }: { insight: Insight }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const config = severityConfig[insight.severity];
  const Icon = config.icon;

  const handleInvestigate = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(insight.link);
  };

  return (
    <div
      className={cn(
        'rounded-lg border-l-[3px] bg-white/60 hover:bg-white/90',
        'shadow-sm hover:shadow-md transition-all duration-200',
        'overflow-hidden',
        config.border
      )}
    >
      <div className="flex items-start gap-2.5 py-3 px-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 p-0.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring mt-0.5"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse details' : 'Expand details'}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          )}
        </button>
        <div className={cn('flex items-center justify-center w-7 h-7 rounded-lg shrink-0', config.iconBg)}>
          <Icon className={cn('h-3.5 w-3.5', config.text)} aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={cn('text-[10px] uppercase font-semibold tracking-wide px-1.5 py-0.5 rounded', config.badge)}>
              {config.label}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {insight.kind}
            </span>
          </div>
          <p className="text-xs font-medium text-foreground truncate">
            {insight.name}
            {insight.namespace ? <span className="text-muted-foreground"> in {insight.namespace}</span> : ''}
          </p>
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">
            {insight.message}
          </p>
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-border/30 mt-0 pt-2 ml-10">
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{insight.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="h-7 text-xs bg-[hsl(var(--accent))] hover:bg-[hsl(var(--ring)/0.5)] text-[hsl(var(--primary))]"
              onClick={handleInvestigate}
              asChild
            >
              <Link to={insight.link}>
                <Search className="h-3 w-3 mr-1" aria-hidden />
                Investigate
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function IntelligencePanel() {
  const { insights, isLoading } = useInsights();

  const criticalCount = insights.filter((i) => i.severity === 'critical').length;
  const warningCount = insights.filter((i) => i.severity === 'warning').length;

  return (
    <section
      className={cn(
        'rounded-2xl border border-[hsl(var(--accent)/0.8)] bg-gradient-to-b from-white/80 to-[hsl(var(--accent)/0.08)]',
        'flex flex-col overflow-hidden min-h-[200px] h-full'
      )}
      aria-label="AI Insights"
    >
      <div className="px-4 py-3 border-b border-[hsl(var(--accent)/0.5)]">
        <div className="flex items-center gap-2 mb-1">
          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[hsl(var(--cosmic-purple)/0.1)]">
            <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--cosmic-purple))]" aria-hidden />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Insights</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          What changed, what&apos;s risky, what might break
        </p>
        {!isLoading && insights.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            {criticalCount > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[hsl(var(--error)/0.1)] text-[hsl(var(--error))]">
                {criticalCount} critical
              </span>
            )}
            {warningCount > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning)/0.85)]">
                {warningCount} warning
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto p-2 min-h-0">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--ring))]" aria-hidden />
            <span className="text-xs text-muted-foreground">Analyzing cluster...</span>
          </div>
        ) : insights.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div className="w-12 h-12 rounded-full bg-[hsl(var(--success)/0.08)] flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-[hsl(var(--success))]" aria-hidden />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">All clear</p>
              <p className="text-xs text-muted-foreground mt-0.5">No notable risks. Cluster looks healthy.</p>
            </div>
          </div>
        ) : (
          <ul className="space-y-1.5" role="list">
            {insights.map((insight) => (
              <li key={insight.id}>
                <InsightCard insight={insight} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
