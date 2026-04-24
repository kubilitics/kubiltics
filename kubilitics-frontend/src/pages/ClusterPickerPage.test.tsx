import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// A single stable mock for useNavigate — declared BEFORE the import chain that
// evaluates the page, so react-router-dom is hoisted with this replacement.
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

import { ClusterPickerPage } from './ClusterPickerPage';
import {
  useClusterPresenceStore,
  __resetForTest,
} from '@/stores/clusterPresenceStore';

function renderPicker() {
  return render(
    <MemoryRouter>
      <ClusterPickerPage />
    </MemoryRouter>,
  );
}

describe('ClusterPickerPage', () => {
  beforeEach(() => {
    __resetForTest();
    navigateMock.mockReset();
  });

  it('renders one card per available cluster', () => {
    useClusterPresenceStore.setState({
      discovered: [
        { identity: { name: 'prod', serverUrl: 'https://p.example' }, source: 'kubeconfig' },
        { identity: { name: 'dev', serverUrl: 'https://d.example' }, source: 'kubeconfig' },
      ],
      registered: [],
      connected: [],
      isReady: true,
    });
    renderPicker();
    expect(screen.getByText('prod')).toBeInTheDocument();
    expect(screen.getByText('dev')).toBeInTheDocument();
  });

  it('clicking a cluster sets active identity and navigates to /dashboard', () => {
    useClusterPresenceStore.setState({
      discovered: [
        { identity: { name: 'prod', serverUrl: 'https://p.example' }, source: 'kubeconfig' },
      ],
      registered: [],
      connected: [],
      isReady: true,
    });
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /prod/i }));
    expect(useClusterPresenceStore.getState().activeLogicalIdentity?.name).toBe(
      'prod',
    );
    expect(navigateMock).toHaveBeenCalledWith('/dashboard');
  });

  it('search filter narrows visible cards by name', () => {
    useClusterPresenceStore.setState({
      discovered: [
        { identity: { name: 'prod-us', serverUrl: 'https://p.example' }, source: 'kubeconfig' },
        { identity: { name: 'staging', serverUrl: 'https://s.example' }, source: 'kubeconfig' },
      ],
      registered: [],
      connected: [],
      isReady: true,
    });
    renderPicker();
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: 'prod' },
    });
    expect(screen.getByText('prod-us')).toBeInTheDocument();
    expect(screen.queryByText('staging')).toBeNull();
  });

  it('search filter matches on server URL', () => {
    useClusterPresenceStore.setState({
      discovered: [
        { identity: { name: 'one', serverUrl: 'https://alpha.example' }, source: 'kubeconfig' },
        { identity: { name: 'two', serverUrl: 'https://beta.example' }, source: 'kubeconfig' },
      ],
      registered: [],
      connected: [],
      isReady: true,
    });
    renderPicker();
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: 'beta' },
    });
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.queryByText('one')).toBeNull();
  });

  it('merges discovered + registered and reflects reachability from registered', () => {
    useClusterPresenceStore.setState({
      discovered: [
        { identity: { name: 'prod', serverUrl: 'https://p.example' }, source: 'kubeconfig' },
      ],
      registered: [
        {
          identity: { name: 'prod', serverUrl: 'https://p.example' },
          source: 'kubeconfig',
          registered_at: '2026-01-01T00:00:00Z',
          reachable: true,
          session_id: 'uuid-prod',
        },
      ],
      connected: [],
      isReady: true,
    });
    renderPicker();
    // Only one card (deduped by logical identity)
    expect(screen.getAllByText('prod')).toHaveLength(1);
    // Reachability label appears
    expect(screen.getByLabelText(/reachable/i)).toBeInTheDocument();
  });

  it('renders an empty-state message when no clusters are available', () => {
    useClusterPresenceStore.setState({
      discovered: [],
      registered: [],
      connected: [],
      isReady: true,
    });
    renderPicker();
    expect(screen.getByText(/no clusters/i)).toBeInTheDocument();
  });

  it('orders connected clusters before non-connected, then alphabetical', () => {
    useClusterPresenceStore.setState({
      discovered: [
        { identity: { name: 'zebra', serverUrl: 'https://z.example' }, source: 'kubeconfig' },
        { identity: { name: 'alpha', serverUrl: 'https://a.example' }, source: 'kubeconfig' },
        { identity: { name: 'bravo', serverUrl: 'https://b.example' }, source: 'kubeconfig' },
      ],
      registered: [],
      connected: [
        {
          identity: { name: 'zebra', serverUrl: 'https://z.example' },
          source: 'kubeconfig',
          registered_at: '',
          reachable: true,
          connected_at: '2026-04-24T00:00:00Z',
          session_id: 'uuid-zebra',
        },
      ],
      isReady: true,
    });
    renderPicker();
    const cards = screen.getAllByTestId('cluster-picker-card');
    // Connected cluster 'zebra' first, then alphabetical 'alpha', 'bravo'.
    expect(cards[0]).toHaveTextContent('zebra');
    expect(cards[1]).toHaveTextContent('alpha');
    expect(cards[2]).toHaveTextContent('bravo');
  });

  it('exposes an "Add cluster" trigger that opens the AddClusterDialog', () => {
    useClusterPresenceStore.setState({
      discovered: [],
      registered: [],
      connected: [],
      isReady: true,
    });
    renderPicker();
    // Dialog starts closed: its "Add a cluster" title is absent.
    expect(screen.queryByText('Add a cluster')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^add cluster$/i }));

    // Dialog now rendered.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Add a cluster')).toBeInTheDocument();
  });
});
