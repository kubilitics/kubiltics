/**
 * ClusterUnreachableBoundary — honest-degradation wrapper.
 *
 * When the backing data hook reports `isReachable=false`, this component
 * renders a non-intrusive banner above its children (the cached/last-known
 * body stays visible at reduced opacity). Retry and Switch-cluster actions
 * are passed in by the caller; this component is purely presentational.
 *
 * Consumers: any page/region whose data originates from a cluster-scoped
 * resilient endpoint. Replaces the ad-hoc `ClusterReachabilityBanner`
 * introduced in 10848cf with a reusable primitive.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  isReachable: boolean;
  isStale: boolean;
  errorMessage: string | null;
  onSwitchCluster: () => void;
  onRetry: () => void;
  children: ReactNode;
}

export function ClusterUnreachableBoundary({
  isReachable,
  isStale,
  errorMessage,
  onSwitchCluster,
  onRetry,
  children,
}: Props) {
  if (isReachable) {
    return <>{children}</>;
  }
  return (
    <div>
      <div
        role="alert"
        className="mb-3 flex items-start gap-3 rounded-md border border-amber-400/40 bg-amber-500/10 p-3 text-sm"
      >
        <svg
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
        <div className="flex-1">
          <div className="font-medium">
            Cluster unreachable{errorMessage ? ` — ${errorMessage}` : ''}
          </div>
          <div className="mt-0.5 text-xs opacity-80">
            Showing last-known data.{' '}
            <button type="button" className="underline" onClick={onRetry}>
              Retry
            </button>
            {' · '}
            <button type="button" className="underline" onClick={onSwitchCluster}>
              Switch cluster
            </button>
          </div>
        </div>
      </div>
      <div className={cn('relative', isStale && 'opacity-75')}>{children}</div>
    </div>
  );
}
