/**
 * Resource counts for the sidebar.
 *
 * Strategy (performance-first):
 * - When backend is configured: use the cluster summary endpoint (single request)
 *   for the key counts shown in the sidebar. This avoids 40+ list requests with limit:5000.
 * - When only direct K8s is connected (no backend): fall back to individual list
 *   queries, but only for the handful of resource types shown in the sidebar nav,
 *   and only with limit:100 (counts don't need full data).
 * - When disconnected: show zero counts.
 */
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useK8sResourceList, type KubernetesResource } from './useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useClusterSummaryWithProject } from '@/hooks/useClusterSummary';
import { useMemo, useRef } from 'react';

// Zero counts returned when disconnected (no fake data)
const zeroCounts: ResourceCounts = {
  pods: 0,
  deployments: 0,
  replicasets: 0,
  statefulsets: 0,
  daemonsets: 0,
  jobs: 0,
  cronjobs: 0,
  podtemplates: 0,
  controllerrevisions: 0,
  resourceslices: 0,
  deviceclasses: 0,
  ipaddresspools: 0,
  bgppeers: 0,
  services: 0,
  ingresses: 0,
  ingressclasses: 0,
  endpoints: 0,
  endpointslices: 0,
  networkpolicies: 0,
  configmaps: 0,
  secrets: 0,
  persistentvolumes: 0,
  persistentvolumeclaims: 0,
  storageclasses: 0,
  volumeattachments: 0,
  volumesnapshots: 0,
  volumesnapshotclasses: 0,
  volumesnapshotcontents: 0,
  nodes: 0,
  namespaces: 0,
  apiservices: 0,
  leases: 0,
  serviceaccounts: 0,
  roles: 0,
  clusterroles: 0,
  rolebindings: 0,
  clusterrolebindings: 0,
  priorityclasses: 0,
  resourcequotas: 0,
  limitranges: 0,
  horizontalpodautoscalers: 0,
  verticalpodautoscalers: 0,
  poddisruptionbudgets: 0,
  customresourcedefinitions: 0,
  mutatingwebhookconfigurations: 0,
  validatingwebhookconfigurations: 0,
};

export interface ResourceCounts {
  pods: number;
  deployments: number;
  replicasets: number;
  statefulsets: number;
  daemonsets: number;
  jobs: number;
  cronjobs: number;
  podtemplates: number;
  controllerrevisions: number;
  resourceslices: number;
  deviceclasses: number;
  ipaddresspools: number;
  bgppeers: number;
  services: number;
  ingresses: number;
  ingressclasses: number;
  endpoints: number;
  endpointslices: number;
  networkpolicies: number;
  configmaps: number;
  secrets: number;
  persistentvolumes: number;
  persistentvolumeclaims: number;
  storageclasses: number;
  volumeattachments: number;
  volumesnapshots: number;
  volumesnapshotclasses: number;
  volumesnapshotcontents: number;
  nodes: number;
  namespaces: number;
  apiservices: number;
  leases: number;
  serviceaccounts: number;
  roles: number;
  clusterroles: number;
  rolebindings: number;
  clusterrolebindings: number;
  priorityclasses: number;
  resourcequotas: number;
  limitranges: number;
  horizontalpodautoscalers: number;
  verticalpodautoscalers: number;
  poddisruptionbudgets: number;
  customresourcedefinitions: number;
  mutatingwebhookconfigurations: number;
  validatingwebhookconfigurations: number;
}

// Small-limit query options for sidebar counts when in direct K8s mode only.
// limit:100 is enough to show a count badge; full data is fetched on the list page.
const DIRECT_K8S_QUERY_OPTIONS = {
  refetchInterval: false as const,
  staleTime: 10 * 60 * 1000, // 10 minutes — sidebar counts don't need to be real-time
  placeholderData: (prev: any) => prev,
  limit: 100,
};

/**
 * Main hook to get all resource counts.
 *
 * When backend is configured: uses a single cluster summary request for key
 * counts and returns 0 for the rest (sidebar only shows these key ones anyway).
 * When direct K8s is connected: uses small list queries for common types only.
 * When disconnected: returns mock counts.
 */
