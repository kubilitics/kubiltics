/**
 * Topology Data Adapter
 * Transforms backend API TopologyGraph format to frontend TopologyGraph format.
 * Handles field mapping, normalization, and missing required fields.
 */

import type {
  TopologyGraph,
  TopologyNode,
  TopologyEdge,
  ResourceStatus,
  HealthStatus,
  RelationshipType,
  KubernetesKind,
} from '../types/topology.types';

/* ── Backend shapes (matches Go JSON tags) ─────────────────────── */

interface BackendTopologyNode {
  id: string;
  kind: string;
  namespace: string;
  name: string;
  apiVersion?: string;
  status?: string;
  metadata: {
    labels: Record<string, string>;
    annotations: Record<string, string>;
    createdAt: string;
    uid: string;
  };
  computed: {
    health: string;
    restartCount?: number;
    replicas?: { desired: number; ready: number; available: number };
  };
  position?: { x: number; y: number };
}

interface BackendTopologyEdge {
  id: string;
  source: string;
  target: string;
  relationshipType: string;
  label: string;
  metadata: {
    derivation: string;
    confidence: number;
    sourceField: string;
  };
}

/* ── Relationship type mapping ─────────────────────────────────── */

const RELATIONSHIP_TYPE_MAP: Record<string, RelationshipType> = {
  // Capitalised labels from backend
  Manages: 'manages',
  Selects: 'selects',
  'Runs on': 'scheduled_on',
  Creates: 'owns',
  Scales: 'manages',
  Targets: 'references',
  'Backed by': 'backed_by',
  Exposes: 'exposes',
  Uses: 'references',
  TLS: 'references',
  'Used by': 'references',
  Restricts: 'limits',
  Protects: 'permits',
  'Bound to': 'backed_by',
  'Attached to': 'references',
  Attaches: 'references',
  Owns: 'owns',
  Routes: 'routes',
  References: 'references',
  Configures: 'configures',
  Mounts: 'mounts',
  Stores: 'stores',
  Permits: 'permits',
  Limits: 'limits',
  Contains: 'contains',
  // Lowercase / snake_case variations
  manages: 'manages',
  selects: 'selects',
  scheduled_on: 'scheduled_on',
  'runs on': 'scheduled_on',
  creates: 'owns',
  scales: 'manages',
  targets: 'references',
  'backed by': 'backed_by',
  backed_by: 'backed_by',
  exposes: 'exposes',
  uses: 'references',
  tls: 'references',
  'used by': 'references',
  restricts: 'limits',
  protects: 'permits',
  'bound to': 'backed_by',
  'attached to': 'references',
  attaches: 'references',
  owns: 'owns',
  routes: 'routes',
  references: 'references',
  configures: 'configures',
  mounts: 'mounts',
  stores: 'stores',
  permits: 'permits',
  limits: 'limits',
  contains: 'contains',
};

function normalizeRelationshipType(backendType: string): RelationshipType {
  const mapped = RELATIONSHIP_TYPE_MAP[backendType];
  if (mapped) return mapped;
  const lower = backendType.toLowerCase().replace(/\s+/g, '_');
  if (lower in RELATIONSHIP_TYPE_MAP) return RELATIONSHIP_TYPE_MAP[lower];
  console.warn(`[topologyAdapter] Unknown relationship type: "${backendType}", defaulting to "references"`);
  return 'references';
}

/* ── Field normalizers ─────────────────────────────────────────── */

function normalizeStatus(status?: string): ResourceStatus {
  if (!status) return 'Unknown';
  const s = status.toLowerCase();
  if (['running', 'active', 'ready', 'bound'].includes(s)) return 'Running';
  if (s === 'pending') return 'Pending';
  if (s === 'failed' || s === 'error') return 'Failed';
  if (s === 'succeeded') return 'Succeeded';
  if (s === 'terminating') return 'Terminating';
  if (s === 'notready') return 'NotReady';
  if (s === 'available') return 'Available';
  if (s === 'released') return 'Released';
  return status as ResourceStatus;
}

function normalizeHealth(health?: string): HealthStatus {
  if (!health) return 'unknown';
  const h = health.toLowerCase();
  if (h === 'healthy') return 'healthy';
  if (h === 'warning') return 'warning';
  if (h === 'critical') return 'critical';
  return 'unknown';
}

/* ── Per-element transformers ──────────────────────────────────── */

