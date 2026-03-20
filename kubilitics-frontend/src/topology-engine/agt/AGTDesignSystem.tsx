/**
 * AGT Design System — Unified visual language for Advanced Graph Topology
 */
import {
  Activity, Database, Network, Shield, Server, Layers, Cpu, Box,
  GitBranch, Globe, Key, Lock, Settings, HardDrive, Archive, Zap,
  GitMerge, FileCode, Share2, Waypoints, Filter, SlidersHorizontal,
  AlertCircle, LayoutGrid,
} from 'lucide-react';

// ─── Gradient Definitions ─────────────────────────────────────────────────

export type GradientDef = { from: string; to: string; text: string; glow: string };

export const GRADIENTS: Record<string, GradientDef> = {
  // Workloads — muted blue-indigo
  Deployment:  { from: '#5A8ED9', to: '#2F5CA8', text: '#fff', glow: 'rgba(90,142,217,0.22)' },
  StatefulSet: { from: '#6B72C4', to: '#424898', text: '#fff', glow: 'rgba(107,114,196,0.22)' },
  DaemonSet:   { from: '#7B5EC0', to: '#523D96', text: '#fff', glow: 'rgba(123,94,192,0.22)'  },
  ReplicaSet:  { from: '#6874C4', to: '#3E4898', text: '#fff', glow: 'rgba(104,116,196,0.2)'  },
  ReplicationController: { from: '#6B7280', to: '#3F4451', text: '#fff', glow: 'rgba(107,114,128,0.2)' },
  Pod:         { from: '#5A8ED9', to: '#2B5FAA', text: '#fff', glow: 'rgba(90,142,217,0.2)'   },
  Job:         { from: '#4E96C0', to: '#1E6A96', text: '#fff', glow: 'rgba(78,150,192,0.2)'   },
  CronJob:     { from: '#3D8FB8', to: '#1A5E80', text: '#fff', glow: 'rgba(61,143,184,0.2)'   },
  PodGroup:    { from: '#7EB8D8', to: '#2B6A94', text: '#fff', glow: 'rgba(126,184,216,0.2)'  },
  // Networking — muted teal
  Service:        { from: '#38A89C', to: '#1F7A70', text: '#fff', glow: 'rgba(56,168,156,0.22)'  },
  Ingress:        { from: '#2E9A94', to: '#1A6E6A', text: '#fff', glow: 'rgba(46,154,148,0.22)'  },
  NetworkPolicy:  { from: '#257A68', to: '#144D40', text: '#fff', glow: 'rgba(37,122,104,0.22)'  },
  Endpoints:      { from: '#40A882', to: '#1E7055', text: '#fff', glow: 'rgba(64,168,130,0.2)'   },
  EndpointSlice:  { from: '#4EB896', to: '#1E7860', text: '#fff', glow: 'rgba(78,184,150,0.2)'   },
  IngressClass:   { from: '#6EC8A8', to: '#2E8864', text: '#fff', glow: 'rgba(110,200,168,0.2)'  },
  HorizontalPodAutoscaler: { from: '#2E9A94', to: '#1A6E6A', text: '#fff', glow: 'rgba(46,154,148,0.2)' },
  PodDisruptionBudget: { from: '#B85252', to: '#8A3030', text: '#fff', glow: 'rgba(184,82,82,0.2)' },
  // Storage — muted cyan-amber
  PersistentVolumeClaim: { from: '#4A96C0', to: '#1E6A96', text: '#fff', glow: 'rgba(74,150,192,0.22)'  },
  PersistentVolume:      { from: '#3882B0', to: '#1A5C84', text: '#fff', glow: 'rgba(56,130,176,0.22)'  },
  StorageClass:          { from: '#3A9EB8', to: '#1A6E84', text: '#fff', glow: 'rgba(58,158,184,0.2)'   },
  VolumeAttachment:      { from: '#5AAEC4', to: '#1E7A94', text: '#fff', glow: 'rgba(90,174,196,0.2)'   },
  ConfigMap:             { from: '#C08E4E', to: '#8A6030', text: '#fff', glow: 'rgba(192,142,78,0.22)'  },
  Secret:                { from: '#B85252', to: '#8A3030', text: '#fff', glow: 'rgba(184,82,82,0.22)'   },
  // RBAC — muted violet
  ServiceAccount:     { from: '#9472C8', to: '#6A4898', text: '#fff', glow: 'rgba(148,114,200,0.22)'  },
  Role:               { from: '#A870C0', to: '#7A4898', text: '#fff', glow: 'rgba(168,112,192,0.2)'   },
  ClusterRole:        { from: '#A856BC', to: '#7A2890', text: '#fff', glow: 'rgba(168,86,188,0.22)'   },
  RoleBinding:        { from: '#B464C4', to: '#882898', text: '#fff', glow: 'rgba(180,100,196,0.2)'   },
  ClusterRoleBinding: { from: '#C086CC', to: '#9448A8', text: '#fff', glow: 'rgba(192,134,204,0.2)'   },
  // Infrastructure — muted amber-orange
  Node:      { from: '#C08E4E', to: '#8A6030', text: '#fff', glow: 'rgba(192,142,78,0.22)'  },
  Namespace: { from: '#C07840', to: '#8A5020', text: '#fff', glow: 'rgba(192,120,64,0.22)'  },
  LimitRange:     { from: '#8A8480', to: '#5A544E', text: '#fff', glow: 'rgba(138,132,128,0.2)' },
  ResourceQuota:  { from: '#7A7068', to: '#4A403C', text: '#fff', glow: 'rgba(122,112,104,0.2)' },
  PriorityClass:  { from: '#9A9690', to: '#6A6460', text: '#fff', glow: 'rgba(154,150,144,0.2)' },
  RuntimeClass:   { from: '#8A8EA0', to: '#5A6070', text: '#fff', glow: 'rgba(138,142,160,0.2)' },
  Lease:          { from: '#7A8498', to: '#4A5464', text: '#fff', glow: 'rgba(122,132,152,0.2)' },
  CSIDriver:      { from: '#2E9A94', to: '#1A6E6A', text: '#fff', glow: 'rgba(46,154,148,0.2)'  },
  CSINode:        { from: '#40A882', to: '#1E7055', text: '#fff', glow: 'rgba(64,168,130,0.2)'  },
  Container:      { from: '#5A8ED9', to: '#2B5FAA', text: '#fff', glow: 'rgba(90,142,217,0.18)' },
};

