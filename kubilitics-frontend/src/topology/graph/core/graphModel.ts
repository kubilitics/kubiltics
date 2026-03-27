import type { TopologyGraph, TopologyNode, TopologyEdge, KubernetesKind, HealthStatus, RelationshipType } from '../types/topology.types';
import { GraphEnhancer } from './GraphEnhancer';

export class GraphModel {
  private nodeMap: Map<string, TopologyNode>;
  private edgeMap: Map<string, TopologyEdge>;
  private outEdges: Map<string, Set<string>>; // nodeId → edge ids going out
  private inEdges: Map<string, Set<string>>;  // nodeId → edge ids coming in

  constructor(graph: TopologyGraph) {
    this.nodeMap = new Map();
    this.edgeMap = new Map();
    this.outEdges = new Map();
    this.inEdges = new Map();

    const enhancedGraph = new GraphEnhancer(graph).enhance();

    for (const node of enhancedGraph.nodes) {
      this.nodeMap.set(node.id, node);
      this.outEdges.set(node.id, new Set());
      this.inEdges.set(node.id, new Set());
    }

    for (const edge of enhancedGraph.edges) {
      this.edgeMap.set(edge.id, edge);
      this.outEdges.get(edge.source)?.add(edge.id);
      this.inEdges.get(edge.target)?.add(edge.id);
    }
  }

  getNode(id: string): TopologyNode | undefined {
    return this.nodeMap.get(id);
  }

  getEdge(id: string): TopologyEdge | undefined {
    return this.edgeMap.get(id);
  }

  get nodes(): TopologyNode[] {
    return Array.from(this.nodeMap.values());
  }

  get edges(): TopologyEdge[] {
    return Array.from(this.edgeMap.values());
  }

  get nodeCount(): number {
    return this.nodeMap.size;
  }

  get edgeCount(): number {
    return this.edgeMap.size;
  }

  /** Get all parent nodes (nodes with edges pointing to this node) */
  getParents(nodeId: string): TopologyNode[] {
    const edgeIds = this.inEdges.get(nodeId);
    if (!edgeIds) return [];
    const parents: TopologyNode[] = [];
    for (const eid of edgeIds) {
      const edge = this.edgeMap.get(eid);
      if (edge) {
        const parent = this.nodeMap.get(edge.source);
        if (parent) parents.push(parent);
      }
    }
    return parents;
  }

  /** Get all child nodes (nodes this node points to) */
  getChildren(nodeId: string): TopologyNode[] {
    const edgeIds = this.outEdges.get(nodeId);
    if (!edgeIds) return [];
    const children: TopologyNode[] = [];
    for (const eid of edgeIds) {
      const edge = this.edgeMap.get(eid);
      if (edge) {
        const child = this.nodeMap.get(edge.target);
        if (child) children.push(child);
      }
    }
    return children;
  }

  /** Get all edges connected to a node */
  getConnectedEdges(nodeId: string): TopologyEdge[] {
    const result: TopologyEdge[] = [];
    const outIds = this.outEdges.get(nodeId);
    const inIds = this.inEdges.get(nodeId);
    if (outIds) for (const eid of outIds) {
      const e = this.edgeMap.get(eid);
      if (e) result.push(e);
    }
    if (inIds) for (const eid of inIds) {
      const e = this.edgeMap.get(eid);
      if (e) result.push(e);
    }
    return result;
  }

  /** Get immediate neighborhood (parents + children + self) */
  getNeighborhood(nodeId: string): Set<string> {
    const result = new Set<string>([nodeId]);
    const outIds = this.outEdges.get(nodeId);
    const inIds = this.inEdges.get(nodeId);
    if (outIds) for (const eid of outIds) {
      const e = this.edgeMap.get(eid);
      if (e) result.add(e.target);
    }
    if (inIds) for (const eid of inIds) {
      const e = this.edgeMap.get(eid);
      if (e) result.add(e.source);
    }
    return result;
  }

  /** Get all connecting edge IDs for a set of node IDs */
  getConnectingEdgeIds(nodeIds: Set<string>): Set<string> {
    const result = new Set<string>();
    for (const edge of this.edgeMap.values()) {
      if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
        result.add(edge.id);
      }
    }
    return result;
  }

  /** Filter nodes by kind */
  getNodesByKind(kind: KubernetesKind): TopologyNode[] {
    return this.nodes.filter(n => n.kind === kind);
  }

  /** Filter nodes by namespace */
  getNodesByNamespace(namespace: string): TopologyNode[] {
    return this.nodes.filter(n => n.namespace === namespace);
  }

  /** Get unique namespaces */
  getNamespaces(): string[] {
    const ns = new Set<string>();
    for (const node of this.nodeMap.values()) {
      if (node.namespace) ns.add(node.namespace);
    }
    return Array.from(ns).sort();
  }

  /** Get resource summary counts per kind */
  getResourceSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const node of this.nodeMap.values()) {
      summary[node.kind] = (summary[node.kind] || 0) + 1;
    }
    return summary;
  }
}
