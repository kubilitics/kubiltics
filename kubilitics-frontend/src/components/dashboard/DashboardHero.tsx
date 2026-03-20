/**
 * Dashboard Hero — Cluster Health Index (0-100), animated radial gauge,
 * status label, AI-generated insight summary. The emotional anchor.
 */
import { motion } from 'framer-motion';
import { Shield, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useHealthScore, type HealthScore } from '@/hooks/useHealthScore';
import { useLiveSignals } from '@/hooks/useLiveSignals';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<HealthScore['status'], string> = {
  excellent: 'Excellent',
  good: 'Healthy',
  fair: 'Fair',
  poor: 'At Risk',
  critical: 'Critical',
};

const STATUS_CONFIG: Record<
  HealthScore['status'],
  { gradient: string; text: string; bg: string; icon: typeof TrendingUp }
> = {
  excellent: {
    gradient: 'url(#gauge-success)',
    text: 'text-[hsl(var(--success))]',
    bg: 'bg-[hsl(var(--success)/0.08)]',
    icon: TrendingUp,
  },
  good: {
    gradient: 'url(#gauge-success)',
    text: 'text-[hsl(var(--success))]',
    bg: 'bg-[hsl(var(--success)/0.08)]',
    icon: TrendingUp,
  },
  fair: {
    gradient: 'url(#gauge-warning)',
    text: 'text-[hsl(var(--warning)/0.85)]',
    bg: 'bg-[hsl(var(--warning)/0.08)]',
    icon: Minus,
  },
  poor: {
    gradient: 'url(#gauge-warning)',
    text: 'text-[hsl(var(--warning)/0.85)]',
    bg: 'bg-[hsl(var(--warning)/0.08)]',
    icon: TrendingDown,
  },
  critical: {
    gradient: 'url(#gauge-error)',
    text: 'text-[hsl(var(--error))]',
    bg: 'bg-[hsl(var(--error)/0.08)]',
    icon: TrendingDown,
  },
};

const RADIUS = 56;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SVG_SIZE = (RADIUS + 14) * 2;

export function DashboardHero() {
  const health = useHealthScore();
  const signals = useLiveSignals();
  const strokeDash = (health.score / 100) * CIRCUMFERENCE;
  const config = STATUS_CONFIG[health.status];
  const StatusIcon = config.icon;

  const quickStats = [
    { label: 'Pods', value: signals.runningPods + signals.failedPods + signals.pendingPods },
    { label: 'Nodes', value: signals.totalNodes },
    { label: 'Alerts', value: signals.activeAlerts },
    { label: 'Restarts', value: signals.podRestarts },
  ];

  return (
    <section
      className={cn(
        'relative w-full overflow-hidden',
        'rounded-2xl border border-[hsl(var(--accent)/0.8)]',
        'bg-gradient-to-br from-white via-[hsl(var(--accent)/0.15)] to-white'
      )}
      aria-label="Cluster health overview"
    >
      {/* Subtle background pattern */}
      <div className="absolute inset-0 opacity-[0.03]" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, hsl(var(--primary)) 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />
      </div>

      <div className="relative flex flex-col md:flex-row items-center gap-6 md:gap-10 py-6 md:py-8 px-6 md:px-10">
        {/* Left: Radial gauge */}
        <div className="flex shrink-0">
          <div className="relative">
            <svg
              className="w-36 h-36 md:w-40 md:h-40 -rotate-90"
              viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
              aria-hidden
            >
              <defs>
                <linearGradient id="gauge-success" gradientTransform="rotate(90)">
                  <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.8} />
                  <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={1} />
                </linearGradient>
                <linearGradient id="gauge-warning" gradientTransform="rotate(90)">
                  <stop offset="0%" stopColor="hsl(var(--warning))" stopOpacity={0.8} />
                  <stop offset="100%" stopColor="hsl(var(--warning))" stopOpacity={1} />
                </linearGradient>
                <linearGradient id="gauge-error" gradientTransform="rotate(90)">
                  <stop offset="0%" stopColor="hsl(var(--error))" stopOpacity={0.8} />
                  <stop offset="100%" stopColor="hsl(var(--error))" stopOpacity={1} />
                </linearGradient>
                <linearGradient id="gauge-track">
                  <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
                </linearGradient>
              </defs>
              {/* Track */}
              <circle
                cx={RADIUS + 14}
                cy={RADIUS + 14}
                r={RADIUS}
                fill="none"
                stroke="url(#gauge-track)"
                strokeWidth={7}
              />
              {/* Progress */}
              <motion.circle
                cx={RADIUS + 14}
                cy={RADIUS + 14}
                r={RADIUS}
                fill="none"
                strokeWidth={7}
                style={{ stroke: config.gradient }}
                strokeLinecap="round"
                strokeDasharray={`${strokeDash} ${CIRCUMFERENCE}`}
                initial={{ strokeDasharray: `0 ${CIRCUMFERENCE}` }}
                animate={{ strokeDasharray: `${strokeDash} ${CIRCUMFERENCE}` }}
                transition={{ duration: 1, ease: 'easeOut' }}
              />
            </svg>
            {/* Center label */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <motion.span
                className="text-4xl md:text-5xl font-extrabold tracking-tight text-foreground tabular-nums"
                key={health.score}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
              >
                {health.score}
              </motion.span>
              <span className="text-xs font-medium text-muted-foreground mt-0.5">/100</span>
            </div>
          </div>
        </div>

        {/* Center: Status + insight */}
        <div className="flex-1 text-center md:text-left min-w-0">
          <motion.div
            className="flex items-center gap-2 justify-center md:justify-start mb-2"
            key={health.status}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold',
                config.bg,
                config.text
              )}
            >
              <StatusIcon className="h-3.5 w-3.5" aria-hidden />
              {STATUS_LABELS[health.status]}
            </div>
            <span className="text-xs text-muted-foreground font-medium">
              Grade {health.grade}
            </span>
          </motion.div>

          <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">
            {health.insight}
          </p>

          {/* Quick stats row */}
          <div className="flex items-center gap-4 mt-4 flex-wrap justify-center md:justify-start">
            {quickStats.map((stat) => (
              <div key={stat.label} className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{stat.label}</span>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {signals.isLoading ? '\u2014' : stat.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Shield icon */}
        <div className="hidden md:flex items-center justify-center shrink-0">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[hsl(var(--accent))] to-[hsl(var(--accent)/0.3)] flex items-center justify-center">
            <Shield className="h-8 w-8 text-[hsl(var(--primary)/0.5)]" aria-hidden />
          </div>
        </div>
      </div>
    </section>
  );
}
