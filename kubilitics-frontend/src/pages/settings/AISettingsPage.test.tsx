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
    // Default mocks. The page calls several commands on mount; every
    // one must have an answer or useEffect throws unhandled rejections
    // and the test's render flakes.
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
      if (cmd === 'migrate_has_api_key') {
        // Default: migration already ran (idempotent no-op).
        return Promise.resolve({
          ran: false,
          has_api_key: false,
          key_found_in_keychain: false,
        });
      }
      if (cmd === 'get_brain_status') {
        // Default: brain is ready → banner stays hidden.
        return Promise.resolve({ status: 'ready', message: 'AI engine ready' });
      }
      if (cmd === 'detect_available_providers') {
        return Promise.resolve([]);
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

  // ── Post-P0/P1/P2/P3 redesign ────────────────────────────────────────

  it('NEVER probes the keychain on mount — no migrate_has_api_key call', async () => {
    // Regression guard: the migration command existed briefly and was
    // removed because even one prompt on page open was unacceptable.
    // If a future refactor re-introduces any keychain-touching command
    // on the mount path, this test fails and the reviewer has to make
    // a conscious choice about user-visible prompts.
    renderPage();
    // Wait long enough for all mount effects to settle.
    await waitFor(() => {
      const calls = (invoke as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(calls).toContain('load_ai_config');
      expect(calls).toContain('get_brain_status');
    });
    const calls = (invoke as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('migrate_has_api_key');
    expect(calls).not.toContain('test_llm_connection'); // test is ALSO keychain-touching
  });

  it('hides the brain reachability banner when the engine is ready', async () => {
    renderPage();
    // Defaults set get_brain_status → ready. Wait for useEffect to fire
    // load_ai_config first so the page has settled.
    await waitFor(() => {
      const calls = (invoke as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(calls).toContain('get_brain_status');
    });
    expect(screen.queryByTestId('brain-reachability-banner')).not.toBeInTheDocument();
  });

  it('shows the brain reachability banner and a Restart engine button when the engine is not ready', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'load_ai_config') {
        return Promise.resolve({ provider: 'openai', model: 'gpt-4o', base_url: '', has_api_key: false });
      }
      if (cmd === 'get_budget_status') return Promise.resolve({ spent_usd: 0, cap_usd: 0 });
      if (cmd === 'migrate_has_api_key') {
        return Promise.resolve({ ran: false, has_api_key: false, key_found_in_keychain: false });
      }
      if (cmd === 'get_brain_status') return Promise.resolve({ status: 'starting' });
      if (cmd === 'detect_available_providers') return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    renderPage();
    const banner = await screen.findByTestId('brain-reachability-banner');
    expect(banner).toBeInTheDocument();
    expect(screen.getByTestId('brain-restart-btn')).toBeInTheDocument();
  });

  it('Restart engine button invokes restart_brain', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'load_ai_config') {
        return Promise.resolve({ provider: 'openai', model: 'gpt-4o', base_url: '', has_api_key: false });
      }
      if (cmd === 'get_budget_status') return Promise.resolve({ spent_usd: 0, cap_usd: 0 });
      if (cmd === 'migrate_has_api_key') {
        return Promise.resolve({ ran: false, has_api_key: false, key_found_in_keychain: false });
      }
      if (cmd === 'get_brain_status') return Promise.resolve({ status: 'starting' });
      if (cmd === 'detect_available_providers') return Promise.resolve([]);
      if (cmd === 'restart_brain') return Promise.resolve();
      return Promise.resolve(undefined);
    });
    renderPage();
    const restartBtn = await screen.findByTestId('brain-restart-btn');
    fireEvent.click(restartBtn);
    await waitFor(() => {
      const calls = (invoke as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(calls).toContain('restart_brain');
    });
  });

  it('renders the merged Provider card with a status badge (no separate Current State card)', () => {
    // P2 redesign: the old "Current State" read-only tiles + "Provider
    // Configuration" editable fields were merged into a single card.
    // Test asserts the merged card's status-badge testid exists and
    // that the legacy separate Current State card is gone.
    renderPage();
    expect(screen.getByTestId('ai-provider-card')).toBeInTheDocument();
    expect(screen.getByTestId('ai-provider-status-badge')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-current-state-card')).not.toBeInTheDocument();
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
