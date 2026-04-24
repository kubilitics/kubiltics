// Integration test for Phase 5 routing helpers exported from App.tsx.
//
// Covers both feature-flag states:
//   OFF: /clusters and /welcome redirect to /connect (back-compat).
//        PresenceEntryPoint is not reached in prod flow (ModeSelectionEntryPoint
//        routes through the legacy path), but the helpers themselves must be
//        guarded.
//   ON:  /clusters + /welcome render the real pages; PresenceEntryPoint
//        redirects to /clusters when clusters exist, /welcome otherwise.
//
// App.tsx is massive — rendering the whole root is expensive and pulls in
// 140+ lazy pages. We exercise the three exported routing helpers directly
// against a MemoryRouter, which exactly exercises the contracts promised by
// the plan: "route resolution with a small integration test using
// MemoryRouter at both flag states."
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import * as featureFlags from '@/lib/featureFlags';
import {
  useClusterPresenceStore,
  __resetForTest,
} from '@/stores/clusterPresenceStore';
import {
  FlagGatedRoute,
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
        <Route
          path="/clusters"
          element={
            <FlagGatedRoute>
              <div>CLUSTER_PICKER_STUB</div>
            </FlagGatedRoute>
          }
        />
        <Route
          path="/welcome"
          element={
            <FlagGatedRoute>
              <div>WELCOME_STUB</div>
            </FlagGatedRoute>
          }
        />
        <Route path="/connect" element={<div>CONNECT_STUB</div>} />
        <Route path="/" element={<PresenceEntryPoint />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('App routing helpers — onboarding-v2 flag gates', () => {
  beforeEach(() => {
    __resetForTest();
    vi.restoreAllMocks();
  });

  describe('feature flag OFF (default)', () => {
    beforeEach(() => {
      vi.spyOn(featureFlags, 'featurePresenceV2').mockReturnValue(false);
    });

    it('/clusters redirects to /connect', () => {
      renderAt('/clusters');
      expect(screen.getByText('CONNECT_STUB')).toBeInTheDocument();
      expect(screen.queryByText('CLUSTER_PICKER_STUB')).toBeNull();
    });

    it('/welcome redirects to /connect', () => {
      renderAt('/welcome');
      expect(screen.getByText('CONNECT_STUB')).toBeInTheDocument();
      expect(screen.queryByText('WELCOME_STUB')).toBeNull();
    });
  });

  describe('feature flag ON', () => {
    beforeEach(() => {
      vi.spyOn(featureFlags, 'featurePresenceV2').mockReturnValue(true);
    });

    it('/clusters renders the picker', () => {
      renderAt('/clusters');
      expect(screen.getByText('CLUSTER_PICKER_STUB')).toBeInTheDocument();
    });

    it('/welcome renders the welcome page', () => {
      renderAt('/welcome');
      expect(screen.getByText('WELCOME_STUB')).toBeInTheDocument();
    });

    it('PresenceEntryPoint redirects / → /welcome when no clusters', () => {
      useClusterPresenceStore.setState({
        discovered: [],
        registered: [],
        connected: [],
        isReady: true,
      });
      renderAt('/');
      expect(screen.getByText('WELCOME_STUB')).toBeInTheDocument();
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

    // Phase 6 task 6.0b: PresenceEntryPoint must NOT redirect while the
    // presence snapshot is still loading. On cold start, availableClusters()
    // reads an empty array before SSE populates the store, which would
    // briefly route users with populated kubeconfigs to /welcome for one
    // frame before bouncing them to /clusters. Render a lightweight loader
    // until `isReady` flips to true.
    it('PresenceEntryPoint shows loader and does NOT navigate while isReady=false', () => {
      useClusterPresenceStore.setState({
        discovered: [
          { identity: { name: 'prod', serverUrl: 'https://p' }, source: 'kubeconfig' },
        ],
        registered: [],
        connected: [],
        isReady: false,
      });
      renderAt('/');
      // No navigation: neither picker nor welcome rendered yet.
      expect(screen.queryByText('CLUSTER_PICKER_STUB')).toBeNull();
      expect(screen.queryByText('WELCOME_STUB')).toBeNull();
      // Loader placeholder is present.
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

      // Flip isReady; the subscribed component should now redirect.
      useClusterPresenceStore.setState({ isReady: true });
      await screen.findByText('CLUSTER_PICKER_STUB');
    });
  });

  it('ClusterPresenceSubscriber renders nothing', () => {
    const { container } = render(<ClusterPresenceSubscriber />);
    expect(container.firstChild).toBeNull();
  });
});
