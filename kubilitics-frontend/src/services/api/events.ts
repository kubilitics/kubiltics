/**
 * Events endpoints (getEvents, getResourceEvents).
 *
 * After onboarding-v2 Phase 4, the backend serves the resilient envelope
 *   {data: <legacyShape>, reachable, stale, error_message, stale_as_of, health_status}
 * where <legacyShape> is either a bare []BackendEvent (pod-scoped or
 * all-namespaces branches) or {items: [...], metadata: {...}} (single-namespace
 * paginated branch). Both clients below unwrap `.data` and collapse the
 * two legacy shapes into the same `[]BackendEvent` the page consumer expects.
 */
import { backendRequest } from './client';
import type { BackendEvent } from './types';

type EventsPayload = BackendEvent[] | { items: BackendEvent[]; metadata?: unknown };
type EventsResponse = EventsPayload | { data?: EventsPayload; reachable?: boolean };

function unwrapEvents(res: EventsResponse): BackendEvent[] {
  // Envelope path: {data: <legacyShape>, reachable, ...}.
  if (res && typeof res === 'object' && !Array.isArray(res) && 'data' in res) {
    const payload = (res as { data?: EventsPayload }).data;
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === 'object' && 'items' in payload) {
      return (payload as { items: BackendEvent[] }).items || [];
    }
    return [];
  }
  // Pre-envelope flat path (back-compat for older backends).
  if (Array.isArray(res)) return res;
  if (res && typeof res === 'object' && 'items' in res) {
    return (res as { items: BackendEvent[] }).items || [];
  }
  return [];
}

/**
 * GET /api/v1/clusters/{clusterId}/events — list events (namespace, limit).
 * Optional: involvedObjectKind + involvedObjectName for pod-scoped events.
 */
export async function getEvents(
  baseUrl: string,
  clusterId: string,
  params?: { namespace?: string; limit?: number }
): Promise<BackendEvent[]> {
  const search = new URLSearchParams();
  if (params?.namespace) search.set('namespace', params.namespace);
  if (params?.limit != null) search.set('limit', String(params.limit));
  const query = search.toString();
  const path = `clusters/${encodeURIComponent(clusterId)}/events${query ? `?${query}` : ''}`;
  const res = await backendRequest<EventsResponse>(baseUrl, path);
  return unwrapEvents(res);
}

/**
 * GET /api/v1/clusters/{clusterId}/events — resource-scoped events (e.g. pod).
 * Query: namespace, involvedObjectKind, involvedObjectName, limit (default 20).
 */
export async function getResourceEvents(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  kind: string,
  name: string,
  limit = 20
): Promise<BackendEvent[]> {
  const search = new URLSearchParams();
  search.set('namespace', namespace);
  search.set('involvedObjectKind', kind);
  search.set('involvedObjectName', name);
  search.set('limit', String(limit));
  const path = `clusters/${encodeURIComponent(clusterId)}/events?${search.toString()}`;
  const res = await backendRequest<EventsResponse>(baseUrl, path);
  return unwrapEvents(res);
}
