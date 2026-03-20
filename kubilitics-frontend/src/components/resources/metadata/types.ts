/**
 * Unified metadata types for Kubilitics resource detail pages.
 *
 * Every resource page must use these types when rendering labels,
 * annotations, taints, and tolerations — no inline custom types.
 */

/** A single Kubernetes label (key=value pair). */
export interface K8sLabel {
  key: string;
  value: string;
}

/** A single Kubernetes annotation (key=value pair, value may be long). */
export interface K8sAnnotation {
  key: string;
  value: string;
}

/** A node taint (key=value:effect). */
export interface K8sTaint {
  key: string;
  value?: string;
  effect: string;
  /** Optional: timeAdded (for NoExecute taints). */
  timeAdded?: string;
}

/** A pod toleration. */
export interface K8sToleration {
  key?: string;
  operator?: string;
  value?: string;
  effect?: string;
  tolerationSeconds?: number;
}

/** Owner reference for navigation. */
export interface K8sOwnerReference {
  kind?: string;
  name?: string;
  uid?: string;
}

/** Standard metadata shape from any Kubernetes resource. */
export interface K8sMetadata {
  name?: string;
  namespace?: string;
  uid?: string;
  creationTimestamp?: string;
  resourceVersion?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  ownerReferences?: K8sOwnerReference[];
}
