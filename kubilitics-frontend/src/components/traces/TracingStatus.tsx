/**
 * TracingStatus — Small badge that shows trace-agent health.
 * Polls getTracingStatus every 30s. Clicking "Tracing Off" opens the setup wizard.
 */
import { Activity, WifiOff, Radio } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getTracingStatus } from '@/services/api/tracing';

interface TracingStatusProps {
  onSetupClick: () => void;
}

export function TracingStatus({ onSetupClick }: TracingStatusProps) {
  const clusterId = useActiveClusterId();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);

  const { data: status, isError } = useQuery({
    queryKey: ['tracing-status', clusterId],
    queryFn: () => getTracingStatus(baseUrl, clusterId!),
    enabled: !!clusterId && !!baseUrl,
    staleTime: 15_000,
    refetchInterval: 30_000,
    // Don't throw on 404 — tracing may not be deployed yet
    retry: false,
  });

  // No cluster — nothing to show
  if (!clusterId) return null;

  // Tracing not yet enabled (or endpoint 404 / error)
  if (!status || isError || !status.enabled) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        onClick={onSetupClick}
        title="Enable distributed tracing"
      >
        <Radio className="h-3.5 w-3.5" />
        <Badge
          variant="outline"
          className="pointer-events-none h-5 px-1.5 text-[10px] font-medium border-muted-foreground/30 text-muted-foreground"
        >
          Tracing Off
        </Badge>
      </Button>
    );
  }

  // Enabled but agent offline
  if (!status.agent_healthy) {
    return (
      <div className={cn('flex items-center gap-1.5')}>
        <WifiOff className="h-3.5 w-3.5 text-destructive" />
        <Badge
          variant="outline"
          className="h-5 px-1.5 text-[10px] font-medium border-destructive/40 text-destructive"
        >
          Agent Offline
        </Badge>
      </div>
    );
  }

  // Active and healthy
  return (
    <div className="flex items-center gap-1.5">
      <Activity className="h-3.5 w-3.5 text-[hsl(var(--success))]" />
      <Badge
        variant="outline"
        className="h-5 px-1.5 text-[10px] font-medium border-[hsl(var(--success))]/40 text-[hsl(var(--success))]"
        title={`${status.agent_span_count.toLocaleString()} spans collected`}
      >
        Tracing Active
        {status.agent_span_count > 0 && (
          <span className="ml-1 opacity-70">
            · {status.agent_span_count.toLocaleString()}
          </span>
        )}
      </Badge>
    </div>
  );
}
