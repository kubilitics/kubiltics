/**
 * Tests for src/hooks/useResourceCounts.ts
 *
 * Covers: mock counts when disconnected, backend summary mapping,
 * direct K8s fallback, and the summaryMap field coverage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ---- Mock controls ----
let mockIsConnected = false;
let mockIsBackendConfigured = false;
let mockCurrentClusterId: string | null = null;
let mockActiveClusterId: string | null = null;
let mockSummaryData: Record<string, number> | null = null;
let mockK8sData: Record<string, unknown> = {};
let summaryCalledWith: string | undefined = undefined;

vi.mock('@/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({ isConnected: mockIsConnected }),
}));

vi.mock('@/stores/backendConfigStore', () => ({
  useBackendConfigStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      isBackendConfigured: () => mockIsBackendConfigured,
      currentClusterId: mockCurrentClusterId,
    };
    return selector(state);
  },
  getEffectiveBackendBaseUrl: () => 'http://localhost:8190',
}));

// Phase 4 Task 4.4: the hook now runs on useResilientQuery instead of
// useClusterSummaryWithProject. Mock at the resilient-query layer so the
// existing regression matrix (disconnected, backend-configured, direct-k8s)
// still exercises the integration end-to-end.
//
// The legacy mockSummaryData embedded { reachable, stale, error_message }
// on the data payload; the resilient hook exposes those as top-level flags.
// The mock destructures them back out so the existing test vectors still
// exercise the same unreachable / stale / no-cache branches.
vi.mock('./useResilientQuery', () => ({
  useResilientQuery: (endpoint: string) => {
    const match = endpoint.match(/\/clusters\/([^/?]+)\/summary/);
    summaryCalledWith = match ? decodeURIComponent(match[1]) : undefined;
    if (!endpoint || mockSummaryData === null) {
      return {
        data: undefined,
        isLoading: false,
        isReachable: false,
        isStale: false,
        errorMessage: null,
        refetch: () => {},
      };
    }
    const raw = mockSummaryData as Record<string, unknown>;
    const reachable = raw.reachable === undefined ? true : Boolean(raw.reachable);
    const stale = Boolean(raw.stale);
    const errorMessage = typeof raw.error_message === 'string' ? raw.error_message : null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { reachable: _r, stale: _s, error_message: _em, stale_as_of: _sa, ...counts } = raw;
    return {
      data: counts,
      isLoading: false,
      isReachable: reachable,
      isStale: stale,
      errorMessage,
      refetch: () => {},
    };
  },
}));

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: (selector: (s: { activeProjectId: string | null }) => unknown) =>
    selector({ activeProjectId: null }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({}),
  };
});

vi.mock('@/hooks/useActiveClusterId', () => ({
  useActiveClusterId: () => mockActiveClusterId ?? mockCurrentClusterId,
}));

vi.mock('@/hooks/useKubernetes', () => ({
  useK8sResourceList: (resourceType: string, _ns: unknown, options: Record<string, unknown> | undefined) => {
    if (options?.enabled === false) {
      return { data: null, isLoading: false, isPlaceholderData: false };
    }
    const data = mockK8sData[resourceType];
    return {
      data: data ?? null,
      isLoading: false,
      isPlaceholderData: false,
    };
  },
}));

import { useResourceCounts, type ResourceCounts } from './useResourceCounts';

beforeEach(() => {
  mockIsConnected = false;
  mockIsBackendConfigured = false;
  mockCurrentClusterId = null;
  mockActiveClusterId = null;
  mockSummaryData = null;
  mockK8sData = {};
  summaryCalledWith = undefined;
});

// ============================================================================
// Disconnected mode — returns zero counts (no fake data)
// ============================================================================

describe('useResourceCounts — disconnected', () => {
  it('returns zero counts when disconnected', () => {
    mockIsConnected = false;

    const { result } = renderHook(() => useResourceCounts());
    const { counts, isConnected } = result.current;

    expect(isConnected).toBe(false);
    expect(counts.pods).toBe(0);
    expect(counts.deployments).toBe(0);
    expect(counts.services).toBe(0);
    expect(counts.nodes).toBe(0);
    expect(counts.namespaces).toBe(0);
    expect(counts.jobs).toBe(0);
    expect(counts.cronjobs).toBe(0);
    expect(counts.secrets).toBe(0);
  });
});

// ============================================================================
// Backend summary mode
// ============================================================================

describe('useResourceCounts — backend summary', () => {
  it('uses backend summary when backend is configured', () => {
    mockIsConnected = true;
    mockIsBackendConfigured = true;
    mockCurrentClusterId = 'test-cluster';
    mockSummaryData = {
      pod_count: 10,
      deployment_count: 5,
      service_count: 3,
      node_count: 2,
      namespace_count: 4,
      statefulset_count: 1,
      replicaset_count: 6,
      daemonset_count: 2,
      job_count: 100,
      cronjob_count: 3,
      ingress_count: 7,
      ingressclass_count: 1,
      endpoint_count: 8,
      endpointslice_count: 9,
      networkpolicy_count: 2,
      configmap_count: 20,
      secret_count: 15,
      persistentvolume_count: 3,
      persistentvolumeclaim_count: 4,
      storageclass_count: 2,
      serviceaccount_count: 50,
      role_count: 10,
      clusterrole_count: 40,
      rolebinding_count: 12,
      clusterrolebinding_count: 30,
      hpa_count: 5,
      limitrange_count: 1,
      resourcequota_count: 2,
      poddisruptionbudget_count: 3,
      priorityclass_count: 2,
      customresourcedefinition_count: 8,
      mutatingwebhookconfiguration_count: 4,
      validatingwebhookconfiguration_count: 2,
    };

    const { result } = renderHook(() => useResourceCounts());
    const { counts, isConnected } = result.current;

    expect(isConnected).toBe(true);
    expect(counts.pods).toBe(10);
    expect(counts.deployments).toBe(5);
    expect(counts.services).toBe(3);
    expect(counts.nodes).toBe(2);
    expect(counts.namespaces).toBe(4);
    expect(counts.statefulsets).toBe(1);
    expect(counts.replicasets).toBe(6);
    expect(counts.daemonsets).toBe(2);
    expect(counts.jobs).toBe(100);
    expect(counts.cronjobs).toBe(3);
    expect(counts.ingresses).toBe(7);
    expect(counts.ingressclasses).toBe(1);
    expect(counts.endpoints).toBe(8);
    expect(counts.endpointslices).toBe(9);
    expect(counts.networkpolicies).toBe(2);
    expect(counts.configmaps).toBe(20);
    expect(counts.secrets).toBe(15);
    expect(counts.persistentvolumes).toBe(3);
    expect(counts.persistentvolumeclaims).toBe(4);
    expect(counts.storageclasses).toBe(2);
    expect(counts.serviceaccounts).toBe(50);
    expect(counts.roles).toBe(10);
    expect(counts.clusterroles).toBe(40);
    expect(counts.rolebindings).toBe(12);
    expect(counts.clusterrolebindings).toBe(30);
    expect(counts.horizontalpodautoscalers).toBe(5);
    expect(counts.limitranges).toBe(1);
    expect(counts.resourcequotas).toBe(2);
    expect(counts.poddisruptionbudgets).toBe(3);
    expect(counts.priorityclasses).toBe(2);
    expect(counts.customresourcedefinitions).toBe(8);
    expect(counts.mutatingwebhookconfigurations).toBe(4);
    expect(counts.validatingwebhookconfigurations).toBe(2);
  });

  it('uses activeCluster.id (via useActiveClusterId) when it differs from stale currentClusterId', () => {
    // Regression: localStorage has a stale cluster ID left over from a deleted
    // cluster, but useRestoreClusterFromBackend has since set activeCluster to a
    // different, valid cluster. Sidebar counts MUST query the valid one — not
    // the stale ID — otherwise the summary endpoint returns nothing and every
    // count renders as 0.
    mockIsConnected = true;
    mockIsBackendConfigured = true;
    mockCurrentClusterId = 'stale-deleted-cluster-id';
    mockActiveClusterId = 'current-valid-cluster-id';
    mockSummaryData = { pod_count: 42, deployment_count: 11 };

    const { result } = renderHook(() => useResourceCounts());

    expect(summaryCalledWith).toBe('current-valid-cluster-id');
    expect(result.current.counts.pods).toBe(42);
    expect(result.current.counts.deployments).toBe(11);
  });

  it('returns 0 for types not in summary and without direct K8s data', () => {
    mockIsConnected = true;
    mockIsBackendConfigured = true;
    mockCurrentClusterId = 'test-cluster';
    // Minimal summary — omits many keys
    mockSummaryData = { pod_count: 5 };

    const { result } = renderHook(() => useResourceCounts());
    const { counts } = result.current;

    // pods mapped from summary
    expect(counts.pods).toBe(5);
    // Types not in summary and no direct K8s data fall to 0
    expect(counts.volumesnapshots).toBe(0);
    expect(counts.volumesnapshotclasses).toBe(0);
    expect(counts.apiservices).toBe(0);
    expect(counts.leases).toBe(0);
  });
});

// ============================================================================
// Direct K8s fallback mode
// ============================================================================

describe('useResourceCounts — direct K8s fallback', () => {
  it('uses item counts from direct K8s queries when no backend', () => {
    mockIsConnected = true;
    mockIsBackendConfigured = false;
    mockCurrentClusterId = null;

    // Simulate K8s list responses
    mockK8sData = {
      pods: { items: Array(7).fill({}), metadata: {} },
      deployments: { items: Array(3).fill({}), metadata: {} },
      services: { items: Array(2).fill({}), metadata: {} },
      nodes: { items: Array(1).fill({}), metadata: {} },
    };

    const { result } = renderHook(() => useResourceCounts());
    const { counts } = result.current;

    expect(counts.pods).toBe(7);
    expect(counts.deployments).toBe(3);
    expect(counts.services).toBe(2);
    expect(counts.nodes).toBe(1);
    // Types with no data return 0
    expect(counts.ingresses).toBe(0);
  });

  it('prefers metadata.total over items.length', () => {
    mockIsConnected = true;
    mockIsBackendConfigured = false;

    mockK8sData = {
      pods: { items: Array(5).fill({}), metadata: { total: 42 } },
    };

    const { result } = renderHook(() => useResourceCounts());
    expect(result.current.counts.pods).toBe(42);
  });

  it('returns isConnected true when connected', () => {
    mockIsConnected = true;
    mockIsBackendConfigured = false;

    const { result } = renderHook(() => useResourceCounts());
    expect(result.current.isConnected).toBe(true);
  });
});

// ============================================================================
// Robustness — unreachable clusters must NEVER flash counters to zero when
// we have any prior real counts to fall back on. This is the regression the
// user has fixed "100 times" — lock it down with explicit tests.
// ============================================================================

describe('useResourceCounts — unreachable robustness', () => {
  it('exposes reachable=false when backend returns reachable:false', () => {
    mockIsConnected = true;
    mockIsBackendConfigured = true;
    mockCurrentClusterId = 'test-cluster';
    mockSummaryData = {
      pod_count: 0, deployment_count: 0, node_count: 0,
      // @ts-expect-error test stub allows boolean/string here
      reachable: false,
      // @ts-expect-error test stub allows string here
      error_message: 'apiserver: connection refused',
    };

    const { result } = renderHook(() => useResourceCounts());
    expect(result.current.reachable).toBe(false);
    expect(result.current.errorMessage).toBe('apiserver: connection refused');
    expect(result.current.stale).toBe(false);
  });

  it('preserves last-known counts when the cluster becomes unreachable mid-session', () => {
    // Step 1: happy path — get real counts into the in-memory cache.
    mockIsConnected = true;
    mockIsBackendConfigured = true;
    mockCurrentClusterId = 'test-cluster';
    mockSummaryData = {
      pod_count: 17, deployment_count: 4, node_count: 3, namespace_count: 7,
    };

    const { rerender, result } = renderHook(() => useResourceCounts());
    expect(result.current.counts.pods).toBe(17);
    expect(result.current.counts.deployments).toBe(4);

    // Step 2: apiserver drops — backend responds reachable:false with zero
    // counts and no server-side cache. The sidebar MUST NOT flash to zeros.
    mockSummaryData = {
      pod_count: 0, deployment_count: 0, node_count: 0,
      // @ts-expect-error boolean in test stub
      reachable: false,
      // @ts-expect-error string in test stub
      error_message: 'EOF',
    };
    rerender();

    expect(result.current.reachable).toBe(false);
    expect(result.current.usingClientCache).toBe(true);
    // Last-known counts survive the blip.
    expect(result.current.counts.pods).toBe(17);
    expect(result.current.counts.deployments).toBe(4);
  });

  it('uses backend-served stale snapshot verbatim (does not re-promote as live)', () => {
    mockIsConnected = true;
    mockIsBackendConfigured = true;
    mockCurrentClusterId = 'test-cluster';
    // Backend says: counts are from its last-known-good cache, live fetch failed.
    mockSummaryData = {
      pod_count: 12, deployment_count: 2, node_count: 1,
      // @ts-expect-error boolean
      reachable: false,
      // @ts-expect-error boolean
      stale: true,
      // @ts-expect-error string
      stale_as_of: '2026-04-21T00:00:00Z',
    };

    const { result } = renderHook(() => useResourceCounts());
    // Counts come through as-is (operator sees cached-but-real numbers).
    expect(result.current.counts.pods).toBe(12);
    expect(result.current.counts.deployments).toBe(2);
    expect(result.current.reachable).toBe(false);
    expect(result.current.stale).toBe(true);
    // usingClientCache is only true when the frontend had to fall back to
    // its OWN in-memory cache (no backend stale payload). Stale backend
    // data is authoritative enough that we flag it via `stale`, not via
    // usingClientCache.
    expect(result.current.usingClientCache).toBe(false);
  });

  it('falls back to zeros only when unreachable AND no cache exists anywhere', () => {
    // First render ever for this cluster — no prior counts observed in memory.
    mockIsConnected = true;
    mockIsBackendConfigured = true;
    mockCurrentClusterId = 'never-reached-cluster';
    mockSummaryData = {
      pod_count: 0, deployment_count: 0,
      // @ts-expect-error boolean
      reachable: false,
      // @ts-expect-error string
      error_message: 'dial tcp: i/o timeout',
    };

    const { result } = renderHook(() => useResourceCounts());
    expect(result.current.reachable).toBe(false);
    expect(result.current.usingClientCache).toBe(false);
    // Zeros are the only honest answer here — the Sidebar renders these as
    // "—" based on (reachable=false && !usingClientCache && !stale), not 0.
    expect(result.current.counts.pods).toBe(0);
  });
});
