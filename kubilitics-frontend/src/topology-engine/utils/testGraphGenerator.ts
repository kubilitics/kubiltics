/**
 * Task 9.1–9.3: Test graph generator for performance testing
 * Generates TopologyGraph with N nodes and ~2N edges for FPS/memory/load tests.
 */
import type {
  TopologyGraph,
  TopologyNode,
  TopologyEdge,
  KubernetesKind,
  RelationshipType,
} from '../types/topology.types';

const KINDS: KubernetesKind[] = [
  'Pod',
  'Deployment',
  'ReplicaSet',
  'Service',
  'ConfigMap',
  'Secret',
  'Namespace',
  'Node',
  'Ingress',
  'PersistentVolumeClaim',
];

const RELATIONSHIPS: RelationshipType[] = [
  'owns',
  'selects',
  'routes',
  'references',
  'mounts',
  'scheduled_on',
];

const STATUSES = ['Running', 'Pending', 'Ready', 'Bound'] as const;

function defaultNode(id: string, kind: KubernetesKind, i: number): TopologyNode {
  const namespace = `ns-${i % 5}`;
  const name = `resource-${i}`;
  return {
    id,
    kind,
    namespace: kind === 'Node' || kind === 'Namespace' ? '' : namespace,
    name,
    apiVersion: 'v1',
    status: STATUSES[i % STATUSES.length],
    label: name,
    metadata: {
      labels: {},
      annotations: {},
      createdAt: '2024-01-01T00:00:00Z',
      uid: `uid-${i}`,
    },
    computed: {
      health: i % 4 === 0 ? 'warning' : i % 4 === 1 ? 'critical' : 'healthy',
      restartCount: i % 10,
      cpuUsage: (i % 100) as number,
      memoryUsage: ((i * 2) % 100) as number,
      replicas: kind === 'Deployment' || kind === 'ReplicaSet' ? { desired: 3, ready: 2, available: 2 } : undefined,
    },
  };
}

function defaultEdge(id: string, source: string, target: string, rel: RelationshipType): TopologyEdge {
  return {
    id,
    source,
    target,
    relationshipType: rel,
    label: rel,
    metadata: {
      derivation: 'test',
      confidence: 0.9,
      sourceField: 'test',
    },
  };
}

/**
 * Generate a test topology graph for performance testing.
 * Task 9.1: 100 nodes, 200 edges
 * Task 9.2: 1,000 nodes, 2,000 edges
 * Task 9.3: 10,000 nodes, 20,000 edges
 *
 * @param nodeCount - Number of nodes to generate
 * @param edgeMultiplier - Edges per node (default 2, so total edges ≈ nodeCount * 2)
 */
export function generateTestGraph(
  nodeCount: number,
  edgeMultiplier: number = 2
): TopologyGraph {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];
  const edgeCountTarget = nodeCount * edgeMultiplier;

  for (let i = 0; i < nodeCount; i++) {
    const kind = KINDS[i % KINDS.length];
    const id = `${kind}/ns-${i % 5}/resource-${i}`;
    nodes.push(defaultNode(id, kind, i));
  }

  let edgeId = 0;
  const seen = new Set<string>();

  while (edges.length < edgeCountTarget && edgeId < edgeCountTarget * 2) {
    const src = nodes[Math.floor(Math.random() * nodeCount)];
    const tgt = nodes[Math.floor(Math.random() * nodeCount)];
    if (src.id === tgt.id) continue;
    const key = `${src.id}-${tgt.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rel = RELATIONSHIPS[edgeId % RELATIONSHIPS.length];
    edges.push(defaultEdge(`edge-${edgeId}`, src.id, tgt.id, rel));
    edgeId++;
  }

  return {
    schemaVersion: '1.0',
    nodes,
    edges,
    metadata: {
      clusterId: 'perf-test',
      generatedAt: new Date().toISOString(),
      layoutSeed: `seed-${nodeCount}`,
      isComplete: true,
      warnings: [],
    },
  };
}
