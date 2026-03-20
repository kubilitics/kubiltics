/**
 * Unit tests for cluster store. BA-7 / test gaps: kubeconfig must not be persisted to localStorage.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useClusterStore } from './clusterStore';

const PERSIST_KEY = 'kubilitics-cluster';

describe('clusterStore', () => {
  beforeEach(() => {
    localStorage.removeItem(PERSIST_KEY);
  });

  afterEach(() => {
    useClusterStore.getState().signOut();
  });

  it('does not persist kubeconfig content to localStorage after connect (BA-7 / test gaps)', async () => {
    const secretContent = 'apiVersion: v1\nkind: Config\nclusters:\n- name: prod\n  cluster: { server: https://prod.example.com }';
    useClusterStore.getState().setKubeconfigContent(secretContent, '/path/to/kubeconfig');

    // Zustand persist writes asynchronously; allow one tick for the subscription to run.
    await new Promise((r) => setTimeout(r, 20));

    const raw = localStorage.getItem(PERSIST_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    const state = parsed.state as Record<string, unknown>;

    expect(state).not.toHaveProperty('kubeconfigContent');
    expect(state).not.toHaveProperty('kubeconfigPath');
    expect(raw).not.toContain(secretContent);
    expect(raw).not.toContain('kubeconfigContent');
    expect(raw).not.toContain('kubeconfigPath');
  });
});
