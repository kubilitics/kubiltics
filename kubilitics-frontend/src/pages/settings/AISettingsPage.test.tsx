/**
 * Tests for AISettingsPage — driven by the `useAIConfigStore` Tauri-keychain
 * round-trip (Phase 2 / Blocker C / Gap 1).
 *
 * Covers:
 *   - render without crash
 *   - hydrate() from load_ai_config on mount
 *   - provider dropdown default (OpenAI / gpt-4o)
 *   - "Test connection" invokes test_llm_connection
 *   - "Save & Test" invokes save_ai_config then test_llm_connection
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

import AISettingsPage from './AISettingsPage';
import { useAIConfigStore } from '@/stores/aiConfigStore';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
import { invoke } from '@tauri-apps/api/core';

vi.mock('@/components/ui/sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <AISettingsPage />
    </MemoryRouter>,
  );
}

describe('AISettingsPage (keychain round-trip)', () => {
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
    // Default: load_ai_config returns the current store-like payload;
    // get_budget_status returns a sane default.
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'load_ai_config') {
        return Promise.resolve({
          provider: 'openai',
          model: 'gpt-4o',
          base_url: '',
          has_api_key: false,
        });
      }
      if (cmd === 'get_budget_status') {
        return Promise.resolve({ spent_usd: 0, cap_usd: 0 });
      }
      return Promise.resolve(undefined);
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    renderPage();
    expect(screen.getByText('AI Settings')).toBeInTheDocument();
  });

  it('mounts and calls load_ai_config via hydrate()', async () => {
    renderPage();
    await waitFor(() => {
      const calls = (invoke as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(calls).toContain('load_ai_config');
    });
  });

  it('defaults the OpenAI model to gpt-4o, not gpt-4o-mini', async () => {
    renderPage();
    const trigger = await screen.findByTestId('model-select');
    expect(trigger).toHaveTextContent('gpt-4o');
    expect(trigger).not.toHaveTextContent('gpt-4o-mini');
  });

  it('Test connection button invokes test_llm_connection', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'load_ai_config') {
        return Promise.resolve({ provider: 'openai', model: 'gpt-4o', base_url: '', has_api_key: true });
      }
      if (cmd === 'get_budget_status') return Promise.resolve({ spent_usd: 0, cap_usd: 0 });
      if (cmd === 'test_llm_connection') {
        return Promise.resolve({ ok: true, status: 200, latency_ms: 42, error: null });
      }
      return Promise.resolve(undefined);
    });
    renderPage();
    fireEvent.click(screen.getByTestId('test-btn'));
    await waitFor(() => expect(screen.getByTestId('test-result')).toHaveTextContent(/Connected/));
    const calls = (invoke as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls).toContain('test_llm_connection');
  });

  it('Save & Test invokes save_ai_config (then test_llm_connection)', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'load_ai_config') {
        return Promise.resolve({ provider: 'openai', model: 'gpt-4o', base_url: '', has_api_key: false });
      }
      if (cmd === 'get_budget_status') return Promise.resolve({ spent_usd: 0, cap_usd: 0 });
      if (cmd === 'save_ai_config') return Promise.resolve();
      if (cmd === 'test_llm_connection') {
        return Promise.resolve({ ok: true, status: 200, latency_ms: 15, error: null });
      }
      return Promise.resolve(undefined);
    });
    renderPage();
    fireEvent.change(screen.getByTestId('api-key-input'), { target: { value: 'sk-test-xyz-012345' } });
    fireEvent.click(screen.getByTestId('save-btn'));
    await waitFor(() => {
      const calls = (invoke as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(calls).toContain('save_ai_config');
    });
    // The save payload includes the raw api_key and the Rust side is
    // responsible for keychain-persisting it. We assert the payload shape.
    const saveCall = (invoke as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === 'save_ai_config');
    expect(saveCall?.[1]).toMatchObject({ cfg: { provider: 'openai', api_key: 'sk-test-xyz-012345' } });
  });

  it('Reset budget cap button invokes reset_budget', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'load_ai_config') {
        return Promise.resolve({ provider: 'openai', model: 'gpt-4o', base_url: '', has_api_key: true });
      }
      if (cmd === 'get_budget_status') return Promise.resolve({ spent_usd: 1.23, cap_usd: 10 });
      if (cmd === 'reset_budget') return Promise.resolve();
      return Promise.resolve(undefined);
    });
    renderPage();
    fireEvent.click(screen.getByTestId('reset-budget-btn'));
    await waitFor(() => {
      const calls = (invoke as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(calls).toContain('reset_budget');
    });
  });
});
