/**
 * Tests for useAIUserConfig. Locks in the gate the ChatPanel uses to
 * decide whether the user has actively configured AI via Settings, vs
 * the brain happening to be running with a dev-baked provider. The
 * regression this prevents: chat input silently enabled on a fresh
 * install because the brain was started with a YAML config on disk.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { useAIUserConfig } from './useAIUserConfig';

const originalFetch = global.fetch;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

function mockFetch(body: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  global.fetch = originalFetch;
});

describe('useAIUserConfig', () => {
  it('isConfigured=false when backend returns empty config (fresh install)', async () => {
    mockFetch({ provider: '', model: '', base_url: '', api_key_masked: '', has_api_key: 'false' });
    const { result } = renderHook(() => useAIUserConfig(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isConfigured).toBe(false);
  });

  it('isConfigured=true when openai + saved key', async () => {
    mockFetch({ provider: 'openai', model: 'gpt-4o-mini', base_url: '', api_key_masked: '••••c_8A', has_api_key: 'true' });
    const { result } = renderHook(() => useAIUserConfig(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isConfigured).toBe(true);
  });

  it('isConfigured=false when provider set but no key saved', async () => {
    // User picked provider in Settings but never hit Save with a key.
    mockFetch({ provider: 'openai', model: 'gpt-4o-mini', base_url: '', api_key_masked: '', has_api_key: 'false' });
    const { result } = renderHook(() => useAIUserConfig(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isConfigured).toBe(false);
  });

  it('isConfigured=true for ollama with base_url (no API key needed)', async () => {
    mockFetch({ provider: 'ollama', model: 'llama3', base_url: 'http://localhost:11434', api_key_masked: '', has_api_key: 'false' });
    const { result } = renderHook(() => useAIUserConfig(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isConfigured).toBe(true);
  });

  it('isConfigured=false for ollama without base_url', async () => {
    mockFetch({ provider: 'ollama', model: 'llama3', base_url: '', api_key_masked: '', has_api_key: 'false' });
    const { result } = renderHook(() => useAIUserConfig(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isConfigured).toBe(false);
  });
});