function transformNode(n: BackendTopologyNode): TopologyNode {
  return {
    id: n.id,
    kind: n.kind as KubernetesKind,
    namespace: n.namespace || '',
    name: n.name,
    apiVersion: n.apiVersion || 'v1',
    status: normalizeStatus(n.status),
    label: n.name,
    metadata: {
      labels: n.metadata?.labels || {},
      annotations: n.metadata?.annotations || {},
      createdAt: n.metadata?.createdAt || '',
      uid: n.metadata?.uid || '',
    },
    computed: {
      health: normalizeHealth(n.computed?.health),
      restartCount: n.computed?.restartCount,
      replicas: n.computed?.replicas,
    },
  };
}

function transformEdge(e: BackendTopologyEdge): TopologyEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    relationshipType: normalizeRelationshipType(e.relationshipType || e.label),
    label: e.label || e.relationshipType || '',
    metadata: {
      derivation: e.metadata?.derivation || '',
      confidence: e.metadata?.confidence ?? 1.0,
      sourceField: e.metadata?.sourceField || '',
    },
  };
}

/* ── Main adapter ──────────────────────────────────────────────── */

/**
 * Transforms backend TopologyGraph to the frontend TopologyGraph format.
 * This is the main adapter used by the API client layer.
 */
interface BackendGraphMetadata {
  clusterId?: string;
  cluster_id?: string;
  generatedAt?: string;
  generated_at?: string;
  layoutSeed?: string;
  layout_seed?: string;
  isComplete?: boolean;
  is_complete?: boolean;
  warnings?: Array<{
    code?: string;
    message?: string;
    affectedNodes?: string[];
    affected_nodes?: string[];
  }>;
}

interface BackendGraph {
  nodes?: BackendTopologyNode[];
  Nodes?: BackendTopologyNode[];
  edges?: BackendTopologyEdge[];
  Edges?: BackendTopologyEdge[];
  metadata?: BackendGraphMetadata;
  Metadata?: BackendGraphMetadata;
  schemaVersion?: string;
  schema_version?: string;
}

export function adaptTopologyGraph(backendGraph: unknown): TopologyGraph {
  if (!backendGraph || typeof backendGraph !== 'object') {
    throw new Error('Backend graph is null or undefined');
  }

  const graph = backendGraph as BackendGraph;
  const nodes: BackendTopologyNode[] = graph.nodes || graph.Nodes || [];
  const edges: BackendTopologyEdge[] = graph.edges || graph.Edges || [];
  const metadata = graph.metadata || graph.Metadata || {};

  return {
    schemaVersion: graph.schemaVersion || graph.schema_version || '1.0',
    nodes: nodes.map(transformNode),
    edges: edges.map(transformEdge),
    metadata: {
      clusterId: metadata.clusterId || metadata.cluster_id || '',
      generatedAt: metadata.generatedAt || metadata.generated_at || new Date().toISOString(),
      layoutSeed: metadata.layoutSeed || metadata.layout_seed || '',
      isComplete: metadata.isComplete ?? metadata.is_complete ?? true,
      warnings: (metadata.warnings || []).map((w) => ({
        code: w.code || '',
        message: w.message || '',
        affectedNodes: w.affectedNodes || w.affected_nodes || [],
      })),
    },
  };
}

/**
 * Validates that a transformed graph has the expected structure.
 */
export function validateTopologyGraph(graph: TopologyGraph): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!graph.schemaVersion) errors.push('Missing schemaVersion');

  if (!Array.isArray(graph.nodes)) {
    errors.push('Nodes must be an array');
  } else {
    graph.nodes.forEach((node, i) => {
      if (!node.id) errors.push(`Node ${i} missing id`);
      if (!node.kind) errors.push(`Node ${i} missing kind`);
      if (!node.name) errors.push(`Node ${i} missing name`);
      if (!node.label) errors.push(`Node ${i} missing label`);
      if (!node.apiVersion) errors.push(`Node ${i} missing apiVersion`);
    });
  }

  if (!Array.isArray(graph.edges)) {
    errors.push('Edges must be an array');
  } else {
    graph.edges.forEach((edge, i) => {
      if (!edge.id) errors.push(`Edge ${i} missing id`);
      if (!edge.source) errors.push(`Edge ${i} missing source`);
      if (!edge.target) errors.push(`Edge ${i} missing target`);
      if (!edge.relationshipType) errors.push(`Edge ${i} missing relationshipType`);
    });
  }

  return { valid: errors.length === 0, errors };
}
