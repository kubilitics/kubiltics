/**
 * Strict TypeScript Utility Types for Kubernetes Resources
 *
 * This module provides strongly-typed interfaces, type guards, and utility
 * types for working with Kubernetes API objects in the Kubilitics frontend.
 * Use these instead of `Record<string, any>` to get compile-time safety
 * and runtime validation.
 *
 * @module strict-types
 */

// ─── Base Kubernetes Types ──────────────────────────────────────────────────

/** Standard Kubernetes object metadata with required fields marked strict. */
export interface StrictObjectMeta {
  readonly name: string;
  readonly namespace?: string;
  readonly uid: string;
  readonly creationTimestamp: string;
  readonly resourceVersion?: string;
  readonly generation?: number;
  readonly labels?: Readonly<Record<string, string>>;
  readonly annotations?: Readonly<Record<string, string>>;
  readonly ownerReferences?: ReadonlyArray<OwnerReference>;
  readonly finalizers?: ReadonlyArray<string>;
  readonly deletionTimestamp?: string;
  readonly deletionGracePeriodSeconds?: number;
}

/** Owner reference for garbage collection lineage. */
export interface OwnerReference {
  readonly apiVersion: string;
  readonly kind: string;
  readonly name: string;
  readonly uid: string;
  readonly controller?: boolean;
  readonly blockOwnerDeletion?: boolean;
}

/**
 * Base interface for all Kubernetes resources.
 * Generic over `Spec` and `Status` to enforce type safety per-resource.
 */
export interface StrictK8sResource<
  Spec = unknown,
  Status = unknown,
> {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: StrictObjectMeta;
  readonly spec?: Spec;
  readonly status?: Status;
}

/** Kubernetes list response wrapper. */
export interface StrictResourceList<T> {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: {
    readonly continue?: string;
    readonly resourceVersion?: string;
    readonly remainingItemCount?: number;
  };
  readonly items: ReadonlyArray<T>;
}

// ─── Pod Types ──────────────────────────────────────────────────────────────

/** Container port definition. */
export interface ContainerPort {
  readonly name?: string;
  readonly containerPort: number;
  readonly protocol?: 'TCP' | 'UDP' | 'SCTP';
  readonly hostPort?: number;
  readonly hostIP?: string;
}

/** Container resource requirements (requests/limits). */
export interface ResourceRequirements {
  readonly requests?: Readonly<Record<string, string>>;
  readonly limits?: Readonly<Record<string, string>>;
}

/** Container definition within a Pod spec. */
export interface Container {
  readonly name: string;
  readonly image: string;
  readonly command?: ReadonlyArray<string>;
  readonly args?: ReadonlyArray<string>;
  readonly ports?: ReadonlyArray<ContainerPort>;
  readonly resources?: ResourceRequirements;
  readonly env?: ReadonlyArray<{
    readonly name: string;
    readonly value?: string;
    readonly valueFrom?: Record<string, unknown>;
  }>;
  readonly volumeMounts?: ReadonlyArray<{
    readonly name: string;
    readonly mountPath: string;
    readonly readOnly?: boolean;
    readonly subPath?: string;
  }>;
  readonly imagePullPolicy?: 'Always' | 'IfNotPresent' | 'Never';
  readonly readinessProbe?: Record<string, unknown>;
  readonly livenessProbe?: Record<string, unknown>;
  readonly startupProbe?: Record<string, unknown>;
}

/** Container status within a Pod. */
export interface ContainerStatus {
  readonly name: string;
  readonly ready: boolean;
  readonly restartCount: number;
  readonly image: string;
  readonly imageID: string;
  readonly state?: {
    readonly running?: { readonly startedAt?: string };
    readonly waiting?: { readonly reason?: string; readonly message?: string };
    readonly terminated?: {
      readonly exitCode: number;
      readonly reason?: string;
      readonly message?: string;
      readonly startedAt?: string;
      readonly finishedAt?: string;
    };
  };
  readonly lastState?: ContainerStatus['state'];
  readonly started?: boolean;
}

