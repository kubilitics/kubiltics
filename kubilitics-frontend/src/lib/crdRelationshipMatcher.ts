/**
 * CRDRelationshipMatcher — Detects relationships between CRD instances and core K8s resources.
 *
 * Two detection strategies:
 * 1. ownerReferences: CRD instance metadata.ownerReferences pointing to core resources
 * 2. Field references:  CRD spec fields that reference core resource kinds by name
 *    (e.g., VirtualService.spec.http[].route[].destination.host → Service)
 *
 * Returns relationship edges suitable for the topology graph.
 */

import type { TopologyEdge, TopologyNode } from '@/topology/types/topology';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OwnerReference {
  apiVersion: string;
  kind: string;
  name: string;
  uid: string;
  controller?: boolean;
  blockOwnerDeletion?: boolean;
}

export interface CRDInstance {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    uid?: string;
    ownerReferences?: OwnerReference[];
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
}

export interface DetectedRelationship {
  sourceId: string;
  targetId: string;
  sourceKind: string;
  targetKind: string;
  relationshipType: 'ownerReference' | 'fieldReference' | 'labelSelector';
  label: string;
  detail?: string;
}

// ─── Well-known field reference patterns ────────────────────────────────────

interface FieldPattern {
  /** CRD kind that contains the reference */
  sourceKind: string;
  /** JSON path segments to traverse (supports wildcards for arrays) */
  path: string[];
  /** Target K8s resource kind */
  targetKind: string;
  /** Human-readable relationship label */
  label: string;
}

/**
 * Known CRD-to-core-resource field reference patterns.
 * Extend this list for new CRD types.
 */
const KNOWN_FIELD_PATTERNS: FieldPattern[] = [
  // Istio VirtualService → Service
  {
    sourceKind: 'VirtualService',
    path: ['spec', 'http', '*', 'route', '*', 'destination', 'host'],
    targetKind: 'Service',
    label: 'routes to',
  },
  // Istio DestinationRule → Service
  {
    sourceKind: 'DestinationRule',
    path: ['spec', 'host'],
    targetKind: 'Service',
    label: 'targets',
  },
  // Istio Gateway → Secret (TLS)
  {
    sourceKind: 'Gateway',
    path: ['spec', 'servers', '*', 'tls', 'credentialName'],
    targetKind: 'Secret',
    label: 'uses TLS secret',
  },
  // cert-manager Certificate → Secret
  {
    sourceKind: 'Certificate',
    path: ['spec', 'secretName'],
    targetKind: 'Secret',
    label: 'creates secret',
  },
  // cert-manager Certificate → Issuer/ClusterIssuer
  {
    sourceKind: 'Certificate',
    path: ['spec', 'issuerRef', 'name'],
    targetKind: 'ClusterIssuer',
    label: 'issued by',
  },
  // Prometheus ServiceMonitor → Service
  {
    sourceKind: 'ServiceMonitor',
    path: ['spec', 'selector', 'matchLabels'],
    targetKind: 'Service',
    label: 'monitors',
  },
  // Argo Rollout → Service (stable/canary)
  {
    sourceKind: 'Rollout',
    path: ['spec', 'strategy', 'canary', 'stableService'],
    targetKind: 'Service',
    label: 'stable service',
  },
  {
    sourceKind: 'Rollout',
    path: ['spec', 'strategy', 'canary', 'canaryService'],
    targetKind: 'Service',
    label: 'canary service',
  },
  // ExternalSecret → Secret
  {
    sourceKind: 'ExternalSecret',
    path: ['spec', 'target', 'name'],
    targetKind: 'Secret',
    label: 'creates secret',
  },
  // Keda ScaledObject → Deployment
  {
    sourceKind: 'ScaledObject',
    path: ['spec', 'scaleTargetRef', 'name'],
    targetKind: 'Deployment',
    label: 'scales',
  },
];

// ─── CRDRelationshipMatcher Class ───────────────────────────────────────────

export class CRDRelationshipMatcher {
  private coreResourceIndex: Map<string, TopologyNode>;
  private coreResourceByKindName: Map<string, TopologyNode>;

  constructor(coreNodes: TopologyNode[]) {
    this.coreResourceIndex = new Map();
    this.coreResourceByKindName = new Map();

    for (const node of coreNodes) {
      this.coreResourceIndex.set(node.id, node);
      // Index by kind/namespace/name for field reference lookups
      const key = this.buildLookupKey(node.kind, node.namespace, node.name);
      this.coreResourceByKindName.set(key, node);
      // Also index by kind/name (no namespace) for cluster-scoped resources
      const shortKey = `${node.kind}/${node.name}`.toLowerCase();
      if (!this.coreResourceByKindName.has(shortKey)) {
        this.coreResourceByKindName.set(shortKey, node);
      }
    }
  }

