/**
 * Wraps official K8s community SVG icons as React components
 * matching the lucide-react icon API (className with h-X w-X).
 * Use these in the sidebar instead of generic lucide icons.
 */
import k8sIconMap from '@/topology/icons/k8sIconMap';

function makeK8sIcon(kind: string) {
  const url = k8sIconMap[kind];
  if (!url) return null;

  const Component = ({ className }: { className?: string }) => (
    <img src={url} alt="" aria-hidden="true" draggable={false} className={className} />
  );
  Component.displayName = `K8s${kind.charAt(0).toUpperCase() + kind.slice(1)}Icon`;
  return Component;
}

// Workloads
export const K8sPodIcon = makeK8sIcon('pod')!;
export const K8sDeploymentIcon = makeK8sIcon('deployment')!;
export const K8sReplicaSetIcon = makeK8sIcon('replicaset')!;
export const K8sStatefulSetIcon = makeK8sIcon('statefulset')!;
export const K8sDaemonSetIcon = makeK8sIcon('daemonset')!;
export const K8sJobIcon = makeK8sIcon('job')!;
export const K8sCronJobIcon = makeK8sIcon('cronjob')!;

// Networking
export const K8sServiceIcon = makeK8sIcon('service')!;
export const K8sIngressIcon = makeK8sIcon('ingress')!;
export const K8sEndpointsIcon = makeK8sIcon('endpoints')!;
export const K8sNetworkPolicyIcon = makeK8sIcon('networkpolicy')!;

// Storage & Config
export const K8sConfigMapIcon = makeK8sIcon('configmap')!;
export const K8sSecretIcon = makeK8sIcon('secret')!;
export const K8sPVIcon = makeK8sIcon('persistentvolume')!;
export const K8sPVCIcon = makeK8sIcon('persistentvolumeclaim')!;
export const K8sStorageClassIcon = makeK8sIcon('storageclass')!;

// Cluster
export const K8sNodeIcon = makeK8sIcon('node')!;
export const K8sNamespaceIcon = makeK8sIcon('namespace')!;

// Security
export const K8sServiceAccountIcon = makeK8sIcon('serviceaccount')!;
export const K8sRoleIcon = makeK8sIcon('role')!;
export const K8sClusterRoleIcon = makeK8sIcon('clusterrole')!;
export const K8sRoleBindingIcon = makeK8sIcon('rolebinding')!;
export const K8sClusterRoleBindingIcon = makeK8sIcon('clusterrolebinding')!;

// Scaling
export const K8sHPAIcon = makeK8sIcon('horizontalpodautoscaler')!;
export const K8sLimitRangeIcon = makeK8sIcon('limitrange')!;
