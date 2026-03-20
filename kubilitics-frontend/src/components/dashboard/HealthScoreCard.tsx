import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { useHealthScore } from '@/hooks/useHealthScore';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';

const statusConfig = {
  excellent: {
    color: 'text-[hsl(var(--success))]',
    badgeBg: 'bg-[hsl(var(--success)/0.12)]',
    borderAccent: 'border-l-[hsl(var(--success))]',
    ringToken: '--success',
    icon: CheckCircle2,
  },
  good: {
    color: 'text-[hsl(var(--success))]',
    badgeBg: 'bg-[hsl(var(--success)/0.12)]',
    borderAccent: 'border-l-[hsl(var(--success))]',
    ringToken: '--success',
    icon: CheckCircle2,
  },
  fair: {
    color: 'text-[hsl(var(--warning))]',
    badgeBg: 'bg-[hsl(var(--warning)/0.12)]',
    borderAccent: 'border-l-[hsl(var(--warning))]',
    ringToken: '--warning',
    icon: AlertTriangle,
  },
  poor: {
    color: 'text-[hsl(var(--warning))]',
    badgeBg: 'bg-[hsl(var(--warning)/0.12)]',
    borderAccent: 'border-l-[hsl(var(--warning))]',
    ringToken: '--warning',
    icon: AlertTriangle,
  },
  critical: {
    color: 'text-[hsl(var(--error))]',
    badgeBg: 'bg-[hsl(var(--error)/0.12)]',
    borderAccent: 'border-l-[hsl(var(--error))]',
    ringToken: '--error',
    icon: AlertTriangle,
  },
};

const breakdownBarColors = {
  podHealth: 'bg-[hsl(var(--ring))]',
  nodeHealth: 'bg-[hsl(var(--ring))]',
  stability: 'bg-[hsl(var(--ring))]',
  eventHealth: 'bg-[hsl(var(--primary))]',
};

function BreakdownItem({
  label,
  value,
  indicatorClassName,
}: {
  label: string;
  value: number;
  indicatorClassName: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xs font-semibold tabular-nums text-foreground">{value}%</span>
      </div>
      <Progress value={value} className="h-2 rounded-full" indicatorClassName={cn('rounded-full', indicatorClassName)} />
    </div>
  );
}

export function HealthScoreCard() {
  const healthScore = useHealthScore();
  const config = statusConfig[healthScore.status];
  const StatusIcon = config.icon;

  const circumference = 2 * Math.PI * 45;
  const strokeDasharray = `${(healthScore.score / 100) * circumference} ${circumference}`;
  const ringColorCss = `hsl(var(${config.ringToken}))`;

  return (
    <section
      className={cn(
        'dashboard-panel overflow-hidden border-l-4',
        'rounded-2xl border border-[hsl(var(--accent)/0.8)]',
        'bg-gradient-to-b from-white/80 to-[hsl(var(--accent)/0.08)]',
        config.borderAccent
      )}
      aria-label="Cluster health score"
    >
      <div className="px-6 pt-5 pb-3 flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
          Cluster Health Score
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                  <Info className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs" side="top">
                <p className="text-xs">
                  Aggregated from pod health (40%), node status (30%), stability (20%), and events (10%).
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </h2>
        <span
          className={cn(
            'capitalize gap-1.5 font-medium px-2.5 py-0.5 rounded-full text-xs flex items-center',
            config.badgeBg,
            config.color
          )}
        >
          <StatusIcon className="h-3.5 w-3.5" />
          {healthScore.status}
        </span>
      </div>
      <div className="px-6 pb-6 pt-0">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Score ring — animated */}
          <div className="flex items-center justify-center py-2">
            <div className="relative">
              <svg className="w-36 h-36 -rotate-90" aria-hidden>
                <defs>
                  <linearGradient id="health-gradient" gradientTransform="rotate(90)">
                    <stop offset="0%" stopColor={ringColorCss} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={ringColorCss} stopOpacity={1} />
                  </linearGradient>
                </defs>
                <circle
                  cx="72"
                  cy="72"
                  r="50"
                  className="fill-none stroke-[6]"
                  style={{ stroke: 'hsl(var(--accent))' }}
                />
                <motion.circle
                  cx="72"
                  cy="72"
                  r="50"
                  className="fill-none stroke-[6]"
                  style={{ stroke: 'url(#health-gradient)' }}
                  strokeLinecap="round"
                  strokeDasharray={strokeDasharray}
                  initial={{ strokeDasharray: `0 ${2 * Math.PI * 50}` }}
                  animate={{ strokeDasharray }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <motion.span
                  className="text-4xl font-bold tracking-tight text-foreground tabular-nums"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  {healthScore.score}
                </motion.span>
                <span className="text-sm text-muted-foreground mt-0.5">out of 100</span>
              </div>
            </div>
          </div>

          {/* Score breakdown */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Score breakdown
            </h4>
            <div className="grid gap-4">
              <BreakdownItem label="Pod health" value={healthScore.breakdown.podHealth} indicatorClassName={breakdownBarColors.podHealth} />
              <BreakdownItem label="Node health" value={healthScore.breakdown.nodeHealth} indicatorClassName={breakdownBarColors.nodeHealth} />
              <BreakdownItem label="Stability" value={healthScore.breakdown.stability} indicatorClassName={breakdownBarColors.stability} />
              <BreakdownItem label="Event health" value={healthScore.breakdown.eventHealth} indicatorClassName={breakdownBarColors.eventHealth} />
            </div>
          </div>
        </div>

        {healthScore.details.length > 0 && (
          <div className="mt-6 pt-5 border-t border-[hsl(var(--accent)/0.6)]">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Insights
            </h4>
            <ul className="space-y-2">
              {healthScore.details.map((detail, i) => (
                <li key={i} className="text-sm flex items-start gap-2.5 text-muted-foreground">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[hsl(var(--ring)/0.5)] shrink-0" />
                  <span>{detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
