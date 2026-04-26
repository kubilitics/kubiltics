import { useQuery } from '@tanstack/react-query';
import { apiUrl } from '@/lib/backendUrl';
import { intervalForState } from './useAIStatus';
import type { AIStatus } from './useAIStatus';

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
  state: AIStatus['state'];
};

// useAICapabilities — calls backend's /api/v1/ai/capabilities. The
// `warm` option is retained for source-compat but is now a no-op: the
// in-cluster runtime is always-on, so there's no cold-start to warm.
//
// Refetch cadence is locked to the same intervalForState used by
// useAIStatus, and staleTime is 0 — both are required so this query
// stays in lockstep with useAIStatus and useAIUserConfig (see
// docs/superpowers/specs/2026-04-26-ai-status-single-source-design.md).
export function useAICapabilities(clusterId: string | undefined, _opts?: { warm?: boolean }) {
  return useQuery<CapabilitiesResponse>({
    queryKey: ['ai', 'capabilities', clusterId],
    enabled: !!clusterId,
    queryFn: async () => {
      const params = new URLSearchParams({ cluster_id: clusterId! });
      const res = await fetch(apiUrl(`/api/v1/ai/capabilities?${params.toString()}`));
      if (!res.ok) throw new Error(`capabilities ${res.status}`);
      return res.json();
    },
    staleTime: 0,
    refetchInterval: (query) => intervalForState(query.state.data?.state),
  });
}
