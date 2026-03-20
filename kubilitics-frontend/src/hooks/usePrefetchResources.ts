/**
 * PERF: Prefetch critical K8s resources as soon as a cluster is connected.
 *
 * The backend informer cache is populated within seconds of cluster connection.
 * This hook prefetches the most commonly needed resources so that navigating to
 * any resource page shows data instantly from React Query's cache.
 *
 * Similar to how Lens pre-populates its KubeObjectStores for all resource types
 * on cluster connect — the user sees data the moment they navigate.
 *
 * Prefetched resources (aligned with sidebar navigation):
 *  - pods, deployments, services, nodes, namespaces (dashboard)
 *  - statefulsets, daemonsets, jobs, cronjobs (workloads)
 *  - configmaps, secrets (config)
 *  - ingresses (networking)
 *  - events (overview)
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useProjectStore } from '@/stores/projectStore';
import { listResources } from '@/services/backendApiClient';

/** Resource types to prefetch on cluster connect */
const PREFETCH_RESOURCES = [
  'pods',
  'deployments',
  'services',
  'nodes',
  'namespaces',
  'statefulsets',
  'daemonsets',
  'jobs',
  'cronjobs',
  'configmaps',
  'secrets',
  'ingresses',
  'events',
] as const;

/**
 * Prefetches critical resources for the active cluster.
 * Call this in the app layout so prefetching starts immediately after connect.
 */
export function usePrefetchResources() {
  const queryClient = useQueryClient();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const clusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);

  const prefetchedRef = useRef<string | null>(null);

  useEffect(() => {
    // Only prefetch when we have a connected cluster
    if (!isBackendConfigured() || !clusterId || !activeCluster) return;

    // Don't re-prefetch for the same cluster (prevent double prefetch on re-renders)
    if (prefetchedRef.current === clusterId) return;
    prefetchedRef.current = clusterId;

    // Stagger prefetches slightly to avoid thundering herd on the backend
    // (though with informer cache, all should be <5ms each)
    const controller = new AbortController();

    const prefetch = async () => {
      for (const resourceType of PREFETCH_RESOURCES) {
        if (controller.signal.aborted) return;

        const queryKey = [
          'backend', 'resources', clusterId,
          activeProjectId ?? 'no-project', resourceType,
          '', // namespace (all)
          '', // projectNamespaces
          '', // limit
          '', // fieldSelector
          '', // labelSelector
        ];

        // Only prefetch if not already in cache
        const existing = queryClient.getQueryData(queryKey);
        if (existing) continue;

        queryClient.prefetchQuery({
          queryKey,
          queryFn: () =>
            listResources(backendBaseUrl, clusterId, resourceType, {}).then(
              (r) => ({ items: r.items, metadata: r.metadata })
            ),
          staleTime: 30_000,
        });

        // Small delay between prefetches to be nice to the backend
        // (with informer cache this is <1ms per request, but still be polite)
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };

    prefetch();

    return () => {
      controller.abort();
    };
  }, [clusterId, activeCluster, backendBaseUrl, isBackendConfigured, queryClient, activeProjectId]);
}
