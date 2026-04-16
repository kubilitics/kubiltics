import type { Diagnosis, ContainerDiagnosis, ReasonCode, PodCondition, WarningEvent } from './types';
import { lookupReason, REASONS } from './reasons';
import { classifyContainerState, maxSeverity } from './severity';

// Minimal shape of a K8s containerStatus — we only use these fields.
interface ContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  state?: {
    waiting?: { reason?: string; message?: string };
    running?: { startedAt?: string };
    terminated?: { reason?: string; message?: string; exitCode: number; finishedAt?: string; signal?: number };
  };
  lastState?: {
    terminated?: { reason?: string; message?: string; exitCode: number; finishedAt?: string; signal?: number };
  };
}

// Minimal shape of a K8s Pod. Using unknown for the full shape to avoid a
// heavy type import; we cast fields at the boundary and trust the tests.
interface PodLike {
  kind?: string;
  metadata: {
    name: string;
    namespace?: string;
    uid?: string;
    deletionTimestamp?: string;
  };
  status?: {
    phase?: string;
    conditions?: Array<{ type: string; status: string; reason?: string; message?: string; lastTransitionTime?: string }>;
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
  };
}

/**
 * Diagnose a single Pod. Pure function over K8s data. No fetching, no hooks.
 *
 * @param pod     The full Pod resource as returned by the K8s API.
 * @param events  Optional list of warning events scoped to this pod.
 */
export function diagnosePod(pod: PodLike, events: WarningEvent[] = []): Diagnosis {
  const kind = pod.kind ?? 'Pod';
  const name = pod.metadata.name;
  const namespace = pod.metadata.namespace;

  // --- Deletion short-circuit ---
  if (pod.metadata.deletionTimestamp) {
    return {
      severity: 'unknown',
      headline: 'Pod is being deleted',
      oneLine: 'Kubernetes has a deletionTimestamp on this pod — it is being removed.',
      reasons: [],
      containers: [],
      conditions: (pod.status?.conditions as PodCondition[]) ?? [],
      recentWarnings: events,
      computedAt: Date.now(),
      kind,
      namespace,
      name,
    };
  }

  const allStatuses: Array<{ cs: ContainerStatus; isInit: boolean }> = [
    ...(pod.status?.initContainerStatuses ?? []).map(cs => ({ cs, isInit: true })),
    ...(pod.status?.containerStatuses ?? []).map(cs => ({ cs, isInit: false })),
  ];
  const containers: ContainerDiagnosis[] = allStatuses.map(({ cs, isInit }) => ({
    name: cs.name,
    isInit,
    state: stateOf(cs),
    reason: cs.state?.waiting?.reason ?? cs.state?.terminated?.reason,
    message: cs.state?.waiting?.message ?? cs.state?.terminated?.message,
    exitCode: cs.state?.terminated?.exitCode,
    restartCount: cs.restartCount,
    ready: cs.ready,
    lastTerminated: cs.lastState?.terminated
      ? {
          reason: cs.lastState.terminated.reason,
          message: cs.lastState.terminated.message,
          exitCode: cs.lastState.terminated.exitCode,
          finishedAt: cs.lastState.terminated.finishedAt,
          signal: cs.lastState.terminated.signal,
        }
      : undefined,
  }));

  // --- Collect reasons from container statuses ---
  const reasons: ReasonCode[] = [];
  for (const { cs } of allStatuses) {
    const waitingReason = cs.state?.waiting?.reason;
    const termReason = cs.state?.terminated?.reason;
    const hasCurrentStateReason = !!waitingReason || !!termReason;

    if (waitingReason) reasons.push(lookupReason(waitingReason));
    // Include lastTerminated reason when it adds diagnostic value — specifically
    // when the container is NOT currently running-and-ready. A running+ready
    // container with a past crash in lastState is healthy now; surfacing the old
    // termination reason as a live severity signal is wrong (it marks a recovered
    // pod as "broken" or "unknown" when the user can see READY 1/1). The
    // lastTerminated info is still shown in the container-details card for
    // debugging, just not used to drive severity.
    const isRunningAndReady = !!cs.state?.running && cs.ready;
    const lastTermReason = cs.lastState?.terminated?.reason;
    const waitingIsKnown = waitingReason ? waitingReason in REASONS : true;
    if (lastTermReason && !isRunningAndReady && (!hasCurrentStateReason || waitingIsKnown) && lastTermReason !== waitingReason) {
      reasons.push(lookupReason(lastTermReason));
    }
    if (termReason && cs.state?.terminated?.exitCode !== 0) reasons.push(lookupReason(termReason));
  }

  // --- Phase-level checks ---
  const phase = pod.status?.phase;
  if (allStatuses.length === 0) {
    // No container statuses yet — check scheduling
    const podScheduled = pod.status?.conditions?.find(c => c.type === 'PodScheduled');
    if (podScheduled?.status === 'False' && podScheduled.reason) {
      reasons.push(lookupReason(podScheduled.reason));
    }
  }

  // --- Severity aggregation ---
  let severity = reasons.reduce<Diagnosis['severity']>(
    (acc, r) => maxSeverity(acc, r.severity),
    'healthy'
  );

  // If phase is Running and severity is still healthy, check container states
  if (severity === 'healthy' && phase === 'Running') {
    const containerSev = allStatuses
      .map(({ cs }) => classifyContainerState(cs))
      .reduce<Diagnosis['severity']>((acc, s) => maxSeverity(acc, s), 'healthy');
    severity = maxSeverity(severity, containerSev);
  }

  if (phase === 'Failed') severity = 'broken';
  if (phase === 'Unknown') severity = 'unknown';
  if (phase === 'Succeeded' && kind === 'Pod') {
    // Bare pod that succeeded — unusual but not broken
    severity = 'healthy';
  }

  // --- Dedupe + sort reasons by severity (broken > degraded > unknown > healthy) ---
  const seen = new Set<string>();
  const uniqueReasons = reasons
    .filter(r => {
      if (seen.has(r.code)) return false;
      seen.add(r.code);
      return true;
    })
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  // --- Headline + oneLine ---
  let headline: string;
  let oneLine: string;

  if (severity === 'healthy') {
    headline = phase === 'Succeeded' ? 'Completed' : 'Running, all containers ready';
    // Match kubectl's READY N/M semantics: only regular (non-init) containers
    // count. Init containers are setup scaffolding that have already finished
    // by the time a pod reaches the healthy state.
    const regular = containers.filter(c => !c.isInit);
    const restarts = regular.reduce((s, c) => s + c.restartCount, 0);
    oneLine = `${regular.length} container${regular.length === 1 ? '' : 's'}, ${restarts} restart${restarts === 1 ? '' : 's'}.`;
  } else if (uniqueReasons[0]) {
    headline = uniqueReasons[0].title;
    oneLine = buildOneLine(uniqueReasons[0], containers, pod);
  } else {
    headline = 'Status unknown';
    oneLine = 'Kubilitics does not have enough data to diagnose this pod.';
  }

  return {
    severity,
    headline,
    oneLine,
    reasons: uniqueReasons,
    containers,
    conditions: (pod.status?.conditions as PodCondition[]) ?? [],
    recentWarnings: events,
    computedAt: Date.now(),
    kind,
    namespace,
    name,
  };
}

