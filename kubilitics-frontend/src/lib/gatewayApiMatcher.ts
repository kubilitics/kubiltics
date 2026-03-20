/**
 * GatewayMatcher — Maps Gateway API resources to topology graph nodes and edges.
 *
 * Supports:
 *   - Gateway -> GatewayClass (parentRef)
 *   - HTTPRoute -> Gateway (parentRefs)
 *   - HTTPRoute -> Service (backendRefs with path matching labels)
 *   - Both gateway.networking.k8s.io/v1 and gateway.networking.k8s.io/v1beta1
 *
 * Gateway nodes are categorized in "networking" with cyan accent.
 */

import type { TopologyNode, TopologyEdge } from '@/topology/types/topology';

// ─── Gateway API Types ──────────────────────────────────────────────────────

/** Supported Gateway API versions */
export const GATEWAY_API_VERSIONS = [
  'gateway.networking.k8s.io/v1',
  'gateway.networking.k8s.io/v1beta1',
] as const;

export type GatewayApiVersion = (typeof GATEWAY_API_VERSIONS)[number];

export interface GatewayClassResource {
  apiVersion: string;
  kind: 'GatewayClass';
  metadata: {
    name: string;
    uid?: string;
    labels?: Record<string, string>;
  };
  spec: {
    controllerName: string;
    description?: string;
  };
  status?: {
    conditions?: Array<{ type: string; status: string; reason?: string }>;
  };
}

export interface GatewayListener {
  name: string;
  hostname?: string;
  port: number;
  protocol: string;
  tls?: {
    mode?: string;
    certificateRefs?: Array<{
      kind?: string;
      name: string;
      namespace?: string;
    }>;
  };
  allowedRoutes?: {
    namespaces?: { from?: string; selector?: Record<string, string> };
    kinds?: Array<{ group?: string; kind: string }>;
  };
}

export interface GatewayResource {
  apiVersion: string;
  kind: 'Gateway';
  metadata: {
    name: string;
    namespace?: string;
    uid?: string;
    labels?: Record<string, string>;
  };
  spec: {
    gatewayClassName: string;
    listeners: GatewayListener[];
    addresses?: Array<{ type?: string; value: string }>;
  };
  status?: {
    addresses?: Array<{ type?: string; value: string }>;
    conditions?: Array<{ type: string; status: string; reason?: string }>;
    listeners?: Array<{
      name: string;
      supportedKinds?: Array<{ group?: string; kind: string }>;
      conditions?: Array<{ type: string; status: string }>;
      attachedRoutes?: number;
    }>;
  };
}

export interface HTTPRouteMatch {
  path?: { type?: string; value?: string };
  headers?: Array<{ type?: string; name: string; value: string }>;
  queryParams?: Array<{ type?: string; name: string; value: string }>;
  method?: string;
}

export interface HTTPRouteBackendRef {
  group?: string;
  kind?: string;
  name: string;
  namespace?: string;
  port?: number;
  weight?: number;
}

export interface HTTPRouteRule {
  matches?: HTTPRouteMatch[];
  filters?: Array<{ type: string; [key: string]: unknown }>;
  backendRefs?: HTTPRouteBackendRef[];
  timeouts?: { request?: string; backendRequest?: string };
}

export interface ParentReference {
  group?: string;
  kind?: string;
  namespace?: string;
  name: string;
  sectionName?: string;
  port?: number;
}

export interface HTTPRouteResource {
  apiVersion: string;
  kind: 'HTTPRoute';
  metadata: {
    name: string;
    namespace?: string;
    uid?: string;
    labels?: Record<string, string>;
  };
  spec: {
    parentRefs: ParentReference[];
    hostnames?: string[];
    rules: HTTPRouteRule[];
  };
  status?: {
    parents?: Array<{
      parentRef: ParentReference;
      controllerName: string;
      conditions?: Array<{ type: string; status: string; reason?: string }>;
    }>;
  };
}

export type GatewayApiResource =
  | GatewayClassResource
  | GatewayResource
  | HTTPRouteResource;

// ─── GatewayMatcher Class ───────────────────────────────────────────────────

