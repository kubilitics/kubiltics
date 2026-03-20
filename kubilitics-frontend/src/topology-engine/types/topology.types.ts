/**
 * Topology Engine – Type Definitions
 * Complete type system for the Kubilitics topology engine
 * Matches Go backend graph output format
 */

// ─── Resource Kinds ───────────────────────────────────────────

export type KubernetesKind =
  | 'Namespace' | 'Ingress' | 'Service'
  | 'Deployment' | 'StatefulSet' | 'DaemonSet'
  | 'ReplicaSet' | 'Pod' | 'PodGroup' | 'Container'
  | 'ConfigMap' | 'Secret'
  | 'PersistentVolumeClaim' | 'PersistentVolume' | 'StorageClass'
  | 'Node' | 'Job' | 'CronJob'
  | 'ServiceAccount' | 'Role' | 'ClusterRole'
  | 'RoleBinding' | 'ClusterRoleBinding'
  | 'NetworkPolicy' | 'ResourceQuota' | 'LimitRange'
  | 'HorizontalPodAutoscaler'
  | 'Endpoints' | 'EndpointSlice';

export type ResourceStatus =
  | 'Running' | 'Pending' | 'Failed' | 'Succeeded'
  | 'Terminating' | 'Unknown' | 'Ready' | 'NotReady'
  | 'Available' | 'Bound' | 'Released';

export type HealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

// ─── Abstraction Levels ───────────────────────────────────────

export type AbstractionLevel = 'L0' | 'L1' | 'L2' | 'L3';

export interface AbstractionLevelConfig {
  label: string;
  description: string;
  hiddenKinds: Set<KubernetesKind>;
}

export const ABSTRACTION_LEVELS: Record<AbstractionLevel, AbstractionLevelConfig> = {
  L0: {
    label: 'Executive',
    description: 'High-level architecture overview',
    hiddenKinds: new Set(['Pod', 'PodGroup', 'ReplicaSet', 'ConfigMap', 'Secret', 'PersistentVolumeClaim', 'PersistentVolume', 'Container', 'Endpoints', 'EndpointSlice']),
  },
  L1: {
    label: 'Namespace',
    description: 'Namespace-grouped with PodGroup aggregation',
    hiddenKinds: new Set(['Pod', 'ReplicaSet', 'Container', 'Endpoints', 'EndpointSlice']),
  },
  L2: {
    label: 'Workload',
    description: 'Full workload chain, collapsible ReplicaSets',
    hiddenKinds: new Set(['Container']),
  },
  L3: {
    label: 'Infrastructure',
    description: 'Full infrastructure with PVC/PV chain',
    hiddenKinds: new Set<KubernetesKind>(),
  },
};

// ─── Edge / Relationship Types ────────────────────────────────

export type RelationshipType =
  | 'exposes' | 'selects' | 'owns' | 'runs'
  | 'mounts' | 'scheduled_on' | 'schedules' | 'references' | 'backed_by'
  | 'routes' | 'configures' | 'contains' | 'stores'
  | 'permits' | 'limits' | 'manages';

// ─── Graph Node ───────────────────────────────────────────────

export interface TopologyNode {
  id: string;
  kind: KubernetesKind;
  namespace: string;
  name: string;
  apiVersion: string;
  status: ResourceStatus;
  label: string;
  parentId?: string;
  replicaCount?: number;
  metadata: {
    labels: Record<string, string>;
    annotations: Record<string, string>;
    createdAt: string;
    uid: string;
  };
  computed: {
    health: HealthStatus;
    restartCount?: number;
    cpuUsage?: number;
    memoryUsage?: number;
    replicas?: {
      desired: number;
      ready: number;
      available: number;
    };
  };
  traffic?: number;
}

// ─── Graph Edge ───────────────────────────────────────────────

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  relationshipType: RelationshipType;
  label: string;
  metadata: {
    derivation: string;
    confidence: number;
    sourceField: string;
  };
  traffic?: number;
}

// ─── Graph Warning ────────────────────────────────────────────

export interface GraphWarning {
  code: string;
  message: string;
  affectedNodes: string[];
}

// ─── Complete Graph ───────────────────────────────────────────

export interface TopologyGraph {
  schemaVersion: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  metadata: {
    clusterId: string;
    generatedAt: string;
    layoutSeed: string;
    isComplete: boolean;
    warnings: GraphWarning[];
  };
}

// ─── Filter / View Types ──────────────────────────────────────

export interface TopologyFilters {
  namespaces?: string[];
  kinds?: KubernetesKind[];
  healthStatuses?: HealthStatus[];
  labels?: Record<string, string>;
  searchQuery?: string;
}

export type ExportFormat = 'svg' | 'png' | 'pdf' | 'json' | 'csv';

export type HeatMapMode = 'none' | 'cpu' | 'restarts';

export interface TopologyViewState {
  zoom: number;
  pan: { x: number; y: number };
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  isPaused: boolean;
  showLabels: boolean;
  showNamespaces: boolean;
  abstractionLevel: AbstractionLevel;
  heatMapMode: HeatMapMode;
  filters: TopologyFilters;
}

// ─── Highlight State ──────────────────────────────────────────

export type HighlightState = 'idle' | 'hovering' | 'selected' | 'path-tracing';

export interface HighlightContext {
  state: HighlightState;
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
  fadedNodeIds: Set<string>;
  fadedEdgeIds: Set<string>;
}

// ─── Export Options ───────────────────────────────────────────

export interface ExportOptions {
  format: ExportFormat;
  abstractionLevel?: AbstractionLevel;
  posterMode?: boolean;
  spacingMultiplier?: number;
  fontSizeMultiplier?: number;
  includeMetadata?: boolean;
  backgroundColor?: string;
  dpi?: number;
}

// ─── Canvas Ref ───────────────────────────────────────────────

export interface TopologyCanvasRef {
  zoomIn: () => void;
  zoomOut: () => void;
  fitToScreen: () => void;
  resetView: () => void;
  exportAsSVG: () => string | undefined;
  exportAsPNG: () => string | undefined;
  exportAsPDF?: (filename?: string) => void;
  relayout: () => void;
  getNodeCount: () => number;
  getEdgeCount: () => number;
}
