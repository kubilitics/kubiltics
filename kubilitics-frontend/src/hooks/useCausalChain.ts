import { useQuery } from '@tanstack/react-query';
import {
  useBackendConfigStore,
  getEffectiveBackendBaseUrl,
} from '@/stores/backendConfigStore';
import type { CausalChain } from '@/stores/causalChainStore';

import { useActiveClusterId } from '@/hooks/useActiveClusterId';
export function useCausalChain(insightId: string | null) {
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  return useQuery<CausalChain | null, Error>({
    queryKey: ['causal-chain', clusterId, insightId],
    queryFn: async () => {
      const res = await fetch(
        `${effectiveBaseUrl}/clusters/${clusterId}/insights/${insightId}/causal-chain`
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Failed to fetch causal chain: ${res.status}`);
      return res.json() as Promise<CausalChain>;
    },
    enabled: !!insightId && !!clusterId && isBackendConfigured,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}
