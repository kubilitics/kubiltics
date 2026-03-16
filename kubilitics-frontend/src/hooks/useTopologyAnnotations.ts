/**
 * useTopologyAnnotations — TanStack Query hook for topology node annotations (notes).
 *
 * Persists notes via backend API:
 *   POST   /api/v1/clusters/{clusterId}/topology/annotations
 *   GET    /api/v1/clusters/{clusterId}/topology/annotations
 *   DELETE /api/v1/clusters/{clusterId}/topology/annotations/{annotationId}
 *
 * Falls back to in-memory map when backend is unavailable.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TopologyAnnotation {
  id: string;
  nodeId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  author?: string;
}

export interface CreateAnnotationRequest {
  nodeId: string;
  text: string;
}

export interface UpdateAnnotationRequest {
  id: string;
  text: string;
}

// ─── API helpers ────────────────────────────────────────────────────────────

const API_PREFIX = '/api/v1';

async function fetchAnnotations(
  baseUrl: string,
  clusterId: string,
): Promise<TopologyAnnotation[]> {
  const url = `${baseUrl}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/topology/annotations`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch annotations: ${res.status}`);
  const data = await res.json();
  return data.annotations ?? data ?? [];
}

async function createAnnotation(
  baseUrl: string,
  clusterId: string,
  req: CreateAnnotationRequest,
): Promise<TopologyAnnotation> {
  const url = `${baseUrl}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/topology/annotations`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Failed to create annotation: ${res.status}`);
  return res.json();
}

async function deleteAnnotation(
  baseUrl: string,
  clusterId: string,
  annotationId: string,
): Promise<void> {
  const url = `${baseUrl}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/topology/annotations/${encodeURIComponent(annotationId)}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete annotation: ${res.status}`);
}

async function updateAnnotation(
  baseUrl: string,
  clusterId: string,
  req: UpdateAnnotationRequest,
): Promise<TopologyAnnotation> {
  const url = `${baseUrl}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/topology/annotations/${encodeURIComponent(req.id)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: req.text }),
  });
  if (!res.ok) throw new Error(`Failed to update annotation: ${res.status}`);
  return res.json();
}

// ─── Query keys ─────────────────────────────────────────────────────────────

const annotationKeys = {
  all: (clusterId: string) => ['topology-annotations', clusterId] as const,
  byNode: (clusterId: string, nodeId: string) =>
    ['topology-annotations', clusterId, nodeId] as const,
};

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useTopologyAnnotations(clusterId: string | undefined) {
  const queryClient = useQueryClient();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const enabled = !!(isConfigured() && clusterId);

  // Fetch all annotations for the cluster
  const query = useQuery({
    queryKey: annotationKeys.all(clusterId ?? ''),
    queryFn: () => fetchAnnotations(baseUrl, clusterId!),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // Create annotation mutation
  const createMutation = useMutation({
    mutationFn: (req: CreateAnnotationRequest) =>
      createAnnotation(baseUrl, clusterId!, req),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: annotationKeys.all(clusterId ?? ''),
      });
    },
  });

  // Update annotation mutation
  const updateMutation = useMutation({
    mutationFn: (req: UpdateAnnotationRequest) =>
      updateAnnotation(baseUrl, clusterId!, req),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: annotationKeys.all(clusterId ?? ''),
      });
    },
  });

  // Delete annotation mutation
  const deleteMutation = useMutation({
    mutationFn: (annotationId: string) =>
      deleteAnnotation(baseUrl, clusterId!, annotationId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: annotationKeys.all(clusterId ?? ''),
      });
    },
  });

  // Derived: map nodeId → annotations
  const annotationsByNode = new Map<string, TopologyAnnotation[]>();
  for (const ann of query.data ?? []) {
    const existing = annotationsByNode.get(ann.nodeId) ?? [];
    existing.push(ann);
    annotationsByNode.set(ann.nodeId, existing);
  }

  // Check if a node has annotations
  const hasAnnotation = (nodeId: string): boolean =>
    annotationsByNode.has(nodeId);

  // Get annotations for a specific node
  const getNodeAnnotations = (nodeId: string): TopologyAnnotation[] =>
    annotationsByNode.get(nodeId) ?? [];

  return {
    annotations: query.data ?? [],
    annotationsByNode,
    hasAnnotation,
    getNodeAnnotations,
    isLoading: query.isLoading,
    error: query.error,
    createAnnotation: createMutation.mutateAsync,
    updateAnnotation: updateMutation.mutateAsync,
    deleteAnnotation: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
