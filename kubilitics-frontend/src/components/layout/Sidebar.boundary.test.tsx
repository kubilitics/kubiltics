/**
 * Phase 4 / Task 4.11 regression: Sidebar wraps its nav content in
 * <ClusterUnreachableBoundary/> — the shared primitive from
 * components/common — instead of the legacy in-file ClusterReachabilityBanner.
 *
 * This test exercises the integration at the boundary layer: when the hook
 * reports reachable=false, the boundary's amber banner (role="alert") appears
 * above the cached nav body.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Control what useResourceCounts returns from the test.
let mockCountsReturn: {
  reachable: boolean;
  stale: boolean;
  errorMessage?: string;
  usingClientCache: boolean;
  isLoading: boolean;
  isInitialLoad: boolean;
  isConnected: boolean;
  counts: Record<string, number>;
} = {
  reachable: true,
  stale: false,
  usingClientCache: false,
  isLoading: false,
  isInitialLoad: false,
  isConnected: true,
  counts: {},
};

vi.mock('@/hooks/useResourceCounts', () => ({
  useResourceCounts: () => mockCountsReturn,
}));

vi.mock('@/hooks/useMetalLBInstalled', () => ({
  useMetalLBInstalled: () => ({ installed: false }),
}));

vi.mock('@/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({ isConnected: true }),
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
  mockCountsReturn = {
    reachable: true,
    stale: false,
    usingClientCache: false,
    isLoading: false,
    isInitialLoad: false,
    isConnected: true,
    counts: {},
  };
});

function renderSidebar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Sidebar — ClusterUnreachableBoundary integration', () => {
  it('does not render the alert banner when reachable', () => {
    mockCountsReturn = { ...mockCountsReturn, reachable: true, stale: false };
    renderSidebar();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders an alert role when unreachable', () => {
    mockCountsReturn = {
      ...mockCountsReturn,
      reachable: false,
      stale: true,
      errorMessage: 'apiserver: connection refused',
      usingClientCache: true,
    };
    renderSidebar();
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent || '').toMatch(/connection refused/);
  });
});
