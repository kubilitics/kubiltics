/**
 * useClusterWatcher — Polls cluster resources every 30 seconds and
 * creates notifications when resource state *changes* (not on every poll).
 *
 * Detects:
 * - Pod crash: CrashLoopBackOff or Error status
 * - Deployment degraded: unavailable replicas
 * - Node not ready: condition Ready != True
 * - HPA scaling: currentReplicas changed
 *
 * Uses a simple diff approach: keep a fingerprint map of "resource key -> state"
 * in a ref. On each poll, compare current state with previous. Only fire a
 * notification when the state transitions (e.g. pod becomes CrashLoopBackOff
 * for the first time, or deployment goes from healthy to degraded).
 *
 * @module useClusterWatcher
 */
import { useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { listResources } from '@/services/backendApiClient';
import { useNotificationStore } from '@/stores/notificationStore';

// ─── Constants ──────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;

// ─── Types ──────────────────────────────────────────────────────────────────

/** Fingerprint of a watched resource's current problem state. `null` = healthy. */
type ResourceFingerprint = string | null;

/** Map from "kind/namespace/name" -> fingerprint of last-known problem state. */
type FingerprintMap = Record<string, ResourceFingerprint>;

interface WatcherState {
  pods: FingerprintMap;
  deployments: FingerprintMap;
  nodes: FingerprintMap;
  hpas: FingerprintMap;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function resourceKey(kind: string, namespace: string | undefined, name: string): string {
  return namespace ? `${kind}/${namespace}/${name}` : `${kind}/-/${name}`;
}

/** Safely extract a nested value from an untyped K8s resource object. */
function dig(obj: Record<string, unknown>, ...keys: string[]): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key]; // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
  }
  return current;
}

// ─── Detectors ──────────────────────────────────────────────────────────────
// Each detector returns a fingerprint string if the resource is in a problem
// state, or null if healthy. The fingerprint captures the specific problem so
// that repeated polls for the *same* problem don't re-notify.

function detectPodProblem(pod: Record<string, unknown>): ResourceFingerprint {
  const phase = dig(pod, 'status', 'phase') as string | undefined;
  const containerStatuses = dig(pod, 'status', 'containerStatuses') as
    | Array<Record<string, unknown>>
    | undefined;

  // Check container statuses for CrashLoopBackOff or Error
  if (Array.isArray(containerStatuses)) {
    for (const cs of containerStatuses) {
      const waitingReason = dig(cs, 'state', 'waiting', 'reason') as string | undefined;
      if (waitingReason === 'CrashLoopBackOff') {
        return 'CrashLoopBackOff';
      }
      if (waitingReason === 'ImagePullBackOff' || waitingReason === 'ErrImagePull') {
        return waitingReason;
      }

      const terminatedReason = dig(cs, 'state', 'terminated', 'reason') as string | undefined;
      if (terminatedReason === 'OOMKilled') {
        return 'OOMKilled';
      }
      if (terminatedReason === 'Error') {
        return 'Error';
      }
    }
  }

  // Check overall phase
  if (phase === 'Failed') {
    return 'Failed';
  }

  return null;
}

function detectDeploymentProblem(dep: Record<string, unknown>): ResourceFingerprint {
  const desiredReplicas = (dig(dep, 'spec', 'replicas') as number) ?? 0;
  const availableReplicas = (dig(dep, 'status', 'availableReplicas') as number) ?? 0;
  const unavailableReplicas = (dig(dep, 'status', 'unavailableReplicas') as number) ?? 0;

  if (unavailableReplicas > 0 || (desiredReplicas > 0 && availableReplicas < desiredReplicas)) {
    return `unavailable:${unavailableReplicas || desiredReplicas - availableReplicas}`;
  }

  return null;
}

function detectNodeProblem(node: Record<string, unknown>): ResourceFingerprint {
  const conditions = dig(node, 'status', 'conditions') as
    | Array<Record<string, unknown>>
    | undefined;

  if (Array.isArray(conditions)) {
    const readyCondition = conditions.find((c) => c.type === 'Ready');
    if (readyCondition && readyCondition.status !== 'True') {
      return 'NotReady';
    }
  }

  return null;
}