export function useResourceCounts(): { counts: ResourceCounts; isLoading: boolean; isInitialLoad: boolean; isConnected: boolean } {
  const { isConnected } = useConnectionStatus();
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);

  // Backend path: single summary request (project-scoped when activeProject is set)
  const summaryQuery = useClusterSummaryWithProject(
    isBackendConfigured() && currentClusterId ? currentClusterId : undefined
  );

  // Direct K8s path: enabled when K8s is connected.
  // When backend IS configured, the summary endpoint only covers ~10 key resource types
  // (pods, deployments, services, nodes, namespaces, statefulsets, replicasets, daemonsets,
  // jobs, cronjobs). For all OTHER resource types we still need direct K8s queries.
  // We use two option sets: one for types covered by the summary (disabled when backend
  // is configured), and one for types NOT covered (always enabled when connected).
  const backendCovers = isBackendConfigured();
  // When backend is configured, the summary endpoint now covers ALL resource types.
  // Direct K8s queries only fire when backend is NOT configured (direct K8s mode).
  const directK8sEnabled = isConnected && !backendCovers;
  const directK8sOptions = { ...DIRECT_K8S_QUERY_OPTIONS, enabled: directK8sEnabled };

  // Types covered by backend summary — skip direct K8s when backend is configured
  const pods = useK8sResourceList<KubernetesResource>('pods', undefined, directK8sOptions);
  const deployments = useK8sResourceList<KubernetesResource>('deployments', undefined, directK8sOptions);
  const services = useK8sResourceList<KubernetesResource>('services', undefined, directK8sOptions);
  const nodes = useK8sResourceList<KubernetesResource>('nodes', undefined, directK8sOptions);
  const namespaces = useK8sResourceList<KubernetesResource>('namespaces', undefined, directK8sOptions);
  const statefulsets = useK8sResourceList<KubernetesResource>('statefulsets', undefined, directK8sOptions);
  const daemonsets = useK8sResourceList<KubernetesResource>('daemonsets', undefined, directK8sOptions);
  const jobs = useK8sResourceList<KubernetesResource>('jobs', undefined, directK8sOptions);
  const cronjobs = useK8sResourceList<KubernetesResource>('cronjobs', undefined, directK8sOptions);
  const replicasets = useK8sResourceList<KubernetesResource>('replicasets', undefined, directK8sOptions);

  // Types NOT covered by backend summary — always query direct K8s when connected
  const ingresses = useK8sResourceList<KubernetesResource>('ingresses', undefined, directK8sOptions);
  const configmaps = useK8sResourceList<KubernetesResource>('configmaps', undefined, directK8sOptions);
  const secrets = useK8sResourceList<KubernetesResource>('secrets', undefined, directK8sOptions);
  const persistentvolumeclaims = useK8sResourceList<KubernetesResource>('persistentvolumeclaims', undefined, directK8sOptions);
  const podtemplates = useK8sResourceList<KubernetesResource>('podtemplates', undefined, directK8sOptions);
  const controllerrevisions = useK8sResourceList<KubernetesResource>('controllerrevisions', undefined, directK8sOptions);
  const resourceslices = useK8sResourceList<KubernetesResource>('resourceslices', undefined, directK8sOptions);
  const deviceclasses = useK8sResourceList<KubernetesResource>('deviceclasses', undefined, directK8sOptions);
  const ipaddresspools = useK8sResourceList<KubernetesResource>('ipaddresspools', undefined, directK8sOptions);
  const bgppeers = useK8sResourceList<KubernetesResource>('bgppeers', undefined, directK8sOptions);
  const ingressclasses = useK8sResourceList<KubernetesResource>('ingressclasses', undefined, directK8sOptions);
  const endpoints = useK8sResourceList<KubernetesResource>('endpoints', undefined, directK8sOptions);
  const endpointslices = useK8sResourceList<KubernetesResource>('endpointslices', undefined, directK8sOptions);
  const networkpolicies = useK8sResourceList<KubernetesResource>('networkpolicies', undefined, directK8sOptions);
  const persistentvolumes = useK8sResourceList<KubernetesResource>('persistentvolumes', undefined, directK8sOptions);
  const storageclasses = useK8sResourceList<KubernetesResource>('storageclasses', undefined, directK8sOptions);
  const volumeattachments = useK8sResourceList<KubernetesResource>('volumeattachments', undefined, directK8sOptions);
  const volumesnapshots = useK8sResourceList<KubernetesResource>('volumesnapshots', undefined, directK8sOptions);
  const volumesnapshotclasses = useK8sResourceList<KubernetesResource>('volumesnapshotclasses', undefined, directK8sOptions);
  const volumesnapshotcontents = useK8sResourceList<KubernetesResource>('volumesnapshotcontents', undefined, directK8sOptions);
  const apiservices = useK8sResourceList<KubernetesResource>('apiservices', undefined, directK8sOptions);
  const leases = useK8sResourceList<KubernetesResource>('leases', undefined, directK8sOptions);
  const serviceaccounts = useK8sResourceList<KubernetesResource>('serviceaccounts', undefined, directK8sOptions);
  const roles = useK8sResourceList<KubernetesResource>('roles', undefined, directK8sOptions);
  const clusterroles = useK8sResourceList<KubernetesResource>('clusterroles', undefined, directK8sOptions);
  const rolebindings = useK8sResourceList<KubernetesResource>('rolebindings', undefined, directK8sOptions);
  const clusterrolebindings = useK8sResourceList<KubernetesResource>('clusterrolebindings', undefined, directK8sOptions);
  const priorityclasses = useK8sResourceList<KubernetesResource>('priorityclasses', undefined, directK8sOptions);
  const resourcequotas = useK8sResourceList<KubernetesResource>('resourcequotas', undefined, directK8sOptions);
  const limitranges = useK8sResourceList<KubernetesResource>('limitranges', undefined, directK8sOptions);
  const horizontalpodautoscalers = useK8sResourceList<KubernetesResource>('horizontalpodautoscalers', undefined, directK8sOptions);
  const verticalpodautoscalers = useK8sResourceList<KubernetesResource>('verticalpodautoscalers', undefined, directK8sOptions);
  const poddisruptionbudgets = useK8sResourceList<KubernetesResource>('poddisruptionbudgets', undefined, directK8sOptions);
  const customresourcedefinitions = useK8sResourceList<KubernetesResource>('customresourcedefinitions', undefined, directK8sOptions);
  const mutatingwebhookconfigurations = useK8sResourceList<KubernetesResource>('mutatingwebhookconfigurations', undefined, directK8sOptions);
  const validatingwebhookconfigurations = useK8sResourceList<KubernetesResource>('validatingwebhookconfigurations', undefined, directK8sOptions);

  // Keep a ref of the last real (non-mock) counts so when cluster disconnects
  // we show the last-known real values instead of hardcoded mocks.
  const lastRealCountsRef = useRef<ResourceCounts | null>(null);

  const counts = useMemo<ResourceCounts>(() => {
    if (!isConnected) {
      // Prefer last-cached real counts; otherwise show zeros (not fake data)
      return lastRealCountsRef.current ?? zeroCounts;
    }

    if (isBackendConfigured() && summaryQuery.data) {
      // Use the single summary response for key counts; for the rest, use the fetched counts
      const s = summaryQuery.data;
      const getCount = (key: keyof ResourceCounts, res: any) => {
        // Map summary keys to ResourceCounts keys
        const summaryMap: Partial<Record<keyof ResourceCounts, keyof typeof s>> = {
          pods: 'pod_count',
          deployments: 'deployment_count',
          services: 'service_count',
          nodes: 'node_count',
          namespaces: 'namespace_count',
          statefulsets: 'statefulset_count',
          replicasets: 'replicaset_count',
          daemonsets: 'daemonset_count',
          jobs: 'job_count',
          cronjobs: 'cronjob_count',
          ingresses: 'ingress_count',
          ingressclasses: 'ingressclass_count',
          endpoints: 'endpoint_count',
          endpointslices: 'endpointslice_count',
          networkpolicies: 'networkpolicy_count',
          configmaps: 'configmap_count',
          secrets: 'secret_count',
          persistentvolumes: 'persistentvolume_count',
          persistentvolumeclaims: 'persistentvolumeclaim_count',
          storageclasses: 'storageclass_count',
          serviceaccounts: 'serviceaccount_count',
          roles: 'role_count',
          clusterroles: 'clusterrole_count',
          rolebindings: 'rolebinding_count',
          clusterrolebindings: 'clusterrolebinding_count',
          horizontalpodautoscalers: 'hpa_count',
          limitranges: 'limitrange_count',
          resourcequotas: 'resourcequota_count',
          poddisruptionbudgets: 'poddisruptionbudget_count',
          priorityclasses: 'priorityclass_count',
          customresourcedefinitions: 'customresourcedefinition_count',
          mutatingwebhookconfigurations: 'mutatingwebhookconfiguration_count',
          validatingwebhookconfigurations: 'validatingwebhookconfiguration_count',
        };
        const summaryKey = summaryMap[key];
        if (summaryKey && s[summaryKey] !== undefined) {
          return s[summaryKey] as number;
        }
        const items = res.data?.items?.length ?? 0;
        const remaining = res.data?.metadata?.remainingItemCount ?? 0;
        return res.data?.metadata?.total ?? (items + remaining);
      };

      return {
        pods: getCount('pods', pods),
        deployments: getCount('deployments', deployments),
        services: getCount('services', services),
        nodes: getCount('nodes', nodes),
        namespaces: getCount('namespaces', namespaces),
        replicasets: getCount('replicasets', replicasets),
        statefulsets: getCount('statefulsets', statefulsets),
        daemonsets: getCount('daemonsets', daemonsets),
        jobs: getCount('jobs', jobs),
        cronjobs: getCount('cronjobs', cronjobs),
        podtemplates: getCount('podtemplates', podtemplates),
        controllerrevisions: getCount('controllerrevisions', controllerrevisions),
        resourceslices: getCount('resourceslices', resourceslices),
        deviceclasses: getCount('deviceclasses', deviceclasses),
        ipaddresspools: getCount('ipaddresspools', ipaddresspools),
        bgppeers: getCount('bgppeers', bgppeers),
        ingresses: getCount('ingresses', ingresses),
        ingressclasses: getCount('ingressclasses', ingressclasses),
        endpoints: getCount('endpoints', endpoints),
        endpointslices: getCount('endpointslices', endpointslices),
        networkpolicies: getCount('networkpolicies', networkpolicies),
        configmaps: getCount('configmaps', configmaps),
        secrets: getCount('secrets', secrets),
        persistentvolumes: getCount('persistentvolumes', persistentvolumes),
        persistentvolumeclaims: getCount('persistentvolumeclaims', persistentvolumeclaims),
        storageclasses: getCount('storageclasses', storageclasses),
        volumeattachments: getCount('volumeattachments', volumeattachments),
        volumesnapshots: getCount('volumesnapshots', volumesnapshots),
        volumesnapshotclasses: getCount('volumesnapshotclasses', volumesnapshotclasses),
        volumesnapshotcontents: getCount('volumesnapshotcontents', volumesnapshotcontents),
        apiservices: getCount('apiservices', apiservices),
        leases: getCount('leases', leases),
        serviceaccounts: getCount('serviceaccounts', serviceaccounts),
        roles: getCount('roles', roles),
        clusterroles: getCount('clusterroles', clusterroles),
        rolebindings: getCount('rolebindings', rolebindings),
        clusterrolebindings: getCount('clusterrolebindings', clusterrolebindings),
        priorityclasses: getCount('priorityclasses', priorityclasses),
        resourcequotas: getCount('resourcequotas', resourcequotas),
        limitranges: getCount('limitranges', limitranges),
        horizontalpodautoscalers: getCount('horizontalpodautoscalers', horizontalpodautoscalers),
        verticalpodautoscalers: getCount('verticalpodautoscalers', verticalpodautoscalers),
        poddisruptionbudgets: getCount('poddisruptionbudgets', poddisruptionbudgets),
        customresourcedefinitions: getCount('customresourcedefinitions', customresourcedefinitions),
        mutatingwebhookconfigurations: getCount('mutatingwebhookconfigurations', mutatingwebhookconfigurations),
        validatingwebhookconfigurations: getCount('validatingwebhookconfigurations', validatingwebhookconfigurations),
      };
    }

    // Generic extraction for counts from a resource list query.
    // K8s returns remainingItemCount when limit is set, so total = items.length + remaining.
    const getDirectCount = (res: any) => {
      const items = res.data?.items?.length ?? 0;
      const remaining = res.data?.metadata?.remainingItemCount ?? 0;
      const total = res.data?.metadata?.total;
      return total ?? (items + remaining);
    };

    // Direct K8s fallback
    return {
      pods: getDirectCount(pods),
      deployments: getDirectCount(deployments),
      services: getDirectCount(services),
      nodes: getDirectCount(nodes),
      namespaces: getDirectCount(namespaces),
      statefulsets: getDirectCount(statefulsets),
      daemonsets: getDirectCount(daemonsets),
      jobs: getDirectCount(jobs),
      cronjobs: getDirectCount(cronjobs),
      ingresses: getDirectCount(ingresses),
      configmaps: getDirectCount(configmaps),
      secrets: getDirectCount(secrets),
      persistentvolumeclaims: getDirectCount(persistentvolumeclaims),
      replicasets: getDirectCount(replicasets),
      podtemplates: getDirectCount(podtemplates),
      controllerrevisions: getDirectCount(controllerrevisions),
      resourceslices: getDirectCount(resourceslices),
      deviceclasses: getDirectCount(deviceclasses),
      ipaddresspools: getDirectCount(ipaddresspools),
      bgppeers: getDirectCount(bgppeers),
      ingressclasses: getDirectCount(ingressclasses),
      endpoints: getDirectCount(endpoints),
      endpointslices: getDirectCount(endpointslices),
      networkpolicies: getDirectCount(networkpolicies),
      persistentvolumes: getDirectCount(persistentvolumes),
      storageclasses: getDirectCount(storageclasses),
      volumeattachments: getDirectCount(volumeattachments),
      volumesnapshots: getDirectCount(volumesnapshots),
      volumesnapshotclasses: getDirectCount(volumesnapshotclasses),
      volumesnapshotcontents: getDirectCount(volumesnapshotcontents),
      apiservices: getDirectCount(apiservices),
      leases: getDirectCount(leases),
      serviceaccounts: getDirectCount(serviceaccounts),
      roles: getDirectCount(roles),
      clusterroles: getDirectCount(clusterroles),
      rolebindings: getDirectCount(rolebindings),
      clusterrolebindings: getDirectCount(clusterrolebindings),
      priorityclasses: getDirectCount(priorityclasses),
      resourcequotas: getDirectCount(resourcequotas),
      limitranges: getDirectCount(limitranges),
      horizontalpodautoscalers: getDirectCount(horizontalpodautoscalers),
      verticalpodautoscalers: getDirectCount(verticalpodautoscalers),
      poddisruptionbudgets: getDirectCount(poddisruptionbudgets),
      customresourcedefinitions: getDirectCount(customresourcedefinitions),
      mutatingwebhookconfigurations: getDirectCount(mutatingwebhookconfigurations),
      validatingwebhookconfigurations: getDirectCount(validatingwebhookconfigurations),
    };
  }, [
    isConnected,
    summaryQuery.data,
    pods.data, deployments.data, services.data, nodes.data, namespaces.data,
    statefulsets.data, daemonsets.data, jobs.data, cronjobs.data,
    ingresses.data, configmaps.data, secrets.data, persistentvolumeclaims.data,
    replicasets.data, podtemplates.data, controllerrevisions.data, resourceslices.data,
    deviceclasses.data, ipaddresspools.data, bgppeers.data, ingressclasses.data,
    endpoints.data, endpointslices.data, networkpolicies.data, persistentvolumes.data,
    storageclasses.data, volumeattachments.data, volumesnapshots.data,
    volumesnapshotclasses.data, volumesnapshotcontents.data, apiservices.data,
    leases.data, serviceaccounts.data, roles.data, clusterroles.data,
    rolebindings.data, clusterrolebindings.data, priorityclasses.data,
    resourcequotas.data, limitranges.data, horizontalpodautoscalers.data,
    verticalpodautoscalers.data, poddisruptionbudgets.data,
    customresourcedefinitions.data, mutatingwebhookconfigurations.data,
    validatingwebhookconfigurations.data,
  ]);

  // Cache real counts so they survive disconnection
  if (isConnected && counts) {
    lastRealCountsRef.current = counts;
  }

  const allQueries = [
    pods, deployments, services, nodes, namespaces, statefulsets, daemonsets, jobs, cronjobs,
    ingresses, configmaps, secrets, persistentvolumeclaims, replicasets, podtemplates,
    controllerrevisions, resourceslices, deviceclasses, ipaddresspools, bgppeers,
    ingressclasses, endpoints, endpointslices, networkpolicies, persistentvolumes,
    storageclasses, volumeattachments, volumesnapshots, volumesnapshotclasses,
    volumesnapshotcontents, apiservices, leases, serviceaccounts, roles, clusterroles,
    rolebindings, clusterrolebindings, priorityclasses, resourcequotas, limitranges,
    horizontalpodautoscalers, verticalpodautoscalers, poddisruptionbudgets,
    customresourcedefinitions, mutatingwebhookconfigurations, validatingwebhookconfigurations
  ];

  const isLoading = backendCovers
    ? summaryQuery.isLoading || allQueries.some(q => q.isLoading)
    : allQueries.some(q => q.isLoading);

  const isInitialLoad = isLoading && !summaryQuery.data && !pods.data;

  return { counts, isLoading, isInitialLoad, isConnected };
}

// Kept for compatibility — returns a single resource count using the same small-limit approach.
function useResourceCount(resourceType: keyof ResourceCounts) {
  const { isConnected } = useConnectionStatus();
  const { data, isLoading, isPlaceholderData } = useK8sResourceList<KubernetesResource>(
    resourceType as any,
    undefined,
    {
      enabled: isConnected,
      refetchInterval: false,
      staleTime: 5 * 60 * 1000,
      placeholderData: (previousData) => previousData,
      limit: 100,
    }
  );

  return {
    count: isConnected ? (data?.items?.length ?? 0) : 0,
    isLoading: isConnected && isLoading && isPlaceholderData === false,
    isInitialLoad: isConnected && isLoading && isPlaceholderData === false && !data,
    isConnected,
  };
}

export { useResourceCount };