export class GatewayMatcher {
  private gatewayClasses: GatewayClassResource[] = [];
  private gateways: GatewayResource[] = [];
  private httpRoutes: HTTPRouteResource[] = [];
  private coreNodeIndex: Map<string, TopologyNode>;

  constructor(coreNodes: TopologyNode[]) {
    this.coreNodeIndex = new Map();
    for (const node of coreNodes) {
      // Index by kind/namespace/name
      const key = `${node.kind}/${node.namespace}/${node.name}`.toLowerCase();
      this.coreNodeIndex.set(key, node);
      // Short key for cluster-scoped
      const shortKey = `${node.kind}/${node.name}`.toLowerCase();
      if (!this.coreNodeIndex.has(shortKey)) {
        this.coreNodeIndex.set(shortKey, node);
      }
    }
  }

  /**
   * Check if a resource is a Gateway API resource (v1 or v1beta1).
   */
  static isGatewayApiResource(resource: { apiVersion?: string; kind?: string }): boolean {
    if (!resource.apiVersion || !resource.kind) return false;
    const isGatewayApiVersion = GATEWAY_API_VERSIONS.some(
      (v) => resource.apiVersion === v,
    );
    const isGatewayKind = ['GatewayClass', 'Gateway', 'HTTPRoute', 'GRPCRoute', 'TCPRoute', 'TLSRoute'].includes(
      resource.kind,
    );
    return isGatewayApiVersion && isGatewayKind;
  }

  /**
   * Ingest Gateway API resources. Call this before generating nodes/edges.
   */
  addResources(resources: GatewayApiResource[]): void {
    for (const res of resources) {
      switch (res.kind) {
        case 'GatewayClass':
          this.gatewayClasses.push(res as GatewayClassResource);
          break;
        case 'Gateway':
          this.gateways.push(res as GatewayResource);
          break;
        case 'HTTPRoute':
          this.httpRoutes.push(res as HTTPRouteResource);
          break;
      }
    }
  }

  /**
   * Generate topology nodes for Gateway API resources.
   * Networking category with cyan color palette.
   */
  generateNodes(): TopologyNode[] {
    const nodes: TopologyNode[] = [];

    for (const gc of this.gatewayClasses) {
      const accepted = gc.status?.conditions?.find(
        (c) => c.type === 'Accepted',
      );
      nodes.push({
        id: `GatewayClass/${gc.metadata.name}`,
        kind: 'GatewayClass',
        name: gc.metadata.name,
        namespace: '',
        apiVersion: gc.apiVersion,
        category: 'networking',
        label: gc.metadata.name,
        status: accepted?.status === 'True' ? 'healthy' : 'warning',
        statusReason: gc.spec.controllerName,
        layer: 0,
        labels: gc.metadata.labels,
      });
    }

    for (const gw of this.gateways) {
      const ns = gw.metadata.namespace ?? 'default';
      const programmed = gw.status?.conditions?.find(
        (c) => c.type === 'Programmed' || c.type === 'Ready',
      );
      const listenerSummary = gw.spec.listeners
        .map((l) => `${l.name}:${l.port}/${l.protocol}`)
        .join(', ');

      nodes.push({
        id: `Gateway/${ns}/${gw.metadata.name}`,
        kind: 'Gateway',
        name: gw.metadata.name,
        namespace: ns,
        apiVersion: gw.apiVersion,
        category: 'networking',
        label: gw.metadata.name,
        status: programmed?.status === 'True' ? 'healthy' : 'warning',
        statusReason: listenerSummary || programmed?.reason,
        layer: 1,
        labels: gw.metadata.labels,
      });
    }

    for (const route of this.httpRoutes) {
      const ns = route.metadata.namespace ?? 'default';
      const ruleCount = route.spec.rules.length;
      const hostnames = route.spec.hostnames?.join(', ') ?? '*';
      const parentAccepted = route.status?.parents?.every(
        (p) => p.conditions?.some((c) => c.type === 'Accepted' && c.status === 'True'),
      );

      nodes.push({
        id: `HTTPRoute/${ns}/${route.metadata.name}`,
        kind: 'HTTPRoute',
        name: route.metadata.name,
        namespace: ns,
        apiVersion: route.apiVersion,
        category: 'networking',
        label: route.metadata.name,
        status: parentAccepted === false ? 'warning' : 'healthy',
        statusReason: `${ruleCount} rule${ruleCount !== 1 ? 's' : ''}, hosts: ${hostnames}`,
        layer: 2,
        labels: route.metadata.labels,
      });
    }

    return nodes;
  }

