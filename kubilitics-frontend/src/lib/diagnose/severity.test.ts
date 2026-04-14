import { describe, it, expect } from 'vitest';
import { maxSeverity, classifyContainerState } from './severity';

describe('maxSeverity', () => {
  it('returns the more severe value', () => {
    expect(maxSeverity('healthy', 'degraded')).toBe('degraded');
    expect(maxSeverity('degraded', 'broken')).toBe('broken');
    expect(maxSeverity('broken', 'healthy')).toBe('broken');
    expect(maxSeverity('unknown', 'healthy')).toBe('unknown');
  });

  it('unknown is less severe than broken', () => {
    expect(maxSeverity('unknown', 'broken')).toBe('broken');
  });

  it('identical inputs return the same value', () => {
    expect(maxSeverity('healthy', 'healthy')).toBe('healthy');
  });

  it('handles an array via reduce', () => {
    const all = ['healthy', 'degraded', 'broken', 'unknown'] as const;
    expect(all.reduce((a, b) => maxSeverity(a, b), 'healthy' as const)).toBe('broken');
  });
});

describe('classifyContainerState', () => {
  it('running + ready is healthy', () => {
    expect(classifyContainerState({ ready: true, state: { running: {} }, restartCount: 0 })).toBe('healthy');
  });

  it('running + not ready is degraded (probe failing)', () => {
    expect(classifyContainerState({ ready: false, state: { running: {} }, restartCount: 0 })).toBe('degraded');
  });

  it('waiting with a reason is broken', () => {
    expect(classifyContainerState({ ready: false, state: { waiting: { reason: 'CrashLoopBackOff' } }, restartCount: 5 })).toBe('broken');
  });

  it('terminated with non-zero exit is broken', () => {
    expect(classifyContainerState({ ready: false, state: { terminated: { exitCode: 137 } }, restartCount: 0 })).toBe('broken');
  });

  it('terminated with exit 0 is healthy (completed init container)', () => {
    expect(classifyContainerState({ ready: false, state: { terminated: { exitCode: 0 } }, restartCount: 0 })).toBe('healthy');
  });

  it('empty state (pre-creation) is unknown', () => {
    expect(classifyContainerState({ ready: false, state: {}, restartCount: 0 })).toBe('unknown');
  });
});
