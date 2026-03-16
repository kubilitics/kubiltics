/**
 * usePluginRegistry — Hook for plugin search, discovery, and management.
 *
 * Provides search/filter over the plugin catalog, install/uninstall mutations,
 * and installed-plugin tracking via TanStack Query + backend API.
 *
 * Official plugins: istio, argocd, cert-manager, flux, kyverno.
 */
import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { toast } from 'sonner';

/** Status of a plugin in the registry. */
export type PluginStatus = 'available' | 'installed' | 'installing' | 'uninstalling' | 'error' | 'update-available';

/** Category for organizing plugins in the marketplace. */
export type PluginCategory =
  | 'service-mesh'
  | 'gitops'
  | 'security'
  | 'certificates'
  | 'policy'
  | 'monitoring'
  | 'networking'
  | 'storage'
  | 'other';

/** Plugin metadata as returned by the registry API. */
export interface PluginInfo {
  /** Unique plugin identifier (e.g., "istio", "argocd"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Short description. */
  description: string;
  /** Author / maintainer. */
  author: string;
  /** Latest available version. */
  version: string;
  /** Installed version (null if not installed). */
  installedVersion: string | null;
  /** Plugin icon URL. */
  iconUrl: string | null;
  /** Plugin homepage URL. */
  homepageUrl: string | null;
  /** Category for marketplace display. */
  category: PluginCategory;
  /** Whether this is an official Kubilitics plugin. */
  official: boolean;
  /** Current status. */
  status: PluginStatus;
  /** Star count or popularity score. */
  stars: number;
  /** Download count. */
  downloads: number;
  /** Keywords for search. */
  keywords: string[];
}

/** Response from the plugin registry list endpoint. */
interface PluginRegistryResponse {
  plugins: PluginInfo[];
  total: number;
}

// ─── Official Plugin Catalog (fallback when backend is unreachable) ──────────

const OFFICIAL_PLUGINS: PluginInfo[] = [
  {
    id: 'istio',
    name: 'Istio Service Mesh',
    description: 'Connect, secure, control, and observe services with Istio service mesh integration.',
    author: 'Kubilitics',
    version: '1.24.0',
    installedVersion: null,
    iconUrl: null,
    homepageUrl: 'https://istio.io',
    category: 'service-mesh',
    official: true,
    status: 'available',
    stars: 35200,
    downloads: 1200000,
    keywords: ['mesh', 'envoy', 'traffic', 'mtls', 'sidecar'],
  },
  {
    id: 'argocd',
    name: 'Argo CD',
    description: 'Declarative GitOps continuous delivery for Kubernetes with ArgoCD integration.',
    author: 'Kubilitics',
    version: '2.13.0',
    installedVersion: null,
    iconUrl: null,
    homepageUrl: 'https://argo-cd.readthedocs.io',
    category: 'gitops',
    official: true,
    status: 'available',
    stars: 17800,
    downloads: 980000,
    keywords: ['gitops', 'cd', 'deployment', 'sync', 'declarative'],
  },
  {
    id: 'cert-manager',
    name: 'cert-manager',
    description: 'Automatically provision and manage TLS certificates in Kubernetes clusters.',
    author: 'Kubilitics',
    version: '1.16.0',
    installedVersion: null,
    iconUrl: null,
    homepageUrl: 'https://cert-manager.io',
    category: 'certificates',
    official: true,
    status: 'available',
    stars: 12400,
    downloads: 870000,
    keywords: ['tls', 'ssl', 'certificates', 'letsencrypt', 'acme'],
  },
  {
    id: 'flux',
    name: 'Flux CD',
    description: 'Keep Kubernetes clusters in sync with sources of configuration using Flux GitOps toolkit.',
    author: 'Kubilitics',
    version: '2.4.0',
    installedVersion: null,
    iconUrl: null,
    homepageUrl: 'https://fluxcd.io',
    category: 'gitops',
    official: true,
    status: 'available',
    stars: 6300,
    downloads: 520000,
    keywords: ['gitops', 'kustomize', 'helm', 'source', 'reconciliation'],
  },
  {
    id: 'kyverno',
    name: 'Kyverno',
    description: 'Kubernetes-native policy management for validation, mutation, and generation of resources.',
    author: 'Kubilitics',
    version: '1.13.0',
    installedVersion: null,
    iconUrl: null,
    homepageUrl: 'https://kyverno.io',
    category: 'policy',
    official: true,
    status: 'available',
    stars: 5600,
    downloads: 410000,
    keywords: ['policy', 'admission', 'validation', 'mutation', 'governance'],
  },
];

