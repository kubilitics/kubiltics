/**
 * React Query hooks for OpenTelemetry Traces endpoints.
 * Pattern: matches useEventsIntelligence.ts
 */
import { useQuery } from '@tanstack/react-query';
import { useActiveClusterId } from './useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import {
  listTraces,
  getTrace,
  getServiceMap,
  getResourceTraces,
  getLinkedTraces,
} from '@/services/api/traces';
import type {
  TraceSummary,
  TraceDetail,
  ServiceMap,
  TraceQueryParams,
} from '@/services/api/traces';

function useBackendContext() {
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const enabled = !!clusterId && isBackendConfigured;
  return { clusterId, effectiveBaseUrl, enabled };
}

/** Fetch traces with query parameters. */
export function useTraces(params: TraceQueryParams) {
  const { clusterId, effectiveBaseUrl, enabled } = useBackendContext();

  return useQuery<TraceSummary[], Error>({
    queryKey: ['traces', 'list', clusterId, params],
    queryFn: () => listTraces(effectiveBaseUrl, clusterId!, params),
    enabled,
    staleTime: 15_000,
    retry: 1,
    retryDelay: 1_000,
  });
}

/** Fetch a single trace with all spans. */
export function useTrace(traceId: string | null) {
  const { clusterId, effectiveBaseUrl, enabled } = useBackendContext();

  return useQuery<TraceDetail, Error>({
    queryKey: ['traces', 'detail', clusterId, traceId],
    queryFn: () => getTrace(effectiveBaseUrl, clusterId!, traceId!),
    enabled: enabled && !!traceId,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Fetch traces for a specific K8s resource (pod, deployment, service). */
export function useResourceTraces(
  kind: string,
  name: string,
  namespace: string,
  options?: { from?: number; to?: number; limit?: number },
) {
  const { clusterId, effectiveBaseUrl, enabled } = useBackendContext();

  return useQuery<TraceSummary[], Error>({
    queryKey: ['traces', 'resource', clusterId, kind, name, namespace, options?.from, options?.to, options?.limit],
    queryFn: () =>
      getResourceTraces(effectiveBaseUrl, clusterId!, {
        kind,
        name,
        namespace: namespace || undefined,
        ...options,
      }),
    enabled: enabled && !!kind && !!name,
    staleTime: 15_000,
    retry: 1,
    retryDelay: 1_000,
  });
}

/** Fetch traces linked to a specific event. */
export function useLinkedTraces(eventId: string | null) {
  const { clusterId, effectiveBaseUrl, enabled } = useBackendContext();

  return useQuery<TraceSummary[], Error>({
    queryKey: ['traces', 'linked-event', clusterId, eventId],
    queryFn: () => getLinkedTraces(effectiveBaseUrl, clusterId!, eventId!),
    enabled: enabled && !!eventId,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Fetch service dependency map. */
export function useServiceMap(from?: number, to?: number) {
  const { clusterId, effectiveBaseUrl, enabled } = useBackendContext();

  return useQuery<ServiceMap, Error>({
    queryKey: ['traces', 'service-map', clusterId, from, to],
    queryFn: () => getServiceMap(effectiveBaseUrl, clusterId!, from, to),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
}
