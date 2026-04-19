import { describe, it, expect, beforeEach } from 'vitest';
import { useAIContextStore } from './aiContextStore';

const reset = () => useAIContextStore.setState({ implicit: null, explicit: null }, false);

describe('aiContextStore', () => {
  beforeEach(reset);

  it('current returns null when both unset', () => {
    expect(useAIContextStore.getState().current()).toBeNull();
  });

  it('implicit is returned when no explicit', () => {
    useAIContextStore.getState().setImplicit({ type: 'pod', cluster: 'c1', name: 'p1' });
    expect(useAIContextStore.getState().current()?.name).toBe('p1');
  });

  it('explicit takes precedence over implicit', () => {
    useAIContextStore.getState().setImplicit({ type: 'pod', cluster: 'c1', name: 'implicit' });
    useAIContextStore.getState().setExplicit({ type: 'pod', cluster: 'c1', name: 'explicit' });
    expect(useAIContextStore.getState().current()?.name).toBe('explicit');
  });

  it('setExplicit(null) reverts to implicit', () => {
    useAIContextStore.getState().setImplicit({ type: 'pod', cluster: 'c1', name: 'implicit' });
    useAIContextStore.getState().setExplicit({ type: 'pod', cluster: 'c1', name: 'explicit' });
    useAIContextStore.getState().setExplicit(null);
    expect(useAIContextStore.getState().current()?.name).toBe('implicit');
  });
});