/** Options for the usePluginRegistry hook. */
export interface UsePluginRegistryOptions {
  /** Only return plugins matching this category. */
  category?: PluginCategory;
  /** Filter to only installed plugins. */
  installedOnly?: boolean;
  /** Enable/disable the query (default true). */
  enabled?: boolean;
}

/**
 * Hook for plugin search, discovery, install, and uninstall operations.
 *
 * Uses TanStack Query for caching. Falls back to the built-in official
 * plugin catalog when the backend plugin registry is unreachable.
 */
export function usePluginRegistry(options: UsePluginRegistryOptions = {}) {
  const { category, installedOnly = false, enabled = true } = options;
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(stored);
  const clusterId = useActiveClusterId();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');

  // Fetch plugin registry from backend
  const {
    data: registryData,
    isLoading,
    error,
    refetch,
  } = useQuery<PluginRegistryResponse>({
    queryKey: ['plugin-registry', clusterId],
    queryFn: async (): Promise<PluginRegistryResponse> => {
      if (!baseUrl || !clusterId) {
        return { plugins: OFFICIAL_PLUGINS, total: OFFICIAL_PLUGINS.length };
      }
      try {
        const res = await fetch(`${baseUrl}/api/v1/clusters/${clusterId}/plugins`);
        if (!res.ok) throw new Error(`Registry fetch failed: ${res.status}`);
        return res.json();
      } catch {
        // Fallback to built-in catalog
        return { plugins: OFFICIAL_PLUGINS, total: OFFICIAL_PLUGINS.length };
      }
    },
    enabled,
    staleTime: 60_000,
    retry: 1,
  });

  const allPlugins = registryData?.plugins ?? OFFICIAL_PLUGINS;

  // Filtered and searched plugins
  const plugins = useMemo(() => {
    let result = allPlugins;

    if (category) {
      result = result.filter((p) => p.category === category);
    }

    if (installedOnly) {
      result = result.filter((p) => p.status === 'installed' || p.status === 'update-available');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          p.keywords.some((k) => k.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [allPlugins, category, installedOnly, searchQuery]);

  // Install mutation
  const installMutation = useMutation({
    mutationFn: async (pluginId: string) => {
      if (!baseUrl || !clusterId) throw new Error('Backend not configured');
      const res = await fetch(`${baseUrl}/api/v1/clusters/${clusterId}/plugins/${pluginId}/install`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`Install failed: ${res.status}`);
      return res.json();
    },
    onSuccess: (_data, pluginId) => {
      toast.success(`Plugin "${pluginId}" installed successfully`);
      queryClient.invalidateQueries({ queryKey: ['plugin-registry'] });
    },
    onError: (err, pluginId) => {
      toast.error(`Failed to install "${pluginId}": ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  // Uninstall mutation
  const uninstallMutation = useMutation({
    mutationFn: async (pluginId: string) => {
      if (!baseUrl || !clusterId) throw new Error('Backend not configured');
      const res = await fetch(`${baseUrl}/api/v1/clusters/${clusterId}/plugins/${pluginId}/uninstall`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`Uninstall failed: ${res.status}`);
      return res.json();
    },
    onSuccess: (_data, pluginId) => {
      toast.success(`Plugin "${pluginId}" uninstalled`);
      queryClient.invalidateQueries({ queryKey: ['plugin-registry'] });
    },
    onError: (err, pluginId) => {
      toast.error(`Failed to uninstall "${pluginId}": ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const install = useCallback((pluginId: string) => installMutation.mutate(pluginId), [installMutation]);
  const uninstall = useCallback((pluginId: string) => uninstallMutation.mutate(pluginId), [uninstallMutation]);

  return {
    /** Filtered list of plugins. */
    plugins,
    /** All plugins from the registry (unfiltered). */
    allPlugins,
    /** Total count of all plugins. */
    totalCount: registryData?.total ?? OFFICIAL_PLUGINS.length,
    /** Whether the registry is loading. */
    isLoading,
    /** Error from the registry query. */
    error,
    /** Current search query. */
    searchQuery,
    /** Update the search query. */
    setSearchQuery,
    /** Install a plugin by ID. */
    install,
    /** Uninstall a plugin by ID. */
    uninstall,
    /** Whether an install is in progress. */
    isInstalling: installMutation.isPending,
    /** Whether an uninstall is in progress. */
    isUninstalling: uninstallMutation.isPending,
    /** Refetch the registry. */
    refetch,
  };
}