function stateOf(cs: ContainerStatus): ContainerDiagnosis['state'] {
  if (cs.state?.running) return 'running';
  if (cs.state?.waiting) return 'waiting';
  if (cs.state?.terminated) return 'terminated';
  return 'unknown';
}

function severityRank(s: Diagnosis['severity']): number {
  return { healthy: 0, degraded: 1, unknown: 2, broken: 3 }[s];
}

function buildOneLine(topReason: ReasonCode, containers: ContainerDiagnosis[], pod: PodLike): string {
  const problemContainer = containers.find(
    c => c.reason === topReason.code || c.lastTerminated?.reason === topReason.code
  );
  if (problemContainer) {
    const exit = problemContainer.lastTerminated?.exitCode ?? problemContainer.exitCode;
    const msg = problemContainer.lastTerminated?.message ?? problemContainer.message;
    if (exit !== undefined && msg) {
      return `${problemContainer.name} exited with code ${exit}: ${trimLine(msg)}`;
    }
    if (msg) return `${problemContainer.name}: ${trimLine(msg)}`;
  }
  if (topReason.code === 'Unschedulable' || topReason.code === 'FailedScheduling') {
    const sched = pod.status?.conditions?.find(c => c.type === 'PodScheduled');
    if (sched?.message) return sched.message;
  }
  return topReason.explanation;
}

function trimLine(s: string): string {
  const firstLine = s.split('\n')[0];
  return firstLine.length > 200 ? firstLine.slice(0, 197) + '...' : firstLine;
}
