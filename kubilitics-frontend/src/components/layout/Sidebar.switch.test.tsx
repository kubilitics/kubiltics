/**
 * Phase 7: FEATURE_PRESENCE_V2 removed — V2 is the only path. Sidebar's
 * handleSwitchCluster always routes to /clusters. This test enforces that
 * contract so we don't regress to /connect.
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
  // jsdom has no scrollIntoView; Sidebar fires a deferred scrollIntoView
  // 150ms after mount. If our test finishes before that timer, the unhandled
  // TypeError pollutes other test files. Stub it once.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(() => {
  navigateMock.mockReset();
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

describe('Sidebar — switch-cluster navigation (Phase 7: always /clusters)', () => {
  it('routes to /clusters', async () => {
    renderSidebar();
    const switchBtn = await screen.findByRole('button', { name: /switch cluster/i });
    await userEvent.click(switchBtn);
    expect(navigateMock).toHaveBeenCalledWith('/clusters');
    expect(navigateMock).not.toHaveBeenCalledWith('/connect');
  });
});
