/**
 * Resource kind configuration definitions for the ResourceListFactory and
 * ResourceDetailFactory.
 *
 * Each config describes a Kubernetes resource kind: its API group, plural name,
 * table columns, available actions, detail tabs, and whether it is namespaced.
 * New resource kinds can be added by extending RESOURCE_CONFIGS.
 *
 * TASK-SCALE-002
 */

import type { LucideIcon } from 'lucide-react';
import {
  Box, Boxes, Container, Database, FileText, Globe, HardDrive, Key, Layers,
  LayoutDashboard, Lock, Network, Route, Scale, Server, Settings, Shield,
  ShieldCheck, Timer, Workflow,
} from 'lucide-react';

// ── Column Definition ──────────────────────────────────────────────────────────

export interface ResourceColumnDef {
  /** Unique column identifier */
  id: string;
  /** Display header label */
  header: string;
  /** Dot-path into the resource object (e.g. 'metadata.name', 'status.phase') */
  accessorPath: string;
  /** Whether the column is sortable */
  sortable?: boolean;
  /** Whether the column is filterable */
  filterable?: boolean;
  /** Whether the column is visible by default */
  defaultVisible?: boolean;
  /** Minimum width in pixels */
  minWidth?: number;
  /** Default width in pixels */
  defaultWidth?: number;
  /** Custom cell renderer key (maps to a renderer in the factory) */
  cellRenderer?: 'status' | 'age' | 'badge' | 'namespace' | 'labels' | 'link' | 'count' | 'bytes' | 'cpu' | 'memory' | 'image' | 'raw';
}

// ── Action Definition ──────────────────────────────────────────────────────────

export type ActionKind = 'delete' | 'scale' | 'restart' | 'edit' | 'logs' | 'exec' | 'cordon' | 'drain' | 'uncordon' | 'describe' | 'export' | 'rollback';

export interface ResourceActionDef {
  /** Action identifier */
  kind: ActionKind;
  /** Display label */
  label: string;
  /** Lucide icon */
  icon: LucideIcon;
  /** Whether this is a destructive action (requires confirmation) */
  destructive?: boolean;
  /** Whether this action requires the resource to be in a specific state */
  enabledWhen?: (resource: Record<string, unknown>) => boolean;
  /** Bulk-action support */
  supportsBulk?: boolean;
}

// ── Tab Definition ─────────────────────────────────────────────────────────────

export interface ResourceTabDef {
  /** Tab identifier */
  id: string;
  /** Display label */
  label: string;
  /** Lucide icon */
  icon: LucideIcon;
  /** Component key to render (maps to factory renderer) */
  component: 'yaml' | 'events' | 'conditions' | 'pods' | 'logs' | 'metrics' | 'topology' | 'rules' | 'endpoints' | 'volumes' | 'env' | 'annotations' | 'labels' | 'status';
}

// ── Resource Kind Config ───────────────────────────────────────────────────────

export interface ResourceKindConfig {
  /** Kubernetes Kind (e.g. 'Deployment') */
  kind: string;
  /** Plural resource name for API (e.g. 'deployments') */
  plural: string;
  /** API group path (e.g. '/apis/apps/v1') */
  apiGroup: string;
  /** Short display name */
  displayName: string;
  /** Plural display name */
  displayNamePlural: string;
  /** Lucide icon for the resource */
  icon: LucideIcon;
  /** Whether the resource is namespaced */
  namespaced: boolean;
  /** Table columns */
  columns: ResourceColumnDef[];
  /** Available row actions */
  actions: ResourceActionDef[];
  /** Detail page tabs */
  tabs: ResourceTabDef[];
  /** Route path for list page (e.g. '/deployments') */
  listRoute: string;
  /** Route path for detail page (e.g. '/deployments/:namespace/:name') */
  detailRoute: string;
  /** Default sort column id */
  defaultSortColumn?: string;
  /** Default sort direction */
  defaultSortDirection?: 'asc' | 'desc';
  /** Category for grouping in navigation */
  category: 'workloads' | 'networking' | 'storage' | 'config' | 'rbac' | 'cluster' | 'batch' | 'policy' | 'gateway';
}

