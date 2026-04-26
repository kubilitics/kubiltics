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
vi.mock('./useActiveProfile', () => ({
  useActiveProfile: vi.fn(() => ({
    id: 'a',
    name: 'Test',
    provider: 'openai',
    model: 'gpt-4o',
    base_url: '',
    has_key: true,
    created_at: '',
    updated_at: '',
    last_validated_at: null,
    last_error: null,
  })),
}));

import { useAIReady } from './useAIReady';
import { useAIStatus } from './useAIStatus';
import { useAICapabilities } from './useAICapabilities';
import { useActiveProfile } from './useActiveProfile';

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
    vi.mocked(useActiveProfile).mockReturnValueOnce(null);
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
    vi.mocked(useActiveProfile).mockReturnValueOnce(null);
    const { result } = renderHook(() => useAIReady('c1'), { wrapper });
    expect(result.current.reason).toBe('not_configured');
    expect(result.current.ready).toBe(false);
  });

  // ─── REGRESSION GUARD: hosted-custom-without-key must not show ready ───
  // Bug we shipped on 2026-04-26 then fixed in commit 0b77d8e4: the
  // credsOk logic treated ANY custom provider with a base_url as
  // configured. That's right for local Ollama / proxies but wrong for
  // hosted custom APIs (Together, Groq, Mistral, Fireworks) which all
  // need a key. The pill flipped green even though chat would fail with
  // the brain returning 401/403 from the upstream LLM. These tests lock
  // the fix so a future contributor copy-pasting the old check fails CI.
  it("REGRESSION: returns 'not_configured' for custom + remote URL + no key (hosted-without-key bug)", () => {
    vi.mocked(useActiveProfile).mockReturnValueOnce({
      id: 'a',
      name: 'Together hosted',
      provider: 'custom',
      model: 'Qwen/Qwen2.5-7B-Instruct-Turbo',
      base_url: 'https://api.together.xyz/v1',
      has_key: false, // user has not yet entered the key
      created_at: '',
      updated_at: '',
      last_validated_at: null,
      last_error: null,
    });
    const { result } = renderHook(() => useAIReady('c1'), { wrapper });
    expect(result.current.reason).toBe('not_configured');
    expect(result.current.ready).toBe(false);
  });

  it("REGRESSION: returns 'ready' for custom + localhost URL + no key (local LLM proxy exception)", () => {
    vi.mocked(useActiveProfile).mockReturnValueOnce({
      id: 'a',
      name: 'Local proxy',
      provider: 'custom',
      model: 'qwen2.5:3b',
      base_url: 'http://localhost:11434/v1',
      has_key: false,
      created_at: '',
      updated_at: '',
      last_validated_at: null,
      last_error: null,
    });
    const { result } = renderHook(() => useAIReady('c1'), { wrapper });
    expect(result.current.reason).toBe('ready');
    expect(result.current.ready).toBe(true);
  });

  it("REGRESSION: returns 'ready' for custom + 127.0.0.1 URL + no key (loopback alt-form)", () => {
    vi.mocked(useActiveProfile).mockReturnValueOnce({
      id: 'a',
      name: 'Local 127',
      provider: 'custom',
      model: 'm',
      base_url: 'http://127.0.0.1:8000',
      has_key: false,
      created_at: '',
      updated_at: '',
      last_validated_at: null,
      last_error: null,
    });
    const { result } = renderHook(() => useAIReady('c1'), { wrapper });
    expect(result.current.reason).toBe('ready');
  });

  // ─── REGRESSION GUARD: active-profile last_error surfaces as brain_error ───
  // Without this surfacing, cold-start activation failures (or a stale
  // key being rejected by the upstream LLM) silently dropped the pill
  // into the defensive 'loading' state — user saw a spinner forever
  // with no actionable message. last_error is the most specific signal
  // we have post-hot-wire-failure; it MUST drive the pill state.
  it("REGRESSION: returns 'brain_error' when active profile carries a last_error", () => {
    vi.mocked(useActiveProfile).mockReturnValueOnce({
      id: 'a',
      name: 'Test',
      provider: 'openai',
      model: 'gpt-4o',
      base_url: '',
      has_key: true,
      created_at: '',
      updated_at: '',
      last_validated_at: '2026-04-26T00:00:00Z',
      last_error: 'brain rejected (401): invalid_api_key',
    });
    const { result } = renderHook(() => useAIReady('c1'), { wrapper });
    expect(result.current.reason).toBe('brain_error');
    expect(result.current.detail).toBe('brain rejected (401): invalid_api_key');
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
