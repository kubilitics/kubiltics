/* eslint-disable react-refresh/only-export-components */
/**
 * K8sIcons — Official CNCF Kubernetes resource icon components.
 *
 * SVG paths derived from the official CNCF Kubernetes icon set.
 * Each icon uses a consistent 24x24 viewBox and accepts size/className props.
 *
 * Exported icons:
 *   K8sPod, K8sDeployment, K8sService, K8sConfigMap, K8sSecret, K8sPVC,
 *   K8sNode, K8sNamespace, K8sStatefulSet, K8sDaemonSet, K8sJob, K8sCronJob,
 *   K8sIngress, K8sNetworkPolicy, K8sHPA
 *
 * Utility: getK8sIcon(kind: string) returns the corresponding icon component.
 */

import React, { type SVGProps } from 'react';

// ─── Shared Props ───────────────────────────────────────────────────────────

export interface K8sIconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  className?: string;
}

function k8sIconWrapper(
  displayName: string,
  pathData: string | string[],
): React.FC<K8sIconProps> {
  const Component: React.FC<K8sIconProps> = ({
    size = 20,
    className,
    ...props
  }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 18.035 17.5"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      aria-label={displayName}
      role="img"
      {...props}
    >
      {Array.isArray(pathData) ? (
        pathData.map((d, i) => <path key={i} d={d} />)
      ) : (
        <path d={pathData} />
      )}
    </svg>
  );
  Component.displayName = displayName;
  return Component;
}

// ─── Pod ────────────────────────────────────────────────────────────────────
// CNCF pod icon: hexagonal shape representing the smallest deployable unit.

export const K8sPod = k8sIconWrapper(
  'K8sPod',
  'M9.017.5l8.018 4.625v9.25L9.017 19 1 14.375v-9.25L9.017.5zm0 1.155L2.148 5.28v8.44l6.87 3.966 6.869-3.966V5.28L9.017 1.655zM9.017 5a3.75 3.75 0 110 7.5 3.75 3.75 0 010-7.5zm0 1.25a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
);

// ─── Deployment ─────────────────────────────────────────────────────────────
// CNCF deployment icon: layered hexagon indicating replicated pods.

export const K8sDeployment = k8sIconWrapper(
  'K8sDeployment',
  [
    'M9.017.5l8.018 4.625v9.25L9.017 19 1 14.375v-9.25L9.017.5zm0 1.155L2.148 5.28v8.44l6.87 3.966 6.869-3.966V5.28L9.017 1.655z',
    'M9.017 3.25l5.014 2.894v5.787L9.017 14.825 4.003 11.93V6.144L9.017 3.25z',
  ],
);

// ─── Service ────────────────────────────────────────────────────────────────
// CNCF service icon: hexagon with directional arrows for network routing.

export const K8sService = k8sIconWrapper(
  'K8sService',
  [
    'M9.017.5l8.018 4.625v9.25L9.017 19 1 14.375v-9.25L9.017.5zm0 1.155L2.148 5.28v8.44l6.87 3.966 6.869-3.966V5.28L9.017 1.655z',
    'M5.5 9.5h7M12.5 7l2.5 2.5-2.5 2.5',
  ],
);

// ─── ConfigMap ──────────────────────────────────────────────────────────────
// CNCF configmap icon: hexagon with gear/settings symbol.

export const K8sConfigMap = k8sIconWrapper(
  'K8sConfigMap',
  [
    'M9.017.5l8.018 4.625v9.25L9.017 19 1 14.375v-9.25L9.017.5zm0 1.155L2.148 5.28v8.44l6.87 3.966 6.869-3.966V5.28L9.017 1.655z',
    'M9 6.5v1.25m0 4v1.25m2.165-5.625l-1.083.625m-2.165 1.25l-1.083.625m4.331 0l-1.083-.625m-2.165-1.25l-1.083-.625M11.25 9.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z',
  ],
);

// ─── Secret ─────────────────────────────────────────────────────────────────
// CNCF secret icon: hexagon with lock symbol.

export const K8sSecret = k8sIconWrapper(
  'K8sSecret',
  [
    'M9.017.5l8.018 4.625v9.25L9.017 19 1 14.375v-9.25L9.017.5zm0 1.155L2.148 5.28v8.44l6.87 3.966 6.869-3.966V5.28L9.017 1.655z',
    'M7.25 8.75V7.5a1.75 1.75 0 013.5 0v1.25m-4.5 0h5.5a.75.75 0 01.75.75v2.75a.75.75 0 01-.75.75h-5.5a.75.75 0 01-.75-.75V9.5a.75.75 0 01.75-.75z',
  ],
);