// ── Shared Column Templates ────────────────────────────────────────────────────

const COL_NAME: ResourceColumnDef = {
  id: 'name', header: 'Name', accessorPath: 'metadata.name',
  sortable: true, filterable: true, defaultVisible: true, minWidth: 160, defaultWidth: 240,
  cellRenderer: 'link',
};
const COL_NAMESPACE: ResourceColumnDef = {
  id: 'namespace', header: 'Namespace', accessorPath: 'metadata.namespace',
  sortable: true, filterable: true, defaultVisible: true, minWidth: 100, defaultWidth: 140,
  cellRenderer: 'namespace',
};
const COL_AGE: ResourceColumnDef = {
  id: 'age', header: 'Age', accessorPath: 'metadata.creationTimestamp',
  sortable: true, defaultVisible: true, minWidth: 80, defaultWidth: 100,
  cellRenderer: 'age',
};
const COL_LABELS: ResourceColumnDef = {
  id: 'labels', header: 'Labels', accessorPath: 'metadata.labels',
  filterable: true, defaultVisible: false, minWidth: 120, defaultWidth: 200,
  cellRenderer: 'labels',
};

// ── Shared Action Templates ────────────────────────────────────────────────────

const ACTION_DELETE: ResourceActionDef = {
  kind: 'delete', label: 'Delete', icon: Lock, destructive: true, supportsBulk: true,
};
const ACTION_EDIT: ResourceActionDef = {
  kind: 'edit', label: 'Edit YAML', icon: FileText,
};
const ACTION_DESCRIBE: ResourceActionDef = {
  kind: 'describe', label: 'Describe', icon: FileText,
};
const ACTION_EXPORT: ResourceActionDef = {
  kind: 'export', label: 'Export YAML', icon: FileText,
};

// ── Shared Tab Templates ───────────────────────────────────────────────────────

const TAB_YAML: ResourceTabDef = { id: 'yaml', label: 'YAML', icon: FileText, component: 'yaml' };
const TAB_EVENTS: ResourceTabDef = { id: 'events', label: 'Events', icon: Timer, component: 'events' };
const TAB_CONDITIONS: ResourceTabDef = { id: 'conditions', label: 'Conditions', icon: ShieldCheck, component: 'conditions' };
const TAB_LABELS: ResourceTabDef = { id: 'labels', label: 'Labels & Annotations', icon: FileText, component: 'labels' };

// ── Resource Configs ───────────────────────────────────────────────────────────

