/**
 * Events endpoints (getEvents, getResourceEvents).
 */
import { backendRequest } from './client';
import type { BackendEvent } from './types';

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
  // Backend might return { items: [...] } or just [...]
  const res = await backendRequest<BackendEvent[] | { items: BackendEvent[] }>(baseUrl, path);
  if (Array.isArray(res)) return res;
  return (res as { items: BackendEvent[] }).items || [];
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
  const res = await backendRequest<BackendEvent[] | { items: BackendEvent[] }>(baseUrl, path);
  if (Array.isArray(res)) return res;
  return (res as { items: BackendEvent[] }).items || [];
}
