import { useQuery } from '@tanstack/react-query';
import { apiUrl } from '@/lib/backendUrl';

// AIStatus mirrors kubilitics-ai's HTTP /status response, surfaced via
// kubilitics-backend /api/v1/ai/status. The supervisor-era SidecarStatus
// shape was retired in subproject 3a.
export type AIStatus = {
  state: 'ready' | 'degraded' | 'unavailable' | 'error' | 'unknown';
  version?: string;
  engines?: string[];
  disabled_reason?: string;
  last_error?: string;
};

// Back-compat alias for callsites that still import the old name.
export type SidecarStatus = AIStatus;

export function intervalForState(state: AIStatus['state'] | undefined): number {
  switch (state) {
    case 'ready':
      return 5000;
    case 'degraded':
      return 5000;
    case 'unavailable':
    case 'error':
      return 30_000;
    default:
      return 5000;
  }
}

export function useAIStatus() {
  return useQuery<AIStatus>({
    queryKey: ['ai', 'status'],
    queryFn: async () => {
      const res = await fetch(apiUrl('/api/v1/ai/status'));
      if (!res.ok) throw new Error(`status ${res.status}`);
      return res.json();
    },
    refetchInterval: (query) => intervalForState(query.state.data?.state),
    staleTime: 0,
  });
}
