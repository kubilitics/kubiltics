/**
 * Phase 6 task 6.0c: Sidebar's handleSwitchCluster must route to `/clusters`
 * when FEATURE_PRESENCE_V2 is on, and to `/connect` when it is off. The
 * behavior is a two-branch conditional that no existing test covers.
 *
 * This test mocks the feature-flag module (so we can flip it per test) and
 * verifies the navigate target by driving the "switch cluster" button on
 * the ClusterUnreachableBoundary — the same button `handleSwitchCluster` is
 * wired to in Sidebar.tsx.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Spy on navigate so we can assert the target URL.
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// Feature-flag module — tests toggle the return value.
vi.mock('@/lib/featureFlags', () => ({
  featurePresenceV2: vi.fn(() => false),
}));
import { featurePresenceV2 } from '@/lib/featureFlags';

// Force the boundary into unreachable state so the "Switch cluster" button
// actually renders.
vi.mock('@/hooks/useResourceCounts', () => ({
  useResourceCounts: () => ({
    reachable: false,
    stale: true,
    errorMessage: 'apiserver: connection refused',
    usingClientCache: true,
    isLoading: false,
    isInitialLoad: false,
    isConnected: false,
    counts: {},
  }),
}));

vi.mock('@/hooks/useMetalLBInstalled', () => ({
  useMetalLBInstalled: () => ({ installed: false }),
}));

vi.mock('@/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({ isConnected: false }),
}));

vi.mock('@/hooks/useHoverPrefetch', () => ({
  useHoverPrefetch: () => ({ onMouseEnter: () => {}, onMouseLeave: () => {} }),
}));

import { Sidebar } from './Sidebar';

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      }),
    });
  }
});

beforeEach(() => {
  navigateMock.mockReset();
  vi.mocked(featurePresenceV2).mockReturnValue(false);
});

function renderSidebar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/pods']}>
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Sidebar — switch-cluster navigation target per FEATURE_PRESENCE_V2', () => {
  it('routes to /connect when the flag is OFF', async () => {
    vi.mocked(featurePresenceV2).mockReturnValue(false);
    renderSidebar();
    const switchBtn = await screen.findByRole('button', { name: /switch cluster/i });
    await userEvent.click(switchBtn);
    expect(navigateMock).toHaveBeenCalledWith('/connect');
    expect(navigateMock).not.toHaveBeenCalledWith('/clusters');
  });

  it('routes to /clusters when the flag is ON', async () => {
    vi.mocked(featurePresenceV2).mockReturnValue(true);
    renderSidebar();
    const switchBtn = await screen.findByRole('button', { name: /switch cluster/i });
    await userEvent.click(switchBtn);
    expect(navigateMock).toHaveBeenCalledWith('/clusters');
    expect(navigateMock).not.toHaveBeenCalledWith('/connect');
  });
});
