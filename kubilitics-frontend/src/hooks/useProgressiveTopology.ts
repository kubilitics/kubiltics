/**
 * useProgressiveTopology — Manages progressive disclosure for large topology views.
 *
 * Responsibilities:
 * - Track which namespaces are expanded vs. collapsed (super-node)
 * - Lazy-load resources for expanded namespaces from the full topology graph
 * - Compute super-node positions, resource counts, and health summaries
 * - Debounce expand/collapse transitions to prevent rapid re-renders
 * - Provide a merged node/edge list combining super-nodes + expanded resources
 */
import { useState, useCallback, useMemo, useRef } from "react";
import type {
  TopologyResponse,
  TopologyNode,
  TopologyEdge,
} from "@/topology/types/topology";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Max nodes rendered when namespaces are expanded (raised from 250 for progressive mode) */
export const MAX_PROGRESSIVE_NODES = 500;

/** Debounce delay for expand/collapse transitions (ms) */
const TOGGLE_DEBOUNCE_MS = 200;

// ─── Types ──────────────────────────────────────────────────────────────────

export type HealthSummary = {
  healthy: number;
  warning: number;
  error: number;
  unknown: number;
};

export interface NamespaceSuperNodeInfo {
  namespace: string;
  resourceCount: number;
  health: HealthSummary;
  /** Dominant health status for color coding */
  overallHealth: "healthy" | "warning" | "error" | "unknown";
  /** Resource breakdown by kind */
  kindCounts: Record<string, number>;
}

export interface ProgressiveTopologyResult {
  /** Merged topology with super-nodes replacing collapsed namespaces */
  topology: TopologyResponse | null;
  /** Set of currently expanded namespace names */
  expandedNamespaces: Set<string>;
  /** Super-node info for each collapsed namespace */
  superNodes: NamespaceSuperNodeInfo[];
  /** All namespaces found in the topology */
  allNamespaces: string[];
  /** Expand a namespace (single-click on super-node) */
  expandNamespace: (ns: string) => void;
  /** Collapse a namespace back to super-node */
  collapseNamespace: (ns: string) => void;
  /** Toggle expand/collapse */
  toggleNamespace: (ns: string) => void;
  /** Expand all namespaces at once */
  expandAll: () => void;
  /** Collapse all namespaces at once */
  collapseAll: () => void;
  /** Whether the total visible nodes exceeded MAX_PROGRESSIVE_NODES */
  truncated: boolean;
  /** Total node count before cap (for warning banner) */
  totalBeforeCap: number;
}

// ─── Health Helpers ─────────────────────────────────────────────────────────

const HEALTHY_STATUSES = new Set([
  "healthy", "Running", "Ready", "Bound", "Available", "Completed", "Active", "Succeeded",
]);
const WARNING_STATUSES = new Set([
  "warning", "Pending", "PartiallyAvailable",
]);
const ERROR_STATUSES = new Set([
  "error", "Failed", "NotReady", "Lost", "CrashLoopBackOff", "OOMKilled",
]);

function classifyStatus(status: string): keyof HealthSummary {
  if (HEALTHY_STATUSES.has(status)) return "healthy";
  if (WARNING_STATUSES.has(status)) return "warning";
  if (ERROR_STATUSES.has(status)) return "error";
  return "unknown";
}

