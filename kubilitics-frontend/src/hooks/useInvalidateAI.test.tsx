import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useInvalidateAI } from './useInvalidateAI';

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useInvalidateAI', () => {
  it('returns a function that resolves only after all three queries refetch', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    let resolveStatus!: () => void;
    let resolveCaps!: () => void;
    let resolveConfig!: () => void;
    const statusFetched = new Promise<void>((r) => { resolveStatus = r; });
    const capsFetched = new Promise<void>((r) => { resolveCaps = r; });
    const configFetched = new Promise<void>((r) => { resolveConfig = r; });

    client.setQueryDefaults(['ai', 'status'], {
      queryFn: async () => { await statusFetched; return { state: 'ready' }; },
    });
    client.setQueryDefaults(['ai', 'capabilities'], {
      queryFn: async () => { await capsFetched; return { ready: true }; },
    });
    client.setQueryDefaults(['ai', 'user-config'], {
      queryFn: async () => { await configFetched; return { provider: 'openai', has_api_key: 'true' }; },
    });
    client.setQueryData(['ai', 'status'], { state: 'ready' });
    client.setQueryData(['ai', 'capabilities'], { ready: true });
    client.setQueryData(['ai', 'user-config'], { provider: 'openai', has_api_key: 'true' });

    const { result } = renderHook(() => useInvalidateAI(), { wrapper: makeWrapper(client) });

    let resolved = false;
    await act(async () => {
      const p = result.current().then(() => { resolved = true; });
      await new Promise((r) => setTimeout(r, 20));
      expect(resolved).toBe(false);

      resolveStatus();
      resolveCaps();
      await new Promise((r) => setTimeout(r, 20));
      expect(resolved).toBe(false);

      resolveConfig();
      await p;
      expect(resolved).toBe(true);
    });
  });
});
