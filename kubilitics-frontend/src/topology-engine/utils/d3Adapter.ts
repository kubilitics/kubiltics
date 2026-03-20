/**
 * Adapter to convert TopologyGraph (from topology-engine) to D3.js component format
 */
import type { TopologyGraph, TopologyNode as EngineNode, TopologyEdge as EngineEdge } from '../types/topology.types';
import type { TopologyNode as D3Node, TopologyEdge as D3Edge, ResourceType } from '../renderer/D3TopologyCanvas';
import { RELATIONSHIP_CONFIG } from './edgeHelpers';

/**
 * Map KubernetesKind to D3.js ResourceType
 */
function mapKindToResourceType(kind: string): ResourceType {
  const kindLower = kind.toLowerCase();
  
  // Direct mappings
  const mapping: Record<string, ResourceType> = {
    'pod': 'pod',
    'deployment': 'deployment',
    'replicaset': 'replicaset',
    'service': 'service',
    'node': 'node',
    'namespace': 'namespace',
    'configmap': 'configmap',
    'secret': 'secret',
    'ingress': 'ingress',
    'statefulset': 'statefulset',
    'daemonset': 'daemonset',
    'job': 'job',
    'cronjob': 'cronjob',
    'persistentvolume': 'pv',
    'persistentvolumeclaim': 'pvc',
    'horizontalpodautoscaler': 'hpa',
    'verticalpodautoscaler': 'vpa',
    'poddisruptionbudget': 'pdb',
    'networkpolicy': 'networkpolicy',
    'serviceaccount': 'serviceaccount',
    'role': 'role',
    'clusterrole': 'clusterrole',
    'rolebinding': 'rolebinding',
    'clusterrolebinding': 'clusterrolebinding',
    'endpoints': 'endpoint',
    'endpointslice': 'endpointslice',
    'ingressclass': 'ingressclass',
    'storageclass': 'storageclass',
  };
  
  return mapping[kindLower] || 'pod'; // Default to pod if unknown
}

/**
 * Map HealthStatus to D3.js status format
 */
function mapHealthToStatus(health: string): 'healthy' | 'warning' | 'error' | 'pending' {
  switch (health) {
    case 'healthy':
      return 'healthy';
    case 'warning':
      return 'warning';
    case 'critical':
      return 'error';
    default:
      return 'pending';
  }
}

/**
 * Convert TopologyGraph to D3.js format
 * @param graph - The topology graph to convert
 * @param currentNodeId - Optional ID of the current/centered node to mark as isCurrent
 */
export function convertToD3Topology(graph: TopologyGraph, currentNodeId?: string): { nodes: D3Node[]; edges: D3Edge[] } {
  // Convert nodes
  const nodes: D3Node[] = graph.nodes.map((node: EngineNode) => ({
    id: node.id,
    type: mapKindToResourceType(node.kind),
    name: node.name,
    namespace: node.namespace || undefined,
    status: mapHealthToStatus(node.computed?.health),
    isCurrent: currentNodeId ? node.id === currentNodeId : false,
    traffic: node.traffic,
  }));

  // Convert edges
  const edges: D3Edge[] = graph.edges.map((edge: EngineEdge) => {
    // Get human-readable label from RELATIONSHIP_CONFIG
    const relationshipConfig = RELATIONSHIP_CONFIG[edge.relationshipType];
    const label = relationshipConfig?.label || edge.relationshipType;

    return {
      from: edge.source,
      to: edge.target,
      label,
      traffic: undefined, // Traffic info not available in current edge format
    };
  });

  return { nodes, edges };
}
