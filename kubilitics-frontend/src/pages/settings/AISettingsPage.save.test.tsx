import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useInvalidateAI } from '@/hooks/useInvalidateAI';

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('AISettingsPage save flow contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('awaiting useInvalidateAI() blocks until all three refetches complete', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let resolveStatus!: () => void;
    let resolveCaps!: () => void;
    let resolveCfg!: () => void;
    const sP = new Promise<void>((r) => { resolveStatus = r; });
    const cP = new Promise<void>((r) => { resolveCaps = r; });
    const ucP = new Promise<void>((r) => { resolveCfg = r; });

    client.setQueryDefaults(['ai', 'status'], { queryFn: async () => { await sP; return { state: 'ready' }; } });
    client.setQueryDefaults(['ai', 'capabilities'], { queryFn: async () => { await cP; return { ready: true }; } });
    client.setQueryDefaults(['ai', 'user-config'], { queryFn: async () => { await ucP; return { provider: 'openai', has_api_key: 'true' }; } });
    client.setQueryData(['ai', 'status'], { state: 'ready' });
    client.setQueryData(['ai', 'capabilities'], { ready: true });
    client.setQueryData(['ai', 'user-config'], { provider: 'openai', has_api_key: 'true' });

    const { result } = renderHook(() => useInvalidateAI(), { wrapper: makeWrapper(client) });

    let savedAndRefreshed = false;
    const fakeSave = async () => {
      await Promise.resolve();
      await result.current();
      savedAndRefreshed = true;
    };

    await act(async () => {
      const p = fakeSave();
      await new Promise((r) => setTimeout(r, 10));
      expect(savedAndRefreshed).toBe(false);

      resolveStatus(); resolveCaps();
      await new Promise((r) => setTimeout(r, 10));
      expect(savedAndRefreshed).toBe(false);

      resolveCfg();
      await p;
      expect(savedAndRefreshed).toBe(true);
    });
  });
});