  /**
   * Detect all relationships from CRD instances to core resources.
   */
  detectRelationships(crdInstances: CRDInstance[]): DetectedRelationship[] {
    const relationships: DetectedRelationship[] = [];

    for (const instance of crdInstances) {
      // 1. ownerReferences
      const ownerRels = this.detectOwnerReferences(instance);
      relationships.push(...ownerRels);

      // 2. Field references
      const fieldRels = this.detectFieldReferences(instance);
      relationships.push(...fieldRels);
    }

    return this.deduplicateRelationships(relationships);
  }

  /**
   * Convert detected relationships to topology edges.
   */
  toTopologyEdges(relationships: DetectedRelationship[]): TopologyEdge[] {
    return relationships.map((rel, index) => ({
      id: `crd-rel-${rel.sourceId}-${rel.targetId}-${index}`,
      source: rel.sourceId,
      target: rel.targetId,
      relationshipType: rel.relationshipType,
      relationshipCategory: this.getRelationshipCategory(rel),
      label: rel.label,
      detail: rel.detail,
      style: rel.relationshipType === 'ownerReference' ? 'solid' : 'dashed',
      animated: false,
      healthy: true,
    }));
  }

  // ─── Private Methods ──────────────────────────────────────────────────────

  private detectOwnerReferences(instance: CRDInstance): DetectedRelationship[] {
    const refs = instance.metadata.ownerReferences ?? [];
    const results: DetectedRelationship[] = [];
    const instanceId = this.buildInstanceId(instance);

    for (const ref of refs) {
      // Try to find the owner in our core resource index
      const ownerKey = this.buildLookupKey(
        ref.kind,
        instance.metadata.namespace ?? '',
        ref.name,
      );
      const ownerNode = this.coreResourceByKindName.get(ownerKey);

      if (ownerNode) {
        results.push({
          sourceId: instanceId,
          targetId: ownerNode.id,
          sourceKind: instance.kind,
          targetKind: ref.kind,
          relationshipType: 'ownerReference',
          label: ref.controller ? 'owned by (controller)' : 'owned by',
          detail: `${instance.kind}/${instance.metadata.name} -> ${ref.kind}/${ref.name}`,
        });
      }
    }

    return results;
  }

  private detectFieldReferences(instance: CRDInstance): DetectedRelationship[] {
    const results: DetectedRelationship[] = [];
    const instanceId = this.buildInstanceId(instance);

    // Check known patterns
    const patterns = KNOWN_FIELD_PATTERNS.filter(
      (p) => p.sourceKind === instance.kind,
    );

    for (const pattern of patterns) {
      const values = this.extractFieldValues(instance, pattern.path);

      for (const value of values) {
        if (typeof value !== 'string' || !value) continue;

        // Resolve the value to a core resource node
        const targetNode = this.resolveReference(
          pattern.targetKind,
          value,
          instance.metadata.namespace,
        );

        if (targetNode) {
          results.push({
            sourceId: instanceId,
            targetId: targetNode.id,
            sourceKind: instance.kind,
            targetKind: pattern.targetKind,
            relationshipType: 'fieldReference',
            label: pattern.label,
            detail: `${instance.kind}/${instance.metadata.name} ${pattern.label} ${pattern.targetKind}/${value}`,
          });
        }
      }
    }

    // Generic field scanning: look for fields named *ServiceName, *SecretName, etc.
    if (instance.spec && patterns.length === 0) {
      const genericRefs = this.scanGenericReferences(instance);
      results.push(...genericRefs);
    }

    return results;
  }