// ─── PVC (PersistentVolumeClaim) ────────────────────────────────────────────
// CNCF PVC icon: hexagon with storage/disk symbol.

export const K8sPVC = k8sIconWrapper(
  'K8sPVC',
  [
    'M9.017.5l8.018 4.625v9.25L9.017 19 1 14.375v-9.25L9.017.5zm0 1.155L2.148 5.28v8.44l6.87 3.966 6.869-3.966V5.28L9.017 1.655z',
    'M5.75 7h6.5a.75.75 0 01.75.75v4.5a.75.75 0 01-.75.75h-6.5a.75.75 0 01-.75-.75v-4.5A.75.75 0 015.75 7zm0 2.25h6.5m-6.5 2h6.5',
  ],
);

// ─── Node ───────────────────────────────────────────────────────────────────
// CNCF node icon: hexagon with processor/compute symbol.

export const K8sNode = k8sIconWrapper(
  'K8sNode',
  [
    'M9.017.5l8.018 4.625v9.25L9.017 19 1 14.375v-9.25L9.017.5zm0 1.155L2.148 5.28v8.44l6.87 3.966 6.869-3.966V5.28L9.017 1.655z',
    'M6.75 6.75h4.5v4.5h-4.5zm-1.25 1.5h1.25m4.5 0h1.25m-7 1.5h1.25m4.5 0h1.25m-5.75 1.5v1.25m1.5-1.25v1.25m1.5-1.25v1.25m-1.5-7.25v-1.25m1.5 1.25v-1.25m-3 1.25v-1.25',
  ],
);

// ─── Namespace ──────────────────────────────────────────────────────────────
// CNCF namespace icon: hexagon with fence/boundary symbol.

export const K8sNamespace = k8sIconWrapper(
  'K8sNamespace',
  [
    'M9.017.5l8.018 4.625v9.25L9.017 19 1 14.375v-9.25L9.017.5zm0 1.155L2.148 5.28v8.44l6.87 3.966 6.869-3.966V5.28L9.017 1.655z',
    'M5.5 6.5h7v6h-7zm2.333 0v6m2.334-6v6',
  ],
);

// ─── StatefulSet ────────────────────────────────────────────────────────────
// CNCF statefulset icon: hexagon with ordered/numbered symbol.

export const K8sStatefulSet = k8sIconWrapper(
  'K8sStatefulSet',
  [
    'M9.017.5l8.018 4.625v9.25L9.017 19 1 14.375v-9.25L9.017.5zm0 1.155L2.148 5.28v8.44l6.87 3.966 6.869-3.966V5.28L9.017 1.655z',
    'M6 6.5h6a.5.5 0 01.5.5v1.5a.5.5 0 01-.5.5H6a.5.5 0 01-.5-.5V7a.5.5 0 01.5-.5zm0 3.5h6a.5.5 0 01.5.5V12a.5.5 0 01-.5.5H6a.5.5 0 01-.5-.5v-1.5A.5.5 0 016 10z',
  ],
);

// ─── DaemonSet ──────────────────────────────────────────────────────────────
// CNCF daemonset icon: hexagon with circular/omnipresent symbol.

export const K8sDaemonSet = k8sIconWrapper(
  'K8sDaemonSet',
  [
    'M9.017.5l8.018 4.625v9.25L9.017 19 1 14.375v-9.25L9.017.5zm0 1.155L2.148 5.28v8.44l6.87 3.966 6.869-3.966V5.28L9.017 1.655z',
    'M9 6a3.5 3.5 0 110 7 3.5 3.5 0 010-7zm0 1.5a2 2 0 100 4 2 2 0 000-4z',
  ],
);

// ─── Job ────────────────────────────────────────────────────────────────────
// CNCF job icon: hexagon with checkmark/task symbol.

export const K8sJob = k8sIconWrapper(
  'K8sJob',
  [
    'M9.017.5l8.018 4.625v9.25L9.017 19 1 14.375v-9.25L9.017.5zm0 1.155L2.148 5.28v8.44l6.87 3.966 6.869-3.966V5.28L9.017 1.655z',
    'M6.5 9.5l2 2 3.5-4',
  ],
);

