import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useAIProfiles, type Profile } from './useAIProfiles';

const SAMPLE: Profile[] = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'OpenAI prod',
    provider: 'openai',
    model: 'gpt-4o',
    base_url: '',
    has_key: true,
    created_at: '2026-04-26T09:14:21Z',
    updated_at: '2026-04-26T09:14:21Z',
    last_validated_at: '2026-04-26T09:14:23Z',
    last_error: null,
  },
];

beforeEach(() => {
  invokeMock.mockReset();
});

describe('useAIProfiles', () => {
  it('lists profiles on mount', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_profiles') return Promise.resolve(SAMPLE);
      if (cmd === 'get_active_profile') return Promise.resolve(SAMPLE[0]);
      throw new Error(`unexpected: ${cmd}`);
    });
    const { result } = renderHook(() => useAIProfiles());
    await waitFor(() => expect(result.current.profiles).toEqual(SAMPLE));
    expect(result.current.activeId).toBe(SAMPLE[0].id);
    expect(result.current.isLoading).toBe(false);
  });

  it('reload re-fetches', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_profiles') return Promise.resolve(SAMPLE);
      if (cmd === 'get_active_profile') return Promise.resolve(SAMPLE[0]);
      throw new Error(`unexpected: ${cmd}`);
    });
    const { result } = renderHook(() => useAIProfiles());
    await waitFor(() => expect(result.current.profiles).toEqual(SAMPLE));
    invokeMock.mockClear();
    await act(async () => { await result.current.reload(); });
    expect(invokeMock).toHaveBeenCalledWith('list_profiles');
    expect(invokeMock).toHaveBeenCalledWith('get_active_profile');
  });

  it('exposes the error when invoke fails', async () => {
    invokeMock.mockImplementation(() => Promise.reject(new Error('boom')));
    const { result } = renderHook(() => useAIProfiles());
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.profiles).toEqual([]);
  });

  it('handles null active profile (no profile activated)', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_profiles') return Promise.resolve(SAMPLE);
      if (cmd === 'get_active_profile') return Promise.resolve(null);
      throw new Error(`unexpected: ${cmd}`);
    });
    const { result } = renderHook(() => useAIProfiles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.activeId).toBeNull();
  });
});
