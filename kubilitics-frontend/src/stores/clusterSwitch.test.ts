import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  emitClusterSwitch,
  onClusterSwitch,
  clearClusterSwitchListeners,
  __lastCluster,
} from './clusterSwitch';

describe('clusterSwitch event bus', () => {
  beforeEach(() => {
    clearClusterSwitchListeners();
  });

  it('fires subscribed listeners with the new cluster id', () => {
    const spy = vi.fn();
    onClusterSwitch(spy);
    emitClusterSwitch('cluster-A');
    expect(spy).toHaveBeenCalledWith('cluster-A');
  });

  it('de-dupes identical consecutive cluster IDs', () => {
    const spy = vi.fn();
    onClusterSwitch(spy);
    emitClusterSwitch('cluster-A');
    emitClusterSwitch('cluster-A');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fires on change even after same-id no-op', () => {
    const spy = vi.fn();
    onClusterSwitch(spy);
    emitClusterSwitch('A');
    emitClusterSwitch('A');
    emitClusterSwitch('B');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith('B');
  });

  it('unsubscribe prevents further notifications', () => {
    const spy = vi.fn();
    const unsub = onClusterSwitch(spy);
    emitClusterSwitch('A');
    unsub();
    emitClusterSwitch('B');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('all listeners are notified within 200ms of emit (race-fix SLO)', async () => {
    const spies = Array.from({ length: 5 }, () => vi.fn());
    spies.forEach((s) => onClusterSwitch(s));
    const t0 = performance.now();
    emitClusterSwitch('sync-A');
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(200);
    spies.forEach((s) => {
      expect(s).toHaveBeenCalledWith('sync-A');
    });
  });

  it('exposes the last-emitted cluster for late subscribers', () => {
    emitClusterSwitch('C');
    expect(__lastCluster()).toBe('C');
  });
});
