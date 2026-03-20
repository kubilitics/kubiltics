import type { TopologyGraph, TopologyNode, TopologyEdge } from '../types/topology.types';
import type { BlastRadiusResult } from '../types/interaction.types';

export interface BlastRadiusOptions {
  /** Maximum depth to traverse (default: 3) */
  maxDepth?: number;

  /** Consider upstream dependencies (default: false) */
  includeUpstream?: boolean;

  /** Consider downstream dependents (default: true) */
  includeDownstream?: boolean;

  /** Relationship types to follow (default: all) */
  relationshipTypes?: string[];

  /** Minimum confidence threshold (default: 0.5) */
  minConfidence?: number;

  /** Impact propagation factor (0-1, default: 0.7) */
  propagationFactor?: number;
}

/**
 * Compute Blast Radius for a Node
 *
 * Calculates the impact of a node failure or change by:
 * 1. Traversing downstream dependencies (BFS)
 * 2. Calculating severity scores based on:
 *    - Relationship criticality
 *    - Confidence scores
 *    - Distance from origin (impact decay)
 *    - Node type criticality
 * 3. Estimating user impact
 *
 * @param graph - Topology graph
 * @param nodeId - Starting node ID
 * @param options - Configuration options
 * @returns Blast radius result with affected nodes, edges, and severity scores
 */
export function computeBlastRadius(
  graph: TopologyGraph,
  nodeId: string,
  options: BlastRadiusOptions = {}
): BlastRadiusResult {
  const {
    maxDepth = 3,
    includeUpstream = false,
    includeDownstream = true,
    relationshipTypes,
    minConfidence = 0.5,
    propagationFactor = 0.7,
  } = options;

  const affectedNodes = new Set<string>();
  const affectedEdges = new Set<string>();
  const alternativePathEdges = new Set<string>();
  const severity = new Map<string, number>();

  // Starting node has 100% severity
  severity.set(nodeId, 100);

  // BFS traversal
  const queue: Array<{ nodeId: string; depth: number; impactScore: number }> = [
    { nodeId, depth: 0, impactScore: 100 },
  ];
  const visited = new Set<string>([nodeId]);

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.depth >= maxDepth) {
      continue;
    }

    // Find relevant edges
    const edges: TopologyEdge[] = [];

    if (includeDownstream) {
      const downstreamEdges = graph.edges.filter(e => e.source === current.nodeId);
      edges.push(...downstreamEdges);
    }

    if (includeUpstream) {
      const upstreamEdges = graph.edges.filter(e => e.target === current.nodeId);
      edges.push(...upstreamEdges);
    }

    // Process edges
    for (const edge of edges) {
      // Filter by relationship type
      if (relationshipTypes && !relationshipTypes.includes(edge.relationshipType)) {
        continue;
      }

      // Filter by confidence
      const confidence = edge.metadata?.confidence ?? 0.5;
      if (confidence < minConfidence) {
        continue;
      }

      // Determine target node
      const targetNodeId = edge.source === current.nodeId ? edge.target : edge.source;

      if (visited.has(targetNodeId)) {
        continue;
      }

      visited.add(targetNodeId);

      // Alternative paths: edges with same target and relationship type but different source (safe paths)
      const sameTargetSameType = graph.edges.filter(
        e => e.target === targetNodeId && e.relationshipType === edge.relationshipType
      );
      for (const alt of sameTargetSameType) {
        const key = `${alt.source}-${alt.target}`;
        if (alt.source !== current.nodeId && !affectedEdges.has(key)) {
          alternativePathEdges.add(key);
        }
      }

      // Calculate impact propagation
      const relationshipCriticality = getRelationshipCriticality(edge.relationshipType);
      const depthDecay = Math.pow(propagationFactor, current.depth + 1);
      const impactScore = current.impactScore * confidence * relationshipCriticality * depthDecay;

      // Get node criticality multiplier
      const targetNode = graph.nodes.find(n => n.id === targetNodeId);
      const nodeCriticality = targetNode ? getNodeCriticality(targetNode, graph) : 1.0;

      const finalSeverity = Math.min(100, impactScore * nodeCriticality);

      // Add to affected sets
      affectedNodes.add(targetNodeId);
      affectedEdges.add(`${edge.source}-${edge.target}`);
      severity.set(targetNodeId, finalSeverity);

      // Continue traversal
      queue.push({
        nodeId: targetNodeId,
        depth: current.depth + 1,
        impactScore: impactScore,
      });
    }
  }

  // Calculate total impact score
  const totalImpact = calculateTotalImpact(affectedNodes, severity, graph);

  // Estimate user impact
  const estimatedUsers = estimateUserImpact(affectedNodes, graph);

  // Generate mitigation suggestions
  const suggestions = generateMitigationSuggestions(nodeId, affectedNodes, graph);

  return {
    affectedNodes,
    affectedEdges,
    severity,
    totalImpact,
    estimatedUsers,
    suggestions,
    alternativePathEdges,
  };
}