/** Pod spec (simplified to commonly used fields). */
export interface PodSpec {
  readonly containers: ReadonlyArray<Container>;
  readonly initContainers?: ReadonlyArray<Container>;
  readonly nodeName?: string;
  readonly nodeSelector?: Readonly<Record<string, string>>;
  readonly serviceAccountName?: string;
  readonly restartPolicy?: 'Always' | 'OnFailure' | 'Never';
  readonly tolerations?: ReadonlyArray<Record<string, unknown>>;
  readonly volumes?: ReadonlyArray<Record<string, unknown>>;
  readonly hostNetwork?: boolean;
  readonly dnsPolicy?: string;
  readonly priority?: number;
  readonly priorityClassName?: string;
}

/** Pod phase type. */
export type PodPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';

/** Pod status. */
export interface PodStatus {
  readonly phase: PodPhase;
  readonly conditions?: ReadonlyArray<{
    readonly type: string;
    readonly status: 'True' | 'False' | 'Unknown';
    readonly reason?: string;
    readonly message?: string;
    readonly lastTransitionTime?: string;
  }>;
  readonly containerStatuses?: ReadonlyArray<ContainerStatus>;
  readonly initContainerStatuses?: ReadonlyArray<ContainerStatus>;
  readonly hostIP?: string;
  readonly podIP?: string;
  readonly startTime?: string;
  readonly qosClass?: 'Guaranteed' | 'Burstable' | 'BestEffort';
}

/** Strictly typed Pod resource. */
export type StrictPod = StrictK8sResource<PodSpec, PodStatus>;

// ─── Deployment Types ───────────────────────────────────────────────────────

/** Deployment spec. */
export interface DeploymentSpec {
  readonly replicas?: number;
  readonly selector: {
    readonly matchLabels?: Readonly<Record<string, string>>;
    readonly matchExpressions?: ReadonlyArray<{
      readonly key: string;
      readonly operator: string;
      readonly values?: ReadonlyArray<string>;
    }>;
  };
  readonly template: {
    readonly metadata?: { readonly labels?: Readonly<Record<string, string>> };
    readonly spec?: PodSpec;
  };
  readonly strategy?: {
    readonly type?: 'Recreate' | 'RollingUpdate';
    readonly rollingUpdate?: {
      readonly maxUnavailable?: number | string;
      readonly maxSurge?: number | string;
    };
  };
  readonly revisionHistoryLimit?: number;
  readonly minReadySeconds?: number;
  readonly paused?: boolean;
}

/** Deployment status. */
export interface DeploymentStatus {
  readonly replicas?: number;
  readonly readyReplicas?: number;
  readonly updatedReplicas?: number;
  readonly availableReplicas?: number;
  readonly unavailableReplicas?: number;
  readonly observedGeneration?: number;
  readonly conditions?: ReadonlyArray<{
    readonly type: string;
    readonly status: 'True' | 'False' | 'Unknown';
    readonly reason?: string;
    readonly message?: string;
    readonly lastTransitionTime?: string;
    readonly lastUpdateTime?: string;
  }>;
}

/** Strictly typed Deployment resource. */
export type StrictDeployment = StrictK8sResource<DeploymentSpec, DeploymentStatus>;

// ─── Service Types ──────────────────────────────────────────────────────────

/** Service port definition. */
export interface ServicePort {
  readonly name?: string;
  readonly protocol?: 'TCP' | 'UDP' | 'SCTP';
  readonly port: number;
  readonly targetPort?: number | string;
  readonly nodePort?: number;
}

/** Service type. */
export type ServiceType = 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName';

/** Service spec. */
export interface ServiceSpec {
  readonly type?: ServiceType;
  readonly selector?: Readonly<Record<string, string>>;
  readonly ports?: ReadonlyArray<ServicePort>;
  readonly clusterIP?: string;
  readonly clusterIPs?: ReadonlyArray<string>;
  readonly externalIPs?: ReadonlyArray<string>;
  readonly externalName?: string;
  readonly loadBalancerIP?: string;
  readonly sessionAffinity?: 'None' | 'ClientIP';
}

/** Service status. */
export interface ServiceStatus {
  readonly loadBalancer?: {
    readonly ingress?: ReadonlyArray<{
      readonly ip?: string;
      readonly hostname?: string;
    }>;
  };
}

