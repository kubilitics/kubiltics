/**
 * Fetches projects from Kubilitics backend (GET /api/v1/projects).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import {
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  addClusterToProject,
  removeClusterFromProject,
  addNamespaceToProject,
  removeNamespaceFromProject,
} from '@/services/backendApiClient';

export function useProjects() {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  return useQuery({
    queryKey: ['backend', 'projects', backendBaseUrl],
    queryFn: () => getProjects(backendBaseUrl ?? ''),
    enabled: isConfigured,
    staleTime: 30_000,
  });
}

export function useProject(projectId: string | null) {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  return useQuery({
    queryKey: ['backend', 'project', projectId, backendBaseUrl],
    queryFn: () => getProject(backendBaseUrl ?? '', projectId!),
    enabled: isConfigured && !!projectId,
    staleTime: 15_000,
  });
}

export function useProjectMutations() {
  const queryClient = useQueryClient();
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored)!;

  const create = useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      createProject(backendBaseUrl, name, description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backend', 'projects'] });
    },
  });

  const update = useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: { name?: string; description?: string } }) =>
      updateProject(backendBaseUrl, projectId, data),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['backend', 'projects'] });
      queryClient.invalidateQueries({ queryKey: ['backend', 'project', projectId] });
    },
  });

  const remove = useMutation({
    mutationFn: (projectId: string) => deleteProject(backendBaseUrl, projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backend', 'projects'] });
    },
  });

  const addCluster = useMutation({
    mutationFn: ({ projectId, clusterId }: { projectId: string; clusterId: string }) =>
      addClusterToProject(backendBaseUrl, projectId, clusterId),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['backend', 'project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['backend', 'projects'] });
    },
  });

  const removeCluster = useMutation({
    mutationFn: ({ projectId, clusterId }: { projectId: string; clusterId: string }) =>
      removeClusterFromProject(backendBaseUrl, projectId, clusterId),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['backend', 'project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['backend', 'projects'] });
    },
  });

  const addNamespace = useMutation({
    mutationFn: ({
      projectId,
      clusterId,
      namespaceName,
      team,
    }: {
      projectId: string;
      clusterId: string;
      namespaceName: string;
      team?: string;
    }) => addNamespaceToProject(backendBaseUrl, projectId, clusterId, namespaceName, team),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['backend', 'project', projectId] });
    },
  });

  const removeNamespace = useMutation({
    mutationFn: ({
      projectId,
      clusterId,
      namespaceName,
    }: {
      projectId: string;
      clusterId: string;
      namespaceName: string;
    }) => removeNamespaceFromProject(backendBaseUrl, projectId, clusterId, namespaceName),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['backend', 'project', projectId] });
    },
  });

  return {
    create,
    update,
    remove,
    addCluster,
    removeCluster,
    addNamespace,
    removeNamespace,
  };
}
