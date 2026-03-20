/**
 * useGitOpsStatus — Hook for fetching GitOps sync status from ArgoCD / Flux annotations.
 *
 * Detects GitOps-managed resources by inspecting standard annotations:
 *   - ArgoCD: `argocd.argoproj.io/managed-by`, `argocd.argoproj.io/sync-status`
 *   - Flux: `kustomize.toolkit.fluxcd.io/name`, `helm.toolkit.fluxcd.io/name`
 *
 * Returns the sync status, provider, and metadata for a given resource.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';

/** Possible sync states for a GitOps-managed resource. */
export type GitOpsSyncState = 'synced' | 'out-of-sync' | 'progressing' | 'degraded' | 'suspended' | 'unknown';

/** Detected GitOps provider for a resource. */
export type GitOpsProvider = 'argocd' | 'flux' | 'none';

/** GitOps status information for a single resource. */
export interface GitOpsResourceStatus {
  /** Whether the resource is managed by any GitOps tool. */
  managed: boolean;
  /** Detected provider (argocd, flux, or none). */
  provider: GitOpsProvider;
  /** Current sync state. */
  syncState: GitOpsSyncState;
  /** Name of the ArgoCD Application or Flux Kustomization managing this resource. */
  appName: string | null;
  /** Source repository URL (if available from annotations). */
  repoUrl: string | null;
  /** Last sync timestamp (ISO string). */
  lastSyncTime: string | null;
  /** Human-readable status message. */
  message: string | null;
  /** Revision (commit SHA or chart version). */
  revision: string | null;
}

/** Arguments for the useGitOpsStatus hook. */
export interface UseGitOpsStatusArgs {
  /** Resource kind (e.g., "Deployment", "Service"). */
  kind: string;
  /** Resource name. */
  name: string;
  /** Resource namespace (empty for cluster-scoped). */
  namespace: string;
  /** Resource annotations — if provided, local detection is used without API call. */
  annotations?: Record<string, string>;
  /** Whether to enable the API query (default true). */
  enabled?: boolean;
}

// ─── ArgoCD annotation keys ──────────────────────────────────
const ARGOCD_MANAGED_BY = 'argocd.argoproj.io/managed-by';
const ARGOCD_SYNC_STATUS = 'argocd.argoproj.io/sync-status';
const ARGOCD_APP_INSTANCE = 'app.kubernetes.io/instance';
const ARGOCD_TRACKING = 'argocd.argoproj.io/tracking-id';

// ─── Flux annotation keys ────────────────────────────────────
const FLUX_KUSTOMIZE_NAME = 'kustomize.toolkit.fluxcd.io/name';
const FLUX_KUSTOMIZE_NS = 'kustomize.toolkit.fluxcd.io/namespace';
const FLUX_HELM_NAME = 'helm.toolkit.fluxcd.io/name';
const FLUX_HELM_NS = 'helm.toolkit.fluxcd.io/namespace';

/**
 * Detect GitOps status from resource annotations without making an API call.
 * This is a pure function suitable for use outside of React.
 */
