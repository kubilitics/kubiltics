/**
 * Kubilitics backend API client.
 * Base URL + /api/v1/clusters and /api/v1/clusters/{clusterId}/...
 * Per TASKS A3.1: client for Kubilitics backend; used by topology and cluster list.
 */
import type { TopologyGraph } from '@/topology-engine';
import { adaptTopologyGraph, validateTopologyGraph } from '@/topology-engine';
import { useAuthStore } from '@/stores/authStore';
import { isTauri } from '@/lib/tauri';

const API_PREFIX = '/api/v1';

/** P1-3: Cooldown shorter in Tauri (local backend) so Retry is useful sooner. */
const BACKEND_DOWN_COOLDOWN_MS_BROWSER = 60_000;
const BACKEND_DOWN_COOLDOWN_MS_TAURI = 15_000;

function getBackendDownCooldownMs(): number {
  return isTauri() ? BACKEND_DOWN_COOLDOWN_MS_TAURI : BACKEND_DOWN_COOLDOWN_MS_BROWSER;
}

let backendUnavailableUntil = 0;

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError && (e.message === 'Failed to fetch' || e.message?.includes('NetworkError'))) return true;
  return false;
}

/** When a request fails due to backend unreachable, open the circuit so we don't hammer the proxy. */
function markBackendUnavailable(): void {
  backendUnavailableUntil = Date.now() + getBackendDownCooldownMs();
}

/** True if we're in cooldown and should skip backend requests (avoids proxy log spam). */
export function isBackendCircuitOpen(): boolean {
  return Date.now() < backendUnavailableUntil;
}

/** Reset circuit so the next Retry can attempt the backend immediately (user-initiated recovery). */
export function resetBackendCircuit(): void {
  backendUnavailableUntil = 0;
}

/**
 * Circuit breaker applies to all backendRequest() and getHealth() calls: topology, metrics, cluster lists,
 * shell completions, kcli/exec, etc. When open, those calls throw immediately (no request sent).
 * Shell/KCLI WebSocket connections use URLs from getKubectlShellStreamUrl/getKCLIShellStreamUrl and connect
 * via new WebSocket() — they are not gated by the circuit; they fail at connection time if backend is down.
 */

/** Cluster shape returned by GET /api/v1/clusters (matches backend models.Cluster) */
export interface BackendCluster {
  id: string;
  name: string;
  context: string;
  kubeconfig_path?: string;
  server_url?: string;
  server?: string;
  version?: string;
  status?: string;
  provider?: string; // EKS, GKE, AKS, OpenShift, Rancher, k3s, Kind, Minikube, Docker Desktop, on-prem
  last_connected?: string;
  created_at?: string;
  updated_at?: string;
  node_count?: number;
  namespace_count?: number;
  is_current?: boolean;
}

/** C2.3: Error transparency — status and requestId for support. */
export class BackendApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string,
    /** X-Request-ID from response header when present (for support correlation). */
    public requestId?: string
  ) {
    super(message);
    this.name = 'BackendApiError';
  }
}

/** D1.2: Header required for destructive actions (delete resource, apply). */
export const CONFIRM_DESTRUCTIVE_HEADER = 'X-Confirm-Destructive';

/**
 * Low-level request against the backend.
 * Path is relative to API root, e.g. "clusters" -> /api/v1/clusters.
 * 
 * Desktop mode (Tauri): Sends kubeconfig with each request via X-Kubeconfig header (Headlamp/Lens model).
 * Web mode: Uses JWT token authentication.
 */
