import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useKubernetesConfigStore } from '@/stores/kubernetesConfigStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { listResources, getResource, deleteResource, patchResource, applyManifest, getPodLogsUrl, CONFIRM_DESTRUCTIVE_HEADER, getCronJobJobs, BackendApiError } from '@/services/backendApiClient';
import { notifyError, notifySuccess } from '@/lib/notificationFormatter';
import yamlParser from 'js-yaml';
import { useProjectStore } from '@/stores/projectStore';
import { toast } from 'sonner';

// Types for Kubernetes resources
export interface KubernetesMetadata {
  name: string;
  namespace?: string;
  uid: string;
  creationTimestamp: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  resourceVersion?: string;
  ownerReferences?: Array<{
    apiVersion: string;
    kind: string;
    name: string;
    uid: string;
  }>;
}

export interface KubernetesResource {
  apiVersion?: string;
  kind?: string;
  metadata: KubernetesMetadata;
  spec?: Record<string, any>;
  status?: Record<string, any>;
}

export interface ResourceList<T> {
  items: T[];
  metadata?: {
    continue?: string;
    resourceVersion?: string;
    remainingItemCount?: number;
    total?: number;
  };
}

// API Group paths mapping
export const API_GROUPS = {
  // Core API (v1)
  pods: '/api/v1',
  services: '/api/v1',
  configmaps: '/api/v1',
  secrets: '/api/v1',
  namespaces: '/api/v1',
  nodes: '/api/v1',
  persistentvolumes: '/api/v1',
  persistentvolumeclaims: '/api/v1',
  serviceaccounts: '/api/v1',
  endpoints: '/api/v1',
  events: '/api/v1',
  resourcequotas: '/api/v1',
  limitranges: '/api/v1',
  replicationcontrollers: '/api/v1',
  podtemplates: '/api/v1',
  componentstatuses: '/api/v1',

  // Apps API
  deployments: '/apis/apps/v1',
  replicasets: '/apis/apps/v1',
  statefulsets: '/apis/apps/v1',
  daemonsets: '/apis/apps/v1',
  controllerrevisions: '/apis/apps/v1',

  // Batch API
  jobs: '/apis/batch/v1',
  cronjobs: '/apis/batch/v1',

  // Networking API
  ingresses: '/apis/networking.k8s.io/v1',
  ingressclasses: '/apis/networking.k8s.io/v1',
  networkpolicies: '/apis/networking.k8s.io/v1',

  // Storage API
  storageclasses: '/apis/storage.k8s.io/v1',
  volumeattachments: '/apis/storage.k8s.io/v1',

  // Snapshot API (CSI Volume Snapshots)
  volumesnapshots: '/apis/snapshot.storage.k8s.io/v1',
  volumesnapshotclasses: '/apis/snapshot.storage.k8s.io/v1',
  volumesnapshotcontents: '/apis/snapshot.storage.k8s.io/v1',

  // RBAC API
  roles: '/apis/rbac.authorization.k8s.io/v1',
  rolebindings: '/apis/rbac.authorization.k8s.io/v1',
  clusterroles: '/apis/rbac.authorization.k8s.io/v1',
  clusterrolebindings: '/apis/rbac.authorization.k8s.io/v1',

  // Autoscaling API
  horizontalpodautoscalers: '/apis/autoscaling/v2',
  verticalpodautoscalers: '/apis/autoscaling.k8s.io/v1',

  // Policy API
  poddisruptionbudgets: '/apis/policy/v1',
  podsecuritypolicies: '/apis/policy/v1beta1',

  // Discovery API
  endpointslices: '/apis/discovery.k8s.io/v1',

  // DRA API (Dynamic Resource Allocation - K8s 1.31+)
  resourceslices: '/apis/resource.k8s.io/v1alpha3',
  deviceclasses: '/apis/resource.k8s.io/v1',

  // MetalLB CRDs (bare-metal load balancer)
  ipaddresspools: '/apis/metallb.io/v1beta1',
  bgppeers: '/apis/metallb.io/v1beta2',

  // Scheduling API
  priorityclasses: '/apis/scheduling.k8s.io/v1',

  // Node API
  runtimeclasses: '/apis/node.k8s.io/v1',

  // Coordination API
  leases: '/apis/coordination.k8s.io/v1',

  // API Registration
  apiservices: '/apis/apiregistration.k8s.io/v1',

  // Custom Resources
  customresourcedefinitions: '/apis/apiextensions.k8s.io/v1',

  // Admission Control
  mutatingwebhookconfigurations: '/apis/admissionregistration.k8s.io/v1',
  validatingwebhookconfigurations: '/apis/admissionregistration.k8s.io/v1',

  // Gateway API (gateway.networking.k8s.io)
  gateways: '/apis/gateway.networking.k8s.io/v1',
  gatewayclasses: '/apis/gateway.networking.k8s.io/v1',
  httproutes: '/apis/gateway.networking.k8s.io/v1',
  grpcroutes: '/apis/gateway.networking.k8s.io/v1',
} as const;