  /**
   * Generate topology edges for Gateway API relationships.
   */
  generateEdges(): TopologyEdge[] {
    const edges: TopologyEdge[] = [];

    // Gateway -> GatewayClass
    for (const gw of this.gateways) {
      const ns = gw.metadata.namespace ?? 'default';
      const gcId = `GatewayClass/${gw.spec.gatewayClassName}`;
      const gwId = `Gateway/${ns}/${gw.metadata.name}`;

      edges.push({
        id: `gw-edge-${gwId}-${gcId}`,
        source: gwId,
        target: gcId,
        relationshipType: 'gatewayClass',
        relationshipCategory: 'networking',
        label: 'class',
        style: 'solid',
        animated: false,
        healthy: true,
      });
    }

    // HTTPRoute -> Gateway (parentRefs)
    for (const route of this.httpRoutes) {
      const routeNs = route.metadata.namespace ?? 'default';
      const routeId = `HTTPRoute/${routeNs}/${route.metadata.name}`;

      for (const parentRef of route.spec.parentRefs) {
        const parentKind = parentRef.kind ?? 'Gateway';
        const parentNs = parentRef.namespace ?? routeNs;
        const parentId = `${parentKind}/${parentNs}/${parentRef.name}`;

        const sectionLabel = parentRef.sectionName
          ? `listener: ${parentRef.sectionName}`
          : 'attached';

        edges.push({
          id: `gw-edge-${routeId}-${parentId}`,
          source: routeId,
          target: parentId,
          relationshipType: 'parentRef',
          relationshipCategory: 'networking',
          label: sectionLabel,
          style: 'solid',
          animated: false,
          healthy: true,
        });
      }

      // HTTPRoute -> Service (backendRefs with path matching rules as labels)
      for (const rule of route.spec.rules) {
        const pathLabel = this.buildPathMatchLabel(rule.matches);

        for (const backendRef of rule.backendRefs ?? []) {
          const targetKind = backendRef.kind ?? 'Service';
          const targetNs = backendRef.namespace ?? routeNs;
          const targetId = `${targetKind}/${targetNs}/${backendRef.name}`;

          // Check if target exists in core nodes
          const targetKey = `${targetKind}/${targetNs}/${backendRef.name}`.toLowerCase();
          const existsInCore = this.coreNodeIndex.has(targetKey);

          const weightLabel = backendRef.weight != null
            ? ` (w:${backendRef.weight})`
            : '';
          const portLabel = backendRef.port != null
            ? `:${backendRef.port}`
            : '';

          edges.push({
            id: `gw-edge-${routeId}-${targetId}-${pathLabel}`,
            source: routeId,
            target: existsInCore ? this.coreNodeIndex.get(targetKey)!.id : targetId,
            relationshipType: 'backendRef',
            relationshipCategory: 'networking',
            label: `${pathLabel}${portLabel}${weightLabel}`.trim() || 'routes to',
            detail: `${route.metadata.name} -> ${backendRef.name}${portLabel}`,
            style: 'dashed',
            animated: true,
            healthy: true,
          });
        }
      }
    }

    return edges;
  }

  /**
   * Build a human-readable path match label from HTTPRoute match rules.
   */
  private buildPathMatchLabel(matches?: HTTPRouteMatch[]): string {
    if (!matches || matches.length === 0) return '*';

    const parts: string[] = [];
    for (const match of matches) {
      if (match.path?.value) {
        const type = match.path.type ?? 'PathPrefix';
        const shortType = type === 'PathPrefix' ? '' : `${type}:`;
        parts.push(`${shortType}${match.path.value}`);
      }
      if (match.method) {
        parts.push(match.method);
      }
      if (match.headers?.length) {
        parts.push(`H:${match.headers.map((h) => h.name).join(',')}`);
      }
    }

    return parts.join(' | ') || '*';
  }
}
