// V2 topology API types (match backend TopologyResponse)

export type ViewMode =
  | "namespace"
  | "cluster"
  | "rbac"
  | "traffic"
  | "resource";  // Used by ResourceTopologyV2View (per-resource detail tab), not shown in main topology tab bar

export interface TopologyMetadata {
  clusterId: string;
  clusterName: string;
  mode: ViewMode;
  namespace?: string;
  focusResource?: string;
  resourceCount: number;
  edgeCount: number;
  buildTimeMs: number;
  cachedAt?: string;
}

export interface NodeMetrics {
  cpuUsage?: number;
  cpuRequest?: number;
  cpuLimit?: number;
  memoryUsage?: number;
  memoryRequest?: number;
  memoryLimit?: number;
  restartCount?: number;
  podCount?: number;
  readyCount?: number;
}

export interface NodeCost {
  monthlyCostUSD: number;
  dailyCostUSD: number;
}

export interface TopologyNode {
  id: string;
  kind: string;
  name: string;
  namespace: string;
  apiVersion: string;
  category: string;
  label: string;
  status: string;
  statusReason?: string;
  metrics?: NodeMetrics;
  cost?: NodeCost;
  layer: number;
  group?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  createdAt?: string;
  // Debugging fields — resource-specific
  podIP?: string;
  nodeName?: string;
  internalIP?: string;
  externalIP?: string;
  clusterIP?: string;
  serviceType?: string;
  containers?: number;
  criticality?: {
    score: number;
    level: 'critical' | 'high' | 'medium' | 'low';
    pageRank: number;
    fanIn: number;
    fanOut: number;
    blastRadius: number;
    dependencyDepth: number;
    isSPOF: boolean;
    confidence: string;
  };
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  relationshipType: string;
  relationshipCategory: string;
  label: string;
  detail?: string;
  style: string;
  animated?: boolean;
  healthy: boolean;
  healthReason?: string;
}

export interface GroupStyle {
  backgroundColor: string;
  borderColor: string;
}

export interface TopologyGroup {
  id: string;
  label: string;
  type: string;
  members: string[];
  collapsed: boolean;
  style: GroupStyle;
}

export interface TopologyResponse {
  metadata: TopologyMetadata;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  groups: TopologyGroup[];
}