/** Strictly typed Service resource. */
export type StrictService = StrictK8sResource<ServiceSpec, ServiceStatus>;

// ─── Node Types ─────────────────────────────────────────────────────────────

/** Node condition. */
export interface NodeCondition {
  readonly type: string;
  readonly status: 'True' | 'False' | 'Unknown';
  readonly reason?: string;
  readonly message?: string;
  readonly lastHeartbeatTime?: string;
  readonly lastTransitionTime?: string;
}

/** Node status. */
export interface NodeStatus {
  readonly capacity?: Readonly<Record<string, string>>;
  readonly allocatable?: Readonly<Record<string, string>>;
  readonly conditions?: ReadonlyArray<NodeCondition>;
  readonly addresses?: ReadonlyArray<{
    readonly type: string;
    readonly address: string;
  }>;
  readonly nodeInfo?: {
    readonly kubeletVersion?: string;
    readonly osImage?: string;
    readonly containerRuntimeVersion?: string;
    readonly architecture?: string;
    readonly operatingSystem?: string;
    readonly kernelVersion?: string;
  };
}

/** Strictly typed Node resource. */
export type StrictNode = StrictK8sResource<Record<string, unknown>, NodeStatus>;

// ─── ConfigMap & Secret ─────────────────────────────────────────────────────

/** ConfigMap — data stored as string key-value pairs. */
export interface StrictConfigMap extends StrictK8sResource {
  readonly data?: Readonly<Record<string, string>>;
  readonly binaryData?: Readonly<Record<string, string>>;
}

/** Secret — base64-encoded data with a type field. */
export interface StrictSecret extends StrictK8sResource {
  readonly data?: Readonly<Record<string, string>>;
  readonly stringData?: Readonly<Record<string, string>>;
  readonly type?: string;
}

// ─── Namespace ──────────────────────────────────────────────────────────────

/** Namespace phase. */
export type NamespacePhase = 'Active' | 'Terminating';

/** Strictly typed Namespace resource. */
export type StrictNamespace = StrictK8sResource<
  Record<string, unknown>,
  { readonly phase?: NamespacePhase }
>;

// ─── StatefulSet ────────────────────────────────────────────────────────────

/** StatefulSet status. */
export interface StatefulSetStatus {
  readonly replicas: number;
  readonly readyReplicas?: number;
  readonly currentReplicas?: number;
  readonly updatedReplicas?: number;
  readonly currentRevision?: string;
  readonly updateRevision?: string;
  readonly observedGeneration?: number;
}

/** Strictly typed StatefulSet resource. */
export type StrictStatefulSet = StrictK8sResource<
  DeploymentSpec & { readonly serviceName: string },
  StatefulSetStatus
>;

// ─── DaemonSet ──────────────────────────────────────────────────────────────

/** DaemonSet status. */
export interface DaemonSetStatus {
  readonly currentNumberScheduled: number;
  readonly desiredNumberScheduled: number;
  readonly numberAvailable?: number;
  readonly numberMisscheduled: number;
  readonly numberReady: number;
  readonly numberUnavailable?: number;
  readonly updatedNumberScheduled?: number;
  readonly observedGeneration?: number;
}

/** Strictly typed DaemonSet resource. */
export type StrictDaemonSet = StrictK8sResource<Record<string, unknown>, DaemonSetStatus>;

// ─── Job & CronJob ──────────────────────────────────────────────────────────

/** Job status. */
export interface JobStatus {
  readonly active?: number;
  readonly succeeded?: number;
  readonly failed?: number;
  readonly startTime?: string;
  readonly completionTime?: string;
  readonly conditions?: ReadonlyArray<{
    readonly type: string;
    readonly status: 'True' | 'False' | 'Unknown';
    readonly reason?: string;
    readonly message?: string;
  }>;
}

/** Strictly typed Job resource. */
export type StrictJob = StrictK8sResource<Record<string, unknown>, JobStatus>;

/** Strictly typed CronJob resource. */
export type StrictCronJob = StrictK8sResource<
  { readonly schedule: string; readonly jobTemplate: Record<string, unknown> },
  { readonly lastScheduleTime?: string; readonly lastSuccessfulTime?: string }
>;

// ─── Ingress ────────────────────────────────────────────────────────────────