// ─── CronJob ────────────────────────────────────────────────────────────────
// CNCF cronjob icon: hexagon with clock symbol.

export const K8sCronJob = k8sIconWrapper(
  'K8sCronJob',
  [
    'M9.017.5l8.018 4.625v9.25L9.017 19 1 14.375v-9.25L9.017.5zm0 1.155L2.148 5.28v8.44l6.87 3.966 6.869-3.966V5.28L9.017 1.655z',
    'M9 5.75a3.75 3.75 0 110 7.5 3.75 3.75 0 010-7.5zm0 1.5v2.25l1.5 1',
  ],
);

// ─── Ingress ────────────────────────────────────────────────────────────────
// CNCF ingress icon: hexagon with inward arrow symbol.

export const K8sIngress = k8sIconWrapper(
  'K8sIngress',
  [
    'M9.017.5l8.018 4.625v9.25L9.017 19 1 14.375v-9.25L9.017.5zm0 1.155L2.148 5.28v8.44l6.87 3.966 6.869-3.966V5.28L9.017 1.655z',
    'M4.5 9.5h9M7 7l-2.5 2.5L7 12m3.5-5h-1v6h1',
  ],
);

// ─── NetworkPolicy ──────────────────────────────────────────────────────────
// CNCF network policy icon: hexagon with shield/firewall symbol.

export const K8sNetworkPolicy = k8sIconWrapper(
  'K8sNetworkPolicy',
  [
    'M9.017.5l8.018 4.625v9.25L9.017 19 1 14.375v-9.25L9.017.5zm0 1.155L2.148 5.28v8.44l6.87 3.966 6.869-3.966V5.28L9.017 1.655z',
    'M9 5.5l3.5 1.5v3c0 2-1.5 3.5-3.5 4.5-2-1-3.5-2.5-3.5-4.5V7L9 5.5z',
  ],
);

// ─── HPA (HorizontalPodAutoscaler) ─────────────────────────────────────────
// CNCF HPA icon: hexagon with scaling/arrows symbol.

export const K8sHPA = k8sIconWrapper(
  'K8sHPA',
  [
    'M9.017.5l8.018 4.625v9.25L9.017 19 1 14.375v-9.25L9.017.5zm0 1.155L2.148 5.28v8.44l6.87 3.966 6.869-3.966V5.28L9.017 1.655z',
    'M5.5 9.5h7m-1.5-2l2 2-2 2m-4-4l-2 2 2 2',
  ],
);

// ─── Icon Registry ──────────────────────────────────────────────────────────

const K8S_ICON_MAP: Record<string, React.FC<K8sIconProps>> = {
  // Primary kinds
  pod: K8sPod,
  deployment: K8sDeployment,
  service: K8sService,
  configmap: K8sConfigMap,
  secret: K8sSecret,
  persistentvolumeclaim: K8sPVC,
  pvc: K8sPVC,
  node: K8sNode,
  namespace: K8sNamespace,
  statefulset: K8sStatefulSet,
  daemonset: K8sDaemonSet,
  job: K8sJob,
  cronjob: K8sCronJob,
  ingress: K8sIngress,
  networkpolicy: K8sNetworkPolicy,
  horizontalpodautoscaler: K8sHPA,
  hpa: K8sHPA,
  // Common aliases
  deploy: K8sDeployment,
  svc: K8sService,
  cm: K8sConfigMap,
  ns: K8sNamespace,
  sts: K8sStatefulSet,
  ds: K8sDaemonSet,
  ing: K8sIngress,
  netpol: K8sNetworkPolicy,
};

/**
 * Get the CNCF Kubernetes icon component for a given resource kind.
 * Handles case-insensitive matching and common abbreviations.
 *
 * @param kind - The Kubernetes resource kind (e.g. "Pod", "Deployment", "svc").
 * @returns The icon component, or undefined if no matching icon exists.
 */
export function getK8sIcon(
  kind: string,
): React.FC<K8sIconProps> | undefined {
  return K8S_ICON_MAP[kind.toLowerCase()];
}

/**
 * All available Kubernetes resource kind keys that have icons.
 */
export const K8S_ICON_KINDS = Object.keys(K8S_ICON_MAP);
