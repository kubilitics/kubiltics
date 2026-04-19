import { useQuery } from '@tanstack/react-query';

export type AICapabilities = {
  schema_version: string;
  ai_version: string;
  providers: string[];
  models: string[];
  supports_undo: boolean;
  supports_plans: boolean;
};

export type CapabilitiesResponse = {
  ready: boolean;
  capabilities: AICapabilities | null;
  disabled_reason?: string;
  state: string;
};

export function useAICapabilities(clusterId: string | undefined, opts?: { warm?: boolean }) {
  return useQuery<CapabilitiesResponse>({
    queryKey: ['ai', 'capabilities', clusterId, opts?.warm],
    enabled: !!clusterId,
    queryFn: async () => {
      const params = new URLSearchParams({ cluster_id: clusterId! });
      if (opts?.warm) params.set('warm', 'true');
      const res = await fetch(`/api/v1/ai/capabilities?${params.toString()}`);
      if (!res.ok) throw new Error(`capabilities ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
}