/** Ingress rule. */
export interface IngressRule {
  readonly host?: string;
  readonly http?: {
    readonly paths: ReadonlyArray<{
      readonly path?: string;
      readonly pathType: 'Exact' | 'Prefix' | 'ImplementationSpecific';
      readonly backend: {
        readonly service?: { readonly name: string; readonly port: { readonly number?: number; readonly name?: string } };
        readonly resource?: { readonly apiGroup: string; readonly kind: string; readonly name: string };
      };
    }>;
  };
}

/** Strictly typed Ingress resource. */
export type StrictIngress = StrictK8sResource<
  { readonly rules?: ReadonlyArray<IngressRule>; readonly tls?: ReadonlyArray<Record<string, unknown>> },
  { readonly loadBalancer?: ServiceStatus['loadBalancer'] }
>;

// ─── Utility Types ──────────────────────────────────────────────────────────

/**
 * Ensures all properties of T are non-nullable (removes `undefined` and `null`).
 * Useful for API response data that has been validated.
 *
 * @example
 * ```ts
 * type SafePod = StrictNonNullable<StrictPod>;
 * // SafePod.metadata.namespace is `string` instead of `string | undefined`
 * ```
 */
export type StrictNonNullable<T> = {
  [K in keyof T]-?: NonNullable<T[K]>;
};

/**
 * Makes specific keys of T required while keeping others unchanged.
 *
 * @example
 * ```ts
 * type PodWithNamespace = RequireKeys<StrictPod['metadata'], 'namespace'>;
 * ```
 */
export type RequireKeys<T, K extends keyof T> = T & {
  [P in K]-?: NonNullable<T[P]>;
};

/**
 * Extracts the items type from a StrictResourceList.
 *
 * @example
 * ```ts
 * type Pods = ListItems<StrictResourceList<StrictPod>>; // ReadonlyArray<StrictPod>
 * ```
 */
export type ListItems<T> = T extends StrictResourceList<infer U>
  ? ReadonlyArray<U>
  : never;

/**
 * Wraps an API response type to handle the loading/error/data states
 * that TanStack Query produces.
 */
export type ApiResponse<T> = {
  readonly data: T | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
};

/**
 * Represents a successfully loaded API response where data is guaranteed.
 */
export type LoadedApiResponse<T> = {
  readonly data: T;
  readonly isLoading: false;
  readonly isError: false;
  readonly error: null;
};

/**
 * Narrows an ApiResponse to a LoadedApiResponse when data is present.
 */
export function isLoaded<T>(
  response: ApiResponse<T>,
): response is LoadedApiResponse<T> {
  return !response.isLoading && !response.isError && response.data !== undefined;
}

// ─── Kubernetes Kind Constants ──────────────────────────────────────────────

/** All supported Kubernetes resource kinds. */
export const K8S_KINDS = {
  Pod: 'Pod',
  Deployment: 'Deployment',
  Service: 'Service',
  Node: 'Node',
  ConfigMap: 'ConfigMap',
  Secret: 'Secret',
  Namespace: 'Namespace',
  StatefulSet: 'StatefulSet',
  DaemonSet: 'DaemonSet',
  Job: 'Job',
  CronJob: 'CronJob',
  Ingress: 'Ingress',
  ReplicaSet: 'ReplicaSet',
  PersistentVolume: 'PersistentVolume',
  PersistentVolumeClaim: 'PersistentVolumeClaim',
  ServiceAccount: 'ServiceAccount',
  NetworkPolicy: 'NetworkPolicy',
  HorizontalPodAutoscaler: 'HorizontalPodAutoscaler',
} as const;

export type K8sKind = (typeof K8S_KINDS)[keyof typeof K8S_KINDS];

// ─── Type Guards ────────────────────────────────────────────────────────────

/**
 * Checks if an unknown value is a Kubernetes resource (has metadata.name, kind, apiVersion).
 */
export function isK8sResource(value: unknown): value is StrictK8sResource {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.kind !== 'string' || typeof obj.apiVersion !== 'string') return false;
  if (typeof obj.metadata !== 'object' || obj.metadata === null) return false;
  const meta = obj.metadata as Record<string, unknown>;
  return typeof meta.name === 'string';
}