export type ResourceType = keyof typeof API_GROUPS;

// API client wrapper
async function k8sRequest<T>(
  path: string,
  options: RequestInit = {},
  config: { apiUrl: string; token?: string }
): Promise<T> {
  const { apiUrl, token } = config;

  if (!apiUrl) {
    throw new Error('Kubernetes API URL not configured');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Kubernetes API error: ${response.status} - ${error}`);
  }

  return response.json();
}

// Cluster-scoped resource kinds (shared for path building)
const CLUSTER_SCOPED_KINDS: ResourceType[] = [
  'nodes', 'namespaces', 'persistentvolumes', 'storageclasses',
  'clusterroles', 'clusterrolebindings', 'ingressclasses', 'priorityclasses',
  'runtimeclasses', 'apiservices', 'customresourcedefinitions', 'volumeattachments',
  'mutatingwebhookconfigurations', 'validatingwebhookconfigurations', 'podsecuritypolicies',
  'volumesnapshotclasses', 'volumesnapshotcontents',
  'resourceslices', 'deviceclasses', 'componentstatuses',
  'gatewayclasses',
];

// Generic hook for fetching any K8s resource list (backend or direct K8s). Per A3.3: single code path for backend mode.
// When backend is used, optional options.limit (e.g. 5000) requests that many items for count/sidebar use.
export function useK8sResourceList<T extends KubernetesResource>(
  resourceType: ResourceType,
  namespace?: string,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
    limit?: number;
    fieldSelector?: string;
    labelSelector?: string;
    staleTime?: number;
    placeholderData?: (previousData: ResourceList<T> | undefined) => ResourceList<T> | undefined;
  }
) {
  const { config } = useKubernetesConfigStore();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const isDemo = useClusterStore((s) => s.isDemo);
  // P0-D: Use currentClusterId exclusively for API paths.
  const clusterId = currentClusterId;
  // P1-8: Demo mode must not fire backend or real K8s requests.
  const skipRequests = isDemo;

  const { activeProject, activeProjectId } = useProjectStore();
  const projectNamespaces = useMemo(() => {
    if (!activeProject || !clusterId || !activeProject.clusters) return null;
    const projectCluster = activeProject.clusters.find(c => c.cluster_id === clusterId);
    return projectCluster?.namespaces ?? null;
  }, [activeProject, clusterId]);
  // Project scope: single namespace -> namespace param; multiple or zero -> namespaces param.
  const projectNamespaceParam =
    projectNamespaces && projectNamespaces.length === 1 ? projectNamespaces[0]! : undefined;
  const projectNamespacesParam =
    projectNamespaces && projectNamespaces.length !== 1 ? projectNamespaces : undefined;

  const apiBase = API_GROUPS[resourceType];
  const isClusterScoped = CLUSTER_SCOPED_KINDS.includes(resourceType);
  const path = isClusterScoped || !namespace
    ? `${apiBase}/${resourceType}`
    : `${apiBase}/namespaces/${namespace}/${resourceType}`;

  const useBackend = isBackendConfigured() && !!clusterId;
  const limit = options?.limit;
  const fieldSelector = options?.fieldSelector;
  const labelSelector = options?.labelSelector;

  return useQuery({
    queryKey: useBackend
      ? ['backend', 'resources', clusterId, activeProjectId ?? 'no-project', resourceType, namespace, projectNamespacesParam?.join(',') ?? '', limit ?? '', fieldSelector ?? '', labelSelector ?? '']
      : ['k8s', resourceType, namespace, fieldSelector ?? '', labelSelector ?? ''],
    queryFn: useBackend
      ? async () => {
        const listParams: Parameters<typeof listResources>[3] = {
          ...(limit != null && limit > 0 ? { limit } : {}),
          ...(fieldSelector ? { fieldSelector } : {}),
          ...(labelSelector ? { labelSelector } : {}),
        };
        if (!isClusterScoped) {
          if (projectNamespacesParam !== undefined) {
            listParams.namespaces = projectNamespacesParam;
          } else if (namespace || projectNamespaceParam) {
            listParams.namespace = namespace || projectNamespaceParam;
          }
        }
        const r = await listResources(backendBaseUrl, clusterId!, resourceType, listParams);
        return { items: r.items as T[], metadata: r.metadata } as ResourceList<T>;
      }
      : () => {
        const query = [fieldSelector && `fieldSelector=${encodeURIComponent(fieldSelector)}`, labelSelector && `labelSelector=${encodeURIComponent(labelSelector)}`].filter(Boolean).join('&');
        return k8sRequest<ResourceList<T>>(path + (query ? `?${query}` : ''), {}, config);
      },
    enabled: !skipRequests && (useBackend ? true : config.isConnected) && (options?.enabled !== false),
    // Poll every 5 min as a safety net only. Real-time updates come via WebSocket
    // (useResourceLiveUpdates) which invalidates queries on resource changes.
    // With informer cache (<1ms reads) + WebSocket invalidation, polling is just
    // a last-resort fallback. Headlamp doesn't poll at all when watching.
    refetchInterval: options?.refetchInterval ?? 5 * 60_000,
    // 60s staleTime: data from informer cache is always consistent.
    // WebSocket invalidation triggers immediate refetch when resources change.
    // Navigation back to a page shows cached data instantly (no loading state).
    staleTime: options?.staleTime ?? 60_000,
    // Refetch on mount only if data is stale (>60s old)
    refetchOnMount: true,
    // Keep previous data while refetching to avoid flash of empty state.
    // In React Query v5, keepPreviousData is a placeholderData function.
    placeholderData: options?.placeholderData ?? keepPreviousData,
    // Retry failed requests with exponential backoff (1s, 2s, 4s).
    // Don't retry 404s — the resource type doesn't exist in the cluster.
    retry: (failureCount: number, error: Error) => {
      if (error instanceof BackendApiError && error.status === 404) return false;
      return failureCount < 3;
    },
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 8000),
  });
}

const DEFAULT_PAGE_SIZE = 10;

/** Pagination-aware list hook for backend mode (limit + continue). When backend is not configured, returns full list (no pagination). */
export function useK8sResourceListPaginated<T extends KubernetesResource>(
  resourceType: ResourceType,
  namespace?: string,
  options?: { limit?: number; continue?: string; enabled?: boolean }
) {
  const { config } = useKubernetesConfigStore();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  // P0-D: Use currentClusterId exclusively. activeCluster.id may hold a stale or demo
  // ID (e.g. '__demo__cluster-alpha') which corrupts all resource API URLs.
  const clusterId = currentClusterId;

  const { activeProject, activeProjectId } = useProjectStore();
  const projectNamespaces = useMemo(() => {
    if (!activeProject || !clusterId || !activeProject.clusters) return null;
    const projectCluster = activeProject.clusters.find(c => c.cluster_id === clusterId);
    return projectCluster?.namespaces ?? null;
  }, [activeProject, clusterId]);
  const projectNamespaceParam =
    projectNamespaces && projectNamespaces.length === 1 ? projectNamespaces[0]! : undefined;
  const projectNamespacesParam =
    projectNamespaces && projectNamespaces.length !== 1 ? projectNamespaces : undefined;

  const apiBase = API_GROUPS[resourceType];
  const isClusterScoped = CLUSTER_SCOPED_KINDS.includes(resourceType);
  const path = isClusterScoped || !namespace
    ? `${apiBase}/${resourceType}`
    : `${apiBase}/namespaces/${namespace}/${resourceType}`;

  const useBackend = isBackendConfigured() && !!clusterId;
  const limit = options?.limit ?? DEFAULT_PAGE_SIZE;
  const continueToken = options?.continue;

  return useQuery({
    queryKey: useBackend
      ? ['backend', 'resources', clusterId, activeProjectId ?? 'no-project', resourceType, namespace, projectNamespacesParam?.join(',') ?? '', limit, continueToken ?? '']
      : ['k8s', resourceType, namespace],
    queryFn: useBackend
      ? () => {
        const listParams: Parameters<typeof listResources>[3] = { limit, ...(continueToken ? { continue: continueToken } : {}) };
        if (!isClusterScoped) {
          if (projectNamespacesParam !== undefined) {
            listParams.namespaces = projectNamespacesParam;
          } else if (namespace || projectNamespaceParam) {
            listParams.namespace = namespace || projectNamespaceParam;
          }
        }
        return listResources(backendBaseUrl, clusterId!, resourceType, listParams).then(
          (r) => ({ items: r.items as T[], metadata: r.metadata } as ResourceList<T>)
        );
      }
      : () => k8sRequest<ResourceList<T>>(path, {}, config),
    enabled: (useBackend ? true : config.isConnected) && (options?.enabled !== false),
    staleTime: 5_000,
    refetchOnMount: 'always',
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
}

/** Pagination state for ResourceList: when backend is used, returns pagination props; otherwise undefined. */
export interface UsePaginatedResourceListPagination {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  rangeLabel?: string;
  /** 1-based; set with totalPages when total is known (client-side) so list can show page numbers. */
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  /** React Query dataUpdatedAt (ms) for "Updated X ago" footer indicator. */
  dataUpdatedAt?: number;
  /** React Query isFetching for footer loading indicator. */
  isFetching?: boolean;
}

/** Full-list fetch limit when using backend (same as Pods / useResourceCounts). */
const FULL_LIST_LIMIT = 5000;

/** Single hook: full-list fetch (limit 5000 when backend, same as Pods), then client-side pagination so counts and stats match sidebar. */
export function usePaginatedResourceList<T extends KubernetesResource>(
  resourceType: ResourceType,
  namespace?: string,
  options?: { enabled?: boolean; pageSize?: number }
) {
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  // P0-D: Use currentClusterId exclusively. activeCluster.id may hold a stale or demo
  // ID (e.g. '__demo__cluster-alpha') which corrupts all resource API URLs.
  const clusterId = currentClusterId;
  const useBackend = isBackendConfigured() && !!clusterId;
  const pageSize = Math.max(1, Math.min(100, options?.pageSize ?? DEFAULT_PAGE_SIZE));
  const [clientPageIndex, setClientPageIndex] = useState(0);

  const fullListDirect = useK8sResourceList<T>(resourceType, namespace, {
    enabled: !useBackend && (options?.enabled !== false),
  });
  const fullListBackend = useK8sResourceList<T>(resourceType, namespace, {
    enabled: useBackend && (options?.enabled !== false),
    limit: FULL_LIST_LIMIT,
  });

  const fullItems = useBackend
    ? (fullListBackend.data?.items ?? [])
    : (fullListDirect.data?.items ?? []);
  const isLoading = useBackend ? fullListBackend.isLoading : fullListDirect.isLoading;
  const isError = useBackend ? fullListBackend.isError : fullListDirect.isError;
  const refetch = useBackend ? fullListBackend.refetch : fullListDirect.refetch;
  const metadata = useBackend ? fullListBackend.data?.metadata : fullListDirect.data?.metadata;
  const dataUpdatedAt = useBackend ? fullListBackend.dataUpdatedAt : fullListDirect.dataUpdatedAt;
  const isFetching = useBackend ? fullListBackend.isFetching : fullListDirect.isFetching;

  // Client-side pagination over full list (same as Pods)
  const totalClient = fullItems.length;
  const maxClientPage = Math.max(0, Math.ceil(totalClient / pageSize) - 1);
  const safeClientPageIndex = Math.min(clientPageIndex, maxClientPage);
  const clientStart = safeClientPageIndex * pageSize;
  const clientPageItems = fullItems.slice(clientStart, clientStart + pageSize);
  const totalClientPages = Math.max(1, Math.ceil(totalClient / pageSize));

  const pagination: UsePaginatedResourceListPagination = {
    hasPrev: safeClientPageIndex > 0,
    hasNext: clientStart + pageSize < totalClient,
    onPrev: () => setClientPageIndex((i) => Math.max(0, i - 1)),
    onNext: () => setClientPageIndex((i) => i + 1),
    rangeLabel:
      totalClient > 0
        ? `Showing ${clientStart + 1}–${Math.min(clientStart + pageSize, totalClient)} of ${totalClient}`
        : isLoading ? 'Loading…' : 'No items',
    currentPage: safeClientPageIndex + 1,
    totalPages: totalClientPages,
    onPageChange: (p) => setClientPageIndex(Math.max(0, Math.min(p - 1, totalClientPages - 1))),
    dataUpdatedAt,
    isFetching,
  };

  useEffect(() => {
    if (clientPageIndex > maxClientPage && maxClientPage >= 0) {
      setClientPageIndex(maxClientPage);
    }
  }, [clientPageIndex, maxClientPage]);

  return {
    data: {
      items: clientPageItems,
      allItems: fullItems,
      metadata,
    },
    isLoading,
    isError,
    refetch,
    pagination,
    pageSize,
  };
}

// Hook for fetching a single resource (backend or direct K8s). Per A3.3: single code path for backend mode.
export function useK8sResource<T extends KubernetesResource>(
  resourceType: ResourceType,
  name: string,
  namespace?: string,
  options?: { enabled?: boolean; refetchInterval?: number | false; staleTime?: number }
) {
  const { config } = useKubernetesConfigStore();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const isDemo = useClusterStore((s) => s.isDemo);
  const clusterId = currentClusterId;

  const apiBase = API_GROUPS[resourceType];
  const isClusterScoped = CLUSTER_SCOPED_KINDS.includes(resourceType);
  const path = isClusterScoped || !namespace
    ? `${apiBase}/${resourceType}/${name}`
    : `${apiBase}/namespaces/${namespace}/${resourceType}/${name}`;

  const useBackend = isBackendConfigured() && !!clusterId;
  const nsForBackend = isClusterScoped ? '' : (namespace ?? '');

  return useQuery({
    queryKey: useBackend ? ['backend', 'resource', clusterId, resourceType, namespace, name] : ['k8s', resourceType, namespace, name],
    queryFn: useBackend
      ? () => getResource(backendBaseUrl, clusterId!, resourceType, nsForBackend, name) as Promise<T>
      : () => k8sRequest<T>(path, {}, config),
    enabled: !isDemo && (useBackend ? true : config.isConnected) && !!name && (options?.enabled !== false),
    staleTime: options?.staleTime ?? 5_000,
    refetchInterval: options?.refetchInterval,
    refetchOnMount: 'always',
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
}

// Hook for creating resources
export function useCreateK8sResource(resourceType: ResourceType) {
  const { config } = useKubernetesConfigStore();
  const queryClient = useQueryClient();
  const apiBase = API_GROUPS[resourceType];
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId;

  return useMutation({
    mutationFn: async ({ yaml, namespace }: { yaml: string; namespace?: string }) => {
      if (isBackendConfigured() && clusterId) {
        return applyManifest(backendBaseUrl, clusterId, yaml);
      }

      const resource = parseYaml(yaml);
      const ns = namespace || resource.metadata?.namespace || 'default';
      const path = CLUSTER_SCOPED_KINDS.includes(resourceType)
        ? `${apiBase}/${resourceType}`
        : `${apiBase}/namespaces/${ns}/${resourceType}`;
      return k8sRequest(path, { method: 'POST', body: yaml }, config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['k8s', resourceType] });
      if (clusterId) {
        queryClient.invalidateQueries({ queryKey: ['backend', 'resources', clusterId, resourceType] });
      }
      notifySuccess({
        action: 'create',
        resourceType,
      });
    },
    onError: (error: Error) => {
      notifyError(error, {
        action: 'create',
        resourceType,
      });
    },
  });
}

// Hook for updating resources (backend: apply YAML; direct: PUT).
export function useUpdateK8sResource(resourceType: ResourceType) {
  const { config } = useKubernetesConfigStore();
  const queryClient = useQueryClient();
  const apiBase = API_GROUPS[resourceType];
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const clusterId = currentClusterId;

  return useMutation({
    mutationFn: async ({ name, yaml, namespace }: { name: string; yaml: string; namespace?: string }) => {
      if (isBackendConfigured() && clusterId) {
        return applyManifest(backendBaseUrl, clusterId, yaml);
      }
      const path = namespace
        ? `${apiBase}/namespaces/${namespace}/${resourceType}/${name}`
        : `${apiBase}/${resourceType}/${name}`;
      return k8sRequest(path, { method: 'PUT', body: yaml }, config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['k8s', resourceType] });
      if (clusterId) {
        queryClient.invalidateQueries({ queryKey: ['backend', 'resource', clusterId, resourceType] });
        queryClient.invalidateQueries({ queryKey: ['backend', 'resources', clusterId, resourceType] });
      }
      notifySuccess({
        action: 'update',
        resourceType,
      });
    },
    onError: (error: Error) => {
      notifyError(error, {
        action: 'update',
        resourceType,
      });
    },
  });
}

// Workload types whose mutations affect pods and replicasets
const WORKLOAD_TYPES: ResourceType[] = ['deployments', 'replicasets', 'statefulsets', 'daemonsets', 'jobs', 'cronjobs'];

// Hook for PATCH (scale, rollout restart, etc.). Only works when backend is configured.
// PERF Area 5: Optimistic scale — when patch contains spec.replicas, the detail cache
// is updated instantly so the UI reflects the new count before the server confirms.
export function usePatchK8sResource(resourceType: ResourceType) {
  const queryClient = useQueryClient();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  // P0-D: Use currentClusterId exclusively. activeCluster.id may hold a stale or demo
  // ID (e.g. '__demo__cluster-alpha') which corrupts all resource API URLs.
  const clusterId = currentClusterId;

  return useMutation({
    mutationFn: async ({
      name,
      namespace,
      patch,
    }: {
      name: string;
      namespace?: string;
      patch: Record<string, unknown>;
    }) => {
      if (!isBackendConfigured() || !clusterId) {
        throw new Error('Backend not configured');
      }
      const ns = CLUSTER_SCOPED_KINDS.includes(resourceType) ? '' : (namespace ?? '');
      return patchResource(backendBaseUrl, clusterId, resourceType, ns, name, patch);
    },
    // PERF: Optimistic scale — detect replica patches and update detail cache instantly
    onMutate: async ({ name, namespace, patch }) => {
      const replicas = (patch as any)?.spec?.replicas;
      if (replicas == null) return {}; // Only optimize scale patches

      // Cancel in-flight refetches on the detail query
      const detailKey = ['backend', 'resource', clusterId, resourceType, namespace, name];
      await queryClient.cancelQueries({ queryKey: detailKey });

      // Snapshot & optimistically update detail cache
      const prevDetail = queryClient.getQueryData(detailKey);
      if (prevDetail) {
        queryClient.setQueryData(detailKey, (old: any) => {
          if (!old?.spec) return old;
          return { ...old, spec: { ...old.spec, replicas } };
        });
      }

      // Also update the item in list caches so the list view shows new count
      const listSnapshots: [readonly unknown[], unknown][] = [];
      const cache = queryClient.getQueryCache();
      for (const query of cache.getAll()) {
        const key = query.queryKey;
        const isMatch =
          (key[0] === 'backend' && key[1] === 'resources' && key[2] === clusterId && key[4] === resourceType);
        if (!isMatch) continue;
        const data = queryClient.getQueryData(key);
        if (!data || !(data as any).items) continue;
        listSnapshots.push([key, data]);
        queryClient.setQueryData(key, (old: any) => {
          if (!old?.items) return old;
          return {
            ...old,
            items: old.items.map((item: any) =>
              item.metadata?.name === name && item.metadata?.namespace === namespace
                ? { ...item, spec: { ...item.spec, replicas } }
                : item
            ),
          };
        });
      }

      return { prevDetail, detailKey, listSnapshots };
    },
    onError: (_error, _vars, context) => {
      // Rollback optimistic scale
      if (context?.prevDetail && context?.detailKey) {
        queryClient.setQueryData(context.detailKey, context.prevDetail);
      }
      if (context?.listSnapshots) {
        for (const [key, data] of context.listSnapshots) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['k8s', resourceType] });
      if (clusterId) {
        queryClient.invalidateQueries({ queryKey: ['backend', 'resource', clusterId, resourceType] });
        queryClient.invalidateQueries({ queryKey: ['backend', 'resources', clusterId, resourceType] });
        // When patching workloads (scale, restart), also invalidate pods and replicasets
        // so pod lifecycle transitions appear immediately
        if (WORKLOAD_TYPES.includes(resourceType)) {
          queryClient.invalidateQueries({ queryKey: ['k8s', 'pods'] });
          queryClient.invalidateQueries({ queryKey: ['backend', 'resources', clusterId] }, { predicate: (query) => {
            const key = query.queryKey;
            return key[0] === 'backend' && key[1] === 'resources' && key[2] === clusterId &&
              (key[4] === 'pods' || key[4] === 'replicasets');
          }});
        }
      }
    },
  });
}

// Hook for deleting resources (backend when configured + cluster selected; else direct K8s). D1.2: backend requires confirmation — UI uses DeleteConfirmDialog before calling.
// PERF Area 5: Optimistic delete — item is removed from list cache immediately on click.
// If the server rejects, the item reappears and an error toast is shown.
export function useDeleteK8sResource(resourceType: ResourceType) {
  const { config } = useKubernetesConfigStore();
  const queryClient = useQueryClient();
  const apiBase = API_GROUPS[resourceType];
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  // P0-D: Use currentClusterId exclusively. activeCluster.id may hold a stale or demo
  // ID (e.g. '__demo__cluster-alpha') which corrupts all resource API URLs.
  const clusterId = currentClusterId;

  return useMutation({
    mutationFn: async ({ name, namespace }: { name: string; namespace?: string }) => {
      const isClusterScoped = CLUSTER_SCOPED_KINDS.includes(resourceType);
      const ns = isClusterScoped ? '' : (namespace ?? '');

      if (isBackendConfigured() && clusterId) {
        return deleteResource(backendBaseUrl, clusterId, resourceType, ns, name);
      }

      const path = isClusterScoped || !namespace
        ? `${apiBase}/${resourceType}/${name}`
        : `${apiBase}/namespaces/${namespace}/${resourceType}/${name}`;
      return k8sRequest(path, { method: 'DELETE' }, config);
    },
    // PERF: Optimistic removal — strip the deleted item from all matching list caches
    // before the server responds. The UI updates in <16ms (one frame).
    onMutate: async ({ name, namespace }) => {
      // Cancel any in-flight refetches so they don't overwrite the optimistic update
      await queryClient.cancelQueries({ queryKey: ['k8s', resourceType] });
      if (clusterId) {
        await queryClient.cancelQueries({
          predicate: (q) =>
            q.queryKey[0] === 'backend' && q.queryKey[1] === 'resources' &&
            q.queryKey[2] === clusterId && q.queryKey[4] === resourceType,
        });
      }

      // Snapshot every matching list cache for rollback on error
      const snapshots: [readonly unknown[], unknown][] = [];
      const cache = queryClient.getQueryCache();
      for (const query of cache.getAll()) {
        const key = query.queryKey;
        const isMatch =
          (key[0] === 'k8s' && key[1] === resourceType) ||
          (key[0] === 'backend' && key[1] === 'resources' && key[2] === clusterId && key[4] === resourceType);
        if (!isMatch) continue;

        const data = queryClient.getQueryData(key);
        if (!data || !(data as any).items) continue;

        snapshots.push([key, data]);
        // Remove by name + namespace match (works for both UID and name lookups)
        queryClient.setQueryData(key, (old: any) => {
          if (!old?.items) return old;
          return {
            ...old,
            items: old.items.filter((item: any) =>
              !(item.metadata?.name === name &&
                (item.metadata?.namespace === namespace || !namespace))
            ),
          };
        });
      }

      return { snapshots };
    },
    onError: (error: Error, _vars, context) => {
      // Rollback: restore all snapshotted list caches
      if (context?.snapshots) {
        for (const [key, data] of context.snapshots) {
          queryClient.setQueryData(key, data);
        }
      }
      notifyError(error, {
        action: 'delete',
        resourceType,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['k8s', resourceType] });
      if (clusterId) {
        queryClient.invalidateQueries({ queryKey: ['backend', 'resources', clusterId, resourceType] });
        // When deleting pods, also invalidate parent workload queries so hero cards update
        if (resourceType === 'pods') {
          for (const wt of WORKLOAD_TYPES) {
            queryClient.invalidateQueries({ queryKey: ['k8s', wt] });
            queryClient.invalidateQueries({ queryKey: ['backend', 'resources', clusterId] }, { predicate: (query) => {
              const key = query.queryKey;
              return key[0] === 'backend' && key[1] === 'resources' && key[2] === clusterId && key[4] === wt;
            }});
            queryClient.invalidateQueries({ queryKey: ['backend', 'resource', clusterId, wt] });
          }
        }
        // When deleting workloads, also invalidate pods
        if (WORKLOAD_TYPES.includes(resourceType)) {
          queryClient.invalidateQueries({ queryKey: ['k8s', 'pods'] });
          queryClient.invalidateQueries({ queryKey: ['backend', 'resources', clusterId] }, { predicate: (query) => {
            const key = query.queryKey;
            return key[0] === 'backend' && key[1] === 'resources' && key[2] === clusterId && key[4] === 'pods';
          }});
        }
      }
      notifySuccess({
        action: 'delete',
        resourceType,
      });
    },
  });
}

// Hook for testing connection
export function useTestK8sConnection() {
  const { config, setConnected } = useKubernetesConfigStore();

  return useMutation({
    mutationFn: async () => {
      const response = await k8sRequest<{ status: string }>('/api/v1', {}, config);
      return response;
    },
    onSuccess: () => {
      setConnected(true);
      notifySuccess({
        action: 'connect',
        resourceType: 'cluster',
      }, { description: 'Kubernetes API is reachable.' });
    },
    onError: (error: Error) => {
      setConnected(false);
      notifyError(error, {
        action: 'connect',
        resourceType: 'cluster',
      });
    },
  });
}

// Hook to get pod logs (backend when configured + clusterId; else direct K8s).
export function useK8sPodLogs(
  namespace: string,
  podName: string,
  containerName?: string,
  options?: { enabled?: boolean; tailLines?: number }
) {
  const { config } = useKubernetesConfigStore();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  // P0-D: Use currentClusterId exclusively. activeCluster.id may hold a stale or demo
  // ID (e.g. '__demo__cluster-alpha') which corrupts all resource API URLs.
  const clusterId = currentClusterId;
  const useBackend = isBackendConfigured() && !!clusterId;

  const queryParams = new URLSearchParams();
  if (containerName) queryParams.set('container', containerName);
  if (options?.tailLines) queryParams.set('tailLines', String(options.tailLines));
  const path = `/api/v1/namespaces/${namespace}/pods/${podName}/log?${queryParams.toString()}`;

  return useQuery({
    queryKey: ['k8s', 'pods', namespace, podName, 'logs', containerName, useBackend ? clusterId : null],
    queryFn: async () => {
      if (useBackend && clusterId) {
        const url = getPodLogsUrl(backendBaseUrl, clusterId, namespace, podName, {
          container: containerName,
          tail: options?.tailLines,
          follow: false,
        });
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch logs');
        return response.text();
      }
      const response = await fetch(`${config.apiUrl}${path}`, {
        headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
      });
      if (!response.ok) throw new Error('Failed to fetch logs');
      return response.text();
    },
    enabled:
      !!podName &&
      (options?.enabled !== false) &&
      (useBackend ? true : config.isConnected),
    // Removed aggressive 5s polling - rely on global defaults (refetchOnWindowFocus/reconnect)
    // Pod logs can be refreshed manually if needed
    refetchInterval: false,
  });
}

// Utility: Calculate age from timestamp (TASK-080 standardized format)
// <60s → "just now", <2m → "Xs", <2h → "Xm", <2d → "Xh", <14d → "Xd", else → "Xwk"
export function calculateAge(timestamp: string | undefined): string {
  if (timestamp == null || timestamp === '') return '—';
  const created = new Date(timestamp);
  const now = new Date();
  if (isNaN(created.getTime())) return '—';
  const diffMs = Math.max(0, now.getTime() - created.getTime());
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 2) return `${seconds}s`;
  if (hours < 2) return `${minutes}m`;
  if (days < 2) return `${hours}h`;
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}wk`;
}

// Simple YAML parser using js-yaml
function parseYaml(yaml: string): KubernetesResource {
  try {
    return yamlParser.load(yaml) as KubernetesResource;
  } catch (e) {
    console.error('Failed to parse YAML:', e);
    // Fallback to minimal structure if parsing fails
    return { metadata: { name: '', uid: '', creationTimestamp: '' } };
  }
}

/** Child job row for CronJob expandable drill-down (Job Name | Status | Start Time | Duration). */
export interface CronJobChildJob {
  name: string;
  namespace: string;
  status: 'Complete' | 'Running' | 'Failed';
  startTime: string;
  duration: string;
}

/** Fetches last 5 child jobs for a CronJob. Uses backend endpoint when configured; otherwise lists jobs and filters client-side. */
export function useCronJobChildJobs(namespace: string, name: string, enabled: boolean) {
  const { config } = useKubernetesConfigStore();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  // P0-D: Use currentClusterId exclusively. activeCluster.id may hold a stale or demo
  // ID (e.g. '__demo__cluster-alpha') which corrupts all resource API URLs.
  const clusterId = currentClusterId;
  const useBackend = isBackendConfigured() && !!clusterId;

  return useQuery({
    queryKey: ['cronjob-child-jobs', clusterId ?? 'direct', namespace, name],
    queryFn: async (): Promise<CronJobChildJob[]> => {
      if (useBackend && clusterId) {
        const res = await getCronJobJobs(backendBaseUrl, clusterId, namespace, name, 5);
        return (res.items ?? []).map((item: Record<string, unknown>) => {
          const meta = (item.metadata as Record<string, unknown>) || {};
          const status = (item.status as Record<string, unknown>) || {};
          const spec = (item.spec as Record<string, unknown>) || {};
          const completionsDesired = (spec.completions as number) ?? 1;
          const succeeded = (status.succeeded as number) || 0;
          const active = (status.active as number) || 0;
          const failed = (status.failed as number) || 0;
          let jobStatus: CronJobChildJob['status'] = 'Running';
          if (succeeded >= completionsDesired) jobStatus = 'Complete';
          else if (failed > 0 && active === 0) jobStatus = 'Failed';
          let duration = '-';
          const startTime = (status.startTime as string) || '';
          if (startTime) {
            const start = new Date(startTime);
            const end = (status.completionTime as string) ? new Date(status.completionTime as string) : new Date();
            const diffSec = Math.floor((end.getTime() - start.getTime()) / 1000);
            if (diffSec < 60) duration = `${diffSec}s`;
            else if (diffSec < 3600) duration = `${Math.floor(diffSec / 60)}m`;
            else duration = `${Math.floor(diffSec / 3600)}h`;
          }
          return {
            name: (meta.name as string) || '',
            namespace: ((meta.namespace as string) || namespace),
            status: jobStatus,
            startTime: startTime || '-',
            duration,
          };
        });
      }
      const path = `${API_GROUPS.jobs}/namespaces/${namespace}/jobs`;
      const res = await k8sRequest<ResourceList<KubernetesResource & { metadata?: { ownerReferences?: Array<{ kind: string; name: string }> }; status?: { startTime?: string; completionTime?: string; succeeded?: number; active?: number; failed?: number }; spec?: { completions?: number } }>>(path, {}, config);
      const items = res?.items ?? [];
      const filtered = items.filter((item) => {
        const refs = item.metadata?.ownerReferences ?? [];
        return refs.some((r) => r.kind === 'CronJob' && r.name === name);
      });
      filtered.sort((a, b) => {
        const ta = a.status?.startTime ?? '';
        const tb = b.status?.startTime ?? '';
        return tb.localeCompare(ta);
      });
      return filtered.slice(0, 5).map((item) => {
        const status = item.status ?? {};
        const spec = item.spec ?? {};
        const completionsDesired = spec.completions ?? 1;
        const succeeded = status.succeeded ?? 0;
        const active = status.active ?? 0;
        const failed = status.failed ?? 0;
        let jobStatus: CronJobChildJob['status'] = 'Running';
        if (succeeded >= completionsDesired) jobStatus = 'Complete';
        else if (failed > 0 && active === 0) jobStatus = 'Failed';
        let duration = '-';
        const startTime = status.startTime ?? '';
        if (startTime) {
          const start = new Date(startTime);
          const end = status.completionTime ? new Date(status.completionTime) : new Date();
          const diffSec = Math.floor((end.getTime() - start.getTime()) / 1000);
          if (diffSec < 60) duration = `${diffSec}s`;
          else if (diffSec < 3600) duration = `${Math.floor(diffSec / 60)}m`;
          else duration = `${Math.floor(diffSec / 3600)}h`;
        }
        return {
          name: item.metadata?.name ?? '',
          namespace: item.metadata?.namespace ?? namespace,
          status: jobStatus,
          startTime: startTime || '-',
          duration,
        };
      });
    },
    enabled: enabled && !!namespace && !!name && (useBackend ? true : config.isConnected),
    staleTime: 60_000,
  });
}

// Legacy hooks for backwards compatibility
export function useK8sResources<T extends KubernetesResource>(
  resourceType: string,
  namespace?: string,
  options?: { enabled?: boolean; refetchInterval?: number }
) {
  return useK8sResourceList<T>(resourceType as ResourceType, namespace, options);
}

export function useK8sAppsResources<T extends KubernetesResource>(
  resourceType: string,
  namespace?: string,
  options?: { enabled?: boolean; refetchInterval?: number }
) {
  return useK8sResourceList<T>(resourceType as ResourceType, namespace, options);
}
