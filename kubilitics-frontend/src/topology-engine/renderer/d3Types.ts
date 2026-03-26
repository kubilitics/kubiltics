/**
 * Legacy D3 topology types — retained for adapter compatibility.
 * These were originally defined in the now-deleted D3TopologyCanvas.tsx.
 */

export type ResourceType =
  | 'cluster'
  | 'pod'
  | 'deployment'
  | 'replicaset'
  | 'service'
  | 'node'
  | 'namespace'
  | 'configmap'
  | 'secret'
  | 'ingress'
  | 'statefulset'
  | 'daemonset'
  | 'job'
  | 'cronjob'
  | 'pv'
  | 'pvc'
  | 'hpa'
  | 'vpa'
  | 'pdb'
  | 'networkpolicy'
  | 'serviceaccount'
  | 'role'
  | 'clusterrole'
  | 'rolebinding'
  | 'clusterrolebinding'
  | 'endpoint'
  | 'endpointslice'
  | 'ingressclass'
  | 'storageclass'
  | 'user'
  | 'group';

export interface TopologyNode {
  id: string;
  type: ResourceType;
  name: string;
  namespace?: string;
  status?: 'healthy' | 'warning' | 'error' | 'pending';
  isCurrent?: boolean;
  traffic?: number;
}

export interface TopologyEdge {
  from: string;
  to: string;
  label?: string;
  traffic?: number;
}