export async function backendRequest<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  if (isBackendCircuitOpen()) {
    throw new BackendApiError(
      isTauri() ? 'Connection temporarily unavailable. Try again in a moment.' : 'Backend unreachable (circuit open). Check backend URL in Settings or try again later.',
      0,
      undefined
    );
  }

  // Ensure no trailing slash
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const url = `${normalizedBase}${API_PREFIX}/${normalizedPath}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) || {}),
  };

  // Desktop mode (Tauri): Send kubeconfig with each request (Headlamp/Lens model)
  if (isTauri()) {
    const { useClusterStore } = await import('@/stores/clusterStore');
    const { activeCluster, kubeconfigContent } = useClusterStore.getState();

    if (kubeconfigContent) {
      headers['X-Kubeconfig'] = btoa(kubeconfigContent);
    } else if (activeCluster?.kubeconfig) {
      headers['X-Kubeconfig'] = btoa(activeCluster.kubeconfig);
    }
  }
  // Web mode: No login — no Authorization header. When auth_mode=required, re-add token injection.

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch (e) {
    // BA-3: Circuit breaker ONLY opens on network-level errors (ECONNREFUSED, Failed to fetch, timeout).
    // HTTP 4xx (404, 401, 403) and 5xx responses must NOT open the circuit — these are application-level
    // errors (wrong cluster ID, auth failure, server error) not backend unavailability. Opening the circuit
    // on 404 would lock out the user for 60 seconds just because they navigated to a non-existent resource.
    // IMPORTANT: markBackendUnavailable() is ONLY called here in the network catch block, never in the
    // !response.ok path below. Any refactor that moves markBackendUnavailable() to the error path would break this.
    if (isNetworkError(e)) markBackendUnavailable();
    throw e;
  }

  const requestId = response.headers.get('X-Request-ID') ?? undefined;
  const body = await response.text();
  if (!response.ok) {
    // BA-3: HTTP 4xx/5xx responses do NOT open the circuit breaker — these are application errors,
    // not backend unavailability. Only network-level errors (in catch block above) open the circuit.
    if (response.status === 401) {
      if (isTauri()) {
        console.error('Kubeconfig authentication failed - kubeconfig may be invalid or expired');
      } else {
        useAuthStore.getState().logout();
      }
      // P2-6: Use event so App can navigate via React Router; window.location.href breaks MemoryRouter (Tauri).
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth-logout'));
      }
    }

    throw new BackendApiError(
      `Backend API error: ${response.status}${body ? ` - ${body}` : ''}`,
      response.status,
      body,
      requestId
    );
  }

  if (!body || body.trim() === '') {
    return undefined as T;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new BackendApiError(
      `Invalid JSON response: ${body.slice(0, 200)}`,
      response.status,
      body,
      requestId
    );
  }
}

/**
 * GET /api/v1/capabilities — backend capabilities (e.g. resource_topology_kinds).
 */
export interface BackendCapabilities {
  resource_topology_kinds?: string[];
}

export async function getCapabilities(baseUrl: string): Promise<BackendCapabilities> {
  return backendRequest<BackendCapabilities>(baseUrl, 'capabilities');
}

/**
 * GET /api/v1/clusters — list all clusters.
 */
export async function getClusters(baseUrl: string): Promise<BackendCluster[]> {
  return backendRequest<BackendCluster[]>(baseUrl, 'clusters');
}

/**
 * GET /api/v1/clusters/discover — scan kubeconfig for new clusters.
 */
export async function discoverClusters(baseUrl: string): Promise<BackendCluster[]> {
  return backendRequest<BackendCluster[]>(baseUrl, 'clusters/discover');
}

/** Project shape from GET /api/v1/projects (list includes cluster_count, namespace_count) */
export interface BackendProject {
  id: string;
  name: string;
  description: string;
  created_at?: string;
  updated_at?: string;
  cluster_count?: number;
  namespace_count?: number;
}

/** Project with clusters and namespaces from GET /api/v1/projects/{projectId} */
export interface BackendProjectWithDetails extends BackendProject {
  clusters: Array<{
    project_id: string;
    cluster_id: string;
    cluster_name: string;
    cluster_status: string;
    cluster_provider: string;
  }>;
  namespaces: Array<{
    project_id: string;
    cluster_id: string;
    namespace_name: string;
    team: string;
    cluster_name: string;
  }>;
}

export async function getProjects(baseUrl: string): Promise<BackendProject[]> {
  return backendRequest<BackendProject[]>(baseUrl, 'projects');
}

export async function getProject(baseUrl: string, projectId: string): Promise<BackendProjectWithDetails> {
  return backendRequest<BackendProjectWithDetails>(baseUrl, `projects/${encodeURIComponent(projectId)}`);
}

export async function createProject(baseUrl: string, name: string, description?: string): Promise<BackendProject> {
  return backendRequest<BackendProject>(baseUrl, 'projects', {
    method: 'POST',
    body: JSON.stringify({ name, description: description ?? '' }),
  });
}

export async function updateProject(baseUrl: string, projectId: string, data: { name?: string; description?: string }): Promise<BackendProject> {
  return backendRequest<BackendProject>(baseUrl, `projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteProject(baseUrl: string, projectId: string): Promise<void> {
  return backendRequest<void>(baseUrl, `projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
}

export async function addClusterToProject(
  baseUrl: string,
  projectId: string,
  clusterId: string
): Promise<void> {
  return backendRequest<void>(baseUrl, `projects/${encodeURIComponent(projectId)}/clusters`, {
    method: 'POST',
    body: JSON.stringify({ cluster_id: clusterId }),
  });
}

export async function removeClusterFromProject(baseUrl: string, projectId: string, clusterId: string): Promise<void> {
  return backendRequest<void>(baseUrl, `projects/${encodeURIComponent(projectId)}/clusters/${encodeURIComponent(clusterId)}`, {
    method: 'DELETE',
  });
}

export async function addNamespaceToProject(
  baseUrl: string,
  projectId: string,
  clusterId: string,
  namespaceName: string,
  team?: string
): Promise<void> {
  return backendRequest<void>(baseUrl, `projects/${encodeURIComponent(projectId)}/namespaces`, {
    method: 'POST',
    body: JSON.stringify({ cluster_id: clusterId, namespace_name: namespaceName, team: team ?? '' }),
  });
}

export async function removeNamespaceFromProject(
  baseUrl: string,
  projectId: string,
  clusterId: string,
  namespaceName: string
): Promise<void> {
  const path = `projects/${encodeURIComponent(projectId)}/namespaces/${encodeURIComponent(clusterId)}/${encodeURIComponent(namespaceName)}`;
  return backendRequest<void>(baseUrl, path, { method: 'DELETE' });
}

/** Cluster summary shape from GET /api/v1/clusters/{clusterId}/summary (matches backend ClusterSummary). */
export interface BackendClusterSummary {
  id: string;
  name: string;
  node_count: number;
  namespace_count: number;
  pod_count: number;
  deployment_count: number;
  service_count: number;
  health_status: string;
}

/**
 * GET /api/v1/clusters/{clusterId}/features/metallb — returns { installed: boolean }.
 */
export async function getClusterFeatureMetallb(
  baseUrl: string,
  clusterId: string
): Promise<{ installed: boolean }> {
  const path = `clusters/${encodeURIComponent(clusterId)}/features/metallb`;
  return backendRequest<{ installed: boolean }>(baseUrl, path);
}

/**
 * GET /api/v1/clusters/{clusterId}/summary — cluster statistics (node_count, namespace_count, pod_count, etc.).
 */
export async function getClusterSummary(
  baseUrl: string,
  clusterId: string
): Promise<BackendClusterSummary> {
  const path = `clusters/${encodeURIComponent(clusterId)}/summary`;
  return backendRequest<BackendClusterSummary>(baseUrl, path);
}

/** Cluster overview shape from GET /api/v1/clusters/{clusterId}/overview (dashboard snapshot). */
export interface ClusterOverview {
  health: {
    score: number;
    grade: string;
    status: string;
  };
  counts: {
    nodes: number;
    pods: number;
    namespaces: number;
    deployments: number;
  };
  pod_status: {
    running: number;
    pending: number;
    failed: number;
    succeeded: number;
  };
  alerts: {
    warnings: number;
    critical: number;
    top_3: Array<{ reason: string; resource: string; namespace: string }>;
  };
  utilization?: {
    cpu_percent: number;
    memory_percent: number;
    cpu_cores: number;
    memory_gib: number;
  };
}

export async function getClusterOverview(
  baseUrl: string,
  clusterId: string
): Promise<ClusterOverview> {
  const path = `clusters/${encodeURIComponent(clusterId)}/overview`;
  return backendRequest<ClusterOverview>(baseUrl, path);
}

/** Workloads overview from GET /api/v1/clusters/{clusterId}/workloads */
export interface WorkloadsOverview {
  pulse: {
    total: number;
    healthy: number;
    warning: number;
    critical: number;
    optimal_percent: number;
  };
  workloads: Array<{
    kind: string;
    name: string;
    namespace: string;
    status: string;
    ready: number;
    desired: number;
    pressure: string;
  }>;
  alerts: {
    warnings: number;
    critical: number;
    top_3: Array<{ reason: string; resource: string; namespace: string }>;
  };
}

export async function getWorkloadsOverview(
  baseUrl: string,
  clusterId: string
): Promise<WorkloadsOverview> {
  const path = `clusters/${encodeURIComponent(clusterId)}/workloads`;
  return backendRequest<WorkloadsOverview>(baseUrl, path);
}

/**
 * POST /api/v1/clusters — add a cluster (kubeconfig path + context).
 * Backend creates K8s client and registers the cluster; use default kubeconfig path for Docker Desktop (e.g. ~/.kube/config).
 */
export async function addCluster(
  baseUrl: string,
  kubeconfigPath: string,
  context: string
): Promise<BackendCluster> {
  return backendRequest<BackendCluster>(baseUrl, 'clusters', {
    method: 'POST',
    body: JSON.stringify({
      kubeconfig_path: kubeconfigPath,
      context: context || undefined,
    }),
  });
}

/**
 * POST /api/v1/clusters — add a cluster by uploading kubeconfig content (base64).
 * Use when user uploads a file from the browser; backend writes to temp and registers the cluster.
 */
export async function addClusterWithUpload(
  baseUrl: string,
  kubeconfigBase64: string,
  context: string
): Promise<BackendCluster> {
  return backendRequest<BackendCluster>(baseUrl, 'clusters', {
    method: 'POST',
    body: JSON.stringify({
      kubeconfig_base64: kubeconfigBase64,
      context: context || undefined,
    }),
  });
}

/**
 * GET /api/v1/clusters/{clusterId}/topology — get topology graph.
 * Optional query: namespace, resource_types.
 */
export async function getTopology(
  baseUrl: string,
  clusterId: string,
  params?: { namespace?: string; resource_types?: string[] }
): Promise<TopologyGraph> {
  const search = new URLSearchParams();
  if (params?.namespace) search.set('namespace', params.namespace);
  if (params?.resource_types?.length)
    params.resource_types.forEach((t) => search.append('resource_types', t));
  const query = search.toString();
  const path = `clusters/${encodeURIComponent(clusterId)}/topology${query ? `?${query}` : ''}`;

  try {
    const result = await backendRequest<any>(baseUrl, path);

    if (!result) {
      throw new Error('Empty response from topology API');
    }

    // Transform backend format to frontend format
    const transformedGraph = adaptTopologyGraph(result);

    // Validate transformed graph
    const validation = validateTopologyGraph(transformedGraph);
    if (!validation.valid) {
      console.error('Topology graph validation failed:', validation.errors);
    }

    return transformedGraph;
  } catch (error) {
    console.error('Error fetching topology:', {
      baseUrl,
      clusterId,
      params,
      error,
    });
    throw error;
  }
}

/**
 * GET /api/v1/clusters/{clusterId}/topology/resource/{kind}/{namespace}/{name} — resource-scoped topology.
 * For cluster-scoped resources (Node, PV, StorageClass) use namespace '-' or '_'.
 */
export async function getResourceTopology(
  baseUrl: string,
  clusterId: string,
  kind: string,
  namespace: string,
  name: string
): Promise<TopologyGraph> {
  const ns = namespace === '' ? '-' : namespace;
  const path = `clusters/${encodeURIComponent(clusterId)}/topology/resource/${encodeURIComponent(kind)}/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`;

  try {
    const result = await backendRequest<any>(baseUrl, path);
    if (!result) throw new Error('Empty response from topology API');

    const transformedGraph = adaptTopologyGraph(result);

    const validation = validateTopologyGraph(transformedGraph);
    if (!validation.valid) {
      console.error('[getResourceTopology] Graph validation errors:', validation.errors);
    }

    return transformedGraph;
  } catch (error) {
    console.error('[getResourceTopology] Failed:', { kind, namespace: ns, name, error });
    throw error;
  }
}

/**
 * GET /api/v1/clusters/{clusterId}/topology/export/drawio
 * Returns { url: string, mermaid?: string } for opening topology in draw.io.
 */
export async function getTopologyExportDrawio(
  baseUrl: string,
  clusterId: string,
  params?: { format?: 'mermaid' | 'xml' }
): Promise<{ url: string; mermaid?: string }> {
  const search = new URLSearchParams();
  if (params?.format) search.set('format', params.format);
  const query = search.toString();
  const path = `clusters/${encodeURIComponent(clusterId)}/topology/export/drawio${query ? `?${query}` : ''}`;
  const result = await backendRequest<{ url: string; mermaid?: string }>(baseUrl, path);
  if (!result?.url) throw new Error('Invalid draw.io export response');
  return result;
}

/**
 * GET /api/v1/../health => /health — backend health check (at API base, not under /api/v1).
 */
export async function getHealth(
  baseUrl: string
): Promise<{ status: string; service?: string; version?: string }> {
  if (isBackendCircuitOpen()) {
    throw new BackendApiError(
      isTauri() ? 'Connection temporarily unavailable. Try again in a moment.' : 'Backend unreachable (circuit open). Check backend URL in Settings or try again later.',
      0,
      undefined
    );
  }
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const url = `${normalizedBase}/health`;
  let response: Response;
  try {
    // BA-4: 5s timeout prevents hanging if backend accepts connection but doesn't respond (e.g. DB migration blocking).
    response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (e) {
    if (isNetworkError(e)) markBackendUnavailable();
    throw e;
  }
  const body = await response.text();
  if (!response.ok) {
    throw new BackendApiError(
      `Health check failed: ${response.status}${body ? ` - ${body}` : ''}`,
      response.status,
      body
    );
  }
  if (!body?.trim()) return undefined as { status: string };
  try {
    return JSON.parse(body) as { status: string; service?: string; version?: string };
  } catch {
    const preview = body?.trim() ? body.slice(0, 100) : '(empty)';
    throw new BackendApiError(
      `Invalid JSON from /health (backend may have returned HTML or wrong URL). Body: ${preview}${(body?.length ?? 0) > 100 ? '…' : ''}`,
      response.status,
      body
    );
  }
}

/** List response shape from GET /api/v1/clusters/{clusterId}/resources/{kind} (matches backend). */
export interface BackendResourceListResponse {
  kind?: string;
  apiVersion?: string;
  metadata?: { resourceVersion?: string; continue?: string; remainingItemCount?: number };
  items: Record<string, unknown>[];
}

/**
 * GET /api/v1/clusters/{clusterId}/crd-instances/{crdName} — list instances of a CRD by full name (e.g. certificates.cert-manager.io).
 * Query: namespace, limit, continue, labelSelector, fieldSelector.
 */
export async function listCRDInstances(
  baseUrl: string,
  clusterId: string,
  crdName: string,
  params?: { namespace?: string; limit?: number; continue?: string; labelSelector?: string; fieldSelector?: string }
): Promise<BackendResourceListResponse> {
  const search = new URLSearchParams();
  if (params?.namespace !== undefined && params.namespace !== '') search.set('namespace', params.namespace);
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.continue) search.set('continue', params.continue);
  if (params?.labelSelector) search.set('labelSelector', params.labelSelector);
  if (params?.fieldSelector) search.set('fieldSelector', params.fieldSelector);
  const query = search.toString();
  const path = `clusters/${encodeURIComponent(clusterId)}/crd-instances/${encodeURIComponent(crdName)}${query ? `?${query}` : ''}`;
  return backendRequest<BackendResourceListResponse>(baseUrl, path);
}

/**
 * GET /api/v1/clusters/{clusterId}/resources/{kind} — list resources by kind.
 * Query: namespace, limit, continue, labelSelector, fieldSelector.
 */
export async function listResources(
  baseUrl: string,
  clusterId: string,
  kind: string,
  params?: { namespace?: string; limit?: number; continue?: string; labelSelector?: string; fieldSelector?: string }
): Promise<BackendResourceListResponse> {
  const search = new URLSearchParams();
  if (params?.namespace !== undefined && params.namespace !== '') search.set('namespace', params.namespace);
  if (params?.limit != null) search.set('limit', String(params.limit));
  if (params?.continue) search.set('continue', params.continue);
  if (params?.labelSelector) search.set('labelSelector', params.labelSelector);
  if (params?.fieldSelector) search.set('fieldSelector', params.fieldSelector);
  const query = search.toString();
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/${encodeURIComponent(kind)}${query ? `?${query}` : ''}`;
  return backendRequest<BackendResourceListResponse>(baseUrl, path);
}

/**
 * GET /api/v1/clusters/{clusterId}/resources/{kind}/{namespace}/{name} — get single resource.
 * For cluster-scoped resources (IngressClass, Node, etc.) pass namespace as ''; path uses '-' sentinel.
 */
export async function getResource(
  baseUrl: string,
  clusterId: string,
  kind: string,
  namespace: string,
  name: string
): Promise<Record<string, unknown>> {
  const ns = namespace === '' ? '-' : namespace;
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/${encodeURIComponent(kind)}/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`;
  return backendRequest<Record<string, unknown>>(baseUrl, path);
}

/**
 * PATCH /api/v1/clusters/{clusterId}/resources/{kind}/{namespace}/{name}
 * Body: JSON merge-patch (e.g. { spec: { replicas: 3 } } for scaling).
 * For cluster-scoped resources pass namespace as ''; path uses '-' sentinel.
 */
export async function patchResource(
  baseUrl: string,
  clusterId: string,
  kind: string,
  namespace: string,
  name: string,
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const ns = namespace === '' ? '-' : namespace;
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/${encodeURIComponent(kind)}/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`;
  return backendRequest<Record<string, unknown>>(baseUrl, path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/**
 * DELETE /api/v1/clusters/{clusterId}/resources/{kind}/{namespace}/{name}
 * D1.2: Requires X-Confirm-Destructive: true (call only after user confirmation).
 * For cluster-scoped resources pass namespace as ''; path uses '-' sentinel.
 */
export async function deleteResource(
  baseUrl: string,
  clusterId: string,
  kind: string,
  namespace: string,
  name: string
): Promise<{ message: string; cluster_id: string; kind: string; namespace: string; name: string }> {
  const ns = namespace === '' ? '-' : namespace;
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/${encodeURIComponent(kind)}/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`;
  return backendRequest(baseUrl, path, {
    method: 'DELETE',
    headers: { [CONFIRM_DESTRUCTIVE_HEADER]: 'true' },
  });
}

/**
 * POST /api/v1/clusters/{clusterId}/apply — apply YAML manifest.
 * D1.2: Requires X-Confirm-Destructive: true (review YAML before applying).
 */
export async function applyManifest(
  baseUrl: string,
  clusterId: string,
  yaml: string
): Promise<{ message: string; cluster_id: string; resources: Array<{ kind: string; namespace: string; name: string; action: string }> }> {
  const path = `clusters/${encodeURIComponent(clusterId)}/apply`;
  return backendRequest(baseUrl, path, {
    method: 'POST',
    headers: { [CONFIRM_DESTRUCTIVE_HEADER]: 'true' },
    body: JSON.stringify({ yaml }),
  });
}

/** Rollout history entry from GET .../deployments/{namespace}/{name}/rollout-history */
export interface RolloutHistoryRevision {
  revision: number;
  creationTimestamp: string;
  changeCause: string;
  podTemplateHash: string;
  ready: number;
  desired: number;
  available: number;
  name: string;
  /** Container images from ReplicaSet pod template (order preserved). */
  images?: string[];
  /** Seconds from this revision's creation until the next revision (rollout duration); 0 for current. */
  durationSeconds?: number;
}

/**
 * GET /api/v1/clusters/{clusterId}/search?q=...&limit=25
 * Global search for command palette: returns resources matching name or namespace (case-insensitive).
 */
export interface SearchResultItem {
  kind: string;
  name: string;
  namespace?: string;
  path: string;
}

export interface SearchResponse {
  results: SearchResultItem[];
}

export async function searchResources(
  baseUrl: string,
  clusterId: string,
  q: string,
  limit?: number
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: q.trim() });
  if (limit != null && limit > 0) params.set('limit', String(limit));
  const path = `clusters/${encodeURIComponent(clusterId)}/search?${params.toString()}`;
  return backendRequest<SearchResponse>(baseUrl, path);
}

/**
 * GET /api/v1/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollout-history
 */
export async function getDeploymentRolloutHistory(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  name: string
): Promise<{ revisions: RolloutHistoryRevision[] }> {
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/rollout-history`;
  return backendRequest<{ revisions: RolloutHistoryRevision[] }>(baseUrl, path);
}

/**
 * GET /api/v1/clusters/{clusterId}/resources/services/{namespace}/{name}/endpoints
 * Returns the Endpoints resource with the same name as the service.
 */
export async function getServiceEndpoints(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  name: string
): Promise<Record<string, unknown>> {
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/services/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/endpoints`;
  return backendRequest<Record<string, unknown>>(baseUrl, path);
}

/** Ref shape for consumers API (namespace/name). */
export interface ConsumersRef {
  namespace: string;
  name: string;
}

/** Response from GET .../configmaps|secrets/{namespace}/{name}/consumers */
export interface ConsumersResponse {
  pods: ConsumersRef[];
  deployments: ConsumersRef[];
  statefulSets: ConsumersRef[];
  daemonSets: ConsumersRef[];
  jobs: ConsumersRef[];
  cronJobs: ConsumersRef[];
}

/**
 * GET /api/v1/clusters/{clusterId}/resources/configmaps/{namespace}/{name}/consumers
 */
export async function getConfigMapConsumers(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  name: string
): Promise<ConsumersResponse> {
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/configmaps/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/consumers`;
  return backendRequest<ConsumersResponse>(baseUrl, path);
}

/**
 * GET /api/v1/clusters/{clusterId}/resources/secrets/{namespace}/{name}/consumers
 */
export async function getSecretConsumers(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  name: string
): Promise<ConsumersResponse> {
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/consumers`;
  return backendRequest<ConsumersResponse>(baseUrl, path);
}

/** TLS cert info from GET .../secrets/{namespace}/{name}/tls-info */
export interface TLSSecretInfo {
  issuer?: string;
  subject?: string;
  validFrom?: string;
  validTo?: string;
  daysRemaining: number;
  hasValidCert: boolean;
  error?: string;
}

export async function getSecretTLSInfo(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  name: string
): Promise<TLSSecretInfo> {
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/tls-info`;
  return backendRequest<TLSSecretInfo>(baseUrl, path);
}

/**
 * GET .../resources/persistentvolumeclaims/{namespace}/{name}/consumers
 */
export async function getPVCConsumers(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  name: string
): Promise<ConsumersResponse> {
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/persistentvolumeclaims/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/consumers`;
  return backendRequest<ConsumersResponse>(baseUrl, path);
}

/**
 * GET .../resources/storageclasses/pv-counts
 * Returns { [storageClassName]: count }
 */
export async function getStorageClassPVCounts(
  baseUrl: string,
  clusterId: string
): Promise<Record<string, number>> {
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/storageclasses/pv-counts`;
  return backendRequest<Record<string, number>>(baseUrl, path);
}

/**
 * GET .../resources/namespaces/counts
 * Returns { [namespaceName]: { pods, services } } for list-page display.
 */
export async function getNamespaceCounts(
  baseUrl: string,
  clusterId: string
): Promise<Record<string, { pods: number; services: number }>> {
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/namespaces/counts`;
  return backendRequest<Record<string, { pods: number; services: number }>>(baseUrl, path);
}

/**
 * GET .../resources/serviceaccounts/token-counts
 * Returns { "namespace/name": tokenCount } for service account token secrets (type=service-account-token).
 */
export async function getServiceAccountTokenCounts(
  baseUrl: string,
  clusterId: string
): Promise<Record<string, number>> {
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/serviceaccounts/token-counts`;
  return backendRequest<Record<string, number>>(baseUrl, path);
}

/**
 * POST /api/v1/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollback
 * Body: { revision?: number } — optional; omit to roll back to previous revision.
 */
export async function postDeploymentRollback(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  name: string,
  body?: { revision?: number }
): Promise<Record<string, unknown>> {
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/rollback`;
  return backendRequest<Record<string, unknown>>(baseUrl, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

/**
 * POST /api/v1/clusters/{clusterId}/resources/cronjobs/{namespace}/{name}/trigger
 * Creates a one-off Job from the CronJob's jobTemplate.
 */
export async function postCronJobTrigger(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  name: string
): Promise<Record<string, unknown>> {
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/cronjobs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/trigger`;
  return backendRequest<Record<string, unknown>>(baseUrl, path, { method: 'POST' });
}

/**
 * GET /api/v1/clusters/{clusterId}/resources/cronjobs/{namespace}/{name}/jobs?limit=5
 * Returns last N child jobs owned by this CronJob (for expandable row drill-down).
 */
export async function getCronJobJobs(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  name: string,
  limit = 5
): Promise<{ items: Record<string, unknown>[] }> {
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/cronjobs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/jobs?limit=${limit}`;
  const res = await backendRequest<{ items: Record<string, unknown>[] }>(baseUrl, path);
  return res ?? { items: [] };
}

/**
 * POST /api/v1/clusters/{clusterId}/resources/jobs/{namespace}/{name}/retry
 * Creates a new Job with the same spec (retry).
 */
export async function postJobRetry(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  name: string
): Promise<Record<string, unknown>> {
  const path = `clusters/${encodeURIComponent(clusterId)}/resources/jobs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/retry`;
  return backendRequest<Record<string, unknown>>(baseUrl, path, { method: 'POST' });
}

/** Event shape from GET /api/v1/clusters/{clusterId}/events (matches backend models.Event). */
export interface BackendEvent {
  id: string;
  name: string;
  event_namespace: string;
  type: string;
  reason: string;
  message: string;
  resource_kind: string;
  resource_name: string;
  namespace: string;
  first_timestamp: string;
  last_timestamp: string;
  count: number;
  source_component?: string;
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
  return backendRequest<BackendEvent[]>(baseUrl, path);
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
  return backendRequest<BackendEvent[]>(baseUrl, path);
}

/** Per-container metrics from pod metrics API. */
export interface BackendContainerMetrics {
  name: string;
  cpu: string;
  memory: string;
}

/** Pod metrics shape from GET /api/v1/clusters/{clusterId}/metrics/{namespace}/{pod}. */
export interface BackendPodMetrics {
  name: string;
  namespace: string;
  CPU: string;
  Memory: string;
  containers?: BackendContainerMetrics[];
}

/**
 * GET /api/v1/clusters/{clusterId}/metrics/{namespace}/{pod} — pod CPU/Memory from Metrics Server.
 */
export async function getPodMetrics(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  podName: string
): Promise<BackendPodMetrics> {
  const path = `clusters/${encodeURIComponent(clusterId)}/metrics/${encodeURIComponent(namespace)}/${encodeURIComponent(podName)}`;
  return backendRequest<BackendPodMetrics>(baseUrl, path);
}

/** Node metrics shape from GET /api/v1/clusters/{clusterId}/metrics/nodes/{nodeName}. */
export interface BackendNodeMetrics {
  name: string;
  CPU: string;
  Memory: string;
}

/**
 * GET /api/v1/clusters/{clusterId}/metrics/nodes/{nodeName} — node CPU/Memory from Metrics Server.
 */
export async function getNodeMetrics(
  baseUrl: string,
  clusterId: string,
  nodeName: string
): Promise<BackendNodeMetrics> {
  const path = `clusters/${encodeURIComponent(clusterId)}/metrics/nodes/${encodeURIComponent(nodeName)}`;
  return backendRequest<BackendNodeMetrics>(baseUrl, path);
}

/** Deployment metrics: aggregated + per-pod from GET .../metrics/{namespace}/deployment/{name}. */
export interface BackendDeploymentMetrics {
  deploymentName: string;
  namespace: string;
  podCount: number;
  totalCPU: string;
  totalMemory: string;
  pods: BackendPodMetrics[];
}

/**
 * GET /api/v1/clusters/{clusterId}/metrics/{namespace}/deployment/{name} — deployment aggregated pod metrics.
 */
export async function getDeploymentMetrics(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  deploymentName: string
): Promise<BackendDeploymentMetrics> {
  const path = `clusters/${encodeURIComponent(clusterId)}/metrics/${encodeURIComponent(namespace)}/deployment/${encodeURIComponent(deploymentName)}`;
  return backendRequest<BackendDeploymentMetrics>(baseUrl, path);
}

/** Workload metrics use the same shape as deployment (aggregated + per-pod). */
export async function getReplicaSetMetrics(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  name: string
): Promise<BackendDeploymentMetrics> {
  const path = `clusters/${encodeURIComponent(clusterId)}/metrics/${encodeURIComponent(namespace)}/replicaset/${encodeURIComponent(name)}`;
  return backendRequest<BackendDeploymentMetrics>(baseUrl, path);
}

export async function getStatefulSetMetrics(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  name: string
): Promise<BackendDeploymentMetrics> {
  const path = `clusters/${encodeURIComponent(clusterId)}/metrics/${encodeURIComponent(namespace)}/statefulset/${encodeURIComponent(name)}`;
  return backendRequest<BackendDeploymentMetrics>(baseUrl, path);
}

export async function getDaemonSetMetrics(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  name: string
): Promise<BackendDeploymentMetrics> {
  const path = `clusters/${encodeURIComponent(clusterId)}/metrics/${encodeURIComponent(namespace)}/daemonset/${encodeURIComponent(name)}`;
  return backendRequest<BackendDeploymentMetrics>(baseUrl, path);
}

export async function getJobMetrics(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  name: string
): Promise<BackendDeploymentMetrics> {
  const path = `clusters/${encodeURIComponent(clusterId)}/metrics/${encodeURIComponent(namespace)}/job/${encodeURIComponent(name)}`;
  return backendRequest<BackendDeploymentMetrics>(baseUrl, path);
}

export async function getCronJobMetrics(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  name: string
): Promise<BackendDeploymentMetrics> {
  const path = `clusters/${encodeURIComponent(clusterId)}/metrics/${encodeURIComponent(namespace)}/cronjob/${encodeURIComponent(name)}`;
  return backendRequest<BackendDeploymentMetrics>(baseUrl, path);
}

/** Per-pod entry in unified metrics summary (backend sends lowercase cpu/memory). */
export interface BackendMetricsSummaryPod {
  name: string;
  namespace?: string;
  cpu: string;
  memory: string;
  containers?: BackendContainerMetrics[];
}

/** Unified metrics summary: one API for pod, node, deployment, replicaset, statefulset, daemonset, job, cronjob. */
export interface BackendMetricsSummary {
  cluster_id: string;
  namespace: string;
  resource_type: string;
  resource_name: string;
  total_cpu: string;
  total_memory: string;
  pod_count: number;
  pods?: BackendMetricsSummaryPod[];
  source?: string;
  warning?: string;
}

/** Response from GET .../metrics/summary. Always 200; use error_code for "no data" reasons (no silent failures). */
export interface BackendMetricsQueryResult {
  summary?: BackendMetricsSummary;
  error?: string;
  error_code?: string;
  query_ms?: number;
  cache_hit?: boolean;
}

/**
 * GET /api/v1/clusters/{clusterId}/metrics/summary?namespace=&resource_type=&resource_name=
 * Unified, resource-agnostic metrics. Use for all resource types (pod, node, deployment, replicaset, etc.).
 */
export async function getMetricsSummary(
  baseUrl: string,
  clusterId: string,
  params: { namespace?: string; resource_type: string; resource_name: string }
): Promise<BackendMetricsQueryResult> {
  const search = new URLSearchParams();
  if (params.namespace != null && params.namespace !== '') search.set('namespace', params.namespace);
  search.set('resource_type', params.resource_type);
  search.set('resource_name', params.resource_name);
  const path = `clusters/${encodeURIComponent(clusterId)}/metrics/summary?${search.toString()}`;
  return backendRequest<BackendMetricsQueryResult>(baseUrl, path);
}

/**
 * Returns the URL for GET /api/v1/clusters/{clusterId}/logs/{namespace}/{pod}.
 * Use with fetch() for streaming or non-streaming log read.
 */
export function getPodLogsUrl(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  pod: string,
  params?: { container?: string; tail?: number; follow?: boolean }
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const search = new URLSearchParams();
  if (params?.container) search.set('container', params.container);
  if (params?.tail != null) search.set('tail', String(params.tail));
  if (params?.follow) search.set('follow', 'true');
  const query = search.toString();
  return `${normalizedBase}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/logs/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}${query ? `?${query}` : ''}`;
}

/**
 * Returns the WebSocket URL for GET /api/v1/clusters/{clusterId}/pods/{namespace}/{name}/exec.
 * Converts http(s) baseUrl to ws(s). When baseUrl is empty (dev proxy), uses window.location.origin.
 */
export function getPodExecWebSocketUrl(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  podName: string,
  params?: { container?: string; shell?: string }
): string {
  const normalizedBase = (baseUrl || '').replace(/\/+$/, '');
  let wsBase = normalizedBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  if (!wsBase && typeof window !== 'undefined') {
    wsBase = window.location.origin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  }
  const search = new URLSearchParams();
  if (params?.container) search.set('container', params.container);
  if (params?.shell) search.set('shell', params.shell);
  const query = search.toString();
  return `${wsBase}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(podName)}/exec${query ? `?${query}` : ''}`;
}

/**
 * WebSocket URL for GET /api/v1/clusters/{clusterId}/shell/stream — full PTY cloud shell
 * (kubectl and any CLI with cluster KUBECONFIG set). Same protocol as pod exec: stdin, resize, stdout/stderr.
 * When baseUrl is empty (dev proxy), uses window.location.origin so the URL is absolute and the proxy is used.
 */
export function getKubectlShellStreamUrl(baseUrl: string, clusterId: string): string {
  const normalizedBase = (baseUrl || '').replace(/\/+$/, '');
  let wsBase = normalizedBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  if (!wsBase && typeof window !== 'undefined') {
    wsBase = window.location.origin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  }
  return `${wsBase}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/shell/stream`;
}

/**
 * WebSocket URL for GET /api/v1/clusters/{clusterId}/kcli/stream.
 * mode can be "ui" (default) or "shell".
 * namespace (optional) starts kcli UI in that namespace (kubens-style).
 */
export function getKCLIShellStreamUrl(
  baseUrl: string,
  clusterId: string,
  mode: 'ui' | 'shell' = 'ui',
  namespace?: string
): string {
  const normalizedBase = (baseUrl || '').replace(/\/+$/, '');
  let wsBase = normalizedBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  if (!wsBase && typeof window !== 'undefined') {
    wsBase = window.location.origin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  }
  const search = new URLSearchParams({ mode });
  if (namespace && namespace !== 'all') {
    search.set('namespace', namespace);
  }
  return `${wsBase}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/kcli/stream?${search.toString()}`;
}

/** Response from POST /clusters/{clusterId}/shell */
export interface ShellCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Response from POST /clusters/{clusterId}/kcli/exec */
export interface KCLIExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * POST /api/v1/clusters/{clusterId}/shell — run a kubectl command (get, describe, logs, top, etc.) and return output.
 */
export async function postShellCommand(
  baseUrl: string,
  clusterId: string,
  command: string
): Promise<ShellCommandResult> {
  return backendRequest<ShellCommandResult>(baseUrl, `clusters/${encodeURIComponent(clusterId)}/shell`, {
    method: 'POST',
    body: JSON.stringify({ command: command.trim() }),
  });
}

/**
 * POST /api/v1/clusters/{clusterId}/kcli/exec — run kcli args server-side for embedded mode.
 */
export async function postKCLIExec(
  baseUrl: string,
  clusterId: string,
  args: string[],
  force = false
): Promise<KCLIExecResult> {
  const headers: Record<string, string> = {};
  if (force) {
    headers['X-Confirm-Destructive'] = 'true';
  }
  return backendRequest<KCLIExecResult>(baseUrl, `clusters/${encodeURIComponent(clusterId)}/kcli/exec`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ args, force }),
  });
}

/** Response from GET /api/v1/clusters/{clusterId}/shell/complete?line=... */
export interface ShellCompleteResult {
  completions: string[];
}

/** Response from GET /api/v1/clusters/{clusterId}/shell/status */
export interface ShellStatusResult {
  clusterId: string;
  clusterName: string;
  context: string;
  namespace: string;
  kcliAvailable: boolean;
  kcliShellModeAllowed: boolean;
  aiEnabled: boolean;
}

/** Response from GET /api/v1/clusters/{clusterId}/kcli/tui/state */
export interface KCLITUIStateResult extends ShellStatusResult { }

/**
 * GET /api/v1/clusters/{clusterId}/shell/complete?line=... — IDE-style kubectl completions (optional for dropdown).
 */
export async function getShellComplete(
  baseUrl: string,
  clusterId: string,
  line: string
): Promise<ShellCompleteResult> {
  const path = `clusters/${encodeURIComponent(clusterId)}/shell/complete`;
  const query = line ? `?line=${encodeURIComponent(line)}` : '';
  return backendRequest<ShellCompleteResult>(baseUrl, `${path}${query}`);
}

/**
 * GET /api/v1/clusters/{clusterId}/shell/status — shell context/namespace and capability metadata.
 */
export async function getShellStatus(
  baseUrl: string,
  clusterId: string
): Promise<ShellStatusResult> {
  const path = `clusters/${encodeURIComponent(clusterId)}/shell/status`;
  return backendRequest<ShellStatusResult>(baseUrl, path);
}

/**
 * GET /api/v1/clusters/{clusterId}/kcli/tui/state — context + namespace + capability metadata for kcli shell panel.
 */
export async function getKCLITUIState(
  baseUrl: string,
  clusterId: string
): Promise<KCLITUIStateResult> {
  const path = `clusters/${encodeURIComponent(clusterId)}/kcli/tui/state`;
  return backendRequest<KCLITUIStateResult>(baseUrl, path);
}

/**
 * GET /api/v1/clusters/{clusterId}/kcli/complete?line=... — IDE-style kcli completions.
 */
export async function getKCLIComplete(
  baseUrl: string,
  clusterId: string,
  line: string
): Promise<ShellCompleteResult> {
  const path = `clusters/${encodeURIComponent(clusterId)}/kcli/complete`;
  const query = line ? `?line=${encodeURIComponent(line)}` : '';
  return backendRequest<ShellCompleteResult>(baseUrl, `${path}${query}`);
}

/**
 * Parse Content-Disposition header for filename (e.g. attachment; filename="kubeconfig-cluster.yaml").
 */
function parseContentDispositionFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?"?([^";\n]+)"?/i) ||
    contentDisposition.match(/filename="?([^";\n]+)"?/i);
  return match ? match[1].trim() : null;
}

/**
 * GET /api/v1/clusters/{clusterId}/kubeconfig — returns kubeconfig YAML for the cluster (context-specific).
 * Returns blob and filename (from Content-Disposition when present) for download.
 * P1-12: Uses same auth headers as backendRequest (X-Kubeconfig in Tauri) so backend can authorize.
 */
export async function getClusterKubeconfig(
  baseUrl: string,
  clusterId: string
): Promise<{ blob: Blob; filename: string }> {
  if (isBackendCircuitOpen()) {
    throw new BackendApiError(
      isTauri() ? 'Connection temporarily unavailable. Try again in a moment.' : 'Backend unreachable (circuit open).',
      0,
      undefined
    );
  }
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const path = `clusters/${encodeURIComponent(clusterId)}/kubeconfig`;
  const url = `${normalizedBase}${API_PREFIX}/${path}`;

  const headers: Record<string, string> = {};
  if (isTauri()) {
    const { useClusterStore } = await import('@/stores/clusterStore');
    const { activeCluster, kubeconfigContent } = useClusterStore.getState();
    if (kubeconfigContent) {
      headers['X-Kubeconfig'] = btoa(kubeconfigContent);
    } else if (activeCluster?.kubeconfig) {
      headers['X-Kubeconfig'] = btoa(activeCluster.kubeconfig);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (e) {
    if (isNetworkError(e)) markBackendUnavailable();
    throw e;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new BackendApiError(
      `Failed to get kubeconfig: ${response.status}${body ? ` - ${body}` : ''}`,
      response.status,
      body
    );
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition');
  const filename = parseContentDispositionFilename(disposition) || `kubeconfig-${clusterId}.yaml`;
  return { blob, filename };
}

/** Factory: create a client interface bound to a base URL (for hooks/pages). */
export function createBackendApiClient(baseUrl: string) {
  return {
    getClusters: () => getClusters(baseUrl),
    getClusterSummary: (clusterId: string) => getClusterSummary(baseUrl, clusterId),
    getClusterOverview: (clusterId: string) => getClusterOverview(baseUrl, clusterId),
    addCluster: (kubeconfigPath: string, context: string) =>
      addCluster(baseUrl, kubeconfigPath, context),
    getTopology: (clusterId: string, params?: Parameters<typeof getTopology>[2]) =>
      getTopology(baseUrl, clusterId, params),
    getResourceTopology: (clusterId: string, kind: string, namespace: string, name: string) =>
      getResourceTopology(baseUrl, clusterId, kind, namespace, name),
    getHealth: () => getHealth(baseUrl),
    listResources: (clusterId: string, kind: string, params?: Parameters<typeof listResources>[3]) =>
      listResources(baseUrl, clusterId, kind, params),
    getResource: (clusterId: string, kind: string, namespace: string, name: string) =>
      getResource(baseUrl, clusterId, kind, namespace, name),
    deleteResource: (cid: string, kind: string, ns: string, n: string) =>
      deleteResource(baseUrl, cid, kind, ns, n),
    applyManifest: (cid: string, yaml: string) => applyManifest(baseUrl, cid, yaml),
    getEvents: (clusterId: string, params?: Parameters<typeof getEvents>[2]) =>
      getEvents(baseUrl, clusterId, params),
    getResourceEvents: (clusterId: string, namespace: string, kind: string, name: string, limit?: number) =>
      getResourceEvents(baseUrl, clusterId, namespace, kind, name, limit),
    getPodMetrics: (clusterId: string, namespace: string, podName: string) =>
      getPodMetrics(baseUrl, clusterId, namespace, podName),
    getPodLogsUrl: (clusterId: string, namespace: string, pod: string, params?: Parameters<typeof getPodLogsUrl>[4]) =>
      getPodLogsUrl(baseUrl, clusterId, namespace, pod, params),
    getPodExecWebSocketUrl: (clusterId: string, namespace: string, podName: string, params?: Parameters<typeof getPodExecWebSocketUrl>[4]) =>
      getPodExecWebSocketUrl(baseUrl, clusterId, namespace, podName, params),
    postShellCommand: (clusterId: string, command: string) =>
      postShellCommand(baseUrl, clusterId, command),
    getShellStatus: (clusterId: string) =>
      getShellStatus(baseUrl, clusterId),
    getKCLITUIState: (clusterId: string) =>
      getKCLITUIState(baseUrl, clusterId),
    getShellComplete: (clusterId: string, line: string) =>
      getShellComplete(baseUrl, clusterId, line),
    getKCLIComplete: (clusterId: string, line: string) =>
      getKCLIComplete(baseUrl, clusterId, line),
    postKCLIExec: (clusterId: string, args: string[], force?: boolean) =>
      postKCLIExec(baseUrl, clusterId, args, force),
  };
}
