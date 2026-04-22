import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { useAIConfigStore } from './aiConfigStore';

describe('aiConfigStore', () => {
  beforeEach(() => {
    useAIConfigStore.setState({
      provider: 'openai',
      model: 'gpt-4o',
      baseUrl: '',
      hasApiKey: false,
      loading: false,
      lastError: null,
    });
    (invoke as ReturnType<typeof vi.fn>).mockReset();
  });

  it('hydrates from load_ai_config on mount', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      provider: 'anthropic',
      model: 'claude-3-5-haiku-latest',
      base_url: '',
      has_api_key: true,
    });
    await useAIConfigStore.getState().hydrate();
    const s = useAIConfigStore.getState();
    expect(s.provider).toBe('anthropic');
    expect(s.model).toBe('claude-3-5-haiku-latest');
    expect(s.hasApiKey).toBe(true);
    expect(invoke).toHaveBeenCalledWith('load_ai_config');
  });

  it('save calls save_ai_config + re-hydrates', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'save_ai_config') return Promise.resolve();
      if (cmd === 'load_ai_config') {
        return Promise.resolve({
          provider: 'openai',
          model: 'gpt-4o',
          base_url: '',
          has_api_key: true, // keychain now has it
        });
      }
      return Promise.resolve();
    });
    await useAIConfigStore
      .getState()
      .save({ provider: 'openai', model: 'gpt-4o', baseUrl: '', apiKey: 'sk-test-xyz-0123456789' });
    const calls = (invoke as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe('save_ai_config');
    expect(calls[0][1]).toMatchObject({
      cfg: {
        provider: 'openai',
        model: 'gpt-4o',
        api_key: 'sk-test-xyz-0123456789',
      },
    });
    // post-save hydrate masks the raw key and flips hasApiKey.
    expect(useAIConfigStore.getState().hasApiKey).toBe(true);
  });

  it('testConnection round-trips via test_llm_connection', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      latency_ms: 137,
      error: null,
    });
    const res = await useAIConfigStore
      .getState()
      .testConnection({ provider: 'openai', model: 'gpt-4o', baseUrl: '', apiKey: 'sk-x' });
    expect(res.ok).toBe(true);
    expect(res.latencyMs).toBe(137);
  });

  it('surfaces save errors via lastError', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('keychain denied'));
    await useAIConfigStore
      .getState()
      .save({ provider: 'openai', model: 'gpt-4o', baseUrl: '', apiKey: 'sk-x' })
      .catch(() => null);
    expect(useAIConfigStore.getState().lastError).toContain('keychain denied');
  });
});
