/**
 * Tests for src/features/dashboard/components/RecentActivityPanel.tsx
 *
 * Covers: disconnected state, loading state, events rendering,
 * "View all events" link.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// ---- Mock controls ----
let mockIsConnected = true;
let mockIsBackendConfigured = false;
let mockClusterId: string | null = null;
let mockEventsData: any[] | null = null;
let mockEventsLoading = false;
let mockK8sEventsData: any = null;
let mockK8sEventsLoading = false;

vi.mock('@/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({ isConnected: mockIsConnected }),
}));

vi.mock('@/stores/backendConfigStore', () => ({
  useBackendConfigStore: (selector: any) => {
    const state = {
      currentClusterId: mockClusterId,
      isBackendConfigured: () => mockIsBackendConfigured,
      backendBaseUrl: 'http://localhost:8190',
    };
    return selector(state);
  },
  getEffectiveBackendBaseUrl: () => 'http://localhost:8190',
}));

vi.mock('@/hooks/useClusterOverview', () => ({
  useClusterOverview: () => ({}),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: any) => {
    if (opts.queryKey?.[1] === 'events') {
      return {
        data: mockEventsData,
        isLoading: mockEventsLoading,
      };
    }
    return { data: null, isLoading: false };
  },
}));

vi.mock('@/hooks/useKubernetes', () => ({
  useK8sResourceList: () => ({
    data: mockK8sEventsData,
    isLoading: mockK8sEventsLoading,
  }),
}));

vi.mock('@/services/backendApiClient', () => ({
  getEvents: vi.fn(),
}));

vi.mock('@/utils/resourceKindMapper', () => ({
  getDetailPath: (kind: string, name: string, ns: string) =>
    ns ? `/${kind.toLowerCase()}s/${ns}/${name}` : `/${kind.toLowerCase()}s/${name}`,
}));

import { RecentActivityPanel } from './RecentActivityPanel';

function renderPanel() {
  return render(
    <MemoryRouter>
      <RecentActivityPanel />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockIsConnected = true;
  mockIsBackendConfigured = false;
  mockClusterId = null;
  mockEventsData = null;
  mockEventsLoading = false;
  mockK8sEventsData = null;
  mockK8sEventsLoading = false;
});

afterEach(() => {
  cleanup();
});

// ============================================================================

describe('RecentActivityPanel', () => {
  it('shows "No cluster connected" when disconnected', () => {
    mockIsConnected = false;

    renderPanel();
    expect(screen.getByText('No cluster connected')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockIsConnected = true;
    mockIsBackendConfigured = false;
    mockK8sEventsLoading = true;
    mockK8sEventsData = null;

    renderPanel();
    expect(screen.getByText('Loading activity...')).toBeInTheDocument();
  });

  it('shows "No recent events" when connected but no events', () => {
    mockIsConnected = true;
    mockIsBackendConfigured = false;
    mockK8sEventsData = { items: [] };
    mockK8sEventsLoading = false;

    renderPanel();
    expect(screen.getByText('No recent events')).toBeInTheDocument();
  });

  it('renders events from direct K8s with correct format', () => {
    mockIsConnected = true;
    mockIsBackendConfigured = false;
    mockK8sEventsData = {
      items: [
        {
          metadata: { uid: 'uid-1', namespace: 'default' },
          type: 'Normal',
          reason: 'Started',
          message: 'Started container nginx',
          involvedObject: { kind: 'Pod', name: 'nginx-abc', namespace: 'default' },
          lastTimestamp: new Date().toISOString(),
          count: 1,
        },
        {
          metadata: { uid: 'uid-2', namespace: 'kube-system' },
          type: 'Warning',
          reason: 'BackOff',
          message: 'Back-off restarting failed container',
          involvedObject: { kind: 'Pod', name: 'coredns-xyz', namespace: 'kube-system' },
          lastTimestamp: new Date().toISOString(),
          count: 5,
        },
      ],
    };

    renderPanel();

    // Resource kind/name should appear
    expect(screen.getByText('Pod/nginx-abc')).toBeInTheDocument();
    expect(screen.getByText('Pod/coredns-xyz')).toBeInTheDocument();

    // Reason badges
    expect(screen.getByText('Started')).toBeInTheDocument();
    expect(screen.getByText('BackOff')).toBeInTheDocument();

    // Count badge for repeated event
    expect(screen.getByText('x5')).toBeInTheDocument();

    // Namespace
    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.getByText('kube-system')).toBeInTheDocument();
  });

  it('renders backend events when backend is configured', () => {
    mockIsConnected = true;
    mockIsBackendConfigured = true;
    mockClusterId = 'my-cluster';
    mockEventsData = [
      {
        id: 'evt-1',
        type: 'Normal',
        reason: 'Pulled',
        message: 'Successfully pulled image',
        resource_kind: 'Pod',
        resource_name: 'web-server',
        namespace: 'production',
        last_timestamp: new Date().toISOString(),
        first_timestamp: new Date().toISOString(),
        count: 1,
      },
    ];

    renderPanel();

    expect(screen.getByText('Pod/web-server')).toBeInTheDocument();
    expect(screen.getByText('Pulled')).toBeInTheDocument();
    expect(screen.getByText('production')).toBeInTheDocument();
  });

  it('shows "View all events" link', () => {
    mockIsConnected = true;
    mockIsBackendConfigured = false;
    mockK8sEventsData = {
      items: [
        {
          metadata: { uid: 'uid-1', namespace: 'default' },
          type: 'Normal',
          reason: 'Created',
          message: 'Created pod',
          involvedObject: { kind: 'Pod', name: 'test-pod', namespace: 'default' },
          lastTimestamp: new Date().toISOString(),
          count: 1,
        },
      ],
    };

    renderPanel();

    const link = screen.getByText('View all events');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/events');
  });

  it('events with href render as links', () => {
    mockIsConnected = true;
    mockIsBackendConfigured = false;
    mockK8sEventsData = {
      items: [
        {
          metadata: { uid: 'uid-link', namespace: 'ns1' },
          type: 'Normal',
          reason: 'Scheduled',
          message: 'Scheduled to node',
          involvedObject: { kind: 'Pod', name: 'linked-pod', namespace: 'ns1' },
          lastTimestamp: new Date().toISOString(),
          count: 1,
        },
      ],
    };

    renderPanel();

    // The event should be wrapped in a Link
    const eventText = screen.getByText('Pod/linked-pod');
    const linkAncestor = eventText.closest('a');
    expect(linkAncestor).toBeTruthy();
    expect(linkAncestor!.getAttribute('href')).toBe('/pods/ns1/linked-pod');
  });
});
