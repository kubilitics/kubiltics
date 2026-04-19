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

// useAICapabilities — calls backend's /api/v1/ai/capabilities. The
// `warm` option is retained for source-compat but is now a no-op: the
// in-cluster runtime is always-on, so there's no cold-start to warm.
export function useAICapabilities(clusterId: string | undefined, _opts?: { warm?: boolean }) {
  return useQuery<CapabilitiesResponse>({
    queryKey: ['ai', 'capabilities', clusterId],
    enabled: !!clusterId,
    queryFn: async () => {
      const params = new URLSearchParams({ cluster_id: clusterId! });
      const res = await fetch(`/api/v1/ai/capabilities?${params.toString()}`);
      if (!res.ok) throw new Error(`capabilities ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
}
