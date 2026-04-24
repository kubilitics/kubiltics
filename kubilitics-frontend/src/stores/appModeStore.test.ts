/**
 * Unit tests for appModeStore.
 *
 * Covers: default, setAppMode, persistence round-trip, clusterStore mirror,
 * useIsOnboarded derivation from presence store.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppModeStore, useIsOnboarded } from './appModeStore';
import { useClusterStore } from './clusterStore';
import { useClusterPresenceStore, __resetForTest } from './clusterPresenceStore';

const PERSIST_KEY = 'kubilitics.app.mode';

describe('appModeStore', () => {
  beforeEach(() => {
    localStorage.removeItem(PERSIST_KEY);
    useAppModeStore.setState({ appMode: null });
    useClusterStore.getState().signOut();
    __resetForTest();
  });

  it('has correct default', () => {
    expect(useAppModeStore.getState().appMode).toBeNull();
  });

  it('setAppMode updates the value', () => {
    useAppModeStore.getState().setAppMode('desktop');
    expect(useAppModeStore.getState().appMode).toBe('desktop');

    useAppModeStore.getState().setAppMode('in-cluster');
    expect(useAppModeStore.getState().appMode).toBe('in-cluster');
  });

  it('setAppMode mirrors into clusterStore for legacy readers', () => {
    useAppModeStore.getState().setAppMode('desktop');
    expect(useClusterStore.getState().appMode).toBe('desktop');
  });

  it('persists appMode to localStorage', async () => {
    useAppModeStore.getState().setAppMode('desktop');
    await new Promise((r) => setTimeout(r, 20));

    const raw = localStorage.getItem(PERSIST_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.appMode).toBe('desktop');
  });
});

describe('useIsOnboarded', () => {
  beforeEach(() => {
    __resetForTest();
  });

  it('returns false when no active logical identity', () => {
    const { result } = renderHook(() => useIsOnboarded());
    expect(result.current).toBe(false);
  });

  it('returns true once an active logical identity is set', () => {
    useClusterPresenceStore.getState().setActiveByLogicalIdentity({
      name: 'docker-desktop',
      serverUrl: 'https://1.2.3.4:6443',
    });
    const { result } = renderHook(() => useIsOnboarded());
    expect(result.current).toBe(true);
  });
});