/**
 * Type guard: checks if a resource is a Pod.
 *
 * @example
 * ```ts
 * if (isPod(resource)) {
 *   console.log(resource.status?.phase); // PodPhase
 * }
 * ```
 */
export function isPod(resource: unknown): resource is StrictPod {
  return isK8sResource(resource) && resource.kind === K8S_KINDS.Pod;
}

/**
 * Type guard: checks if a resource is a Deployment.
 */
export function isDeployment(resource: unknown): resource is StrictDeployment {
  return isK8sResource(resource) && resource.kind === K8S_KINDS.Deployment;
}

/**
 * Type guard: checks if a resource is a Service.
 */
export function isService(resource: unknown): resource is StrictService {
  return isK8sResource(resource) && resource.kind === K8S_KINDS.Service;
}

/**
 * Type guard: checks if a resource is a Node.
 */
export function isNode(resource: unknown): resource is StrictNode {
  return isK8sResource(resource) && resource.kind === K8S_KINDS.Node;
}

/**
 * Type guard: checks if a resource is a ConfigMap.
 */
export function isConfigMap(resource: unknown): resource is StrictConfigMap {
  return isK8sResource(resource) && resource.kind === K8S_KINDS.ConfigMap;
}

/**
 * Type guard: checks if a resource is a Secret.
 */
export function isSecret(resource: unknown): resource is StrictSecret {
  return isK8sResource(resource) && resource.kind === K8S_KINDS.Secret;
}

/**
 * Type guard: checks if a resource is a Namespace.
 */
export function isNamespace(resource: unknown): resource is StrictNamespace {
  return isK8sResource(resource) && resource.kind === K8S_KINDS.Namespace;
}

/**
 * Type guard: checks if a resource is a StatefulSet.
 */
export function isStatefulSet(resource: unknown): resource is StrictStatefulSet {
  return isK8sResource(resource) && resource.kind === K8S_KINDS.StatefulSet;
}

/**
 * Type guard: checks if a resource is a DaemonSet.
 */
export function isDaemonSet(resource: unknown): resource is StrictDaemonSet {
  return isK8sResource(resource) && resource.kind === K8S_KINDS.DaemonSet;
}

/**
 * Type guard: checks if a resource is a Job.
 */
export function isJob(resource: unknown): resource is StrictJob {
  return isK8sResource(resource) && resource.kind === K8S_KINDS.Job;
}

/**
 * Type guard: checks if a resource is a CronJob.
 */
export function isCronJob(resource: unknown): resource is StrictCronJob {
  return isK8sResource(resource) && resource.kind === K8S_KINDS.CronJob;
}

/**
 * Type guard: checks if a resource is an Ingress.
 */
export function isIngress(resource: unknown): resource is StrictIngress {
  return isK8sResource(resource) && resource.kind === K8S_KINDS.Ingress;
}

/**
 * Generic type guard factory: checks if a resource matches a specific kind.
 *
 * @example
 * ```ts
 * const isReplicaSet = isKind('ReplicaSet');
 * if (isReplicaSet(resource)) { ... }
 * ```
 */
export function isKind<K extends K8sKind>(kind: K) {
  return (resource: unknown): resource is StrictK8sResource => {
    return isK8sResource(resource) && resource.kind === kind;
  };
}

/**
 * Asserts that a value is a Kubernetes resource, throwing if it is not.
 * Useful at API boundaries where you want to fail fast on malformed data.
 *
 * @throws {TypeError} if the value is not a valid K8s resource
 */
export function assertK8sResource(
  value: unknown,
  expectedKind?: string,
): asserts value is StrictK8sResource {
  if (!isK8sResource(value)) {
    throw new TypeError(
      `Expected a Kubernetes resource${expectedKind ? ` of kind "${expectedKind}"` : ''}, ` +
        `got ${typeof value === 'object' ? JSON.stringify(value)?.slice(0, 100) : String(value)}`,
    );
  }
  if (expectedKind && (value as StrictK8sResource).kind !== expectedKind) {
    throw new TypeError(
      `Expected kind "${expectedKind}", got "${(value as StrictK8sResource).kind}"`,
    );
  }
}
