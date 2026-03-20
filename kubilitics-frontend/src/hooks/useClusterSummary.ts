/**
 * Fetches cluster summary from GET /api/v1/clusters/{clusterId}/summary.
 * Used by Dashboard for Quick Stats. Gated by circuit so we don't storm the backend when down.
 * Optional projectId: when set, returns counts scoped to that project's namespaces in the cluster.
 */
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getClusterSummary } from '@/services/backendApiClient';
import { useBackendCircuitOpen } from '@/hooks/useBackendCircuitOpen';
import { useProjectStore } from '@/stores/projectStore';

export function useClusterSummary(clusterId: string | undefined, projectId?: string | null) {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const circuitOpen = useBackendCircuitOpen();

  return useQuery({
    queryKey: ['backend', 'clusterSummary', backendBaseUrl, clusterId, projectId ?? ''],
    queryFn: () => getClusterSummary(backendBaseUrl, clusterId!, projectId ?? undefined),
    enabled: isConfigured && !!clusterId && !circuitOpen,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * Uses cluster summary with project context when in a project (for sidebar/dashboard counts).
 * Prefers projectId from the route (/projects/:projectId/...) so the first request is project-scoped
 * before the store is updated, then falls back to activeProjectId from the store.
 */
export function useClusterSummaryWithProject(clusterId: string | undefined) {
  const { projectId: projectIdFromRoute } = useParams<{ projectId?: string }>();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projectId = projectIdFromRoute || activeProjectId;
  return useClusterSummary(clusterId, projectId || null);
}
