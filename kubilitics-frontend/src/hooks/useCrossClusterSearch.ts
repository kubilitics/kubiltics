/**
 * useCrossClusterSearch — ENT-005
 *
 * Hook that performs a debounced search across all connected clusters.
 * Results are grouped by cluster with type-ahead UX (300ms debounce).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useClusterStore, type Cluster } from '@/stores/clusterStore';

// ─── Types ───────────────────────────────────────────────────

export type SearchResultKind =
  | 'Pod'
  | 'Deployment'
  | 'Service'
  | 'ConfigMap'
  | 'Secret'
  | 'Namespace'
  | 'Node'
  | 'Ingress'
  | 'StatefulSet'
  | 'DaemonSet'
  | 'Job'
  | 'CronJob'
  | 'PersistentVolumeClaim';

export interface SearchResult {
  kind: SearchResultKind;
  name: string;
  namespace?: string;
  clusterId: string;
  clusterName: string;
  /** Relative URL within Kubilitics to navigate to */
  href: string;
  /** Age string, e.g. "3d" */
  age?: string;
  /** Status for display badges */
  status?: string;
}

export interface ClusterSearchGroup {
  cluster: Pick<Cluster, 'id' | 'name' | 'provider' | 'status'>;
  results: SearchResult[];
  error?: string;
}

export interface CrossClusterSearchState {
  query: string;
  setQuery: (q: string) => void;
  debouncedQuery: string;
  results: ClusterSearchGroup[];
  totalCount: number;
  isSearching: boolean;
  error: string | null;
  /** Clear results and query */
  reset: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────

function buildResourceHref(kind: string, name: string, namespace?: string): string {
  const kindSlug = kind.toLowerCase() + 's';
  if (namespace) {
    return `/${kindSlug}/${namespace}/${name}`;
  }
  return `/${kindSlug}/${name}`;
}

// ─── Hook ────────────────────────────────────────────────────

export function useCrossClusterSearch(): CrossClusterSearchState {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const clusters = useClusterStore((s) => s.clusters);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const [results, setResults] = useState<ClusterSearchGroup[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setQuery('');
    setResults([]);
    setError(null);
  }, []);

  // Perform search whenever debounced query changes
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      setError(null);
      return;
    }

    // Abort previous in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const performSearch = async () => {
      setIsSearching(true);
      setError(null);

      try {
        // If backend exposes a cross-cluster search endpoint, use it
        const res = await fetch(
          `${backendBaseUrl}/api/v1/search?q=${encodeURIComponent(debouncedQuery)}`,
          { signal: controller.signal }
        );

        if (!res.ok) {
          // Fallback: search each cluster individually
          const groups = await searchClustersIndividually(
            backendBaseUrl,
            clusters,
            debouncedQuery,
            controller.signal
          );
          setResults(groups);
          return;
        }

        const data = await res.json();
        // Backend returns { groups: ClusterSearchGroup[] }
        if (data.groups) {
          setResults(
            data.groups.map((g: ClusterSearchGroup) => ({
              ...g,
              results: g.results.map((r: SearchResult) => ({
                ...r,
                href: r.href || buildResourceHref(r.kind, r.name, r.namespace),
              })),
            }))
          );
        } else {
          setResults([]);
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        // Fallback to individual cluster search
        try {
          const groups = await searchClustersIndividually(
            backendBaseUrl,
            clusters,
            debouncedQuery,
            controller.signal
          );
          setResults(groups);
        } catch (fallbackErr) {
          if ((fallbackErr as Error).name === 'AbortError') return;
          setError(fallbackErr instanceof Error ? fallbackErr.message : 'Search failed');
        }
      } finally {
        setIsSearching(false);
      }
    };

    performSearch();

    return () => {
      controller.abort();
    };
  }, [debouncedQuery, backendBaseUrl, clusters]);

  const totalCount = results.reduce((sum, g) => sum + g.results.length, 0);

  return {
    query,
    setQuery,
    debouncedQuery,
    results,
    totalCount,
    isSearching,
    error,
    reset,
  };
}

// ─── Fallback: per-cluster search ────────────────────────────

async function searchClustersIndividually(
  backendBaseUrl: string,
  clusters: Cluster[],
  query: string,
  signal: AbortSignal
): Promise<ClusterSearchGroup[]> {
  const activeClusters = clusters.filter((c) => !c.__isDemo && c.status !== 'error');

  const promises = activeClusters.map(async (cluster): Promise<ClusterSearchGroup> => {
    try {
      const res = await fetch(
        `${backendBaseUrl}/api/v1/clusters/${cluster.id}/search?q=${encodeURIComponent(query)}`,
        { signal }
      );
      if (!res.ok) {
        return {
          cluster: { id: cluster.id, name: cluster.name, provider: cluster.provider, status: cluster.status },
          results: [],
          error: `HTTP ${res.status}`,
        };
      }
      const data = await res.json();
      const items: SearchResult[] = (data.results ?? []).map((r: SearchResult) => ({
        ...r,
        clusterId: cluster.id,
        clusterName: cluster.name,
        href: r.href || buildResourceHref(r.kind, r.name, r.namespace),
      }));
      return {
        cluster: { id: cluster.id, name: cluster.name, provider: cluster.provider, status: cluster.status },
        results: items,
      };
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      return {
        cluster: { id: cluster.id, name: cluster.name, provider: cluster.provider, status: cluster.status },
        results: [],
        error: err instanceof Error ? err.message : 'Search failed',
      };
    }
  });

  return Promise.all(promises);
}
