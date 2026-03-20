/**
 * Node Helpers – Utility functions for topology nodes
 */
import type { TopologyNode } from '../types/topology.types';
import { getNodeDataAttributes, getHealthColor, NODE_COLORS } from '../renderer/styles';

/**
 * Build Cytoscape element data from a TopologyNode.
 *
 * Label strategy (world-class UX):
 * - The node shape is a clean, coloured icon (no text inside).
 * - A two-line label is rendered BELOW the node:
 *     Line 1: Kind name   (e.g. "Deployment")
 *     Line 2: Resource name (e.g. "nginx-deployment")
 * - The label is dark text on the light canvas for maximum contrast.
 */
export function toCytoscapeNodeData(node: TopologyNode) {
  const attrs = getNodeDataAttributes(node.kind);
  const isCompound = node.kind === 'Namespace';

  // Pods use health-based colors
  let bgColor = attrs.bgColor;
  let borderColor = attrs.borderColor;
  let glowColor = attrs.glowColor;
  if (node.kind === 'Pod') {
    const hc = getHealthColor(node.computed?.health);
    bgColor = hc.bg;
    borderColor = hc.border;
    glowColor = hc.glow;
  }

  return {
    data: {
      id: node.id,
      // Two-line composite label shown below the node
      label: node.kind + '\n' + node.name,
      displayLabel: node.label || node.name,
      iconLabel: attrs.iconLabel, // Full kind name (kept for getNodeDataAttributes consumers)
      kind: node.kind,
      namespace: node.namespace,
      name: node.name,
      status: node.status,
      health: node.computed?.health,
      bgColor,
      borderColor,
      glowColor,
      textColor: attrs.textColor,
      nodeWidth: attrs.nodeWidth,
      nodeHeight: attrs.nodeHeight,
      nodeShape: attrs.nodeShape,
      replicaCount: node.replicaCount,
      _nodeData: node,
    },
    classes: isCompound ? 'compound' : undefined,
  };
}

/**
 * Display-friendly labels for each Kubernetes kind (full names, no abbreviations).
 */
export const KIND_LABELS: Record<string, string> = {
  Pod: 'Pod',
  Deployment: 'Deployment',
  ReplicaSet: 'ReplicaSet',
  Service: 'Service',
  Node: 'Node',
  Namespace: 'Namespace',
  ConfigMap: 'ConfigMap',
  Secret: 'Secret',
  Ingress: 'Ingress',
  StatefulSet: 'StatefulSet',
  DaemonSet: 'DaemonSet',
  Job: 'Job',
  CronJob: 'CronJob',
  PersistentVolume: 'PersistentVolume',
  PersistentVolumeClaim: 'PersistentVolumeClaim',
  StorageClass: 'StorageClass',
  PodGroup: 'PodGroup',
  HorizontalPodAutoscaler: 'HorizontalPodAutoscaler',
  ServiceAccount: 'ServiceAccount',
  Role: 'Role',
  ClusterRole: 'ClusterRole',
  RoleBinding: 'RoleBinding',
  ClusterRoleBinding: 'ClusterRoleBinding',
  NetworkPolicy: 'NetworkPolicy',
  Container: 'Container',
  Endpoints: 'Endpoints',
  EndpointSlice: 'EndpointSlice',
  ResourceQuota: 'ResourceQuota',
  LimitRange: 'LimitRange',
};

/**
 * Get color for a kind (e.g. for filter pills).
 */
export function getKindColor(kind: string): string {
  return NODE_COLORS[kind]?.bg || '#6b7280';
}
