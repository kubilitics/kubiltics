/**
 * Unit tests for demoStore.
 *
 * Covers: default, setDemo, localStorage persistence round-trip, pass-through
 * to clusterStore so the demo-cluster seeding side effect is preserved.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useDemoStore } from './demoStore';
import { useClusterStore } from './clusterStore';

const PERSIST_KEY = 'kubilitics.demo.enabled';

describe('demoStore', () => {
  beforeEach(() => {
    localStorage.removeItem(PERSIST_KEY);
    useDemoStore.setState({ isDemo: false });
    useClusterStore.getState().signOut();
  });

  it('has correct default value', () => {
    expect(useDemoStore.getState().isDemo).toBe(false);
  });

  it('setDemo(true) updates the flag', () => {
    useDemoStore.getState().setDemo(true);
    expect(useDemoStore.getState().isDemo).toBe(true);
  });

  it('setDemo(false) updates the flag', () => {
    useDemoStore.getState().setDemo(true);
    useDemoStore.getState().setDemo(false);
    expect(useDemoStore.getState().isDemo).toBe(false);
  });

  it('persists isDemo to localStorage', async () => {
    useDemoStore.getState().setDemo(true);
    await new Promise((r) => setTimeout(r, 20));

    const raw = localStorage.getItem(PERSIST_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.isDemo).toBe(true);
  });

  it('setDemo(true) preserves clusterStore demo-seeding side effect', () => {
    useDemoStore.getState().setDemo(true);
    // clusterStore.setDemo(true) seeds 3 mock demo clusters
    const cluster = useClusterStore.getState();
    expect(cluster.isDemo).toBe(true);
    expect(cluster.clusters.length).toBeGreaterThan(0);
  });
});
