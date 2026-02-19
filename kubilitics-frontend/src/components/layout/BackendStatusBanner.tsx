/**
 * Banner shown when backend is configured but unreachable (health check fails).
 * P2-17: refetchInterval 15s, retry 0 (circuit handles recovery), skip query when circuit open.
 */
import { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBackendHealth } from '@/hooks/useBackendHealth';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { BackendApiError, isBackendCircuitOpen, resetBackendCircuit } from '@/services/backendApiClient';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/tauri';

export function BackendStatusBanner({ className }: { className?: string }) {
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const [circuitTick, setCircuitTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCircuitTick((t) => t + 1), 2000);
    return () => clearInterval(id);
  }, []);
  const circuitOpen = isBackendCircuitOpen();
  const health = useBackendHealth({
    enabled: isConfigured() && !circuitOpen,
    refetchInterval: 15_000,
    retry: 0,
  });

  if (!isConfigured()) return null;
  if (!health.error) return null;

  const requestId = health.error instanceof BackendApiError ? health.error.requestId : undefined;
  const desktop = isTauri();
  const headline = desktop ? 'Connection issue' : 'Backend unreachable';
  const detail = desktop ? 'Data below may be cached. Use Retry when the connection is back.' : (health.error instanceof Error ? health.error.message : 'Load failed') + ' (data below may be cached and outdated).';

  return (
    <div
      className={cn(
        'flex flex-col gap-1 px-4 py-3 rounded-lg border border-destructive/50 bg-destructive/10 text-destructive',
        className
      )}
      role="alert"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium truncate">
            {headline}: {detail}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              resetBackendCircuit();
              health.refetch();
            }}
            disabled={health.isFetching}
            className="gap-1"
          >
            <RefreshCw className={cn('h-4 w-4', health.isFetching && 'animate-spin')} />
            Retry
          </Button>
          {!desktop && (
            <Button size="sm" variant="outline" asChild className="gap-1">
              <Link to="/settings">
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </Button>
          )}
        </div>
      </div>
      {requestId && (
        <p className="text-xs text-muted-foreground pl-7">
          Request ID: <code className="bg-muted px-1 rounded">{requestId}</code> (for support)
        </p>
      )}
    </div>
  );
}
