/**
 * React Query hooks for Fleet X-Ray endpoints.
 *
 * Each hook wraps a single API function with TanStack Query for caching,
 * polling, and error handling. Follows the same pattern as useFleetOverview.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import {
  getXRayDashboard,
  getXRayClusterMetrics,
  getXRayComparison,
  getXRayTemplates,
  createXRayTemplate,
  getXRayTemplate,
  updateXRayTemplate,
  deleteXRayTemplate,
  getXRayTemplateScores,
  getXRayDRAssessment,
  getXRayHealthHistory,
} from '@/services/api/fleetXray';
import type { GoldenTemplateInput } from '@/services/api/fleetXray';

const XRAY_POLL_INTERVAL = 30_000;

function useBaseUrl() {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  return { baseUrl: getEffectiveBackendBaseUrl(stored), isConfigured };
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export function useXRayDashboard() {
  const { baseUrl, isConfigured } = useBaseUrl();
  return useQuery({
    queryKey: ['fleet-xray', 'dashboard', baseUrl],
    queryFn: () => getXRayDashboard(baseUrl),
    enabled: isConfigured,
    refetchInterval: XRAY_POLL_INTERVAL,
    staleTime: 15_000,
  });
}

// ── Single Cluster Metrics ───────────────────────────────────────────────────

export function useXRayClusterMetrics(clusterId: string | null) {
  const { baseUrl, isConfigured } = useBaseUrl();
  return useQuery({
    queryKey: ['fleet-xray', 'cluster-metrics', baseUrl, clusterId],
    queryFn: () => getXRayClusterMetrics(baseUrl, clusterId!),
    enabled: isConfigured && !!clusterId,
    staleTime: 15_000,
  });
}

// ── Comparison ───────────────────────────────────────────────────────────────

export function useXRayComparison(clusterAId: string | null, clusterBId: string | null) {
  const { baseUrl, isConfigured } = useBaseUrl();
  return useQuery({
    queryKey: ['fleet-xray', 'compare', baseUrl, clusterAId, clusterBId],
    queryFn: () => getXRayComparison(baseUrl, clusterAId!, clusterBId!),
    enabled: isConfigured && !!clusterAId && !!clusterBId,
    staleTime: 15_000,
  });
}

// ── Templates ────────────────────────────────────────────────────────────────

export function useXRayTemplates() {
  const { baseUrl, isConfigured } = useBaseUrl();
  return useQuery({
    queryKey: ['fleet-xray', 'templates', baseUrl],
    queryFn: () => getXRayTemplates(baseUrl),
    enabled: isConfigured,
    staleTime: 30_000,
  });
}

export function useXRayTemplate(templateId: string | null) {
  const { baseUrl, isConfigured } = useBaseUrl();
  return useQuery({
    queryKey: ['fleet-xray', 'template', baseUrl, templateId],
    queryFn: () => getXRayTemplate(baseUrl, templateId!),
    enabled: isConfigured && !!templateId,
    staleTime: 30_000,
  });
}

export function useCreateXRayTemplate() {
  const { baseUrl } = useBaseUrl();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GoldenTemplateInput) => createXRayTemplate(baseUrl, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet-xray', 'templates'] });
    },
  });
}

export function useUpdateXRayTemplate() {
  const { baseUrl } = useBaseUrl();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: GoldenTemplateInput }) =>
      updateXRayTemplate(baseUrl, id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet-xray', 'templates'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-xray', 'template'] });
    },
  });
}

export function useDeleteXRayTemplate() {
  const { baseUrl } = useBaseUrl();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteXRayTemplate(baseUrl, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet-xray', 'templates'] });
    },
  });
}

// ── Template Scores ──────────────────────────────────────────────────────────

export function useXRayTemplateScores(templateId: string | null) {
  const { baseUrl, isConfigured } = useBaseUrl();
  return useQuery({
    queryKey: ['fleet-xray', 'template-scores', baseUrl, templateId],
    queryFn: () => getXRayTemplateScores(baseUrl, templateId!),
    enabled: isConfigured && !!templateId,
    staleTime: 15_000,
  });
}

// ── DR Assessment ────────────────────────────────────────────────────────────

export function useXRayDRAssessment(primaryId: string | null, backupId: string | null) {
  const { baseUrl, isConfigured } = useBaseUrl();
  return useQuery({
    queryKey: ['fleet-xray', 'dr', baseUrl, primaryId, backupId],
    queryFn: () => getXRayDRAssessment(baseUrl, primaryId!, backupId!),
    enabled: isConfigured && !!primaryId && !!backupId,
    staleTime: 15_000,
  });
}

// ── Health History ───────────────────────────────────────────────────────────

export function useXRayHealthHistory(
  clusterId: string | null,
  from: number,
  to: number,
) {
  const { baseUrl, isConfigured } = useBaseUrl();
  return useQuery({
    queryKey: ['fleet-xray', 'history', baseUrl, clusterId, from, to],
    queryFn: () => getXRayHealthHistory(baseUrl, clusterId!, from, to),
    enabled: isConfigured && !!clusterId && from > 0 && to > from,
    staleTime: 60_000,
  });
}
