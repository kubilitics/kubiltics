/**
 * Tests for src/hooks/useConnectionStatus.ts
 *
 * Covers: connected/disconnected status based on backend config, cluster, and K8s config state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock controls
let mockIsBackendConfigured = false;
let mockActiveCluster: { id: string; name: string } | null = null;
let mockKubeIsConnected = false;

vi.mock('@/stores/backendConfigStore', () => ({
  useBackendConfigStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      isBackendConfigured: () => mockIsBackendConfigured,
    };
    return selector(state);
  },
}));

vi.mock('@/stores/clusterPresenceStore', () => ({
  useActiveCluster: () => mockActiveCluster,
}));

vi.mock('@/stores/kubernetesConfigStore', () => ({
  useKubernetesConfigStore: () => ({
    config: { isConnected: mockKubeIsConnected },
  }),
}));

import { useConnectionStatus } from './useConnectionStatus';

beforeEach(() => {
  mockIsBackendConfigured = false;
  mockActiveCluster = null;
  mockKubeIsConnected = false;
});

// ============================================================================

describe('useConnectionStatus', () => {
  it('returns disconnected when nothing is configured', () => {
    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current.isConnected).toBe(false);
  });

  it('returns connected when backend is configured AND activeCluster is set', () => {
    mockIsBackendConfigured = true;
    mockActiveCluster = { id: 'c1', name: 'cluster-1' };

    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current.isConnected).toBe(true);
  });

  it('returns disconnected when backend is configured but no active cluster', () => {
    mockIsBackendConfigured = true;
    mockActiveCluster = null;

    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current.isConnected).toBe(false);
  });

  it('returns disconnected when activeCluster is set but backend is not configured', () => {
    mockIsBackendConfigured = false;
    mockActiveCluster = { id: 'c1', name: 'cluster-1' };

    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current.isConnected).toBe(false);
  });

  it('returns connected when direct K8s API is connected (no backend)', () => {
    mockIsBackendConfigured = false;
    mockActiveCluster = null;
    mockKubeIsConnected = true;

    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current.isConnected).toBe(true);
  });

  it('returns connected when both backend and K8s direct are connected', () => {
    mockIsBackendConfigured = true;
    mockActiveCluster = { id: 'c1', name: 'cluster-1' };
    mockKubeIsConnected = true;

    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current.isConnected).toBe(true);
  });

  it('returns connected when only K8s direct is connected (backend not configured)', () => {
    mockIsBackendConfigured = false;
    mockActiveCluster = null;
    mockKubeIsConnected = true;

    const { result } = renderHook(() => useConnectionStatus());
    expect(result.current.isConnected).toBe(true);
  });
});
