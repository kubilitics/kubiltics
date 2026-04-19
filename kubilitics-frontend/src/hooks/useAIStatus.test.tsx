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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ state: 'ready', version: 'test-1', engines: ['llm'] }),
      })),
    );
  });

  it('intervalForState returns adaptive cadence', () => {
    expect(intervalForState('ready')).toBe(5000);
    expect(intervalForState('degraded')).toBe(5000);
    expect(intervalForState('unavailable')).toBe(30_000);
    expect(intervalForState('error')).toBe(30_000);
    expect(intervalForState(undefined)).toBe(5000);
  });

  it('fetches status', async () => {
    const { result } = renderHook(() => useAIStatus(), { wrapper });
    await waitFor(() => expect(result.current.data?.state).toBe('ready'));
    expect(result.current.data?.version).toBe('test-1');
    expect(result.current.data?.engines).toEqual(['llm']);
  });
});
