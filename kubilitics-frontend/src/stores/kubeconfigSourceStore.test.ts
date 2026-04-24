/**
 * Unit tests for kubeconfigSourceStore (useKubeconfigStore).
 *
 * Covers: default, setKubeconfigPath, setKubeconfigContent, clusterStore
 * mirroring (so existing API-client readers still see the same values).
 *
 * Persistence note: by design, neither field persists (credentials must not
 * sit in localStorage — see BA-7). We don't assert persistence round-trip.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useKubeconfigStore } from './kubeconfigSourceStore';
import { useClusterStore } from './clusterStore';

describe('useKubeconfigStore', () => {
  beforeEach(() => {
    useKubeconfigStore.setState({ kubeconfigPath: undefined, kubeconfigContent: undefined });
    useClusterStore.getState().signOut();
  });

  it('has correct defaults', () => {
    const s = useKubeconfigStore.getState();
    expect(s.kubeconfigPath).toBeUndefined();
    expect(s.kubeconfigContent).toBeUndefined();
  });

  it('setKubeconfigPath updates local state and mirrors to clusterStore', () => {
    useKubeconfigStore.getState().setKubeconfigPath('/home/user/.kube/config');
    expect(useKubeconfigStore.getState().kubeconfigPath).toBe('/home/user/.kube/config');
    expect(useClusterStore.getState().kubeconfigPath).toBe('/home/user/.kube/config');
  });

  it('setKubeconfigContent stores content + path locally and mirrors to clusterStore', () => {
    const content = 'apiVersion: v1\nkind: Config';
    useKubeconfigStore.getState().setKubeconfigContent(content, '/tmp/kc');
    const s = useKubeconfigStore.getState();
    expect(s.kubeconfigContent).toBe(content);
    expect(s.kubeconfigPath).toBe('/tmp/kc');

    const cs = useClusterStore.getState();
    expect(cs.kubeconfigContent).toBe(content);
    expect(cs.kubeconfigPath).toBe('/tmp/kc');
  });

  it('setKubeconfigContent without path leaves path undefined', () => {
    useKubeconfigStore.getState().setKubeconfigContent('yaml');
    expect(useKubeconfigStore.getState().kubeconfigPath).toBeUndefined();
  });
});
