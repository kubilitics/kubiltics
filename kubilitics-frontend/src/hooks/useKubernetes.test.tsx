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
