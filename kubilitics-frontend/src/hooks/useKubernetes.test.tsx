/**
 * Unit tests for useKubernetes hooks. Test gaps: demo mode must not fire HTTP requests.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useK8sResourceList, useK8sResource } from './useKubernetes';
import { useClusterStore } from '@/stores/clusterStore';
import * as backendApiClient from '@/services/backendApiClient';

// Mock backend API client functions
vi.mock('@/services/backendApiClient', () => ({
  listResources: vi.fn(),
  getResource: vi.fn(),
}));

// Mock k8sRequest (used for direct k8s mode)
vi.mock('@/lib/k8s', () => ({
  k8sRequest: vi.fn(),
}));

describe('useKubernetes hooks - demo mode', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
        },
      },
    });
    vi.clearAllMocks();
    // Reset demo mode to false
    useClusterStore.getState().setDemo(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useClusterStore.getState().signOut();
  });

  it('useK8sResourceList does not fire HTTP requests when demo mode is enabled (test gaps)', async () => {
    // Set demo mode to true
    useClusterStore.getState().setDemo(true);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useK8sResourceList('pods', 'default'), { wrapper });

    // Wait a bit to ensure query would have run if enabled
    await waitFor(() => {
      expect(result.current.isFetching).toBe(false);
    }, { timeout: 100 });

    // Verify API functions were never called
    expect(backendApiClient.listResources).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('useK8sResource does not fire HTTP requests when demo mode is enabled (test gaps)', async () => {
    // Set demo mode to true
    useClusterStore.getState().setDemo(true);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useK8sResource('pods', 'test-pod', 'default'), { wrapper });

    // Wait a bit to ensure query would have run if enabled
    await waitFor(() => {
      expect(result.current.isFetching).toBe(false);
    }, { timeout: 100 });

    // Verify API functions were never called
    expect(backendApiClient.getResource).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});

// ─── Namespace vs project priority ──────────────────────────────────────────
// Pin the critical invariant: when a caller explicitly passes a namespace
// (detail pages, resource-scoped queries), the project namespace filter must
// NOT override it. This is the root cause of a three-time regression where
// a persisted activeProjectId silently scoped pod/event queries to the
// project's namespaces, making detail pages show "No pods available".

import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useProjectStore } from '@/stores/projectStore';

describe('useK8sResourceList — namespace vs project priority', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    vi.clearAllMocks();
    useClusterStore.getState().setDemo(false);

    // Simulate: backend configured with a cluster
    useBackendConfigStore.setState({
      backendBaseUrl: 'http://localhost:8190',
      currentClusterId: 'test-cluster',
    });

    // Simulate: active project that only includes 'default' and 'kube-system'
    // (NOT 'otel-demo'). This is the exact scenario that caused the bug.
    useProjectStore.setState({
      activeProject: {
        id: 'proj-1',
        name: 'my-project',
        clusters: [{
          cluster_id: 'test-cluster',
          namespaces: ['default', 'kube-system'],
        }],
      } as never,
      activeProjectId: 'proj-1',
    });

    (backendApiClient.listResources as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [{ metadata: { name: 'test-pod' } }],
      metadata: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useClusterStore.getState().signOut();
    useBackendConfigStore.setState({ backendBaseUrl: '', currentClusterId: null });
    useProjectStore.setState({ activeProject: null, activeProjectId: null });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('explicit namespace overrides project namespaces', async () => {
    // A detail page calls useK8sResourceList('pods', 'otel-demo').
    // The active project has namespaces ['default', 'kube-system'] — NOT otel-demo.
    // The query must pass namespace='otel-demo', NOT namespaces=['default','kube-system'].
    renderHook(() => useK8sResourceList('pods', 'otel-demo'), { wrapper });

    await waitFor(() => {
      expect(backendApiClient.listResources).toHaveBeenCalled();
    });

    const callArgs = (backendApiClient.listResources as ReturnType<typeof vi.fn>).mock.calls[0];
    const listParams = callArgs[3]; // 4th arg is the params object
    expect(listParams.namespace).toBe('otel-demo');
    expect(listParams.namespaces).toBeUndefined();
  });

  it('undefined namespace falls through to project namespaces', async () => {
    // A list page calls useK8sResourceList('pods', undefined).
    // The active project should scope the query to ['default', 'kube-system'].
    renderHook(() => useK8sResourceList('pods', undefined), { wrapper });

    await waitFor(() => {
      expect(backendApiClient.listResources).toHaveBeenCalled();
    });

    const callArgs = (backendApiClient.listResources as ReturnType<typeof vi.fn>).mock.calls[0];
    const listParams = callArgs[3];
    expect(listParams.namespaces).toEqual(['default', 'kube-system']);
    expect(listParams.namespace).toBeUndefined();
  });
});