  /**
   * Scan for generic field references in CRD specs.
   * Looks for field names containing common reference suffixes.
   */
  private scanGenericReferences(instance: CRDInstance): DetectedRelationship[] {
    const results: DetectedRelationship[] = [];
    const instanceId = this.buildInstanceId(instance);

    const refPatterns: Array<{ suffix: RegExp; targetKind: string; label: string }> = [
      { suffix: /[Ss]ervice[Nn]ame$/,     targetKind: 'Service',    label: 'references service' },
      { suffix: /[Ss]ecret[Nn]ame$/,      targetKind: 'Secret',     label: 'references secret' },
      { suffix: /[Cc]onfig[Mm]ap[Nn]ame$/,targetKind: 'ConfigMap',  label: 'references configmap' },
      { suffix: /[Dd]eployment[Nn]ame$/,  targetKind: 'Deployment', label: 'references deployment' },
      { suffix: /[Nn]amespace$/,           targetKind: 'Namespace',  label: 'references namespace' },
    ];

    this.walkObject(instance.spec!, (key, value) => {
      if (typeof value !== 'string' || !value) return;

      for (const pattern of refPatterns) {
        if (!pattern.suffix.test(key)) continue;
        const target = this.resolveReference(
          pattern.targetKind,
          value,
          instance.metadata.namespace,
        );
        if (target) {
          results.push({
            sourceId: instanceId,
            targetId: target.id,
            sourceKind: instance.kind,
            targetKind: pattern.targetKind,
            relationshipType: 'fieldReference',
            label: pattern.label,
            detail: `${instance.kind}/${instance.metadata.name}.${key} = ${value}`,
          });
        }
      }
    });

    return results;
  }

  /** Extract values from an object following a JSON path with wildcard support. */
  private extractFieldValues(obj: unknown, path: string[]): unknown[] {
    if (path.length === 0) return [obj];
    if (obj == null || typeof obj !== 'object') return [];

    const [head, ...rest] = path;

    if (head === '*') {
      // Wildcard: iterate array elements or object values
      const items = Array.isArray(obj) ? obj : Object.values(obj);
      return items.flatMap((item) => this.extractFieldValues(item, rest));
    }

    const record = obj as Record<string, unknown>;
    if (!(head in record)) return [];
    return this.extractFieldValues(record[head], rest);
  }

  /** Walk an object tree and call visitor for every leaf key/value pair. */
  private walkObject(
    obj: Record<string, unknown>,
    visitor: (key: string, value: unknown) => void,
    maxDepth = 8,
  ): void {
    if (maxDepth <= 0) return;

    for (const [key, value] of Object.entries(obj)) {
      visitor(key, value);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.walkObject(value as Record<string, unknown>, visitor, maxDepth - 1);
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object') {
            this.walkObject(item as Record<string, unknown>, visitor, maxDepth - 1);
          }
        }
      }
    }
  }

  /** Resolve a reference value to a core resource node. */
  private resolveReference(
    targetKind: string,
    name: string,
    namespace?: string,
  ): TopologyNode | undefined {
    // For Istio-style service references: strip the FQDN suffix
    // e.g., "reviews.default.svc.cluster.local" → name="reviews", ns="default"
    const fqdnMatch = name.match(/^([^.]+)\.([^.]+)\.svc/);
    if (fqdnMatch) {
      const [, svcName, svcNs] = fqdnMatch;
      const key = this.buildLookupKey(targetKind, svcNs, svcName);
      return this.coreResourceByKindName.get(key);
    }

    // Try namespace-qualified lookup
    if (namespace) {
      const key = this.buildLookupKey(targetKind, namespace, name);
      const node = this.coreResourceByKindName.get(key);
      if (node) return node;
    }

    // Try unqualified lookup
    const shortKey = `${targetKind}/${name}`.toLowerCase();
    return this.coreResourceByKindName.get(shortKey);
  }

  private buildLookupKey(kind: string, namespace: string, name: string): string {
    return `${kind}/${namespace}/${name}`.toLowerCase();
  }

  private buildInstanceId(instance: CRDInstance): string {
    const ns = instance.metadata.namespace ?? '';
    return ns
      ? `${instance.kind}/${ns}/${instance.metadata.name}`
      : `${instance.kind}/${instance.metadata.name}`;
  }

  private getRelationshipCategory(rel: DetectedRelationship): string {
    if (rel.relationshipType === 'ownerReference') return 'ownership';
    // Infer from target kind
    const kindCategoryMap: Record<string, string> = {
      Service: 'networking',
      Ingress: 'networking',
      Secret: 'configuration',
      ConfigMap: 'configuration',
      Deployment: 'ownership',
      StatefulSet: 'ownership',
      PersistentVolumeClaim: 'storage',
      Namespace: 'containment',
    };
    return kindCategoryMap[rel.targetKind] ?? 'custom';
  }

  private deduplicateRelationships(
    rels: DetectedRelationship[],
  ): DetectedRelationship[] {
    const seen = new Set<string>();
    return rels.filter((rel) => {
      const key = `${rel.sourceId}|${rel.targetId}|${rel.relationshipType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
