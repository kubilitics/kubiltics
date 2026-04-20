import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useClusterStore, type Cluster } from './clusterStore';

vi.mock('@/lib/backendUrl', () => ({
  getBackendBase: () => 'http://test.local',
}));

const mkCluster = (overrides: Partial<Cluster>): Cluster => ({
  id: 'fallback-id',
  name: 'cluster',
  context: 'cluster',
  version: 'v1.34.3',
  status: 'healthy',
  region: 'unknown',
  provider: 'kind',
  nodes: 0,
  namespaces: 0,
  pods: { running: 0, pending: 0, failed: 0 },
  cpu: { used: 0, total: 0 },
  memory: { used: 0, total: 0 },
  ...overrides,
});

describe('clusterStore.syncClusters — Headlamp-style identity by (name, serverUrl)', () => {
  beforeEach(() => {
    useClusterStore.setState({
      clusters: [],
      activeCluster: null,
      isDemo: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates id in place when backend re-registers same (name, serverUrl) with new id', async () => {
    useClusterStore.setState({
      clusters: [
        mkCluster({ id: 'OLD-uuid', name: 'docker-desktop', serverUrl: 'https://1.2.3.4:6443' }),
      ],
      activeCluster: mkCluster({
        id: 'OLD-uuid',
        name: 'docker-desktop',
        serverUrl: 'https://1.2.3.4:6443',
      }),
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: 'NEW-uuid',
              name: 'docker-desktop',
              context: 'docker-desktop',
              server_url: 'https://1.2.3.4:6443',
              status: 'connected',
              version: 'v1.34.3',
              provider: 'kind',
            },
          ]),
      }),
    );

    await useClusterStore.getState().syncClusters();

    const { clusters, activeCluster } = useClusterStore.getState();
    expect(clusters).toHaveLength(1);
    expect(clusters[0].id).toBe('NEW-uuid');
    expect(clusters[0].name).toBe('docker-desktop');
    expect(clusters[0].serverUrl).toBe('https://1.2.3.4:6443');
    expect(activeCluster?.id).toBe('NEW-uuid');
  });

  it('evicts a cluster the backend no longer reports', async () => {
    useClusterStore.setState({
      clusters: [
        mkCluster({ id: 'A', name: 'gone', serverUrl: 'https://gone:6443' }),
        mkCluster({ id: 'B', name: 'kept', serverUrl: 'https://kept:6443' }),
      ],
      activeCluster: mkCluster({ id: 'A', name: 'gone', serverUrl: 'https://gone:6443' }),
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 'B', name: 'kept', server_url: 'https://kept:6443', status: 'connected' },
          ]),
      }),
    );

    await useClusterStore.getState().syncClusters();

    const { clusters, activeCluster } = useClusterStore.getState();
    expect(clusters.map((c) => c.name)).toEqual(['kept']);
    expect(activeCluster).toBeNull();
  });

  it('adds a new cluster discovered in backend', async () => {
    useClusterStore.setState({ clusters: [], activeCluster: null });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 'NEW', name: 'fresh', server_url: 'https://fresh:6443', status: 'connected' },
          ]),
      }),
    );

    await useClusterStore.getState().syncClusters();

    expect(useClusterStore.getState().clusters[0].id).toBe('NEW');
    expect(useClusterStore.getState().clusters[0].serverUrl).toBe('https://fresh:6443');
  });

  it('skips sync entirely in demo mode', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    useClusterStore.setState({ isDemo: true });

    await useClusterStore.getState().syncClusters();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves demo entries while syncing real ones', async () => {
    useClusterStore.setState({
      clusters: [
        mkCluster({ id: '__demo__one', name: 'demo', __isDemo: true }),
        mkCluster({ id: 'A', name: 'real', serverUrl: 'https://r:6443' }),
      ],
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 'A2', name: 'real', server_url: 'https://r:6443', status: 'connected' },
          ]),
      }),
    );

    await useClusterStore.getState().syncClusters();

    const { clusters } = useClusterStore.getState();
    expect(clusters.find((c) => c.__isDemo)?.id).toBe('__demo__one');
    expect(clusters.find((c) => !c.__isDemo)?.id).toBe('A2');
  });
});
