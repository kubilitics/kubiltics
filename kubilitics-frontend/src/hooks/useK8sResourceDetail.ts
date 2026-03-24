import { useQuery } from '@tanstack/react-query';
import { useK8sResource, useK8sResourceList, calculateAge, type KubernetesResource, type ResourceType } from './useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { getResourceEvents } from '@/services/backendApiClient';
import yaml from 'js-yaml';

/** Canonical K8s kind for involvedObject (used in events fieldSelector). */
export const RESOURCE_EVENTS_KIND = [
  'Pod', 'Deployment', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob',
  'Service', 'Ingress', 'IngressClass', 'Endpoints', 'EndpointSlice', 'NetworkPolicy',
  'ConfigMap', 'Secret', 'PersistentVolume', 'PersistentVolumeClaim', 'StorageClass', 'VolumeAttachment',
] as const;

export interface EventInfo {
  type: 'Normal' | 'Warning';
  reason: string;
  message: string;
  time: string;
}

// Convert a K8s resource object to YAML string
export function resourceToYaml(resource: KubernetesResource): string {
  if (!resource || Object.keys(resource).length === 0) return '';

  try {
    return yaml.dump(resource, {
      indent: 2,
      noArrayIndent: false,
      skipInvalid: true,
      flowLevel: -1,
      noRefs: true,
      lineWidth: -1,
    });
  } catch (err) {
    console.error('Failed to convert resource to YAML:', err);
    return '';
  }
}

// Hook to fetch events for a resource (namespace-wide when fieldSelector not provided; use useResourceEvents for resource-scoped).
export function useK8sEvents(namespace?: string, fieldSelector?: string) {
  const { data, isLoading, error } = useK8sResourceList<KubernetesResource>(
    'events',
    namespace,
    { enabled: !!namespace || !!fieldSelector, ...(fieldSelector ? { fieldSelector } : {}) }
  );

  const events: EventInfo[] = (data?.items || []).map((event: Record<string, unknown>) => ({
    type: (event.type === 'Warning' ? 'Warning' : 'Normal') as EventInfo['type'],
    reason: event.reason || '',
    message: event.message || '',
    time: event.lastTimestamp ? calculateAge(event.lastTimestamp) :
      event.eventTime ? calculateAge(event.eventTime) : 'unknown',
  }));

  return { events, isLoading, error };
}

/**
 * Resource-scoped events: backend getResourceEvents when configured, else K8s events list with
 * fieldSelector involvedObject.kind=kind,involvedObject.name=name. Use for detail Events tab (no mock).
 * @param kind Canonical K8s kind (e.g. 'Service', 'Deployment', 'Pod')
 * @param namespace Resource namespace (optional for cluster-scoped)
 * @param name Resource name
 */
export function useResourceEvents(
  kind: string,
  namespace: string | undefined,
  name: string | undefined
) {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;
  const useBackend = !!(isBackendConfigured && clusterId && name && (namespace !== undefined || kind === 'IngressClass'));

  const backendQuery = useQuery({
    queryKey: ['resource-events', clusterId, namespace ?? '', kind, name ?? ''],
    queryFn: () => getResourceEvents(baseUrl!, clusterId!, namespace ?? '', kind, name!, 20),
    enabled: useBackend && !!baseUrl,
    staleTime: 0,
    refetchOnMount: 'always' as const,
  });

  const fieldSelector = name && kind ? `involvedObject.name=${name},involvedObject.kind=${kind}` : undefined;
  const nsForK8s = namespace ?? 'default';
  const k8sList = useK8sResourceList<KubernetesResource & { type?: string; reason?: string; message?: string; lastTimestamp?: string; eventTime?: string }>(
    'events',
    nsForK8s,
    { enabled: !useBackend && !!name, fieldSelector: fieldSelector ?? '' }
  );

  const events: EventInfo[] = useBackend
    ? (backendQuery.data ?? []).map((e) => ({
      type: (e.type === 'Warning' ? 'Warning' : 'Normal') as EventInfo['type'],
      reason: e.reason ?? '',
      message: e.message ?? '',
      time: e.last_timestamp ? calculateAge(e.last_timestamp) : (e.first_timestamp ? calculateAge(e.first_timestamp) : 'unknown'),
    }))
    : (k8sList.data?.items ?? []).map((event: Record<string, unknown>) => ({
      type: (event.type === 'Warning' ? 'Warning' : 'Normal') as EventInfo['type'],
      reason: event.reason || '',
      message: event.message || '',
      time: event.lastTimestamp ? calculateAge(event.lastTimestamp) : (event.eventTime ? calculateAge(event.eventTime) : 'unknown'),
    }));

  const isLoading = useBackend ? backendQuery.isLoading : k8sList.isLoading;
  const error = useBackend ? backendQuery.error : k8sList.error;
  const refetch = useBackend ? backendQuery.refetch : k8sList.refetch;

  return { events, isLoading, error, refetch };
}

/** Pod-scoped events from backend (last 10–20 for the pod). Use when backend is configured. */
export function usePodEvents(namespace: string | undefined, podName: string | undefined) {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId ?? null;
  const enabled = !!(isBackendConfigured() && clusterId && namespace && podName);

  const query = useQuery({
    queryKey: ['backend', 'resource-events', clusterId, namespace, 'Pod', podName],
    queryFn: () => getResourceEvents(backendBaseUrl, clusterId!, namespace!, 'Pod', podName!, 20),
    enabled,
    staleTime: 60_000,
  });

  const events: EventInfo[] = (query.data ?? []).map((e) => ({
    type: (e.type === 'Warning' ? 'Warning' : 'Normal') as EventInfo['type'],
    reason: e.reason ?? '',
    message: e.message ?? '',
    time: e.last_timestamp ? calculateAge(e.last_timestamp) : e.first_timestamp ? calculateAge(e.first_timestamp) : 'unknown',
  }));

  return { events, isLoading: query.isLoading, error: query.error };
}

// Generic hook for resource detail. No mock data: when not connected, resource is undefined (page shows connect state).
export function useResourceDetail<T extends KubernetesResource>(
  resourceType: ResourceType,
  name: string | undefined,
  namespace: string | undefined,
  _mockData: T, // Kept for API compatibility; not used — we never show mock data.
  options?: { refetchInterval?: number | false; staleTime?: number }
) {
  const { isConnected } = useConnectionStatus();

  const { data, isLoading, error, refetch } = useK8sResource<T>(
    resourceType,
    name || '',
    namespace,
    { enabled: !!name, refetchInterval: options?.refetchInterval, staleTime: options?.staleTime }
  );

  const resource = isConnected && data ? (data as T) : undefined;
  const age = resource?.metadata?.creationTimestamp
    ? calculateAge(resource.metadata.creationTimestamp)
    : 'unknown';

  return {
    resource: resource ?? ({} as T),
    isLoading: isConnected ? isLoading : false,
    error,
    isConnected,
    age,
    refetch,
    yaml: resource ? resourceToYaml(resource) : '',
  };
}
