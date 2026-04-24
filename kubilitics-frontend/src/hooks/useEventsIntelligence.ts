/**
 * React Query hooks for Events Intelligence endpoints.
 * Pattern: matches useClusterHealth.ts
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import {
  queryEvents,
  getEventStats,
  getEvent,
  getCausalChain,
  analyzeEvents,
  getRecentChanges,
  getIncidents,
  getIncident,
  getIncidentEvents,
  getActiveInsights,
  dismissInsight,
  getSystemHealth,
} from '@/services/api/eventsIntelligence';
import type {
  WideEvent,
  EventStats,
  EventContext,
  CausalChain,
  AnalyzeResult,
  Change,
  Incident,
  Insight,
  EventQueryParams,
  AnalyzeQuery,
  SystemHealth,
} from '@/services/api/eventsIntelligence';

function useBackendContext() {
  // P0-D: Use currentClusterId exclusively. activeCluster.id may hold a stale or
  // different ID that doesn't match the events pipeline's cluster ID.
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  const enabled = !!clusterId && isBackendConfigured;
  return { clusterId, effectiveBaseUrl, enabled };
}

/** Fetch events with query parameters. */
export function useEventsQuery(params: EventQueryParams) {
  const { clusterId, effectiveBaseUrl, enabled } = useBackendContext();

  return useQuery<WideEvent[], Error>({
    queryKey: ['events-intelligence', 'query', clusterId, params],
    queryFn: () => queryEvents(effectiveBaseUrl, clusterId!, params),
    enabled,
    staleTime: 15_000,
    retry: 2,
    retryDelay: 1_000,
  });
}

/** Fetch aggregate event statistics. */
export function useEventStats() {
  const { clusterId, effectiveBaseUrl, enabled } = useBackendContext();

  return useQuery<EventStats, Error>({
    queryKey: ['events-intelligence', 'stats', clusterId],
    queryFn: () => getEventStats(effectiveBaseUrl, clusterId!),
    enabled,
    staleTime: 30_000,
    retry: 1,
    retryDelay: 1_000,
  });
}

/** Fetch a single event with full context. */
export function useEvent(eventId: string | null) {
  const { clusterId, effectiveBaseUrl, enabled } = useBackendContext();

  return useQuery<EventContext, Error>({
    queryKey: ['events-intelligence', 'event', clusterId, eventId],
    queryFn: () => getEvent(effectiveBaseUrl, clusterId!, eventId!),
    enabled: enabled && !!eventId,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Fetch the causal chain for an event. */
export function useCausalChain(eventId: string | null) {
  const { clusterId, effectiveBaseUrl, enabled } = useBackendContext();

  return useQuery<CausalChain, Error>({
    queryKey: ['events-intelligence', 'chain', clusterId, eventId],
    queryFn: () => getCausalChain(effectiveBaseUrl, clusterId!, eventId!),
    enabled: enabled && !!eventId,
    staleTime: 60_000,
    retry: 1,
  });
}

/** Run an analyze query. Only fires when query is non-null. */
export function useAnalyze(query: AnalyzeQuery | null) {
  const { clusterId, effectiveBaseUrl, enabled } = useBackendContext();

  return useQuery<AnalyzeResult[], Error>({
    queryKey: ['events-intelligence', 'analyze', clusterId, query],
    queryFn: () => analyzeEvents(effectiveBaseUrl, clusterId!, query!),
    enabled: enabled && query !== null,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Fetch recent resource changes. */
export function useRecentChanges(limit?: number) {
  const { clusterId, effectiveBaseUrl, enabled } = useBackendContext();

  return useQuery<Change[], Error>({
    queryKey: ['events-intelligence', 'changes', clusterId, limit],
    queryFn: () => getRecentChanges(effectiveBaseUrl, clusterId!, limit),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Fetch incidents. */
export function useIncidents() {
  const { clusterId, effectiveBaseUrl, enabled } = useBackendContext();

  return useQuery<Incident[], Error>({
    queryKey: ['events-intelligence', 'incidents', clusterId],
    queryFn: () => getIncidents(effectiveBaseUrl, clusterId!),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Fetch a single incident. */
export function useIncident(id: string | null) {
  const { clusterId, effectiveBaseUrl, enabled } = useBackendContext();

  return useQuery<Incident, Error>({
    queryKey: ['events-intelligence', 'incident', clusterId, id],
    queryFn: () => getIncident(effectiveBaseUrl, clusterId!, id!),
    enabled: enabled && !!id,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Fetch events linked to an incident. */
export function useIncidentEvents(id: string | null) {
  const { clusterId, effectiveBaseUrl, enabled } = useBackendContext();

  return useQuery<WideEvent[], Error>({
    queryKey: ['events-intelligence', 'incident-events', clusterId, id],
    queryFn: () => getIncidentEvents(effectiveBaseUrl, clusterId!, id!),
    enabled: enabled && !!id,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Fetch active insights. */
export function useActiveInsights() {
  const { clusterId, effectiveBaseUrl, enabled } = useBackendContext();

  return useQuery<Insight[], Error>({
    queryKey: ['events-intelligence', 'insights', clusterId],
    queryFn: () => getActiveInsights(effectiveBaseUrl, clusterId!),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Dismiss an insight (mutation). */
export function useDismissInsight() {
  const { clusterId, effectiveBaseUrl } = useBackendContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (insightId: string) =>
      dismissInsight(effectiveBaseUrl, clusterId!, insightId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['events-intelligence', 'insights', clusterId],
      });
    },
  });
}

/** Fetch system-wide Events Intelligence pipeline health. Polls every 30s. */
export function useSystemHealth() {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  return useQuery<SystemHealth, Error>({
    queryKey: ['events-intelligence', 'system-health'],
    queryFn: () => getSystemHealth(effectiveBaseUrl),
    enabled: isBackendConfigured,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: 1,
    retryDelay: 5_000,
  });
}