/**
 * Relationship confidence (PRD Section 10.2 / Task 7.1)
 * Impact propagates as impact * confidence; higher = more impact propagation
 */
const RELATIONSHIP_CONFIDENCE: Record<string, number> = {
  owns: 1.0,
  selects: 0.9,
  routes: 0.85,
  references: 0.7,
  mounts: 0.6,
  scheduled_on: 0.9,
  routes_to: 0.85,
  backed_by: 0.75,
  configures: 0.6,
  contains: 0.5,
  stores: 0.5,
  permits: 0.5,
  limits: 0.5,
  manages: 0.5,
  exposes: 0.8,
  runs: 0.85,
};

/**
 * Get relationship criticality score (0-1)
 * Uses RELATIONSHIP_CONFIDENCE when defined, else edge metadata confidence
 */
function getRelationshipCriticality(relationshipType: string): number {
  return RELATIONSHIP_CONFIDENCE[relationshipType] ?? 0.5;
}

/**
 * Get node criticality multiplier based on node type and downstream impact
 */
function getNodeCriticality(node: TopologyNode, graph: TopologyGraph): number {
  let criticalityMultiplier = 1.0;

  // Node type criticality
  const typeCriticality: Record<string, number> = {
    'Service': 1.5, // Services are user-facing
    'Ingress': 1.8, // Ingress impacts all traffic
    'Deployment': 1.3,
    'StatefulSet': 1.4, // StatefulSets are harder to recover
    'DaemonSet': 1.3,
    'Pod': 1.0,
    'ConfigMap': 1.1,
    'Secret': 1.2, // Secrets affect authentication
    'PersistentVolume': 1.3, // Data loss is critical
    'Node': 2.0, // Node failure affects everything on it
  };

  criticalityMultiplier *= typeCriticality[node.kind] ?? 1.0;

  // Downstream dependency count (more dependents = more critical)
  const downstreamCount = graph.edges.filter(e => e.source === node.id).length;
  if (downstreamCount > 10) criticalityMultiplier *= 1.5;
  else if (downstreamCount > 5) criticalityMultiplier *= 1.3;
  else if (downstreamCount > 2) criticalityMultiplier *= 1.1;

  // Single point of failure detection
  const isSPOF = detectSPOF(node.id, graph);
  if (isSPOF) criticalityMultiplier *= 2.0;

  return Math.min(2.0, criticalityMultiplier);
}

/**
 * Detect if node is a single point of failure
 */
function detectSPOF(nodeId: string, graph: TopologyGraph): boolean {
  const downstreamEdges = graph.edges.filter(e => e.source === nodeId);

  if (downstreamEdges.length < 3) return false;

  // Check if dependents have alternatives
  for (const edge of downstreamEdges) {
    const alternatives = graph.edges.filter(
      e => e.target === edge.target && e.source !== nodeId && e.relationshipType === edge.relationshipType
    );

    if (alternatives.length > 0) {
      return false; // Has alternative
    }
  }

  return true; // No alternatives
}

/**
 * Calculate total impact score (0-100)
 */
function calculateTotalImpact(
  affectedNodes: Set<string>,
  severity: Map<string, number>,
  graph: TopologyGraph
): number {
  if (affectedNodes.size === 0) return 0;

  // Weighted average of severity scores
  const totalSeverity = Array.from(affectedNodes).reduce((sum, nodeId) => {
    return sum + (severity.get(nodeId) ?? 0);
  }, 0);

  const avgSeverity = totalSeverity / affectedNodes.size;

  // Factor in proportion of graph affected
  const graphImpact = (affectedNodes.size / graph.nodes.length) * 100;

  // Combine: 70% severity, 30% graph coverage
  return Math.min(100, avgSeverity * 0.7 + graphImpact * 0.3);
}

