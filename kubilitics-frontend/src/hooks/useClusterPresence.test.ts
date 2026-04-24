// useClusterPresence.test.ts — exercises the snapshot-fetch + EventSource path.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useClusterPresence } from './useClusterPresence';
import { useClusterPresenceStore, __resetForTest } from '@/stores/clusterPresenceStore';

describe('useClusterPresence', () => {
  beforeEach(() => {
    __resetForTest();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      discovered: [{ identity: { name: 'a', serverUrl: 'https://a' }, source: 'kubeconfig' }],
      registered: [], connected: [], last_used: null,
    }), { status: 200 })));
    // Stub EventSource to a no-op open.
    class FakeES {
      url: string;
      onmessage: ((ev: MessageEvent) => unknown) | null = null;
      onerror: ((ev: Event) => unknown) | null = null;
      constructor(url: string) { this.url = url; }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeES);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('fetches initial snapshot on mount', async () => {
    renderHook(() => useClusterPresence());
    await waitFor(() => {
      expect(useClusterPresenceStore.getState().isReady).toBe(true);
      expect(useClusterPresenceStore.getState().discovered.length).toBe(1);
    });
  });
});
