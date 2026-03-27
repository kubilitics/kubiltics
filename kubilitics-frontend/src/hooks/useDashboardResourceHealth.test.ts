/**
 * Tests for useDashboardResourceHealth hook.
 *
 * We extract the health-categorisation logic by mocking every external hook
 * (useK8sResourceList, useClusterOverview, useConnectionStatus, useBackendConfigStore)
 * and then calling the real hook via renderHook inside a React wrapper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/* ── Mocks ─────────────────────────────────────────────────────────────────── */

// Provide a stable return value per resource type; tests override via mockReturnValue.
const mockUseK8sResourceList = vi.fn().mockReturnValue({ data: undefined, isLoading: false });
const mockUseClusterOverview = vi.fn().mockReturnValue({ data: undefined });
const mockUseConnectionStatus = vi.fn().mockReturnValue({ isConnected: true });
const mockUseBackendConfigStore = vi.fn().mockReturnValue('cluster-1');

vi.mock('./useKubernetes', () => ({
  useK8sResourceList: (...args: unknown[]) => mockUseK8sResourceList(...args),
}));

vi.mock('./useClusterOverview', () => ({
  useClusterOverview: (...args: unknown[]) => mockUseClusterOverview(...args),
}));

vi.mock('./useConnectionStatus', () => ({
  useConnectionStatus: () => mockUseConnectionStatus(),
}));

vi.mock('@/stores/backendConfigStore', () => ({
  useBackendConfigStore: (selector: (s: any) => any) => {
    // The hook calls useBackendConfigStore(s => s.currentClusterId)
    return selector({ currentClusterId: 'cluster-1' });
  },
}));

import { useDashboardResourceHealth, type ResourceHealthSummary } from './useDashboardResourceHealth';

/* ── Helpers ───────────────────────────────────────────────────────────────── */

/**
 * The hook calls useK8sResourceList 9 times in a fixed order:
 * nodes, pods, deployments, services, daemonsets, namespaces, configmaps, secrets, cronjobs
 */
type ResourceDataMap = {
  nodes?: any;
  pods?: any;
  deployments?: any;
  services?: any;
  daemonsets?: any;
  namespaces?: any;
  configmaps?: any;
  secrets?: any;
  cronjobs?: any;
};

const RESOURCE_ORDER = [
  'nodes', 'pods', 'deployments', 'services',
  'daemonsets', 'namespaces', 'configmaps', 'secrets', 'cronjobs',
] as const;

