/**
 * ChatPanel — budget_exceeded banner wiring.
 *
 * Phase 2 / Gap 3 close-out: verifies that when the chat store's most
 * recent assistant turn ends in error with code="budget_exceeded", the
 * <BudgetExceededBanner> renders above the input and its Reset button
 * invokes the `reset_budget` Tauri command.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// --- Tauri mock ---
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
import { invoke } from '@tauri-apps/api/core';

// --- Toast mock ---
vi.mock('@/components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// --- AI readiness hooks: pretend AI is fully configured & ready ---
vi.mock('@/hooks/useAICapabilities', () => ({
  useAICapabilities: () => ({
    data: {
      ready: true,
      state: 'ready',
      capabilities: { providers: ['openai'], models: ['gpt-4o'] },
    },
    error: undefined,
  }),
}));
vi.mock('@/hooks/useAIUserConfig', () => ({
  useAIUserConfig: () => ({ isConfigured: true, isLoading: false }),
}));
vi.mock('@/hooks/useChatController', () => ({
  useChatController: () => ({ sendMessage: vi.fn(), cancelTurn: vi.fn() }),
}));

// --- Child components: keep lightweight, we don't exercise them here ---
vi.mock('./ChatHeader', () => ({ ChatHeader: () => <div data-testid="chat-header" /> }));
vi.mock('./ChatTranscript', () => ({
  ChatTranscript: () => <div data-testid="chat-transcript" />,
}));
vi.mock('./ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

import { ChatPanel } from './ChatPanel';
import { useChatStore } from '@/stores/chatStore';
import { useActiveCluster, useClusterPresenceStore } from '@/stores/clusterPresenceStore';

function seedBudgetExceeded(clusterId: string) {
  useChatStore.setState({
    panelOpen: true,
    connectionState: 'open',
    connectionError: undefined,
    sessionByCluster: { [clusterId]: 'sess-1' },
    transcripts: {
      [clusterId]: [
        {
          kind: 'user',
          turnId: 'u1',
          text: 'hello',
          startedAt: 0,
        },
        {
          kind: 'assistant',
          turnId: 't1',
          anchorId: 'a1',
          blocks: [],
          state: 'error',
          startedAt: 1,
          finishedAt: 2,
          error: { code: 'budget_exceeded', message: 'cap reached' },
        },
      ],
    },
  });
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <ChatPanel />
    </MemoryRouter>,
  );
}

describe('ChatPanel — budget_exceeded banner', () => {
  beforeEach(() => {
    (invoke as ReturnType<typeof vi.fn>).mockReset();
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    // Seed presence with a connected cluster. `useActiveCluster()` derives the
    // legacy-shaped view from this state, so ChatPanel sees `{ id: 'c-1' }`.
    useClusterPresenceStore.setState({
      discovered: [],
      registered: [],
      connected: [
        {
          identity: { name: 'demo', serverUrl: 'https://demo' },
          source: 'manual',
          session_id: 'c-1',
          registered_at: new Date().toISOString(),
          connected_at: new Date().toISOString(),
          reachable: true,
        },
      ],
      activeLogicalIdentity: { name: 'demo', serverUrl: 'https://demo' },
      isReady: true,
    });
    seedBudgetExceeded('c-1');
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the banner when the last assistant turn errored with budget_exceeded', () => {
    renderPanel();
    expect(screen.getByTestId('budget-exceeded-banner')).toBeInTheDocument();
    expect(screen.getByTestId('budget-exceeded-banner')).toHaveTextContent(
      /Monthly AI budget reached/i,
    );
  });

  it('clicking Reset invokes the reset_budget Tauri command', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('budget-exceeded-reset'));
    await waitFor(() => {
      const calls = (invoke as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(calls).toContain('reset_budget');
    });
  });

  it('does not render the banner when the last turn errored with a different code', () => {
    useChatStore.setState({
      transcripts: {
        'c-1': [
          {
            kind: 'assistant',
            turnId: 't1',
            anchorId: 'a1',
            blocks: [],
            state: 'error',
            startedAt: 1,
            finishedAt: 2,
            error: { code: 'Internal', message: 'boom' },
          },
        ],
      },
    });
    renderPanel();
    expect(screen.queryByTestId('budget-exceeded-banner')).not.toBeInTheDocument();
  });
});

// ── Phase 2 quality fix #5: banner clears after successful reset ─────────
describe('ChatPanel banner auto-clear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      transcripts: {
        'c-1': [
          {
            kind: 'assistant',
            turnId: 't1',
            anchorId: 'a1',
            blocks: [],
            state: 'error',
            startedAt: 1,
            finishedAt: 2,
            error: { code: 'budget_exceeded', message: 'Monthly AI budget reached.' },
          },
        ],
      },
    });
  });

  function renderPanel() {
    return render(
      <MemoryRouter>
        <ChatPanel clusterId="c-1" open={true} onClose={() => {}} />
      </MemoryRouter>,
    );
  }

  it('banner unmounts after invoke("reset_budget") resolves', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    renderPanel();

    expect(screen.getByTestId('budget-exceeded-banner')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('budget-exceeded-reset'));

    await waitFor(() => {
      expect(screen.queryByTestId('budget-exceeded-banner')).not.toBeInTheDocument();
    });
  });

  it('banner stays if invoke("reset_budget") rejects', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    renderPanel();

    expect(screen.getByTestId('budget-exceeded-banner')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('budget-exceeded-reset'));

    // Banner should remain since reset failed — user needs to see the warning.
    await waitFor(() => {
      const calls = (invoke as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(calls).toContain('reset_budget');
    });
    expect(screen.getByTestId('budget-exceeded-banner')).toBeInTheDocument();
  });
});