const FALLBACK_GRADIENT: GradientDef = { from: '#5A6878', to: '#323C48', text: '#fff', glow: 'rgba(90,104,120,0.2)' };

export function getGradient(kind: string): GradientDef {
  return GRADIENTS[kind] ?? FALLBACK_GRADIENT;
}

// ─── Kind → Icon Mapping ──────────────────────────────────────────────────

export const KIND_ICONS: Record<string, React.ElementType> = {
  Deployment: Layers, StatefulSet: Database, DaemonSet: Cpu, ReplicaSet: Share2,
  Pod: Box, Job: Zap, CronJob: Activity, PodGroup: GitMerge,
  Service: Globe, Ingress: Network, NetworkPolicy: Shield, Endpoints: Waypoints,
  EndpointSlice: Waypoints, IngressClass: GitBranch, HorizontalPodAutoscaler: SlidersHorizontal,
  PersistentVolumeClaim: Archive, PersistentVolume: HardDrive, StorageClass: Database,
  ConfigMap: FileCode, Secret: Key, VolumeAttachment: HardDrive,
  ServiceAccount: Lock, Role: Shield, ClusterRole: Shield, RoleBinding: Lock, ClusterRoleBinding: Lock,
  Node: Server, Namespace: LayoutGrid, LimitRange: Filter, ResourceQuota: Filter,
  Container: Box, CSIDriver: HardDrive, CSINode: Server, Lease: Activity,
  ReplicationController: Share2, PodDisruptionBudget: AlertCircle, PriorityClass: Zap,
  RuntimeClass: Settings,
};

export function KindIcon({ kind, size = 14, className = '' }: { kind: string; size?: number; className?: string }) {
  const Icon = KIND_ICONS[kind] ?? Box;
  return <Icon size={size} className={className} />;
}

// ─── Health ────────────────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

export function healthColor(h: HealthStatus | string | undefined): string {
  if (h === 'healthy') return '#4BA872';
  if (h === 'warning') return '#C4903A';
  if (h === 'critical') return '#B85252';
  return '#607080';
}

// ─── Resource Categories ──────────────────────────────────────────────────

