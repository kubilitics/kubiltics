/**
 * PipelineHealthIndicator — a small colored dot with a tooltip showing the
 * health of the Events Intelligence pipeline system. Designed to sit in the
 * global header bar.
 *
 * - Green dot: all pipelines healthy
 * - Amber dot: some degraded
 * - Red dot: all down
 * - Gray dot: loading / no data
 */
import { useSystemHealth } from '@/hooks/useEventsIntelligence';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDBSize(mb: number): string {
  if (mb < 1) return `${Math.round(mb * 1024)}KB`;
  return `${mb.toFixed(1)}MB`;
}

export function PipelineHealthIndicator() {
  const { data: health, isLoading, isError } = useSystemHealth();

  // Don't render anything if we can't reach the endpoint at all
  if (isLoading || isError || !health) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="block w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0 cursor-default"
            aria-label="Events pipeline status unknown"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8}>
          <p className="text-xs font-medium">Events pipeline: checking...</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  const dotColor =
    health.status === 'healthy'
      ? 'bg-emerald-500'
      : health.status === 'degraded'
        ? 'bg-amber-500'
        : 'bg-red-500';

  const pulseColor =
    health.status === 'healthy'
      ? 'bg-emerald-400'
      : health.status === 'degraded'
        ? 'bg-amber-400'
        : 'bg-red-400';

  const healthyCount = health.pipelines.filter((p) => p.status === 'healthy').length;
  const degradedCount = health.pipelines.filter((p) => p.status === 'degraded').length;
  const downCount = health.pipelines.filter((p) => p.status === 'down').length;
  const totalPipelines = health.pipelines.length;

  const eventsLast5Min = health.pipelines.reduce((sum, p) => sum + p.events_last_5min, 0);

  // Build status summary line
  const parts: string[] = [];
  if (healthyCount > 0) parts.push(`${healthyCount} healthy`);
  if (degradedCount > 0) parts.push(`${degradedCount} degraded`);
  if (downCount > 0) parts.push(`${downCount} down`);
  const pipelineSummary = totalPipelines > 0
    ? `${totalPipelines} cluster${totalPipelines !== 1 ? 's' : ''}: ${parts.join(', ')}`
    : 'No pipelines running';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="relative flex items-center justify-center w-4 h-4 shrink-0 cursor-default"
          aria-label={`Events pipeline: ${health.status}`}
        >
          {/* Pulse ring for healthy/degraded */}
          {health.status !== 'down' && (
            <span className={cn('absolute inset-0 rounded-full animate-ping opacity-30', pulseColor)} />
          )}
          <span className={cn('relative block w-2 h-2 rounded-full', dotColor)} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8} className="max-w-xs z-[100]">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">
            Events Pipeline: <span className="capitalize">{health.status}</span>
          </p>
          <p className="text-[11px] text-muted-foreground">{pipelineSummary}</p>
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            <p>{eventsLast5Min.toLocaleString()} events/5min</p>
            <p>DB: {formatDBSize(health.db_size_mb)} &middot; {health.total_events.toLocaleString()} total events</p>
            <p>Uptime: {formatUptime(health.uptime_seconds)}</p>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
