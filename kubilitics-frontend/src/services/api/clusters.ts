/**
 * Cluster CRUD, summary, overview, reconnect, kubeconfig, capabilities, workloads.
 */
import { isTauri } from '@/lib/tauri';
import { useClusterStore } from '@/stores/clusterStore';
import {
  backendRequest,
  BackendApiError,
  API_PREFIX,
  isBackendCircuitOpen,
  isNetworkError,
  isCORSError,
  isBackendEverReady,
  markBackendUnavailable,
  resetBackendCircuit,
} from './client';
import type {
  BackendCluster,
  BackendClusterSummary,
  ClusterOverview,
  WorkloadsOverview,
  BackendCapabilities,
} from './types';

/**
 * GET /api/v1/capabilities — backend capabilities (e.g. resource_topology_kinds).
 */
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
 * Optional projectId: when set, counts are restricted to that project's namespaces in the cluster.
 */
export async function getClusterSummary(
  baseUrl: string,
  clusterId: string,
  projectId?: string
): Promise<BackendClusterSummary> {
  const search = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const path = `clusters/${encodeURIComponent(clusterId)}/summary${search}`;
  return backendRequest<BackendClusterSummary>(baseUrl, path);
}

export async function getClusterOverview(
  baseUrl: string,
  clusterId: string
): Promise<ClusterOverview> {
  const path = `clusters/${encodeURIComponent(clusterId)}/overview`;
  return backendRequest<ClusterOverview>(baseUrl, path);
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
 * POST /api/v1/clusters/{clusterId}/reconnect — reset circuit breaker and rebuild K8s client.
 * Returns updated cluster (status "connected" on success).
 * Call this when a cluster shows status "error" to recover without restarting the backend.
 */
export async function reconnectCluster(
  baseUrl: string,
  clusterId: string
): Promise<BackendCluster> {
  // Clear per-cluster circuit so the reconnect attempt is not blocked
  resetBackendCircuit(clusterId);
  return backendRequest<BackendCluster>(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/reconnect`,
    { method: 'POST' }
  );
}

/**
 * DELETE /api/v1/clusters/{clusterId} — unregister a cluster from the backend.
 * Removes the cluster from the DB and in-memory clients. Does not modify kubeconfig.
 */
export async function deleteCluster(
  baseUrl: string,
  clusterId: string
): Promise<void> {
  await backendRequest(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}`,
    { method: 'DELETE' }
  );
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
  if (isBackendCircuitOpen(clusterId)) {
    throw new BackendApiError(
      `Cluster ${clusterId} temporarily unavailable. Try again in a moment.`,
      0,
      undefined
    );
  }
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const path = `clusters/${encodeURIComponent(clusterId)}/kubeconfig`;
  const url = `${normalizedBase}${API_PREFIX}/${path}`;

  const headers: Record<string, string> = {};
  if (isTauri()) {
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
    if (isNetworkError(e) && !isCORSError(e) && isBackendEverReady()) markBackendUnavailable();
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
