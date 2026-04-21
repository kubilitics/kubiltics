/**
 * Tests for AISettingsPage
 *
 * Covers: render, current-state surfacing, provider switching,
 * save-disabled-until-validated gate, validate -> save happy path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import AISettingsPage from './AISettingsPage';

// ---- Mocks ----
vi.mock('@/hooks/useAIStatus', () => ({
  useAIStatus: () => ({
    data: { state: 'ready', version: 'test-1.2.3', engines: ['llm', 'kagent'] },
    isLoading: false,
  }),
  intervalForState: () => 5000,
}));

vi.mock('@/hooks/useAICapabilities', () => ({
  useAICapabilities: () => ({
    data: {
      ready: true,
      capabilities: {
        schema_version: '1.0.1',
        ai_version: 'test-1.2.3',
        providers: ['openai', 'anthropic'],
        models: ['gpt-4o-mini'],
        supports_undo: true,
        supports_plans: true,
      },
      state: 'ready',
    },
  }),
}));

vi.mock('@/hooks/useActiveClusterId', () => ({
  useActiveClusterId: () => 'cluster-test',
}));

// Sonner toast — silent, capture-able if needed
vi.mock('@/components/ui/sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AISettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AISettingsPage', () => {
  beforeEach(() => {
    // Default: GET /ai/config on mount returns 404 (no saved config). Tests
    // that exercise validate/save chain extra mockResolvedValueOnce calls
    // on top of this default.
    const f = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    vi.stubGlobal('fetch', f);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    renderPage();
    expect(screen.getByText('AI Settings')).toBeInTheDocument();
  });

  it('shows current state from useAIStatus', () => {
    renderPage();
    // State badge
    expect(screen.getByText('ready')).toBeInTheDocument();
    // Version + engines surfaced
    expect(screen.getByText('test-1.2.3')).toBeInTheDocument();
    expect(screen.getByText('llm, kagent')).toBeInTheDocument();
  });

  it('disables Save until Validate succeeds', async () => {
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) }) // mount GET
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, latency_ms: 42 }) }); // validate
    renderPage();

    // Pre-validate: API key required + Save disabled
    fireEvent.change(screen.getByTestId('api-key-input'), { target: { value: 'sk-test' } });
    expect(screen.getByTestId('save-btn')).toBeDisabled();

    fireEvent.click(screen.getByTestId('validate-btn'));
    await waitFor(() => expect(screen.getByTestId('validate-result')).toHaveTextContent(/Connected/));
    expect(screen.getByTestId('save-btn')).not.toBeDisabled();
  });

  it('defaults the OpenAI model to gpt-4o, not gpt-4o-mini', async () => {
    // Fresh install: no saved config. The provider dropdown starts on OpenAI,
    // and the model dropdown must land on gpt-4o — not gpt-4o-mini. Using the
    // mini by default was the single biggest "feels dumb" lever: per-prompt
    // fragility, missing summaries, text that collapses on any large tool
    // output. gpt-4o costs more per million tokens but eliminates most of
    // the tax gpt-4o-mini was charging us in UX.
    renderPage();
    // The SelectTrigger renders the current value as its text content.
    const trigger = await screen.findByTestId('model-select');
    expect(trigger).toHaveTextContent('gpt-4o');
    expect(trigger).not.toHaveTextContent('gpt-4o-mini');
  });

  it('save flow posts to /api/v1/ai/config after a successful validate', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    // 1st call: mount-time GET /ai/config (no saved config). Then validate, then save.
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) }) // mount GET
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, latency_ms: 12 }) }) // validate
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, applied_provider: 'openai' }) }); // save

    renderPage();
    fireEvent.change(screen.getByTestId('api-key-input'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByTestId('validate-btn'));
    await waitFor(() => expect(screen.getByTestId('save-btn')).not.toBeDisabled());

    fireEvent.click(screen.getByTestId('save-btn'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    // The save POST is the third (last) call after mount-GET + validate.
    const saveCall = fetchMock.mock.calls[2];
    expect(saveCall[0]).toBe('/api/v1/ai/config');
    expect(saveCall[1]?.method).toBe('POST');
    const body = JSON.parse(saveCall[1]?.body as string);
    expect(body.provider).toBe('openai');
    expect(body.api_key).toBe('sk-test');
  });
});
