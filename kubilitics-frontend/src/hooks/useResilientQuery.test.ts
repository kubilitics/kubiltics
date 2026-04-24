/**
 * Regression tests for useResilientQuery — the shared resilient-response
 * pattern generalized from 10848cf (the counts/sidebar fix). The four
 * cases mirror the useResourceCounts regression matrix: healthy,
 * backend-stale, session-cache-stale, no-data.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useResilientQuery } from './useResilientQuery';

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useResilientQuery', () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('happy path: returns data, reachable=true, not stale', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { count: 42 },
            reachable: true,
            health_status: 'healthy',
          }),
          { status: 200 },
        ),
      ),
    );
    const { result } = renderHook(
      () => useResilientQuery<{ count: number }>('/api/x'),
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => expect(result.current.data).toEqual({ count: 42 }));
    expect(result.current.isReachable).toBe(true);
    expect(result.current.isStale).toBe(false);
    expect(result.current.errorMessage).toBeNull();
  });

  it('preserves last-known data when transitioning to unreachable', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('?1')) {
        return new Response(
          JSON.stringify({
            data: { count: 42 },
            reachable: true,
            health_status: 'healthy',
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          reachable: false,
          error_message: 'connection refused',
          health_status: 'unreachable',
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(
      ({ n }: { n: number }) => useResilientQuery<{ count: number }>(`/api/x?${n}`),
      { wrapper: wrapper(qc), initialProps: { n: 1 } },
    );
    await waitFor(() => expect(result.current.data).toEqual({ count: 42 }));
    rerender({ n: 2 });
    await waitFor(() => expect(result.current.isReachable).toBe(false));
    // Session cache preserves the last-known payload across the switch.
    expect(result.current.data).toEqual({ count: 42 });
    expect(result.current.isStale).toBe(true);
    expect(result.current.errorMessage).toBe('connection refused');
  });

  it('returns backend stale data as stale without promoting to session cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { count: 10 },
            reachable: false,
            stale: true,
            stale_as_of: '2026-04-24T10:00:00Z',
            error_message: 'timeout',
            health_status: 'unreachable',
          }),
          { status: 200 },
        ),
      ),
    );
    const { result } = renderHook(
      () => useResilientQuery<{ count: number }>('/api/x'),
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => expect(result.current.data).toEqual({ count: 10 }));
    expect(result.current.isStale).toBe(true);
    expect(result.current.isReachable).toBe(false);
    expect(result.current.errorMessage).toBe('timeout');
  });

  it('no data + no session cache → data undefined', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            reachable: false,
            error_message: 'down',
            health_status: 'unreachable',
          }),
          { status: 200 },
        ),
      ),
    );
    const { result } = renderHook(
      () => useResilientQuery<{ count: number }>('/api/x'),
      { wrapper: wrapper(qc) },
    );
    // Wait for the fetch to fully resolve — not just loading-default state.
    await waitFor(() => expect(result.current.errorMessage).toBe('down'));
    expect(result.current.isReachable).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isStale).toBe(false);
  });
});
