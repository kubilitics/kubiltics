// Public types for the diagnose package. Pure data — no React, no hooks.
// Consumed by both the lib/ logic and the components/ presentation layer.

export type DiagnosisSeverity = 'healthy' | 'degraded' | 'broken' | 'unknown';

export interface ReasonCode {
  /** Raw Kubernetes reason string, e.g. 'CrashLoopBackOff', 'OOMKilled'. */
  code: string;
  severity: DiagnosisSeverity;
  /** Short, human, no jargon. "Container keeps crashing". */
  title: string;
  /** 1-2 sentences. Plain English, no K8s-speak. */
  explanation: string;
  suggestions: Suggestion[];
  /** Optional link to runbook / k8s.io docs. */
  docLink?: string;
}

export interface Suggestion {
  /** "Read the crash output from the previous run" */
  text: string;
  /** Optional literal kubectl command with {namespace}/{pod}/{container} placeholders. */
  kubectlHint?: string;
  /** Optional deep link action. */
  action?: DiagnoseAction;
}

export type DiagnoseAction =
  | { type: 'jump_to_tab'; tab: 'logs' | 'events' | 'terminal' | 'containers' | 'yaml' | 'metrics' }
  | { type: 'jump_to_pod'; namespace: string; name: string }
  | { type: 'copy'; value: string };

export interface ContainerDiagnosis {
  name: string;
  isInit: boolean;
  state: 'waiting' | 'running' | 'terminated' | 'unknown';
  /** K8s state reason, e.g. 'CrashLoopBackOff'. Undefined when running cleanly. */
  reason?: string;
  /** K8s state message — full text, not truncated. */
  message?: string;
  /** Exit code if state === 'terminated'. */
  exitCode?: number;
  restartCount: number;
  ready: boolean;
  started?: boolean;
  lastTerminated?: {
    reason?: string;
    message?: string;
    exitCode: number;
    finishedAt?: string;
    signal?: number;
  };
}

export interface WarningEvent {
  reason: string;
  message: string;
  count: number;
  firstSeen: number; // ms epoch
  lastSeen: number; // ms epoch
  involvedObject?: { kind: string; namespace: string; name: string };
}

export interface PodCondition {
  type: 'Ready' | 'ContainersReady' | 'Initialized' | 'PodScheduled' | string;
  status: 'True' | 'False' | 'Unknown';
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface Diagnosis {
  severity: DiagnosisSeverity;
  /** "Container keeps crashing" */
  headline: string;
  /** "busybox exited with code 128: exec: \"invalid-command\" not found in $PATH" */
  oneLine: string;
  /** Ordered most-severe first. May be multi-entry for complex states. */
  reasons: ReasonCode[];
  containers: ContainerDiagnosis[];
  conditions: PodCondition[];
  recentWarnings: WarningEvent[];
  /** For controller diagnoses, link to the worst child pod. */
  relatedPodLink?: { namespace: string; name: string };
  computedAt: number; // ms epoch
  kind: string; // 'Pod' | 'Deployment' | ...
  namespace?: string;
  name: string;
}

/** Options passed to diagnoseWorkload — all optional except resource itself. */
export interface DiagnoseOptions {
  relatedPods?: unknown[]; // typed as unknown to avoid cross-file imports; callers cast
  relatedJobs?: unknown[];
  events?: unknown[];
}
