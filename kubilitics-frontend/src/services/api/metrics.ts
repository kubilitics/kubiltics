/**
 * Metrics endpoints (pod, node, deployment, workload, summary, history).
 */
import { backendRequest } from './client';
import type {
  BackendPodMetrics,
  BackendNodeMetrics,
  BackendDeploymentMetrics,
  BackendMetricsQueryResult,
  MetricsHistoryResponse,
} from './types';

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

// --- Metrics History ---

export async function getMetricsHistory(
  baseUrl: string,
  clusterId: string,
  params: { namespace?: string; resource_type: string; resource_name: string; duration?: string }
): Promise<MetricsHistoryResponse> {
  const search = new URLSearchParams();
  if (params.namespace) search.set('namespace', params.namespace);
  search.set('resource_type', params.resource_type);
  search.set('resource_name', params.resource_name);
  if (params.duration) search.set('duration', params.duration);
  const path = `clusters/${encodeURIComponent(clusterId)}/metrics/history?${search.toString()}`;
  return backendRequest<MetricsHistoryResponse>(baseUrl, path);
}
