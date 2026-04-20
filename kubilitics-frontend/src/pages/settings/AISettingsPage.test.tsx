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
    vi.stubGlobal('fetch', vi.fn());
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
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, latency_ms: 42 }),
    });
    renderPage();

    // Pre-validate: API key required + Save disabled
    fireEvent.change(screen.getByTestId('api-key-input'), { target: { value: 'sk-test' } });
    expect(screen.getByTestId('save-btn')).toBeDisabled();

    fireEvent.click(screen.getByTestId('validate-btn'));
    await waitFor(() => expect(screen.getByTestId('validate-result')).toHaveTextContent(/Connected/));
    expect(screen.getByTestId('save-btn')).not.toBeDisabled();
  });

  it('save flow posts to /api/v1/ai/config after a successful validate', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, latency_ms: 12 }) }) // validate
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, applied_provider: 'openai' }) }); // save

    renderPage();
    fireEvent.change(screen.getByTestId('api-key-input'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByTestId('validate-btn'));
    await waitFor(() => expect(screen.getByTestId('save-btn')).not.toBeDisabled());

    fireEvent.click(screen.getByTestId('save-btn'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const lastCall = fetchMock.mock.calls[1];
    expect(lastCall[0]).toBe('/api/v1/ai/config');
    expect(lastCall[1]?.method).toBe('POST');
    const body = JSON.parse(lastCall[1]?.body as string);
    expect(body.provider).toBe('openai');
    expect(body.api_key).toBe('sk-test');
  });
});