export const RESOURCE_CONFIGS: Record<string, ResourceKindConfig> = {
  // ─── Workloads ─────────────────────────────────────────────────────────────

  deployments: {
    kind: 'Deployment', plural: 'deployments', apiGroup: '/apis/apps/v1',
    displayName: 'Deployment', displayNamePlural: 'Deployments', icon: Boxes,
    namespaced: true, category: 'workloads',
    listRoute: '/deployments', detailRoute: '/deployments/:namespace/:name',
    defaultSortColumn: 'name', defaultSortDirection: 'asc',
    columns: [
      COL_NAME, COL_NAMESPACE,
      { id: 'ready', header: 'Ready', accessorPath: 'status.readyReplicas', sortable: true, defaultVisible: true, minWidth: 70, defaultWidth: 80, cellRenderer: 'count' },
      { id: 'upToDate', header: 'Up-to-date', accessorPath: 'status.updatedReplicas', sortable: true, defaultVisible: true, minWidth: 80, defaultWidth: 100, cellRenderer: 'count' },
      { id: 'available', header: 'Available', accessorPath: 'status.availableReplicas', sortable: true, defaultVisible: true, minWidth: 80, defaultWidth: 100, cellRenderer: 'count' },
      { id: 'strategy', header: 'Strategy', accessorPath: 'spec.strategy.type', filterable: true, defaultVisible: true, minWidth: 100, defaultWidth: 120 },
      COL_AGE, COL_LABELS,
    ],
    actions: [
      { kind: 'scale', label: 'Scale', icon: Scale, supportsBulk: false },
      { kind: 'restart', label: 'Restart', icon: Workflow, destructive: false },
      { kind: 'rollback', label: 'Rollback', icon: Timer, destructive: true },
      ACTION_EDIT, ACTION_EXPORT, ACTION_DELETE,
    ],
    tabs: [
      { id: 'pods', label: 'Pods', icon: Box, component: 'pods' },
      TAB_CONDITIONS, TAB_EVENTS, TAB_YAML, TAB_LABELS,
      { id: 'metrics', label: 'Metrics', icon: Scale, component: 'metrics' },
    ],
  },

  statefulsets: {
    kind: 'StatefulSet', plural: 'statefulsets', apiGroup: '/apis/apps/v1',
    displayName: 'StatefulSet', displayNamePlural: 'StatefulSets', icon: Database,
    namespaced: true, category: 'workloads',
    listRoute: '/statefulsets', detailRoute: '/statefulsets/:namespace/:name',
    defaultSortColumn: 'name',
    columns: [
      COL_NAME, COL_NAMESPACE,
      { id: 'ready', header: 'Ready', accessorPath: 'status.readyReplicas', sortable: true, defaultVisible: true, minWidth: 70, defaultWidth: 80, cellRenderer: 'count' },
      { id: 'replicas', header: 'Replicas', accessorPath: 'spec.replicas', sortable: true, defaultVisible: true, minWidth: 80, defaultWidth: 90, cellRenderer: 'count' },
      COL_AGE, COL_LABELS,
    ],
    actions: [
      { kind: 'scale', label: 'Scale', icon: Scale },
      { kind: 'restart', label: 'Restart', icon: Workflow },
      ACTION_EDIT, ACTION_EXPORT, ACTION_DELETE,
    ],
    tabs: [
      { id: 'pods', label: 'Pods', icon: Box, component: 'pods' },
      { id: 'volumes', label: 'Volumes', icon: HardDrive, component: 'volumes' },
      TAB_CONDITIONS, TAB_EVENTS, TAB_YAML, TAB_LABELS,
    ],
  },

  daemonsets: {
    kind: 'DaemonSet', plural: 'daemonsets', apiGroup: '/apis/apps/v1',
    displayName: 'DaemonSet', displayNamePlural: 'DaemonSets', icon: Layers,
    namespaced: true, category: 'workloads',
    listRoute: '/daemonsets', detailRoute: '/daemonsets/:namespace/:name',
    defaultSortColumn: 'name',
    columns: [
      COL_NAME, COL_NAMESPACE,
      { id: 'desired', header: 'Desired', accessorPath: 'status.desiredNumberScheduled', sortable: true, defaultVisible: true, minWidth: 70, defaultWidth: 80, cellRenderer: 'count' },
      { id: 'current', header: 'Current', accessorPath: 'status.currentNumberScheduled', sortable: true, defaultVisible: true, minWidth: 70, defaultWidth: 80, cellRenderer: 'count' },
      { id: 'ready', header: 'Ready', accessorPath: 'status.numberReady', sortable: true, defaultVisible: true, minWidth: 70, defaultWidth: 80, cellRenderer: 'count' },
      COL_AGE, COL_LABELS,
    ],
    actions: [
      { kind: 'restart', label: 'Restart', icon: Workflow },
      ACTION_EDIT, ACTION_EXPORT, ACTION_DELETE,
    ],
    tabs: [
      { id: 'pods', label: 'Pods', icon: Box, component: 'pods' },
      TAB_CONDITIONS, TAB_EVENTS, TAB_YAML, TAB_LABELS,
    ],
  },

  pods: {
    kind: 'Pod', plural: 'pods', apiGroup: '/api/v1',
    displayName: 'Pod', displayNamePlural: 'Pods', icon: Box,
    namespaced: true, category: 'workloads',
    listRoute: '/pods', detailRoute: '/pods/:namespace/:name',
    defaultSortColumn: 'name',
    columns: [
      COL_NAME, COL_NAMESPACE,
      { id: 'status', header: 'Status', accessorPath: 'status.phase', sortable: true, filterable: true, defaultVisible: true, minWidth: 80, defaultWidth: 100, cellRenderer: 'status' },
      { id: 'restarts', header: 'Restarts', accessorPath: 'status.containerStatuses', sortable: true, defaultVisible: true, minWidth: 80, defaultWidth: 90, cellRenderer: 'count' },
      { id: 'node', header: 'Node', accessorPath: 'spec.nodeName', sortable: true, filterable: true, defaultVisible: true, minWidth: 120, defaultWidth: 160 },
      { id: 'ip', header: 'IP', accessorPath: 'status.podIP', sortable: false, defaultVisible: true, minWidth: 100, defaultWidth: 130 },
      COL_AGE, COL_LABELS,
    ],
    actions: [
      { kind: 'logs', label: 'Logs', icon: FileText },
      { kind: 'exec', label: 'Exec', icon: Container },
      ACTION_DESCRIBE, ACTION_EXPORT, ACTION_DELETE,
    ],
    tabs: [
      { id: 'logs', label: 'Logs', icon: FileText, component: 'logs' },
      { id: 'env', label: 'Environment', icon: Settings, component: 'env' },
      { id: 'volumes', label: 'Volumes', icon: HardDrive, component: 'volumes' },
      TAB_CONDITIONS, TAB_EVENTS, TAB_YAML, TAB_LABELS,
    ],
  },

  // ─── Batch ─────────────────────────────────────────────────────────────────

  jobs: {
    kind: 'Job', plural: 'jobs', apiGroup: '/apis/batch/v1',
    displayName: 'Job', displayNamePlural: 'Jobs', icon: Workflow,
    namespaced: true, category: 'batch',
    listRoute: '/jobs', detailRoute: '/jobs/:namespace/:name',
    defaultSortColumn: 'name',
    columns: [
      COL_NAME, COL_NAMESPACE,
      { id: 'completions', header: 'Completions', accessorPath: 'status.succeeded', sortable: true, defaultVisible: true, minWidth: 90, defaultWidth: 110, cellRenderer: 'count' },
      { id: 'status', header: 'Status', accessorPath: 'status.conditions', sortable: false, defaultVisible: true, minWidth: 80, defaultWidth: 100, cellRenderer: 'status' },
      COL_AGE, COL_LABELS,
    ],
    actions: [ACTION_DESCRIBE, ACTION_EXPORT, ACTION_DELETE],
    tabs: [
      { id: 'pods', label: 'Pods', icon: Box, component: 'pods' },
      TAB_CONDITIONS, TAB_EVENTS, TAB_YAML, TAB_LABELS,
    ],
  },

  cronjobs: {
    kind: 'CronJob', plural: 'cronjobs', apiGroup: '/apis/batch/v1',
    displayName: 'CronJob', displayNamePlural: 'CronJobs', icon: Timer,
    namespaced: true, category: 'batch',
    listRoute: '/cronjobs', detailRoute: '/cronjobs/:namespace/:name',
    defaultSortColumn: 'name',
    columns: [
      COL_NAME, COL_NAMESPACE,
      { id: 'schedule', header: 'Schedule', accessorPath: 'spec.schedule', sortable: true, defaultVisible: true, minWidth: 100, defaultWidth: 140 },
      { id: 'suspend', header: 'Suspend', accessorPath: 'spec.suspend', sortable: true, filterable: true, defaultVisible: true, minWidth: 70, defaultWidth: 90 },
      { id: 'active', header: 'Active', accessorPath: 'status.active', sortable: true, defaultVisible: true, minWidth: 60, defaultWidth: 80, cellRenderer: 'count' },
      { id: 'lastSchedule', header: 'Last Schedule', accessorPath: 'status.lastScheduleTime', sortable: true, defaultVisible: true, minWidth: 100, defaultWidth: 140, cellRenderer: 'age' },
      COL_AGE, COL_LABELS,
    ],
    actions: [ACTION_EDIT, ACTION_EXPORT, ACTION_DELETE],
    tabs: [TAB_EVENTS, TAB_YAML, TAB_LABELS],
  },

  // ─── Networking ────────────────────────────────────────────────────────────

  services: {
    kind: 'Service', plural: 'services', apiGroup: '/api/v1',
    displayName: 'Service', displayNamePlural: 'Services', icon: Globe,
    namespaced: true, category: 'networking',
    listRoute: '/services', detailRoute: '/services/:namespace/:name',
    defaultSortColumn: 'name',
    columns: [
      COL_NAME, COL_NAMESPACE,
      { id: 'type', header: 'Type', accessorPath: 'spec.type', sortable: true, filterable: true, defaultVisible: true, minWidth: 90, defaultWidth: 110 },
      { id: 'clusterIP', header: 'Cluster IP', accessorPath: 'spec.clusterIP', sortable: false, defaultVisible: true, minWidth: 100, defaultWidth: 130 },
      { id: 'ports', header: 'Ports', accessorPath: 'spec.ports', sortable: false, defaultVisible: true, minWidth: 120, defaultWidth: 200 },
      COL_AGE, COL_LABELS,
    ],
    actions: [ACTION_EDIT, ACTION_EXPORT, ACTION_DELETE],
    tabs: [
      { id: 'endpoints', label: 'Endpoints', icon: Network, component: 'endpoints' },
      TAB_EVENTS, TAB_YAML, TAB_LABELS,
    ],
  },

  ingresses: {
    kind: 'Ingress', plural: 'ingresses', apiGroup: '/apis/networking.k8s.io/v1',
    displayName: 'Ingress', displayNamePlural: 'Ingresses', icon: Route,
    namespaced: true, category: 'networking',
    listRoute: '/ingresses', detailRoute: '/ingresses/:namespace/:name',
    defaultSortColumn: 'name',
    columns: [
      COL_NAME, COL_NAMESPACE,
      { id: 'class', header: 'Class', accessorPath: 'spec.ingressClassName', sortable: true, filterable: true, defaultVisible: true, minWidth: 100, defaultWidth: 130 },
      { id: 'hosts', header: 'Hosts', accessorPath: 'spec.rules', sortable: false, defaultVisible: true, minWidth: 120, defaultWidth: 200 },
      { id: 'address', header: 'Address', accessorPath: 'status.loadBalancer.ingress', sortable: false, defaultVisible: true, minWidth: 100, defaultWidth: 140 },
      COL_AGE, COL_LABELS,
    ],
    actions: [ACTION_EDIT, ACTION_EXPORT, ACTION_DELETE],
    tabs: [TAB_EVENTS, TAB_YAML, TAB_LABELS],
  },

  networkpolicies: {
    kind: 'NetworkPolicy', plural: 'networkpolicies', apiGroup: '/apis/networking.k8s.io/v1',
    displayName: 'Network Policy', displayNamePlural: 'Network Policies', icon: Shield,
    namespaced: true, category: 'networking',
    listRoute: '/networkpolicies', detailRoute: '/networkpolicies/:namespace/:name',
    defaultSortColumn: 'name',
    columns: [
      COL_NAME, COL_NAMESPACE,
      { id: 'policyTypes', header: 'Policy Types', accessorPath: 'spec.policyTypes', sortable: false, filterable: true, defaultVisible: true, minWidth: 100, defaultWidth: 140 },
      COL_AGE, COL_LABELS,
    ],
    actions: [ACTION_EDIT, ACTION_EXPORT, ACTION_DELETE],
    tabs: [{ id: 'rules', label: 'Rules', icon: Shield, component: 'rules' }, TAB_YAML, TAB_LABELS],
  },

  // ─── Config ────────────────────────────────────────────────────────────────

  configmaps: {
    kind: 'ConfigMap', plural: 'configmaps', apiGroup: '/api/v1',
    displayName: 'ConfigMap', displayNamePlural: 'ConfigMaps', icon: Settings,
    namespaced: true, category: 'config',
    listRoute: '/configmaps', detailRoute: '/configmaps/:namespace/:name',
    defaultSortColumn: 'name',
    columns: [
      COL_NAME, COL_NAMESPACE,
      { id: 'dataCount', header: 'Data', accessorPath: 'data', sortable: true, defaultVisible: true, minWidth: 60, defaultWidth: 80, cellRenderer: 'count' },
      COL_AGE, COL_LABELS,
    ],
    actions: [ACTION_EDIT, ACTION_EXPORT, ACTION_DELETE],
    tabs: [TAB_YAML, TAB_LABELS],
  },

  secrets: {
    kind: 'Secret', plural: 'secrets', apiGroup: '/api/v1',
    displayName: 'Secret', displayNamePlural: 'Secrets', icon: Key,
    namespaced: true, category: 'config',
    listRoute: '/secrets', detailRoute: '/secrets/:namespace/:name',
    defaultSortColumn: 'name',
    columns: [
      COL_NAME, COL_NAMESPACE,
      { id: 'type', header: 'Type', accessorPath: 'type', sortable: true, filterable: true, defaultVisible: true, minWidth: 140, defaultWidth: 200 },
      { id: 'dataCount', header: 'Data', accessorPath: 'data', sortable: true, defaultVisible: true, minWidth: 60, defaultWidth: 80, cellRenderer: 'count' },
      COL_AGE, COL_LABELS,
    ],
    actions: [ACTION_EXPORT, ACTION_DELETE],
    tabs: [TAB_YAML, TAB_LABELS],
  },

  // ─── Storage ───────────────────────────────────────────────────────────────

  persistentvolumeclaims: {
    kind: 'PersistentVolumeClaim', plural: 'persistentvolumeclaims', apiGroup: '/api/v1',
    displayName: 'PVC', displayNamePlural: 'Persistent Volume Claims', icon: HardDrive,
    namespaced: true, category: 'storage',
    listRoute: '/persistentvolumeclaims', detailRoute: '/persistentvolumeclaims/:namespace/:name',
    defaultSortColumn: 'name',
    columns: [
      COL_NAME, COL_NAMESPACE,
      { id: 'status', header: 'Status', accessorPath: 'status.phase', sortable: true, filterable: true, defaultVisible: true, minWidth: 80, defaultWidth: 100, cellRenderer: 'status' },
      { id: 'volume', header: 'Volume', accessorPath: 'spec.volumeName', sortable: true, defaultVisible: true, minWidth: 120, defaultWidth: 180 },
      { id: 'capacity', header: 'Capacity', accessorPath: 'status.capacity.storage', sortable: true, defaultVisible: true, minWidth: 80, defaultWidth: 100, cellRenderer: 'bytes' },
      { id: 'storageClass', header: 'Storage Class', accessorPath: 'spec.storageClassName', sortable: true, filterable: true, defaultVisible: true, minWidth: 100, defaultWidth: 140 },
      { id: 'accessModes', header: 'Access Modes', accessorPath: 'spec.accessModes', sortable: false, defaultVisible: true, minWidth: 100, defaultWidth: 130 },
      COL_AGE, COL_LABELS,
    ],
    actions: [ACTION_EDIT, ACTION_EXPORT, ACTION_DELETE],
    tabs: [TAB_CONDITIONS, TAB_EVENTS, TAB_YAML, TAB_LABELS],
  },

  // ─── RBAC ──────────────────────────────────────────────────────────────────

  clusterroles: {
    kind: 'ClusterRole', plural: 'clusterroles', apiGroup: '/apis/rbac.authorization.k8s.io/v1',
    displayName: 'Cluster Role', displayNamePlural: 'Cluster Roles', icon: ShieldCheck,
    namespaced: false, category: 'rbac',
    listRoute: '/clusterroles', detailRoute: '/clusterroles/:name',
    defaultSortColumn: 'name',
    columns: [
      COL_NAME,
      { id: 'ruleCount', header: 'Rules', accessorPath: 'rules', sortable: true, defaultVisible: true, minWidth: 60, defaultWidth: 80, cellRenderer: 'count' },
      COL_AGE, COL_LABELS,
    ],
    actions: [ACTION_DESCRIBE, ACTION_EXPORT, ACTION_DELETE],
    tabs: [{ id: 'rules', label: 'Rules', icon: Shield, component: 'rules' }, TAB_YAML, TAB_LABELS],
  },

  // ─── Cluster ───────────────────────────────────────────────────────────────

  nodes: {
    kind: 'Node', plural: 'nodes', apiGroup: '/api/v1',
    displayName: 'Node', displayNamePlural: 'Nodes', icon: Server,
    namespaced: false, category: 'cluster',
    listRoute: '/nodes', detailRoute: '/nodes/:name',
    defaultSortColumn: 'name',
    columns: [
      COL_NAME,
      { id: 'status', header: 'Status', accessorPath: 'status.conditions', sortable: true, filterable: true, defaultVisible: true, minWidth: 80, defaultWidth: 100, cellRenderer: 'status' },
      { id: 'roles', header: 'Roles', accessorPath: 'metadata.labels', sortable: false, defaultVisible: true, minWidth: 100, defaultWidth: 140 },
      { id: 'version', header: 'Version', accessorPath: 'status.nodeInfo.kubeletVersion', sortable: true, defaultVisible: true, minWidth: 90, defaultWidth: 120 },
      { id: 'os', header: 'OS', accessorPath: 'status.nodeInfo.osImage', sortable: true, defaultVisible: false, minWidth: 100, defaultWidth: 160 },
      COL_AGE, COL_LABELS,
    ],
    actions: [
      { kind: 'cordon', label: 'Cordon', icon: Lock, destructive: true },
      { kind: 'uncordon', label: 'Uncordon', icon: ShieldCheck },
      { kind: 'drain', label: 'Drain', icon: Lock, destructive: true },
      ACTION_DESCRIBE, ACTION_EXPORT,
    ],
    tabs: [
      { id: 'pods', label: 'Pods', icon: Box, component: 'pods' },
      { id: 'metrics', label: 'Metrics', icon: Scale, component: 'metrics' },
      TAB_CONDITIONS, TAB_EVENTS, TAB_YAML, TAB_LABELS,
    ],
  },

  namespaces: {
    kind: 'Namespace', plural: 'namespaces', apiGroup: '/api/v1',
    displayName: 'Namespace', displayNamePlural: 'Namespaces', icon: LayoutDashboard,
    namespaced: false, category: 'cluster',
    listRoute: '/namespaces', detailRoute: '/namespaces/:name',
    defaultSortColumn: 'name',
    columns: [
      COL_NAME,
      { id: 'status', header: 'Status', accessorPath: 'status.phase', sortable: true, filterable: true, defaultVisible: true, minWidth: 80, defaultWidth: 100, cellRenderer: 'status' },
      COL_AGE, COL_LABELS,
    ],
    actions: [ACTION_DESCRIBE, ACTION_EXPORT, ACTION_DELETE],
    tabs: [TAB_EVENTS, TAB_YAML, TAB_LABELS],
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Get config for a resource kind by plural name */
export function getResourceConfig(plural: string): ResourceKindConfig | undefined {
  return RESOURCE_CONFIGS[plural];
}

/** Get all configs in a category */
export function getResourceConfigsByCategory(category: ResourceKindConfig['category']): ResourceKindConfig[] {
  return Object.values(RESOURCE_CONFIGS).filter((c) => c.category === category);
}

/** Get all resource config entries as an array */
export function getAllResourceConfigs(): ResourceKindConfig[] {
  return Object.values(RESOURCE_CONFIGS);
}

/** Resolve a dot-path on an object (e.g. 'status.phase' -> resource.status.phase) */
export function resolveAccessorPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