/**
 * Estimate number of users impacted
 *
 * This is a simplified heuristic - real implementation should integrate with
 * user analytics or service mesh data
 */
function estimateUserImpact(affectedNodes: Set<string>, graph: TopologyGraph): number {
  let estimatedUsers = 0;

  affectedNodes.forEach(nodeId => {
    const node = graph.nodes.find(n => n.id === nodeId);

    if (!node) return;

    // Services and Ingresses typically serve users
    if (node.kind === 'Service') {
      const rps = node.computed?.requestsPerSecond ?? 0;
      // Estimate: 1 RPS ≈ 60 unique users per minute
      estimatedUsers += rps * 60;
    }

    if (node.kind === 'Ingress') {
      const rps = node.computed?.requestsPerSecond ?? 0;
      estimatedUsers += rps * 100; // Ingress has higher user multiplier
    }
  });

  return Math.round(estimatedUsers);
}

/**
 * Generate mitigation suggestions based on blast radius analysis
 */
function generateMitigationSuggestions(
  originNodeId: string,
  affectedNodes: Set<string>,
  graph: TopologyGraph
): string[] {
  const suggestions: string[] = [];

  const originNode = graph.nodes.find(n => n.id === originNodeId);
  if (!originNode) return suggestions;

  // Suggestion 1: Replica count
  if (originNode.kind === 'Deployment' || originNode.kind === 'StatefulSet') {
    const replicas = originNode.data?.spec?.replicas ?? 1;
    if (replicas < 3) {
      suggestions.push(`Increase replica count to at least 3 for high availability`);
    }
  }

  // Suggestion 2: Pod Disruption Budget
  if (originNode.kind === 'Deployment' || originNode.kind === 'StatefulSet') {
    suggestions.push(`Add PodDisruptionBudget to prevent simultaneous pod terminations`);
  }

  // Suggestion 3: Multi-zone deployment
  if (affectedNodes.size > 10) {
    suggestions.push(`Deploy across multiple availability zones for fault tolerance`);
  }

  // Suggestion 4: Circuit breaker
  if (originNode.kind === 'Service') {
    suggestions.push(`Implement circuit breaker pattern to prevent cascading failures`);
  }

  // Suggestion 5: Backup strategy
  if (originNode.kind === 'PersistentVolume' || originNode.kind === 'StatefulSet') {
    suggestions.push(`Ensure automated backup and recovery procedures are in place`);
  }

  // Suggestion 6: Health checks
  if (originNode.kind === 'Pod' || originNode.kind === 'Deployment') {
    const hasLiveness = originNode.data?.spec?.containers?.[0]?.livenessProbe;
    const hasReadiness = originNode.data?.spec?.containers?.[0]?.readinessProbe;

    if (!hasLiveness) {
      suggestions.push(`Add liveness probes to detect and restart unhealthy containers`);
    }
    if (!hasReadiness) {
      suggestions.push(`Add readiness probes to prevent traffic to unready pods`);
    }
  }

  // Suggestion 7: Alternative routing
  if (affectedNodes.size > 5) {
    suggestions.push(`Consider adding alternative routing paths to reduce single points of failure`);
  }

  return suggestions;
}

/**
 * Get blast radius summary statistics
 */
export function getBlastRadiusSummary(result: BlastRadiusResult): string {
  const { affectedNodes, totalImpact, estimatedUsers } = result;

  if (affectedNodes.size === 0) {
    return 'No downstream impact detected';
  }

  const impactLevel =
    totalImpact > 80 ? 'Critical' :
    totalImpact > 50 ? 'High' :
    totalImpact > 20 ? 'Moderate' : 'Low';

  const userImpact = estimatedUsers ? `, affecting ~${estimatedUsers.toLocaleString()} users` : '';

  return `${impactLevel} impact: ${affectedNodes.size} resources affected${userImpact}`;
}