function setupResourceData(data: ResourceDataMap) {
  let callIdx = 0;
  mockUseK8sResourceList.mockImplementation(() => {
    const key = RESOURCE_ORDER[callIdx++ % RESOURCE_ORDER.length];
    const items = data[key];
    return {
      data: items ? { items } : undefined,
      isLoading: false,
    };
  });
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe('useDashboardResourceHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseK8sResourceList.mockReturnValue({ data: undefined, isLoading: false });
    mockUseClusterOverview.mockReturnValue({ data: undefined });
    mockUseConnectionStatus.mockReturnValue({ isConnected: true });
  });

  it('returns empty health record when no data is available', () => {
    const { result } = renderHook(() => useDashboardResourceHealth());
    expect(result.current.health).toEqual({});
  });

  // ── Pods ──────────────────────────────────────────────────────────────────

  describe('pods — K8s list fallback', () => {
    it('categorises pod phases correctly', () => {
      setupResourceData({
        pods: [
          { metadata: { name: 'p1', uid: '1', creationTimestamp: '' }, status: { phase: 'Running' } },
          { metadata: { name: 'p2', uid: '2', creationTimestamp: '' }, status: { phase: 'Running' } },
          { metadata: { name: 'p3', uid: '3', creationTimestamp: '' }, status: { phase: 'Pending' } },
          { metadata: { name: 'p4', uid: '4', creationTimestamp: '' }, status: { phase: 'Failed' } },
          { metadata: { name: 'p5', uid: '5', creationTimestamp: '' }, status: { phase: 'Succeeded' } },
        ],
      });

      const { result } = renderHook(() => useDashboardResourceHealth());
      const pods = result.current.health.pods as ResourceHealthSummary;

      expect(pods).toBeDefined();
      expect(pods.total).toBe(5);

      const segMap = Object.fromEntries(pods.segments.map((s) => [s.label, s.count]));
      expect(segMap.Running).toBe(2);
      expect(segMap.Pending).toBe(1);
      expect(segMap.Failed).toBe(1);
      expect(segMap.Succeeded).toBe(1);
    });

    it('filters out zero-count segments', () => {
      setupResourceData({
        pods: [
          { metadata: { name: 'p1', uid: '1', creationTimestamp: '' }, status: { phase: 'Running' } },
        ],
      });

      const { result } = renderHook(() => useDashboardResourceHealth());
      const pods = result.current.health.pods as ResourceHealthSummary;

      expect(pods.total).toBe(1);
      expect(pods.segments).toHaveLength(1);
      expect(pods.segments[0].label).toBe('Running');
    });
  });

  describe('pods — backend overview preferred', () => {
    it('uses overview pod_status when available', () => {
      mockUseClusterOverview.mockReturnValue({
        data: {
          pod_status: { running: 10, pending: 2, failed: 1, succeeded: 3 },
        },
      });
      setupResourceData({}); // no direct K8s data

      const { result } = renderHook(() => useDashboardResourceHealth());
      const pods = result.current.health.pods as ResourceHealthSummary;

      expect(pods.total).toBe(16);
      const segMap = Object.fromEntries(pods.segments.map((s) => [s.label, s.count]));
      expect(segMap.Running).toBe(10);
      expect(segMap.Pending).toBe(2);
      expect(segMap.Failed).toBe(1);
      expect(segMap.Succeeded).toBe(3);
    });
  });

  // ── Nodes ─────────────────────────────────────────────────────────────────

  describe('nodes — readiness', () => {
    it('categorises Ready vs NotReady nodes', () => {
      setupResourceData({
        nodes: [
          {
            metadata: { name: 'n1', uid: '1', creationTimestamp: '' },
            status: { conditions: [{ type: 'Ready', status: 'True' }] },
          },
          {
            metadata: { name: 'n2', uid: '2', creationTimestamp: '' },
            status: { conditions: [{ type: 'Ready', status: 'False' }] },
          },
          {
            metadata: { name: 'n3', uid: '3', creationTimestamp: '' },
            status: { conditions: [{ type: 'MemoryPressure', status: 'False' }] },
          },
        ],
      });

      const { result } = renderHook(() => useDashboardResourceHealth());
      const nodes = result.current.health.nodes as ResourceHealthSummary;

      expect(nodes.total).toBe(3);
      const segMap = Object.fromEntries(nodes.segments.map((s) => [s.label, s.count]));
      expect(segMap.Ready).toBe(1);
      expect(segMap.NotReady).toBe(2);
    });
  });

  // ── Deployments ───────────────────────────────────────────────────────────

  describe('deployments — availability', () => {
    it('categorises Available / Progressing / Unavailable', () => {
      setupResourceData({
        deployments: [
          // Available: availableReplicas >= replicas and > 0
          { metadata: { name: 'd1', uid: '1', creationTimestamp: '' }, status: { availableReplicas: 3, replicas: 3 } },
          // Progressing: availableReplicas > 0 but < replicas
          { metadata: { name: 'd2', uid: '2', creationTimestamp: '' }, status: { availableReplicas: 1, replicas: 3 } },
          // Unavailable: availableReplicas 0
          { metadata: { name: 'd3', uid: '3', creationTimestamp: '' }, status: { availableReplicas: 0, replicas: 3 } },
        ],
      });

      const { result } = renderHook(() => useDashboardResourceHealth());
      const deps = result.current.health.deployments as ResourceHealthSummary;

      expect(deps.total).toBe(3);
      const segMap = Object.fromEntries(deps.segments.map((s) => [s.label, s.count]));
      expect(segMap.Available).toBe(1);
      expect(segMap.Progressing).toBe(1);
      expect(segMap.Unavailable).toBe(1);
    });
  });

  // ── Services ──────────────────────────────────────────────────────────────

  describe('services — type distribution', () => {
    it('categorises service types correctly', () => {
      setupResourceData({
        services: [
          { metadata: { name: 's1', uid: '1', creationTimestamp: '' }, spec: { type: 'ClusterIP' } },
          { metadata: { name: 's2', uid: '2', creationTimestamp: '' }, spec: { type: 'ClusterIP' } },
          { metadata: { name: 's3', uid: '3', creationTimestamp: '' }, spec: { type: 'NodePort' } },
          { metadata: { name: 's4', uid: '4', creationTimestamp: '' }, spec: { type: 'LoadBalancer' } },
          { metadata: { name: 's5', uid: '5', creationTimestamp: '' }, spec: { type: 'ExternalName' } },
        ],
      });

      const { result } = renderHook(() => useDashboardResourceHealth());
      const svcs = result.current.health.services as ResourceHealthSummary;

      expect(svcs.total).toBe(5);
      const segMap = Object.fromEntries(svcs.segments.map((s) => [s.label, s.count]));
      expect(segMap.ClusterIP).toBe(2);
      expect(segMap.NodePort).toBe(1);
      expect(segMap.LoadBalancer).toBe(1);
      expect(segMap.ExternalName).toBe(1);
    });
  });

  // ── DaemonSets ────────────────────────────────────────────────────────────

  describe('daemonsets — readiness', () => {
    it('categorises Ready vs Partial', () => {
      setupResourceData({
        daemonsets: [
          { metadata: { name: 'ds1', uid: '1', creationTimestamp: '' }, status: { numberReady: 3, desiredNumberScheduled: 3 } },
          { metadata: { name: 'ds2', uid: '2', creationTimestamp: '' }, status: { numberReady: 1, desiredNumberScheduled: 3 } },
        ],
      });

      const { result } = renderHook(() => useDashboardResourceHealth());
      const ds = result.current.health.daemonsets as ResourceHealthSummary;

      expect(ds.total).toBe(2);
      const segMap = Object.fromEntries(ds.segments.map((s) => [s.label, s.count]));
      expect(segMap.Ready).toBe(1);
      expect(segMap.Partial).toBe(1);
    });
  });

  // ── Namespaces ────────────────────────────────────────────────────────────

  describe('namespaces — phase', () => {
    it('categorises Active vs Terminating', () => {
      setupResourceData({
        namespaces: [
          { metadata: { name: 'ns1', uid: '1', creationTimestamp: '' }, status: { phase: 'Active' } },
          { metadata: { name: 'ns2', uid: '2', creationTimestamp: '' }, status: { phase: 'Active' } },
          { metadata: { name: 'ns3', uid: '3', creationTimestamp: '' }, status: { phase: 'Terminating' } },
        ],
      });

      const { result } = renderHook(() => useDashboardResourceHealth());
      const ns = result.current.health.namespaces as ResourceHealthSummary;

      expect(ns.total).toBe(3);
      const segMap = Object.fromEntries(ns.segments.map((s) => [s.label, s.count]));
      expect(segMap.Active).toBe(2);
      expect(segMap.Terminating).toBe(1);
    });
  });

  // ── CronJobs ──────────────────────────────────────────────────────────────

  describe('cronjobs — suspended', () => {
    it('categorises Active vs Suspended', () => {
      setupResourceData({
        cronjobs: [
          { metadata: { name: 'cj1', uid: '1', creationTimestamp: '' }, spec: { suspend: false } },
          { metadata: { name: 'cj2', uid: '2', creationTimestamp: '' }, spec: { suspend: true } },
          { metadata: { name: 'cj3', uid: '3', creationTimestamp: '' }, spec: { suspend: true } },
        ],
      });

      const { result } = renderHook(() => useDashboardResourceHealth());
      const cj = result.current.health.cronjobs as ResourceHealthSummary;

      expect(cj.total).toBe(3);
      const segMap = Object.fromEntries(cj.segments.map((s) => [s.label, s.count]));
      expect(segMap.Active).toBe(1);
      expect(segMap.Suspended).toBe(2);
    });
  });

  // ── Secrets ───────────────────────────────────────────────────────────────

  describe('secrets — type distribution', () => {
    it('categorises secret types correctly', () => {
      setupResourceData({
        secrets: [
          { metadata: { name: 's1', uid: '1', creationTimestamp: '' }, type: 'Opaque' },
          { metadata: { name: 's2', uid: '2', creationTimestamp: '' }, type: 'kubernetes.io/tls' },
          { metadata: { name: 's3', uid: '3', creationTimestamp: '' }, type: 'kubernetes.io/service-account-token' },
          { metadata: { name: 's4', uid: '4', creationTimestamp: '' }, type: 'kubernetes.io/dockerconfigjson' },
          { metadata: { name: 's5', uid: '5', creationTimestamp: '' }, type: 'bootstrap.kubernetes.io/token' },
        ],
      });

      const { result } = renderHook(() => useDashboardResourceHealth());
      const sec = result.current.health.secrets as ResourceHealthSummary;

      expect(sec.total).toBe(5);
      const segMap = Object.fromEntries(sec.segments.map((s) => [s.label, s.count]));
      expect(segMap.Opaque).toBe(1);
      expect(segMap.TLS).toBe(1);
      expect(segMap['SA Token']).toBe(1);
      expect(segMap.Docker).toBe(1);
      expect(segMap.Other).toBe(1);
    });
  });
});
