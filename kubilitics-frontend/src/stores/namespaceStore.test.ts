/**
 * Unit tests for namespaceStore.
 *
 * Covers: default value, setActiveNamespace, localStorage persistence round-trip.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useNamespaceStore } from './namespaceStore';

const PERSIST_KEY = 'kubilitics.namespace.active';

describe('namespaceStore', () => {
  beforeEach(() => {
    localStorage.removeItem(PERSIST_KEY);
    useNamespaceStore.setState({ activeNamespace: 'all' });
  });

  it('has correct default value', () => {
    expect(useNamespaceStore.getState().activeNamespace).toBe('all');
  });

  it('setActiveNamespace updates the value', () => {
    useNamespaceStore.getState().setActiveNamespace('kube-system');
    expect(useNamespaceStore.getState().activeNamespace).toBe('kube-system');
  });

  it('persists activeNamespace to localStorage', async () => {
    useNamespaceStore.getState().setActiveNamespace('production');
    await new Promise((r) => setTimeout(r, 20));

    const raw = localStorage.getItem(PERSIST_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.activeNamespace).toBe('production');
  });

  it('round-trips: set -> read', () => {
    useNamespaceStore.getState().setActiveNamespace('default');
    expect(useNamespaceStore.getState().activeNamespace).toBe('default');
    useNamespaceStore.getState().setActiveNamespace('all');
    expect(useNamespaceStore.getState().activeNamespace).toBe('all');
  });
});
