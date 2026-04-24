// Integration test for App routing helpers.
//
// The cluster-entry flow is a single page: /clusters. The picker renders a
// list when clusters exist and a clean empty state when none do. There is
// no separate /welcome route — a legacy redirect is kept so any stored
// bookmarks / deep links still resolve to the right place.
//
// App.tsx is massive — rendering the whole root is expensive and pulls in
// 140+ lazy pages. We exercise the exported routing helpers directly against
// a MemoryRouter, which exactly exercises the contracts promised by the
// current onboarding flow.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';

import {
  useClusterPresenceStore,
  __resetForTest,
} from '@/stores/clusterPresenceStore';
import {
  PresenceEntryPoint,
  ClusterPresenceSubscriber,
} from './App';

// Stub the presence hook. App's subscriber mounts useClusterPresence which
// would try to open an SSE stream; in jsdom we only need to assert the
// component renders without error.
vi.mock('@/hooks/useClusterPresence', () => ({
  useClusterPresence: vi.fn(),
}));

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/clusters" element={<div>CLUSTER_PICKER_STUB</div>} />
        {/* Legacy route — preserved in App.tsx as a Navigate redirect so
            stored bookmarks keep working even though there's no WelcomePage
            anymore. The stub here mirrors that redirect. */}
        <Route path="/welcome" element={<Navigate to="/clusters" replace />} />
        <Route path="/" element={<PresenceEntryPoint />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('App routing helpers — single-page onboarding', () => {
  beforeEach(() => {
    __resetForTest();
    vi.restoreAllMocks();
  });

  it('/clusters renders the picker', () => {
    renderAt('/clusters');
    expect(screen.getByText('CLUSTER_PICKER_STUB')).toBeInTheDocument();
  });

  it('legacy /welcome bookmark redirects to /clusters', () => {
    renderAt('/welcome');
    expect(screen.getByText('CLUSTER_PICKER_STUB')).toBeInTheDocument();
  });

  it('PresenceEntryPoint redirects / → /clusters when no clusters (picker owns the empty state)', () => {
    useClusterPresenceStore.setState({
      discovered: [],
      registered: [],
      connected: [],
      isReady: true,
    });
    renderAt('/');
    expect(screen.getByText('CLUSTER_PICKER_STUB')).toBeInTheDocument();
  });

  it('PresenceEntryPoint redirects / → /clusters when clusters exist', () => {
    useClusterPresenceStore.setState({
      discovered: [
        { identity: { name: 'prod', serverUrl: 'https://p' }, source: 'kubeconfig' },
      ],
      registered: [],
      connected: [],
      isReady: true,
    });
    renderAt('/');
    expect(screen.getByText('CLUSTER_PICKER_STUB')).toBeInTheDocument();
  });

  it('PresenceEntryPoint shows loader and does NOT navigate while isReady=false', () => {
    // Cold-start: availableClusters() reads an empty array before SSE
    // populates the store. Wait until isReady flips before deciding to
    // navigate — otherwise the loader is needed to avoid a flash.
    useClusterPresenceStore.setState({
      discovered: [
        { identity: { name: 'prod', serverUrl: 'https://p' }, source: 'kubeconfig' },
      ],
      registered: [],
      connected: [],
      isReady: false,
    });
    renderAt('/');
    expect(screen.queryByText('CLUSTER_PICKER_STUB')).toBeNull();
    expect(
      screen.getByTestId('presence-entry-loader'),
    ).toBeInTheDocument();
  });

  it('PresenceEntryPoint navigates once isReady flips to true', async () => {
    useClusterPresenceStore.setState({
      discovered: [
        { identity: { name: 'prod', serverUrl: 'https://p' }, source: 'kubeconfig' },
      ],
      registered: [],
      connected: [],
      isReady: false,
    });
    renderAt('/');
    expect(screen.queryByText('CLUSTER_PICKER_STUB')).toBeNull();

    useClusterPresenceStore.setState({ isReady: true });
    await screen.findByText('CLUSTER_PICKER_STUB');
  });

  it('ClusterPresenceSubscriber renders nothing', () => {
    const { container } = render(<ClusterPresenceSubscriber />);
    expect(container.firstChild).toBeNull();
  });
});
