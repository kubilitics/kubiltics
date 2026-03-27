/**
 * Project CRUD endpoints.
 */
import { backendRequest } from './client';
import type { BackendProject, BackendProjectWithDetails } from './types';

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