function computeOverallHealth(h: HealthSummary): HealthSummary["healthy"] extends number
  ? "healthy" | "warning" | "error" | "unknown"
  : never {
  if (h.error > 0) return "error";
  if (h.warning > 0) return "warning";
  if (h.healthy > 0) return "healthy";
  return "unknown";
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useProgressiveTopology(
  sourceTopology: TopologyResponse | null,
): ProgressiveTopologyResult {
  const [expandedNamespaces, setExpandedNamespaces] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Extract all namespaces from the source topology ─────────────────────
  const allNamespaces = useMemo<string[]>(() => {
    if (!sourceTopology?.nodes) return [];
    const nsSet = new Set<string>();
    for (const node of sourceTopology.nodes) {
      if (node.namespace) nsSet.add(node.namespace);
    }
    return Array.from(nsSet).sort();
  }, [sourceTopology]);

  // ── Group nodes by namespace ────────────────────────────────────────────
  const nodesByNamespace = useMemo(() => {
    const map = new Map<string, TopologyNode[]>();
    if (!sourceTopology?.nodes) return map;
    for (const node of sourceTopology.nodes) {
      const ns = node.namespace || "__cluster_scoped__";
      if (!map.has(ns)) map.set(ns, []);
      map.get(ns)!.push(node);
    }
    return map;
  }, [sourceTopology]);

  // ── Compute super-node info for collapsed namespaces ────────────────────
  const superNodes = useMemo<NamespaceSuperNodeInfo[]>(() => {
    const result: NamespaceSuperNodeInfo[] = [];
    for (const ns of allNamespaces) {
      if (expandedNamespaces.has(ns)) continue; // Skip expanded namespaces
      const nodes = nodesByNamespace.get(ns) ?? [];
      const health: HealthSummary = { healthy: 0, warning: 0, error: 0, unknown: 0 };
      const kindCounts: Record<string, number> = {};

      for (const node of nodes) {
        health[classifyStatus(node.status)]++;
        kindCounts[node.kind] = (kindCounts[node.kind] ?? 0) + 1;
      }

      result.push({
        namespace: ns,
        resourceCount: nodes.length,
        health,
        overallHealth: computeOverallHealth(health),
        kindCounts,
      });
    }
    return result;
  }, [allNamespaces, expandedNamespaces, nodesByNamespace]);

  // ── Build merged topology ───────────────────────────────────────────────
  const mergedResult = useMemo<{
    topology: TopologyResponse | null;
    truncated: boolean;
    totalBeforeCap: number;
  }>(() => {
    if (!sourceTopology) return { topology: null, truncated: false, totalBeforeCap: 0 };

    const mergedNodes: TopologyNode[] = [];
    const collapsedNsSet = new Set<string>();

    // 1. Add super-nodes for collapsed namespaces
    for (const sn of superNodes) {
      collapsedNsSet.add(sn.namespace);
      mergedNodes.push({
        id: `super::${sn.namespace}`,
        kind: "NamespaceSuperNode",
        name: sn.namespace,
        namespace: sn.namespace,
        apiVersion: "v1",
        category: "cluster",
        label: `${sn.namespace} (${sn.resourceCount} resources)`,
        status: sn.overallHealth,
        layer: -1, // Place super-nodes at the top layer
        group: undefined,
        labels: undefined,
        annotations: undefined,
      });
    }

    // 2. Add all nodes from expanded namespaces + cluster-scoped resources
    if (sourceTopology.nodes) {
      for (const node of sourceTopology.nodes) {
        const ns = node.namespace || "__cluster_scoped__";
        if (collapsedNsSet.has(ns)) continue; // Skip nodes in collapsed namespaces
        mergedNodes.push(node);
      }
    }

    // 3. Filter edges: keep only edges where both source and target are visible
    const visibleNodeIds = new Set(mergedNodes.map((n) => n.id));
    let mergedEdges: TopologyEdge[] = [];
    if (sourceTopology.edges) {
      mergedEdges = sourceTopology.edges.filter(
        (e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target),
      );

      // Also create synthetic edges between super-nodes if there were cross-namespace edges
      const superNodeEdges = new Map<string, TopologyEdge>();
      for (const edge of sourceTopology.edges) {
        const sourceNode = sourceTopology.nodes.find((n) => n.id === edge.source);
        const targetNode = sourceTopology.nodes.find((n) => n.id === edge.target);
        if (!sourceNode || !targetNode) continue;

        const sourceNs = sourceNode.namespace || "__cluster_scoped__";
        const targetNs = targetNode.namespace || "__cluster_scoped__";
        if (sourceNs === targetNs) continue; // Same namespace, skip

        const sourceIsCollapsed = collapsedNsSet.has(sourceNs);
        const targetIsCollapsed = collapsedNsSet.has(targetNs);
        if (!sourceIsCollapsed && !targetIsCollapsed) continue; // Both expanded, already handled

        const effectiveSource = sourceIsCollapsed ? `super::${sourceNs}` : edge.source;
        const effectiveTarget = targetIsCollapsed ? `super::${targetNs}` : edge.target;
        const syntheticId = `synth::${effectiveSource}::${effectiveTarget}`;

        if (!superNodeEdges.has(syntheticId)) {
          superNodeEdges.set(syntheticId, {
            id: syntheticId,
            source: effectiveSource,
            target: effectiveTarget,
            relationshipType: "cross_namespace",
            relationshipCategory: "containment",
            label: "cross-ns",
            style: "dashed",
            animated: false,
            healthy: true,
          });
        }
      }
      mergedEdges = [...mergedEdges, ...Array.from(superNodeEdges.values())];
    }

    // 4. Apply node cap
    let truncated = false;
    const totalBeforeCap = mergedNodes.length;
    let finalNodes = mergedNodes;
    let finalEdges = mergedEdges;

    if (mergedNodes.length > MAX_PROGRESSIVE_NODES) {
      truncated = true;
      finalNodes = mergedNodes.slice(0, MAX_PROGRESSIVE_NODES);
      const keptIds = new Set(finalNodes.map((n) => n.id));
      finalEdges = mergedEdges.filter(
        (e) => keptIds.has(e.source) && keptIds.has(e.target),
      );
    }

    const topology: TopologyResponse = {
      metadata: {
        ...sourceTopology.metadata,
        resourceCount: finalNodes.length,
        edgeCount: finalEdges.length,
      },
      nodes: finalNodes,
      edges: finalEdges,
      groups: sourceTopology.groups ?? [],
    };

    return { topology, truncated, totalBeforeCap };
  }, [sourceTopology, superNodes]);

  // ── Debounced state updater ─────────────────────────────────────────────
  const debouncedSetExpanded = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setExpandedNamespaces(updater);
      }, TOGGLE_DEBOUNCE_MS);
    },
    [],
  );

  // ── Actions ─────────────────────────────────────────────────────────────
  const expandNamespace = useCallback(
    (ns: string) => {
      debouncedSetExpanded((prev) => {
        if (prev.has(ns)) return prev;
        const next = new Set(prev);
        next.add(ns);
        return next;
      });
    },
    [debouncedSetExpanded],
  );

  const collapseNamespace = useCallback(
    (ns: string) => {
      debouncedSetExpanded((prev) => {
        if (!prev.has(ns)) return prev;
        const next = new Set(prev);
        next.delete(ns);
        return next;
      });
    },
    [debouncedSetExpanded],
  );

  const toggleNamespace = useCallback(
    (ns: string) => {
      debouncedSetExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(ns)) {
          next.delete(ns);
        } else {
          next.add(ns);
        }
        return next;
      });
    },
    [debouncedSetExpanded],
  );

  const expandAll = useCallback(() => {
    setExpandedNamespaces(new Set(allNamespaces));
  }, [allNamespaces]);

  const collapseAll = useCallback(() => {
    setExpandedNamespaces(new Set());
  }, []);

  return {
    topology: mergedResult.topology,
    expandedNamespaces,
    superNodes,
    allNamespaces,
    expandNamespace,
    collapseNamespace,
    toggleNamespace,
    expandAll,
    collapseAll,
    truncated: mergedResult.truncated,
    totalBeforeCap: mergedResult.totalBeforeCap,
  };
}
