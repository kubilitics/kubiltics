/**
 * PERF Area 2: Prefetch resource data on sidebar link hover.
 *
 * The average hover-to-click time is 200-400ms. By starting the data fetch
 * on hover, the data is often ready in React Query's cache by the time the
 * user clicks — making navigation feel instant.
 *
 * Maps route paths to Kubernetes resource types, then calls
 * queryClient.prefetchQuery with the same key pattern used by page hooks.
 */
import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useProjectStore } from '@/stores/projectStore';
import { listResources } from '@/services/backendApiClient';

/** Maps sidebar route paths to the resource type(s) they display. */
const ROUTE_RESOURCE_MAP: Record<string, string[]> = {
  '/pods': ['pods'],
  '/deployments': ['deployments'],
  '/services': ['services'],
  '/nodes': ['nodes'],
  '/namespaces': ['namespaces'],
  '/events': ['events'],
  '/statefulsets': ['statefulsets'],
  '/daemonsets': ['daemonsets'],
  '/jobs': ['jobs'],
  '/cronjobs': ['cronjobs'],
  '/configmaps': ['configmaps'],
  '/secrets': ['secrets'],
  '/ingresses': ['ingresses'],
  '/replicasets': ['replicasets'],
  '/endpoints': ['endpoints'],
  '/endpointslices': ['endpointslices'],
  '/networkpolicies': ['networkpolicies'],
  '/persistentvolumes': ['persistentvolumes'],
  '/persistentvolumeclaims': ['persistentvolumeclaims'],
  '/storageclasses': ['storageclasses'],
  '/serviceaccounts': ['serviceaccounts'],
  '/roles': ['roles'],
  '/rolebindings': ['rolebindings'],
  '/clusterroles': ['clusterroles'],
  '/clusterrolebindings': ['clusterrolebindings'],
  '/horizontalpodautoscalers': ['horizontalpodautoscalers'],
  '/resourcequotas': ['resourcequotas'],
  '/limitranges': ['limitranges'],
  '/customresourcedefinitions': ['customresourcedefinitions'],
  '/leases': ['leases'],
  '/priorityclasses': ['priorityclasses'],
  '/poddisruptionbudgets': ['poddisruptionbudgets'],
  // Additional sidebar resources
  '/podtemplates': ['podtemplates'],
  '/controllerrevisions': ['controllerrevisions'],
  '/ingressclasses': ['ingressclasses'],
  '/ipaddresspools': ['ipaddresspools'],
  '/bgppeers': ['bgppeers'],
  '/volumeattachments': ['volumeattachments'],
  '/volumesnapshots': ['volumesnapshots'],
  '/volumesnapshotclasses': ['volumesnapshotclasses'],
  '/volumesnapshotcontents': ['volumesnapshotcontents'],
  '/apiservices': ['apiservices'],
  '/resourceslices': ['resourceslices'],
  '/deviceclasses': ['deviceclasses'],
  '/verticalpodautoscalers': ['verticalpodautoscalers'],
  '/customresources': ['customresources'],
  '/mutatingwebhooks': ['mutatingwebhookconfigurations'],
  '/validatingwebhooks': ['validatingwebhookconfigurations'],
  // Composite pages prefetch their primary resources
  '/workloads': ['pods', 'deployments', 'statefulsets', 'daemonsets'],
  '/dashboard': ['pods', 'deployments', 'services', 'nodes'],
  '/networking': ['services', 'ingresses', 'networkpolicies'],
  '/storage': ['configmaps', 'secrets', 'persistentvolumes', 'persistentvolumeclaims'],
  '/cluster': ['nodes', 'namespaces', 'events'],
  '/scaling': ['horizontalpodautoscalers', 'poddisruptionbudgets'],
  '/crds': ['customresourcedefinitions'],
  '/admission': ['mutatingwebhookconfigurations', 'validatingwebhookconfigurations'],
};

/**
 * Returns an onMouseEnter handler that prefetches data for the target route.
 * The prefetch is debounced (100ms) to avoid firing on accidental hovers.
 */
export function useHoverPrefetch() {
  const queryClient = useQueryClient();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const clusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prefetchRoute = useCallback(
    (path: string) => {
      if (!isBackendConfigured() || !clusterId || !activeCluster) return;

      const resourceTypes = ROUTE_RESOURCE_MAP[path];
      if (!resourceTypes) return;

      for (const resourceType of resourceTypes) {
        const queryKey = [
          'backend', 'resources', clusterId,
          activeProjectId ?? 'no-project', resourceType,
          '', '', '', '', '',
        ];

        // Only prefetch if not already fresh in cache
        const existing = queryClient.getQueryState(queryKey);
        if (existing?.dataUpdatedAt && Date.now() - existing.dataUpdatedAt < 30_000) continue;

        queryClient.prefetchQuery({
          queryKey,
          queryFn: () =>
            listResources(backendBaseUrl, clusterId, resourceType, {}).then(
              (r) => ({ items: r.items, metadata: r.metadata })
            ),
          staleTime: 30_000,
        });
      }
    },
    [queryClient, backendBaseUrl, clusterId, activeCluster, isBackendConfigured, activeProjectId],
  );

  const onMouseEnter = useCallback(
    (path: string) => {
      // 100ms debounce — only prefetch on intentional hover, not drive-by
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => prefetchRoute(path), 100);
    },
    [prefetchRoute],
  );

  const onMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return { onMouseEnter, onMouseLeave };
}
