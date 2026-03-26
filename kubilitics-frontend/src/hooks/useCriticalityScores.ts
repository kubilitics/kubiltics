/**
 * Hook to fetch criticality scores from the topology v2 criticality endpoint.
 *
 * Returns a Map indexed by "Kind/namespace/name" and "Kind/name" for fast lookup
 * from resource list tables.
 */
import { useQuery } from '@tanstack/react-query';
import { useActiveClusterId } from './useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

export interface CriticalityEntry {
  nodeId: string;
  kind: string;
  namespace: string;
  name: string;
  level: 'critical' | 'high' | 'medium' | 'low';
  blastRadius: number;
  isSPOF: boolean;
  score: number;
}

export function useCriticalityScores(namespace?: string) {
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  return useQuery<Map<string, CriticalityEntry>>({
    queryKey: ['criticality-scores', clusterId, namespace],
    queryFn: async () => {
      const nsParam = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
      const path = `clusters/${encodeURIComponent(clusterId!)}/topology/v2/criticality${nsParam}`;
      const url = effectiveBaseUrl ? `${effectiveBaseUrl}/api/v1/${path}` : `/api/v1/${path}`;
      const res = await fetch(url);
      if (!res.ok) return new Map();
      const data = (await res.json()) as CriticalityEntry[];
      const map = new Map<string, CriticalityEntry>();
      for (const entry of data) {
        // Index by "Kind/namespace/name" for namespaced lookups
        const key = `${entry.kind}/${entry.namespace}/${entry.name}`;
        map.set(key, entry);
        // Also index by "Kind/name" for simpler lookups
        map.set(`${entry.kind}/${entry.name}`, entry);
      }
      return map;
    },
    enabled: !!clusterId && isBackendConfigured(),
    staleTime: 60_000,
    retry: 1,
  });
}
