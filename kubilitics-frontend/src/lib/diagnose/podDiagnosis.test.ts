import { describe, it, expect } from 'vitest';
import { diagnosePod } from './podDiagnosis';
import {
  crashLoopPod,
  healthyPod,
  healthyPodWithInit,
  oomKilledPod,
  imagePullPod,
  schedulingFailedPod,
  unreadyPod,
  initContainerFailingPod,
  warningEvent,
} from './__fixtures__/fixtures';

describe('diagnosePod', () => {
  it('CrashLoopBackOff is broken with the right reason', () => {
    const d = diagnosePod(crashLoopPod());
    expect(d.severity).toBe('broken');
    expect(d.reasons[0].code).toBe('CrashLoopBackOff');
    expect(d.headline.toLowerCase()).toContain('crash');
    expect(d.containers).toHaveLength(1);
    expect(d.containers[0].name).toBe('busybox');
    expect(d.containers[0].state).toBe('waiting');
    expect(d.containers[0].lastTerminated?.exitCode).toBe(128);
    expect(d.containers[0].lastTerminated?.reason).toBe('StartError');
  });

  it('healthy pod is healthy', () => {
    const d = diagnosePod(healthyPod());
    expect(d.severity).toBe('healthy');
    expect(d.reasons).toHaveLength(0);
    expect(d.headline.toLowerCase()).toContain('running');
  });

  it('healthy pod with init container reports regular container count only', () => {
    const d = diagnosePod(healthyPodWithInit());
    expect(d.severity).toBe('healthy');
    expect(d.oneLine).toContain('2 container');
    expect(d.oneLine).not.toContain('3 container');
  });

  it('OOMKilled surfaces as broken with OOMKilled reason', () => {
    const d = diagnosePod(oomKilledPod());
    expect(d.severity).toBe('broken');
    const codes = d.reasons.map(r => r.code);
    expect(codes).toContain('OOMKilled');
  });

  it('ImagePullBackOff is broken', () => {
    const d = diagnosePod(imagePullPod());
    expect(d.severity).toBe('broken');
    expect(d.reasons[0].code).toBe('ImagePullBackOff');
  });

  it('FailedScheduling surfaces when no containerStatuses yet', () => {
    const d = diagnosePod(schedulingFailedPod());
    expect(d.severity).toBe('broken');
    expect(d.reasons[0].code).toBe('Unschedulable');
    expect(d.oneLine.toLowerCase()).toContain('insufficient cpu');
  });

  it('running but not ready is degraded', () => {
    const d = diagnosePod(unreadyPod());
    expect(d.severity).toBe('degraded');
  });

  it('failing init container surfaces even though main is waiting', () => {
    const d = diagnosePod(initContainerFailingPod());
    expect(d.severity).toBe('broken');
    expect(d.containers.length).toBeGreaterThanOrEqual(2);
    expect(d.containers.some(c => c.isInit)).toBe(true);
  });

  it('warning events are attached when provided', () => {
    const d = diagnosePod(crashLoopPod(), [
      warningEvent('BackOff', 'Back-off restarting failed container busybox', 7),
      warningEvent('Failed', 'Error: failed to create containerd task: exec...', 5),
    ] as never[]);
    expect(d.recentWarnings).toHaveLength(2);
    expect(d.recentWarnings[0].message).toContain('Back-off');
  });

  it('unknown reason falls back to generic entry, no throw', () => {
    const pod = crashLoopPod();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pod.status.containerStatuses[0].state.waiting as any).reason = 'NeverSeenReason';
    const d = diagnosePod(pod);
    expect(d.severity).toBe('unknown');
    expect(d.reasons[0].code).toBe('NeverSeenReason');
  });

  it('deletionTimestamp marks pod as being deleted', () => {
    const pod = healthyPod();
    (pod.metadata as Record<string, unknown>).deletionTimestamp = '2026-04-14T12:00:00Z';
    const d = diagnosePod(pod);
    expect(d.severity).toBe('unknown');
    expect(d.headline.toLowerCase()).toContain('deleted');
  });

  it('diagnose is idempotent', () => {
    const pod = crashLoopPod();
    const a = diagnosePod(pod);
    const b = diagnosePod(pod);
    const { computedAt: _ca, ...aRest } = a;
    const { computedAt: _cb, ...bRest } = b;
    expect(aRest).toEqual(bRest);
  });

  it('kind and name are always populated', () => {
    const d = diagnosePod(crashLoopPod('my-pod'));
    expect(d.kind).toBe('Pod');
    expect(d.name).toBe('my-pod');
    expect(d.namespace).toBe('default');
  });

  it('running+ready pod with past crashes is healthy, not broken', () => {
    // kube-scheduler pattern: currently running and ready (1/1) but has 9
    // restarts and lastState.terminated.reason='Error'. The old code marked
    // this "broken" because it read lastState as a live signal. A recovered
    // pod should be healthy.
    const pod = {
      kind: 'Pod',
      metadata: { name: 'scheduler', namespace: 'kube-system', uid: 'uid-1', resourceVersion: '1' },
      status: {
        phase: 'Running',
        containerStatuses: [{
          name: 'scheduler',
          ready: true,
          restartCount: 9,
          state: { running: { startedAt: '2026-04-10T00:00:00Z' } },
          lastState: {
            terminated: { reason: 'Error', exitCode: 1, finishedAt: '2026-04-09T23:59:00Z' },
          },
        }],
        conditions: [
          { type: 'Ready', status: 'True' },
          { type: 'ContainersReady', status: 'True' },
        ],
      },
    };
    const d = diagnosePod(pod);
    expect(d.severity).toBe('healthy');
    expect(d.reasons).toHaveLength(0);
  });

  it('running+ready pod with lastState.terminated.reason=Unknown is healthy', () => {
    // OTel ad pod pattern: running 1/1 with 4 restarts, lastState Unknown
    // exit 255. Should be healthy, not "unknown".
    const pod = {
      kind: 'Pod',
      metadata: { name: 'ad', namespace: 'otel-demo', uid: 'uid-2', resourceVersion: '1' },
      status: {
        phase: 'Running',
        containerStatuses: [{
          name: 'ad',
          ready: true,
          restartCount: 4,
          state: { running: { startedAt: '2026-04-13T17:28:02Z' } },
          lastState: {
            terminated: { reason: 'Unknown', exitCode: 255, finishedAt: '2026-04-13T17:27:57Z' },
          },
        }],
        conditions: [
          { type: 'Ready', status: 'True' },
          { type: 'ContainersReady', status: 'True' },
        ],
      },
    };
    const d = diagnosePod(pod);
    expect(d.severity).toBe('healthy');
    expect(d.reasons).toHaveLength(0);
  });

  it('waiting pod with lastState.terminated still surfaces the root cause', () => {
    // CrashLoopBackOff + OOMKilled in lastState — this SHOULD still surface
    // OOMKilled because the container is NOT running+ready. Regression guard.
    const d = diagnosePod(oomKilledPod());
    expect(d.severity).toBe('broken');
    const codes = d.reasons.map(r => r.code);
    expect(codes).toContain('OOMKilled');
  });

  it('conditions are copied into the result', () => {
    const d = diagnosePod(crashLoopPod());
    expect(d.conditions.length).toBeGreaterThan(0);
    expect(d.conditions.some(c => c.type === 'Ready' && c.status === 'False')).toBe(true);
  });
});