export type ResourceCategory = 'workload' | 'networking' | 'storage' | 'rbac' | 'infra' | 'system';

export const KIND_CATEGORY: Record<string, ResourceCategory> = {
  Deployment: 'workload', StatefulSet: 'workload', DaemonSet: 'workload', ReplicaSet: 'workload',
  Pod: 'workload', Job: 'workload', CronJob: 'workload', PodGroup: 'workload', Container: 'workload',
  ReplicationController: 'workload', HorizontalPodAutoscaler: 'workload', PodDisruptionBudget: 'workload',
  Service: 'networking', Ingress: 'networking', NetworkPolicy: 'networking', Endpoints: 'networking',
  EndpointSlice: 'networking', IngressClass: 'networking',
  PersistentVolumeClaim: 'storage', PersistentVolume: 'storage', StorageClass: 'storage',
  VolumeAttachment: 'storage', ConfigMap: 'storage', Secret: 'storage',
  CSIDriver: 'storage', CSINode: 'storage',
  ServiceAccount: 'rbac', Role: 'rbac', ClusterRole: 'rbac', RoleBinding: 'rbac', ClusterRoleBinding: 'rbac',
  Node: 'infra', Namespace: 'infra', LimitRange: 'infra', ResourceQuota: 'infra',
  PriorityClass: 'system', RuntimeClass: 'system', Lease: 'system',
};

export function getCategory(kind: string): ResourceCategory {
  return KIND_CATEGORY[kind] ?? 'system';
}

export const CATEGORY_LABELS: Record<ResourceCategory, string> = {
  workload: 'Workloads', networking: 'Networking', storage: 'Storage',
  rbac: 'RBAC', infra: 'Infrastructure', system: 'System',
};

export const CATEGORY_ICONS: Record<ResourceCategory, React.ElementType> = {
  workload: Layers, networking: Globe, storage: Database,
  rbac: Shield, infra: Server, system: Settings,
};

export const ALL_CATEGORIES: ResourceCategory[] = ['workload', 'networking', 'storage', 'rbac', 'infra', 'system'];

export const CATEGORY_COLORS: Record<ResourceCategory, string> = {
  workload: '#5A8ED9', networking: '#38A89C', storage: '#4A96C0',
  rbac: '#9472C8', infra: '#C08E4E', system: '#728FA6',
};

// ─── Edge Colors ──────────────────────────────────────────────────────────

export const EDGE_COLORS: Record<string, string> = {
  owns: '#5A6E82', manages: '#5A6E82',
  selects: '#38A89C', exposes: '#38A89C',
  routes: '#5A8ED9',
  mounts: '#4A96C0', stores: '#4A96C0', backed_by: '#4A96C0',
  configures: '#C08E4E', references: '#C08E4E',
  permits: '#9472C8',
  scheduled_on: '#C07840', runs: '#C07840',
  contains: '#6A7888',
  limits: '#706860',
};

export function getEdgeColor(rel: string): string {
  return EDGE_COLORS[rel] ?? '#94A3B8';
}

// ─── Shared Styles ────────────────────────────────────────────────────────

export const glassBase: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid rgba(0,0,0,0.1)',
  overflow: 'hidden',
  cursor: 'pointer',
  transition: 'box-shadow 0.2s ease, transform 0.15s ease, opacity 0.2s ease',
  userSelect: 'none',
};

// ─── Node Type Picker ─────────────────────────────────────────────────────

export function pickNodeType(kind: string): string {
  const cat = getCategory(kind);
  if (kind === 'Pod') return 'pod';
  if (kind === 'Node' || kind === 'Namespace') return 'infra';
  if (cat === 'workload') return 'workload';
  if (cat === 'networking') return 'network';
  if (cat === 'storage') return 'storage';
  if (cat === 'rbac') return 'rbac';
  return 'generic';
}

export function pickEdgeType(rel: string): string {
  if (rel === 'owns' || rel === 'manages') return 'ownership';
  if (rel === 'selects' || rel === 'routes' || rel === 'exposes') return 'traffic';
  if (rel === 'mounts' || rel === 'stores' || rel === 'backed_by') return 'storage';
  if (rel === 'permits') return 'rbac';
  if (rel === 'configures' || rel === 'references') return 'config';
  return 'ownership';
}
