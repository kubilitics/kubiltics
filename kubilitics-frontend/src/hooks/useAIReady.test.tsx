import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the three underlying hooks so we control each input independently.
// Default: every gate green. Individual tests override one slot at a time.
vi.mock('./useAIStatus', () => ({
  useAIStatus: vi.fn(() => ({
    data: { state: 'ready' },
    isLoading: false,
    isError: false,
    error: null,
  })),
  intervalForState: (s?: string) => (s === 'error' || s === 'unavailable' || s === 'unknown' ? 30_000 : 5_000),
}));
vi.mock('./useAICapabilities', () => ({
  useAICapabilities: vi.fn(() => ({
    data: { ready: true, capabilities: null, state: 'ready' },
    isLoading: false,
    isError: false,
    error: null,
  })),
}));
vi.mock('./useAIUserConfig', () => ({
  useAIUserConfig: vi.fn(() => ({
    data: { provider: 'openai', model: 'gpt-4o', base_url: '', api_key_masked: '****', has_api_key: 'true' },
    isConfigured: true,
    isLoading: false,
    error: undefined,
  })),
}));

import { useAIReady } from './useAIReady';
import { useAIStatus } from './useAIStatus';
import { useAICapabilities } from './useAICapabilities';
import { useAIUserConfig } from './useAIUserConfig';

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAIReady — reason precedence', () => {
  it("returns 'loading' when any underlying query is loading", () => {
    vi.mocked(useAICapabilities).mockReturnValueOnce({
      data: undefined, isLoading: true, isError: false, error: null,
    } as ReturnType<typeof useAICapabilities>);
    const { result } = renderHook(() => useAIReady('c1'), { wrapper });
    expect(result.current.reason).toBe('loading');
    expect(result.current.ready).toBe(false);
  });

  it("returns 'brain_unreachable' when any underlying query errors", () => {
    vi.mocked(useAIStatus).mockReturnValueOnce({
      data: undefined, isLoading: false, isError: true, error: new Error('boom'),
    } as ReturnType<typeof useAIStatus>);
    const { result } = renderHook(() => useAIReady('c1'), { wrapper });
    expect(result.current.reason).toBe('brain_unreachable');
    expect(result.current.ready).toBe(false);
  });

  it("returns 'brain_error' when status reports state='error'", () => {
    vi.mocked(useAIStatus).mockReturnValueOnce({
      data: { state: 'error' }, isLoading: false, isError: false, error: null,
    } as ReturnType<typeof useAIStatus>);
    const { result } = renderHook(() => useAIReady('c1'), { wrapper });
    expect(result.current.reason).toBe('brain_error');
    expect(result.current.ready).toBe(false);
  });

  it("returns 'brain_error' when status reports state='unavailable'", () => {
    vi.mocked(useAIStatus).mockReturnValueOnce({
      data: { state: 'unavailable' }, isLoading: false, isError: false, error: null,
    } as ReturnType<typeof useAIStatus>);
    const { result } = renderHook(() => useAIReady('c1'), { wrapper });
    expect(result.current.reason).toBe('brain_error');
  });

  it("returns 'not_configured' when user config is not configured (HEADLINE BUG)", () => {
    // Capabilities ready=true AND status=ready, but user has not saved config.
    // Old code in ChatStatusPill could show 'AI Ready' here. New code must NOT.
    vi.mocked(useAIUserConfig).mockReturnValueOnce({
      data: { provider: '', model: '', base_url: '', api_key_masked: '', has_api_key: 'false' },
      isConfigured: false, isLoading: false, error: undefined,
    });
    const { result } = renderHook(() => useAIReady('c1'), { wrapper });
    expect(result.current.reason).toBe('not_configured');
    expect(result.current.ready).toBe(false);
  });

  it("returns 'degraded' when status=degraded and configured", () => {
    vi.mocked(useAIStatus).mockReturnValueOnce({
      data: { state: 'degraded' }, isLoading: false, isError: false, error: null,
    } as ReturnType<typeof useAIStatus>);
    const { result } = renderHook(() => useAIReady('c1'), { wrapper });
    expect(result.current.reason).toBe('degraded');
    expect(result.current.ready).toBe(true);
  });

  it("returns 'ready' when all three gates are green", () => {
    const { result } = renderHook(() => useAIReady('c1'), { wrapper });
    expect(result.current.reason).toBe('ready');
    expect(result.current.ready).toBe(true);
  });

  it("returns 'ready' when status.state is empty (brain up but no ready event) and capabilities reports ready (REGRESSION: brain's /status historically returns empty when up)", () => {
    // /api/v1/ai/status returns {"state":""} — brain is reachable but hasn't
    // pushed a ready event yet. /api/v1/ai/capabilities and /api/v1/ai/config
    // both report ready/configured. ChatPanel must NOT sit on "Checking AI…".
    vi.mocked(useAIStatus).mockReturnValueOnce({
      data: { state: '' as unknown as 'ready' }, // backend wart: empty string
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useAIStatus>);
    const { result } = renderHook(() => useAIReady('c1'), { wrapper });
    expect(result.current.reason).toBe('ready');
    expect(result.current.ready).toBe(true);
  });

  it("still returns 'not_configured' when status.state is empty AND user is unconfigured (headline bug must not regress)", () => {
    vi.mocked(useAIStatus).mockReturnValueOnce({
      data: { state: '' as unknown as 'ready' },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useAIStatus>);
    vi.mocked(useAIUserConfig).mockReturnValueOnce({
      data: { provider: '', model: '', base_url: '', api_key_masked: '', has_api_key: 'false' },
      isConfigured: false, isLoading: false, error: undefined,
    });
    const { result } = renderHook(() => useAIReady('c1'), { wrapper });
    expect(result.current.reason).toBe('not_configured');
    expect(result.current.ready).toBe(false);
  });
});

describe('useAIReady — labels', () => {
  it('exposes a non-empty label for every reason', () => {
    const { result } = renderHook(() => useAIReady('c1'), { wrapper });
    expect(typeof result.current.label).toBe('string');
    expect(result.current.label.length).toBeGreaterThan(0);
  });
});
