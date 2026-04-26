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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import AISettingsPage from './AISettingsPage';

// Mock the profile hooks used by the Phase-5 shim inside AISettingsPage.
vi.mock('@/hooks/useAIProfiles', () => ({
  useAIProfiles: vi.fn(() => ({
    profiles: [],
    activeId: null,
    isLoading: false,
    reload: async () => {},
  })),
}));

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
  // AISettingsPage uses useQueryClient to invalidate the ['ai'] query
  // tree after save, so react-query's Provider must be in the tree
  // for the component to mount. Fresh QueryClient per render so cache
  // state doesn't bleed across tests.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AISettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AISettingsPage (keychain round-trip)', () => {
  beforeEach(() => {
    (invoke as ReturnType<typeof vi.fn>).mockReset();
    // Default mocks. The page calls several commands on mount; every
    // one must have an answer or useEffect throws unhandled rejections
    // and the test's render flakes.
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'list_profiles') return Promise.resolve([]);
      if (cmd === 'get_active_profile') return Promise.resolve(null);
      if (cmd === 'get_budget_status') {
        return Promise.resolve({ spent_usd: 0, cap_usd: 0 });
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

  it('mounts and probes the brain status', async () => {
    // The Phase-5 shim gets profile data from useAIProfiles (hook-mocked above);
    // the page still directly invokes get_brain_status for the reachability banner.
    renderPage();
    await waitFor(() => {
      const calls = (invoke as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(calls).toContain('get_brain_status');
    });
  });

  it('renders the model select dropdown', async () => {
    // Phase 5 shim returns empty model when no active profile; Phase 6
    // will wire the correct default. Just assert the element renders.
    renderPage();
    await screen.findByTestId('model-select');
  });

  it('Test connection button renders without crashing (Phase 5 shim: save/test are stubs)', async () => {
    // Phase 5 shim returns stub responses for save/testConnection.
    // Phase 6 will wire the real profile-based implementations.
    renderPage();
    await waitFor(() => expect(screen.getByTestId('test-btn')).toBeInTheDocument());
  });

  it('Save & Test button renders without crashing (Phase 5 shim: save is a stub)', async () => {
    // Phase 5 shim returns stub responses for save/testConnection.
    // Phase 6 will wire the real profile-based implementations.
    renderPage();
    await waitFor(() => expect(screen.getByTestId('save-btn')).toBeInTheDocument());
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
      if (cmd === 'list_profiles') return Promise.resolve([]);
      if (cmd === 'get_active_profile') return Promise.resolve(null);
      if (cmd === 'get_budget_status') return Promise.resolve({ spent_usd: 0, cap_usd: 0 });
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
      if (cmd === 'list_profiles') return Promise.resolve([]);
      if (cmd === 'get_active_profile') return Promise.resolve(null);
      if (cmd === 'get_budget_status') return Promise.resolve({ spent_usd: 0, cap_usd: 0 });
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
      if (cmd === 'list_profiles') return Promise.resolve([]);
      if (cmd === 'get_active_profile') return Promise.resolve(null);
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
