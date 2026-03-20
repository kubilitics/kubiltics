/**
 * Hierarchical Adapter - Converts TopologyGraph to D3 tree hierarchy format
 * Builds tree structure for hierarchical/tree layout visualization
 */
import type { TopologyGraph, TopologyNode as EngineNode, TopologyEdge as EngineEdge } from '../types/topology.types';
import type { TopologyNode as D3Node, TopologyEdge as D3Edge, ResourceType } from '../renderer/D3TopologyCanvas';
import { RELATIONSHIP_CONFIG } from './edgeHelpers';

/**
 * Map KubernetesKind to D3.js ResourceType
 */
function mapKindToResourceType(kind: string): ResourceType {
  const kindLower = kind.toLowerCase();
  
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
  
  return mapping[kindLower] || 'pod';
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
 * Hierarchical tree node structure for D3 tree layout
 * Note: This type is also defined in D3HierarchicalTopologyCanvas.tsx for component use
 */
export interface HierarchicalNode {
  id: string;
  data: D3Node;
  children?: HierarchicalNode[];
  parent?: HierarchicalNode;
  depth?: number;
  x?: number;
  y?: number;
}

/**
 * Convert TopologyGraph to hierarchical tree structure
 * Identifies root nodes and builds parent-child relationships
 */
export function convertToHierarchicalTree(
  graph: TopologyGraph,
  currentNodeId?: string
): { root: HierarchicalNode; edges: D3Edge[] } {
  // Convert nodes to D3 format
  const d3Nodes: D3Node[] = graph.nodes.map((node: EngineNode) => ({
    id: node.id,
    type: mapKindToResourceType(node.kind),
    name: node.name,
    namespace: node.namespace || undefined,
    status: mapHealthToStatus(node.computed?.health),
    isCurrent: currentNodeId ? node.id === currentNodeId : false,
    traffic: node.traffic,
  }));

  // Convert edges to D3 format with labels
  const d3Edges: D3Edge[] = graph.edges.map((edge: EngineEdge) => {
    const relationshipConfig = RELATIONSHIP_CONFIG[edge.relationshipType];
    const label = relationshipConfig?.label || edge.relationshipType;
    return {
      from: edge.source,
      to: edge.target,
      label,
      traffic: undefined,
    };
  });

  // Build node map for quick lookup
  const nodeMap = new Map<string, HierarchicalNode>();
  d3Nodes.forEach(node => {
    nodeMap.set(node.id, {
      id: node.id,
      data: node,
      children: [],
    });
  });

  // Build parent-child relationships from edges
  // Priority: 'owns' > 'manages' > 'runs' > other relationships
  const relationshipPriority: Record<string, number> = {
    'owns': 1,
    'manages': 2,
    'runs': 3,
    'creates': 4,
  };

  // Group edges by target, keeping only highest priority relationship
  const childToParent = new Map<string, { parentId: string; edge: D3Edge }>();
  
  d3Edges.forEach(edge => {
    const existing = childToParent.get(edge.to);
    const priority = relationshipPriority[edge.label?.toLowerCase() || ''] || 100;
    
    const existingPriority = existing ? (relationshipPriority[existing.edge.label?.toLowerCase() || ''] || 100) : 100;
    if (!existing || priority < existingPriority) {
      childToParent.set(edge.to, { parentId: edge.from, edge });
    }
  });

  // Build tree structure
  const rootNodes: HierarchicalNode[] = [];
  
  nodeMap.forEach((node, nodeId) => {
    const parentInfo = childToParent.get(nodeId);
    
    if (parentInfo) {
      const parent = nodeMap.get(parentInfo.parentId);
      if (parent) {
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(node);
        node.parent = parent;
      } else {
        // Parent not found, treat as root
        rootNodes.push(node);
      }
    } else {
      // No parent, this is a root node
      rootNodes.push(node);
    }
  });

  // If multiple roots and we have a current node, use it as root
  // Otherwise, create a virtual root if multiple roots exist
  let root: HierarchicalNode;
  
  if (rootNodes.length === 1) {
    root = rootNodes[0];
  } else if (currentNodeId && nodeMap.has(currentNodeId)) {
    // Use current node as root, reorganize tree
    root = nodeMap.get(currentNodeId)!;
    
    // Rebuild tree with current node as root
    const visited = new Set<string>();
    const rebuildTree = (node: HierarchicalNode) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      
      node.children = [];
      // Find all edges where this node is the source
      d3Edges
        .filter(e => e.from === node.id)
        .forEach(edge => {
          const child = nodeMap.get(edge.to);
          if (child && !visited.has(child.id)) {
            node.children!.push(child);
            child.parent = node;
            rebuildTree(child);
          }
        });
    };
    
    rebuildTree(root);
    
    // Add remaining disconnected nodes as children
    nodeMap.forEach((node) => {
      if (!visited.has(node.id) && node.id !== root.id) {
        if (!root.children) {
          root.children = [];
        }
        root.children.push(node);
        node.parent = root;
      }
    });
  } else {
    // Create virtual root
    root = {
      id: '__virtual_root__',
      data: {
        id: '__virtual_root__',
        type: 'namespace',
        name: 'Root',
      },
      children: rootNodes,
    };
    rootNodes.forEach(node => {
      node.parent = root;
    });
  }

  return { root, edges: d3Edges };
}
