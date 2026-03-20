/**
 * Health Pulse Strip — Gateway vital signs: clusters, nodes, running pods,
 * failed pods, pending pods, restarts, active alerts, health score (0-100).
 * Blue/white themed cards with semantic status highlights.
 */
import { motion } from 'framer-motion';
import {
  Server,
  Box,
  XCircle,
  AlertTriangle,
  Activity,
  LayoutDashboard,
  RotateCcw,
  Clock,
} from 'lucide-react';
import { useLiveSignals } from '@/hooks/useLiveSignals';
import { useHealthScore } from '@/hooks/useHealthScore';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

interface PulseMetric {
  key: keyof ReturnType<typeof useLiveSignals>;
  label: string;
  icon: typeof Server;
  link: string;
  semantic?: 'error' | 'warning' | 'success';
}

const PULSE_ITEMS: PulseMetric[] = [
  { key: 'totalClusters', label: 'Clusters', icon: LayoutDashboard, link: '/dashboard' },
  { key: 'totalNodes', label: 'Nodes', icon: Server, link: '/nodes' },
  { key: 'runningPods', label: 'Running', icon: Box, link: '/pods', semantic: 'success' },
  { key: 'failedPods', label: 'Failed', icon: XCircle, link: '/pods', semantic: 'error' },
  { key: 'pendingPods', label: 'Pending', icon: Clock, link: '/pods', semantic: 'warning' },
  { key: 'podRestarts', label: 'Restarts', icon: RotateCcw, link: '/pods', semantic: 'warning' },
  { key: 'activeAlerts', label: 'Alerts', icon: AlertTriangle, link: '/events', semantic: 'warning' },
];

function MetricChip({
  label,
  value,
  icon: Icon,
  link,
  semantic,
  isLoading,
}: {
  label: string;
  value: number;
  icon: typeof Server;
  link: string;
  semantic?: 'error' | 'warning' | 'success';
  isLoading: boolean;
}) {
  const isError = semantic === 'error' && value > 0;
  const isWarning = semantic === 'warning' && value > 0;
  const isSuccess = semantic === 'success' && value > 0;

  return (
    <Link
      to={link}
      className={cn(
        'group flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl shrink-0 relative z-10',
        'transition-all duration-200 hover:shadow-md cursor-pointer',
        'border bg-white/60 backdrop-blur-sm',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isError && 'border-[hsl(var(--error)/0.3)] bg-[hsl(var(--error)/0.04)] hover:bg-[hsl(var(--error)/0.08)]',
        isWarning && 'border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.04)] hover:bg-[hsl(var(--warning)/0.08)]',
        isSuccess && 'border-[hsl(var(--success)/0.15)] hover:bg-[hsl(var(--success)/0.04)]',
        !isError && !isWarning && !isSuccess && 'border-border/40 hover:bg-[hsl(var(--accent)/0.5)] hover:border-[hsl(var(--ring)/0.4)]'
      )}
      aria-label={`${label}: ${value}`}
    >
      <div
        className={cn(
          'flex items-center justify-center w-8 h-8 rounded-lg transition-colors',
          isError && 'bg-[hsl(var(--error)/0.12)]',
          isWarning && 'bg-[hsl(var(--warning)/0.12)]',
          isSuccess && 'bg-[hsl(var(--success)/0.1)]',
          !isError && !isWarning && !isSuccess && 'bg-[hsl(var(--accent))]'
        )}
      >
        <Icon
          className={cn(
            'h-4 w-4 transition-colors',
            isError && 'text-[hsl(var(--error))]',
            isWarning && 'text-[hsl(var(--warning)/0.85)]',
            isSuccess && 'text-[hsl(var(--success))]',
            !isError && !isWarning && !isSuccess && 'text-[hsl(var(--primary))]'
          )}
          aria-hidden
        />
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground leading-none mb-0.5">
          {label}
        </span>
        <motion.span
          key={`${label}-${value}`}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className={cn(
            'text-lg font-bold tabular-nums leading-none',
            isError && 'text-[hsl(var(--error))]',
            isWarning && value > 0 && 'text-[hsl(var(--warning)/0.85)]',
            isSuccess && 'text-[hsl(var(--success))]',
            !isError && !isWarning && !isSuccess && 'text-foreground'
          )}
        >
          {isLoading ? '\u2014' : value}
        </motion.span>
      </div>
    </Link>
  );
}

export function LiveSignalStrip() {
  const signals = useLiveSignals();
  const health = useHealthScore();

  const healthSemantic =
    health.status === 'excellent' || health.status === 'good'
      ? 'success'
      : health.status === 'fair' || health.status === 'poor'
        ? 'warning'
        : 'error';

  return (
    <div
      className={cn(
        'w-full flex items-center gap-2 py-3 px-3 rounded-2xl',
        'border border-[hsl(var(--accent))] bg-gradient-to-r from-[hsl(var(--accent)/0.3)] via-white/80 to-[hsl(var(--accent)/0.3)]',
        'overflow-x-auto scrollbar-thin'
      )}
      role="status"
      aria-label="Health pulse: cluster vital signs"
      aria-live="polite"
    >
      {PULSE_ITEMS.map(({ key, label, icon, link, semantic }) => (
        <MetricChip
          key={key}
          label={label}
          value={signals[key] as number}
          icon={icon}
          link={link}
          semantic={semantic}
          isLoading={signals.isLoading}
        />
      ))}

      {/* Health score — separated */}
      <div className="shrink-0 ml-1 pl-2 border-l-2 border-[hsl(var(--border)/0.5)]">
        <Link
          to="/dashboard"
          className={cn(
            'flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 cursor-pointer relative z-10',
            'border bg-white/60 backdrop-blur-sm hover:shadow-md',
            healthSemantic === 'success' && 'border-[hsl(var(--success)/0.2)] hover:bg-[hsl(var(--success)/0.04)]',
            healthSemantic === 'warning' && 'border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.04)]',
            healthSemantic === 'error' && 'border-[hsl(var(--error)/0.3)] bg-[hsl(var(--error)/0.04)]'
          )}
          aria-label={`Health score ${health.score} out of 100`}
        >
          <div
            className={cn(
              'flex items-center justify-center w-8 h-8 rounded-lg',
              healthSemantic === 'success' && 'bg-[hsl(var(--success)/0.1)]',
              healthSemantic === 'warning' && 'bg-[hsl(var(--warning)/0.12)]',
              healthSemantic === 'error' && 'bg-[hsl(var(--error)/0.12)]'
            )}
          >
            <Activity
              className={cn(
                'h-4 w-4',
                healthSemantic === 'success' && 'text-[hsl(var(--success))]',
                healthSemantic === 'warning' && 'text-[hsl(var(--warning)/0.85)]',
                healthSemantic === 'error' && 'text-[hsl(var(--error))]'
              )}
              aria-hidden
            />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground leading-none mb-0.5">
              Health
            </span>
            <div className="flex items-baseline gap-0.5">
              <motion.span
                key={`health-${health.score}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  'text-lg font-bold tabular-nums leading-none',
                  healthSemantic === 'success' && 'text-[hsl(var(--success))]',
                  healthSemantic === 'warning' && 'text-[hsl(var(--warning)/0.85)]',
                  healthSemantic === 'error' && 'text-[hsl(var(--error))]'
                )}
              >
                {signals.isLoading ? '\u2014' : health.score}
              </motion.span>
              <span className="text-[10px] text-muted-foreground font-medium">/100</span>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
