import type { DiagnosisSeverity } from './types';

const SEVERITY_ORDER: Record<DiagnosisSeverity, number> = {
  healthy: 0,
  degraded: 1,
  unknown: 2,
  broken: 3,
};

/**
 * Returns whichever of a/b is more severe. Used to combine multiple container
 * diagnoses into a single pod severity. Order:
 * healthy < degraded < unknown < broken.
 *
 * (Unknown ranks below broken because an unknown state is less actionable but
 * still not as alarming as a confirmed crash.)
 */
export function maxSeverity(a: DiagnosisSeverity, b: DiagnosisSeverity): DiagnosisSeverity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

interface ContainerStateInput {
  ready: boolean;
  state?: {
    waiting?: { reason?: string; message?: string };
    running?: { startedAt?: string };
    terminated?: { reason?: string; message?: string; exitCode: number };
  };
  restartCount: number;
}

/**
 * Classify a single container status into a severity. Pure function over the
 * K8s containerStatus shape (a subset — only the fields we care about).
 *
 * - running + ready → healthy
 * - running + not ready → degraded (usually probe failing)
 * - waiting with any reason → broken
 * - terminated exit 0 → healthy (completed init container)
 * - terminated non-zero → broken
 * - empty state → unknown
 */
export function classifyContainerState(cs: ContainerStateInput): DiagnosisSeverity {
  if (cs.state?.running) {
    return cs.ready ? 'healthy' : 'degraded';
  }
  if (cs.state?.waiting) {
    return 'broken';
  }
  if (cs.state?.terminated) {
    return cs.state.terminated.exitCode === 0 ? 'healthy' : 'broken';
  }
  return 'unknown';
}
