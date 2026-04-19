import { useQuery } from '@tanstack/react-query';

export type SidecarStatus = {
  state: 'stopped' | 'starting' | 'ready' | 'stopping' | 'crashed';
  last_error?: string;
  restart_attempts: number;
  next_retry_at?: string;
  active_streams: number;
  current_spawn_id?: string;
  disabled_reason?: string;
};

export function intervalForState(state: SidecarStatus['state'] | undefined): number {
  switch (state) {
    case 'starting': return 1000;
    case 'ready': return 5000;
    case 'stopped': return 10_000;
    case 'crashed': return 30_000;
    default: return 5000;
  }
}

export function useAIStatus() {
  return useQuery<SidecarStatus>({
    queryKey: ['ai', 'status'],
    queryFn: async () => {
      const res = await fetch('/api/v1/ai/status');
      if (!res.ok) throw new Error(`status ${res.status}`);
      return res.json();
    },
    refetchInterval: (query) => intervalForState(query.state.data?.state),
    staleTime: 0,
  });
}
