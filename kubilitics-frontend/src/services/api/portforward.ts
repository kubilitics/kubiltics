/**
 * Port forward, debug container, and file transfer endpoints.
 */
import { isTauri } from '@/lib/tauri';
import { useClusterStore } from '@/stores/clusterStore';
import { backendRequest, BackendApiError, API_PREFIX } from './client';
import type {
  PortForwardStartRequest,
  PortForwardStartResponse,
  ContainerFileEntry,
} from './types';

/** POST /api/v1/clusters/{clusterId}/port-forward — starts a real kubectl port-forward subprocess. */
export async function startPortForward(
  baseUrl: string,
  clusterId: string,
  req: PortForwardStartRequest
): Promise<PortForwardStartResponse> {
  return backendRequest<PortForwardStartResponse>(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/port-forward`,
    { method: 'POST', body: JSON.stringify(req) }
  );
}

/** POST /api/v1/clusters/{clusterId}/resources/pods/{namespace}/{pod}/debug — creates an ephemeral debug container. */
export async function createDebugContainer(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  pod: string,
  image: string,
  targetContainer: string,
): Promise<{ name: string; status: string }> {
  return backendRequest<{ name: string; status: string }>(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/resources/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/debug`,
    {
      method: 'POST',
      body: JSON.stringify({ image, targetContainer, command: ['/bin/sh'] }),
    },
  );
}

/** DELETE /api/v1/clusters/{clusterId}/port-forward/{sessionId} — stops the subprocess. */
export async function stopPortForward(
  baseUrl: string,
  clusterId: string,
  sessionId: string
): Promise<void> {
  await backendRequest<void>(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/port-forward/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' }
  );
}

// ── File Transfer ────────────────────────────────────────────────────────

/** POST /api/v1/clusters/{clusterId}/resources/{namespace}/{pod}/ls — lists files in a container directory. */
export async function listContainerFiles(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  pod: string,
  path: string,
  container: string
): Promise<ContainerFileEntry[]> {
  return backendRequest<ContainerFileEntry[]>(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/resources/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/ls`,
    { method: 'POST', body: JSON.stringify({ path, container }) }
  );
}

/** Build the download URL for a file inside a container (used for direct browser download). */
export function getContainerFileDownloadUrl(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  pod: string,
  path: string,
  container: string
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  return `${normalizedBase}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/resources/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/download?path=${encodeURIComponent(path)}&container=${encodeURIComponent(container)}`;
}

/** POST /api/v1/clusters/{clusterId}/resources/{namespace}/{pod}/upload — uploads a file to a container. */
export async function uploadContainerFile(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  pod: string,
  path: string,
  container: string,
  file: File
): Promise<{ success: boolean; message: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('path', path);
  form.append('container', container);

  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const url = `${normalizedBase}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/resources/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/upload`;

  const headers: Record<string, string> = {};

  // Desktop mode (Tauri): Send kubeconfig with each request
  if (isTauri()) {
    const { activeCluster, kubeconfigContent } = useClusterStore.getState();
    if (kubeconfigContent) {
      headers['X-Kubeconfig'] = btoa(kubeconfigContent);
    } else if (activeCluster?.kubeconfig) {
      headers['X-Kubeconfig'] = btoa(activeCluster.kubeconfig);
    }
  }

  const response = await fetch(url, { method: 'POST', body: form, headers });
  if (!response.ok) {
    const body = await response.text();
    throw new BackendApiError(body || response.statusText, response.status, undefined);
  }
  return response.json();
}
