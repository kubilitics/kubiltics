import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAIStatus, intervalForState } from './useAIStatus';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe('useAIStatus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ state: 'ready', restart_attempts: 0, active_streams: 0 }),
    })));
  });

  it('intervalForState returns adaptive cadence', () => {
    expect(intervalForState('starting')).toBe(1000);
    expect(intervalForState('ready')).toBe(5000);
    expect(intervalForState('stopped')).toBe(10_000);
    expect(intervalForState('crashed')).toBe(30_000);
  });

  it('fetches status', async () => {
    const { result } = renderHook(() => useAIStatus(), { wrapper });
    await waitFor(() => expect(result.current.data?.state).toBe('ready'));
  });
});