export function detectGitOpsFromAnnotations(
  annotations: Record<string, string> | undefined,
): GitOpsResourceStatus {
  const empty: GitOpsResourceStatus = {
    managed: false,
    provider: 'none',
    syncState: 'unknown',
    appName: null,
    repoUrl: null,
    lastSyncTime: null,
    message: null,
    revision: null,
  };

  if (!annotations) return empty;

  // ─── ArgoCD Detection ────────────────────────────────────
  const argoManagedBy = annotations[ARGOCD_MANAGED_BY];
  const argoTracking = annotations[ARGOCD_TRACKING];
  const argoInstance = annotations[ARGOCD_APP_INSTANCE];

  if (argoManagedBy || argoTracking || argoInstance) {
    const syncRaw = annotations[ARGOCD_SYNC_STATUS]?.toLowerCase() ?? '';
    let syncState: GitOpsSyncState = 'unknown';
    if (syncRaw === 'synced') syncState = 'synced';
    else if (syncRaw === 'outofsync' || syncRaw === 'out-of-sync') syncState = 'out-of-sync';
    else if (syncRaw === 'progressing') syncState = 'progressing';
    else if (syncRaw === 'degraded') syncState = 'degraded';
    else if (syncRaw === 'suspended') syncState = 'suspended';

    return {
      managed: true,
      provider: 'argocd',
      syncState,
      appName: argoManagedBy || argoInstance || null,
      repoUrl: null,
      lastSyncTime: null,
      message: syncRaw ? `ArgoCD sync: ${syncRaw}` : 'Managed by ArgoCD',
      revision: null,
    };
  }

  // ─── Flux Detection ──────────────────────────────────────
  const fluxKustomizeName = annotations[FLUX_KUSTOMIZE_NAME];
  const fluxHelmName = annotations[FLUX_HELM_NAME];

  if (fluxKustomizeName || fluxHelmName) {
    const appName = fluxKustomizeName || fluxHelmName;
    const appNs = annotations[FLUX_KUSTOMIZE_NS] || annotations[FLUX_HELM_NS] || '';
    const qualifiedName = appNs ? `${appNs}/${appName}` : appName;
    const isHelm = !!fluxHelmName;

    return {
      managed: true,
      provider: 'flux',
      syncState: 'synced', // Flux doesn't annotate sync status on managed resources by default
      appName: qualifiedName ?? null,
      repoUrl: null,
      lastSyncTime: null,
      message: isHelm ? `Managed by Flux HelmRelease: ${qualifiedName}` : `Managed by Flux Kustomization: ${qualifiedName}`,
      revision: annotations['kustomize.toolkit.fluxcd.io/revision'] || null,
    };
  }

  return empty;
}

/**
 * Hook for fetching GitOps sync status for a Kubernetes resource.
 *
 * When `annotations` are provided, local detection is performed without an API call.
 * Otherwise, it queries the backend for the resource's GitOps status.
 */
export function useGitOpsStatus({
  kind,
  name,
  namespace,
  annotations,
  enabled = true,
}: UseGitOpsStatusArgs) {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(stored);
  const clusterId = useActiveClusterId();

  // Local detection from annotations
  const localStatus = useMemo(
    () => detectGitOpsFromAnnotations(annotations),
    [annotations],
  );

  // If annotations provided and detected, skip API call
  const shouldQuery = enabled && !localStatus.managed && !!clusterId && !!baseUrl;

  const query = useQuery<GitOpsResourceStatus>({
    queryKey: ['gitops-status', clusterId, kind, namespace, name],
    queryFn: async (): Promise<GitOpsResourceStatus> => {
      const params = new URLSearchParams({ kind, name, namespace });
      const res = await fetch(`${baseUrl}/api/v1/clusters/${clusterId}/gitops/status?${params}`);
      if (!res.ok) {
        // If 404, the resource is not GitOps-managed
        if (res.status === 404) {
          return {
            managed: false,
            provider: 'none',
            syncState: 'unknown',
            appName: null,
            repoUrl: null,
            lastSyncTime: null,
            message: null,
            revision: null,
          };
        }
        throw new Error(`Failed to fetch GitOps status: ${res.status}`);
      }
      return res.json();
    },
    enabled: shouldQuery,
    staleTime: 30_000,
    retry: 1,
  });

  // Prefer local annotation detection, fall back to API query
  const status = localStatus.managed ? localStatus : (query.data ?? localStatus);

  return {
    /** Resolved GitOps status (annotation-based or API-based). */
    status,
    /** Whether the API query is loading (false when using local annotations). */
    isLoading: shouldQuery ? query.isLoading : false,
    /** Error from the API query (null when using local annotations). */
    error: shouldQuery ? query.error : null,
    /** Refetch the API query. */
    refetch: query.refetch,
  };
}