interface HPAFingerprint {
  problem: ResourceFingerprint;
  currentReplicas: number;
  targetName: string;
}

function extractHPAState(hpa: Record<string, unknown>): HPAFingerprint {
  const currentReplicas = (dig(hpa, 'status', 'currentReplicas') as number) ?? 0;
  const targetName =
    (dig(hpa, 'spec', 'scaleTargetRef', 'name') as string) ?? 'unknown';
  const targetKind =
    (dig(hpa, 'spec', 'scaleTargetRef', 'kind') as string) ?? 'Deployment';

  return {
    problem: null, // HPAs don't have a "problem" per se — we track scaling events
    currentReplicas,
    targetName: `${targetKind}/${targetName}`,
  };
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useClusterWatcher() {
  const clusterId = useActiveClusterId();
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const addNotification = useNotificationStore((s) => s.addNotification);

  const enabled = isConfigured && !!clusterId;

  // Previous state ref — survives re-renders but not remounts (intentional:
  // when the user switches clusters the component remounts, resetting state).
  const prevState = useRef<WatcherState>({
    pods: {},
    deployments: {},
    nodes: {},
    hpas: {},
  });

  // Track whether this is the first successful fetch (skip notifications on
  // initial load — we only want to notify on *changes*).
  const isFirstFetch = useRef(true);

  // HPA replica counts are tracked separately for scaling detection.
  const prevHPAReplicas = useRef<Record<string, number>>({});

  // ── Fetch all watched resource kinds in a single query ──
  const fetchWatchedResources = useCallback(async () => {
    if (!clusterId) return null;

    const [podsRes, deploymentsRes, nodesRes, hpasRes] = await Promise.allSettled([
      listResources(backendBaseUrl, clusterId, 'pods', { limit: 500 }),
      listResources(backendBaseUrl, clusterId, 'deployments', { limit: 200 }),
      listResources(backendBaseUrl, clusterId, 'nodes', { limit: 100 }),
      listResources(backendBaseUrl, clusterId, 'horizontalpodautoscalers', { limit: 100 }),
    ]);

    return {
      pods: podsRes.status === 'fulfilled' ? podsRes.value.items : [],
      deployments: deploymentsRes.status === 'fulfilled' ? deploymentsRes.value.items : [],
      nodes: nodesRes.status === 'fulfilled' ? nodesRes.value.items : [],
      hpas: hpasRes.status === 'fulfilled' ? hpasRes.value.items : [],
    };
  }, [backendBaseUrl, clusterId]);

  const { data } = useQuery({
    queryKey: ['clusterWatcher', backendBaseUrl, clusterId],
    queryFn: fetchWatchedResources,
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
    // Don't refetch on window focus — the interval handles it
    refetchOnWindowFocus: false,
    // Keep stale data while refetching
    staleTime: POLL_INTERVAL_MS - 5_000,
  });

  // ── Diff & notify ──
  useEffect(() => {
    if (!data) return;

    const newPods: FingerprintMap = {};
    const newDeployments: FingerprintMap = {};
    const newNodes: FingerprintMap = {};
    const newHpas: FingerprintMap = {};
    const newHPAReplicas: Record<string, number> = {};

    // ── Pods ──
    for (const pod of data.pods) {
      const name = dig(pod, 'metadata', 'name') as string;
      const namespace = dig(pod, 'metadata', 'namespace') as string;
      if (!name) continue;
      const key = resourceKey('Pod', namespace, name);
      const fingerprint = detectPodProblem(pod);
      newPods[key] = fingerprint;

      if (!isFirstFetch.current && fingerprint && fingerprint !== prevState.current.pods[key]) {
        const messages: Record<string, string> = {
          CrashLoopBackOff: `Pod ${name} in namespace ${namespace} crashed (CrashLoopBackOff)`,
          OOMKilled: `Pod ${name} in namespace ${namespace} was OOMKilled`,
          ImagePullBackOff: `Pod ${name} in namespace ${namespace} has ImagePullBackOff`,
          ErrImagePull: `Pod ${name} in namespace ${namespace} failed to pull image`,
          Error: `Pod ${name} in namespace ${namespace} terminated with error`,
          Failed: `Pod ${name} in namespace ${namespace} entered Failed state`,
        };

        addNotification({
          title: `Pod ${fingerprint}`,
          description: messages[fingerprint] ?? `Pod ${name} in ${namespace} has issue: ${fingerprint}`,
          severity: 'error',
          category: 'cluster',
          resourceKind: 'Pod',
          resourceName: name,
          namespace,
          resourceLink: `/pods/${namespace}/${name}`,
        });
      }
    }

    // ── Deployments ──
    for (const dep of data.deployments) {
      const name = dig(dep, 'metadata', 'name') as string;
      const namespace = dig(dep, 'metadata', 'namespace') as string;
      if (!name) continue;
      const key = resourceKey('Deployment', namespace, name);
      const fingerprint = detectDeploymentProblem(dep);
      newDeployments[key] = fingerprint;

      if (!isFirstFetch.current && fingerprint && fingerprint !== prevState.current.deployments[key]) {
        const unavailableCount = fingerprint.split(':')[1] ?? '?';
        addNotification({
          title: 'Deployment degraded',
          description: `Deployment ${name} in namespace ${namespace} has ${unavailableCount} unavailable replica(s)`,
          severity: 'warning',
          category: 'cluster',
          resourceKind: 'Deployment',
          resourceName: name,
          namespace,
          resourceLink: `/deployments/${namespace}/${name}`,
        });
      }
    }

    // ── Nodes ──
    for (const node of data.nodes) {
      const name = dig(node, 'metadata', 'name') as string;
      if (!name) continue;
      const key = resourceKey('Node', undefined, name);
      const fingerprint = detectNodeProblem(node);
      newNodes[key] = fingerprint;

      if (!isFirstFetch.current && fingerprint && fingerprint !== prevState.current.nodes[key]) {
        addNotification({
          title: 'Node NotReady',
          description: `Node ${name} became NotReady`,
          severity: 'error',
          category: 'cluster',
          resourceKind: 'Node',
          resourceName: name,
          resourceLink: `/nodes/${name}`,
        });
      }
    }

    // ── HPAs (scaling events) ──
    for (const hpa of data.hpas) {
      const name = dig(hpa, 'metadata', 'name') as string;
      const namespace = dig(hpa, 'metadata', 'namespace') as string;
      if (!name) continue;
      const key = resourceKey('HPA', namespace, name);
      const state = extractHPAState(hpa);
      newHpas[key] = state.problem;
      newHPAReplicas[key] = state.currentReplicas;

      if (
        !isFirstFetch.current &&
        prevHPAReplicas.current[key] !== undefined &&
        prevHPAReplicas.current[key] !== state.currentReplicas &&
        state.currentReplicas > 0
      ) {
        const direction =
          state.currentReplicas > prevHPAReplicas.current[key] ? 'scaled up' : 'scaled down';
        addNotification({
          title: `HPA ${direction}`,
          description: `HPA ${name} ${direction} ${state.targetName} to ${state.currentReplicas} replicas in namespace ${namespace}`,
          severity: 'info',
          category: 'cluster',
          resourceKind: 'HorizontalPodAutoscaler',
          resourceName: name,
          namespace,
          resourceLink: `/horizontalpodautoscalers/${namespace}/${name}`,
        });
      }
    }

    // Update previous state
    prevState.current = {
      pods: newPods,
      deployments: newDeployments,
      nodes: newNodes,
      hpas: newHpas,
    };
    prevHPAReplicas.current = newHPAReplicas;

    // After first successful fetch, enable notifications for subsequent diffs
    if (isFirstFetch.current) {
      isFirstFetch.current = false;
    }
  }, [data, addNotification]);

  // Reset first-fetch flag when cluster changes
  useEffect(() => {
    isFirstFetch.current = true;
    prevState.current = { pods: {}, deployments: {}, nodes: {}, hpas: {} };
    prevHPAReplicas.current = {};
  }, [clusterId]);
}
