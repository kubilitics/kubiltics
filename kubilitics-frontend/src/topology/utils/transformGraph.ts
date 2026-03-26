/**
 * transformGraph — Converts topology-engine TopologyGraph to v2 TopologyResponse format.
 *
 * Shared between:
 * - useTopologyData (main cluster topology)
 * - ResourceTopologyV2View (resource-specific topology)
 */
import type {
  TopologyGraph,
  TopologyNode as EngineNode,
  TopologyEdge as EngineEdge,
} from "@/topology-engine/types/topology.types";
import type {
  TopologyResponse,
  TopologyNode,
  TopologyEdge,
} from "../types/topology";

/** Map engine kind to v2 category */
export function kindToCategory(kind: string): string {
  const map: Record<string, string> = {
    Deployment: "compute", StatefulSet: "compute", DaemonSet: "compute",
    ReplicaSet: "compute", Pod: "compute", PodGroup: "compute",
    Job: "compute", CronJob: "compute", Container: "compute",
    ReplicationController: "compute",
    Service: "networking", Ingress: "networking", NetworkPolicy: "networking",
    Endpoints: "networking", EndpointSlice: "networking", IngressClass: "networking",
    PersistentVolumeClaim: "storage", PersistentVolume: "storage",
    StorageClass: "storage", VolumeAttachment: "storage",
    ConfigMap: "config", Secret: "config",
    ServiceAccount: "security", Role: "security", ClusterRole: "security",
    RoleBinding: "security", ClusterRoleBinding: "security",
    HorizontalPodAutoscaler: "scaling", PodDisruptionBudget: "scaling",
    Node: "scheduling", Namespace: "scheduling",
  };
  return map[kind] ?? "custom";
}

/** Map engine relationship to v2 edge category */
export function relToCategory(rel: string): string {
  const map: Record<string, string> = {
    owns: "ownership", manages: "ownership",
    selects: "networking", exposes: "networking", routes: "networking",
    mounts: "storage", stores: "storage", backed_by: "storage",
    references: "configuration", configures: "configuration",
    permits: "rbac",
    scheduled_on: "scheduling", schedules: "scheduling", runs: "scheduling",
    limits: "policy", contains: "ownership",
  };
  return map[rel] ?? "ownership";
}

// ── Edge label & deduplication ────────────────────────────────────────────
// Category priority: when multiple edges connect the same two nodes, keep
// the one from the highest-priority category (ownership > networking > etc).
// Lower number = higher priority.
const CATEGORY_PRIORITY: Record<string, number> = {
  ownership: 0,
  networking: 1,
  scaling: 2,
  storage: 3,
  configuration: 4,
  rbac: 5,
  policy: 6,
  scheduling: 7,
  containment: 8,
  cluster: 9,
};

/**
 * Clean an edge label for canvas display.
 * Strips filesystem paths, long selectors, and IPs — keeps short, human-readable text.
 * Verbose details stay in the `detail` field for the side panel.
 */
function cleanEdgeLabel(label: string, relationshipType: string): string {
  // Static short labels by relationship type (override verbose matcher output)
  const shortLabels: Record<string, string> = {
    ownerRef: "owned by",
    namespace: "in namespace",
    scheduling: "runs on",
    service_account: "uses SA",
    priority_class: "priority",
    runtime_class: "runtime",
    endpoint_target: "target",
    endpoints: "endpoints",
    endpoint_slice: "endpoints",
    ingress_backend: "routes to",
    ingress_class: "class",
    ingress_tls: "TLS cert",
    ingress_default: "default backend",
    resource_quota: "quota",
    taint_toleration: "tolerates",
  };
  if (shortLabels[relationshipType]) return shortLabels[relationshipType];

  // Strip filesystem paths: "mounts → /var/run/secrets/..." → "mounts"
  // "projects → /var/run/secrets/..." → "projects"
  // "token → /var/run/secrets/..." → "token"
  if (label.includes("→")) {
    const action = label.split("→")[0].trim();
    return action;
  }

  // Strip long selector strings: "selects (app=checkout, version=v1)" → "selects"
  if (label.includes("(") && label.length > 30) {
    return label.split("(")[0].trim();
  }

  // Strip IP addresses in parentheses: "target (10.20.1.160)" → "target"
  if (/\(\d+\.\d+\.\d+\.\d+\)/.test(label)) {
    return label.replace(/\s*\(\d+\.\d+\.\d+\.\d+\)/, "").trim();
  }

  // Truncate anything over 25 chars
  if (label.length > 25) {
    return label.slice(0, 22) + "…";
  }

  return label;
}

/** Assign layer for layout ordering */
export function kindToLayer(kind: string): number {
  const map: Record<string, number> = {
    Ingress: 0, IngressClass: 0,
    Service: 1, Endpoints: 1, EndpointSlice: 1,
    Deployment: 2, StatefulSet: 2, DaemonSet: 2, Job: 2, CronJob: 2,
    ReplicaSet: 3, ReplicationController: 3,
    Pod: 4, PodGroup: 4, Container: 4,
    Node: 5,
    ConfigMap: 3, Secret: 3,
    PersistentVolumeClaim: 3, PersistentVolume: 4, StorageClass: 5,
    ServiceAccount: 3, Role: 2, ClusterRole: 2,
    RoleBinding: 3, ClusterRoleBinding: 3,
    Namespace: 0, HorizontalPodAutoscaler: 2,
  };
  return map[kind] ?? 3;
}

// Kinds that are operational telemetry, not infrastructure relationships.
// These belong in the Events/Logs tabs, not in the topology graph.
const EXCLUDED_KINDS = new Set(["Event"]);

/** Convert engine TopologyGraph → v2 TopologyResponse */
export function transformGraph(graph: TopologyGraph, clusterName?: string): TopologyResponse {
  // Filter out operational telemetry nodes (Events) — they add noise, not insight
  const filteredNodes = graph.nodes.filter((n) => !EXCLUDED_KINDS.has(n.kind));
  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));

  const nodes: TopologyNode[] = filteredNodes.map((n: EngineNode) => ({
    id: n.id,
    kind: n.kind,
    name: n.name,
    namespace: n.namespace ?? "",
    apiVersion: n.apiVersion ?? "",
    category: kindToCategory(n.kind),
    label: n.label ?? n.name,
    status: n.computed?.health === "healthy" ? "Running" :
            n.computed?.health === "warning" ? "Pending" :
            n.computed?.health === "critical" ? "Failed" :
            n.status ?? "Unknown",
    statusReason: n.status,
    metrics: n.computed ? {
      cpuUsage: n.computed.cpuUsage,
      memoryUsage: n.computed.memoryUsage,
      restartCount: n.computed.restartCount,
      podCount: n.computed.replicas?.desired,
      readyCount: n.computed.replicas?.ready,
    } : undefined,
    layer: kindToLayer(n.kind),
    labels: n.metadata?.labels,
    annotations: n.metadata?.annotations,
    createdAt: n.metadata?.createdAt,
    // Debugging fields — passed through from backend
    podIP: (n as Record<string, unknown>).podIP as string | undefined,
    nodeName: (n as Record<string, unknown>).nodeName as string | undefined,
    internalIP: (n as Record<string, unknown>).internalIP as string | undefined,
    externalIP: (n as Record<string, unknown>).externalIP as string | undefined,
    clusterIP: (n as Record<string, unknown>).clusterIP as string | undefined,
    serviceType: (n as Record<string, unknown>).serviceType as string | undefined,
    containers: (n as Record<string, unknown>).containers as number | undefined,
  }));

  // ── Deduplicate parallel edges ────────────────────────────────────────
  // Skip edges that connect to excluded nodes (Events, etc.).
  // Then merge parallel edges between the same source→target pair into one,
  // keeping the highest-priority edge and merging verbose details.
  const edgePairMap = new Map<string, {
    best: EngineEdge;
    bestCategory: string;
    bestPriority: number;
    allDetails: string[];
    allLabels: string[];
  }>();

  for (const e of graph.edges) {
    // Skip edges connected to excluded nodes
    if (!filteredNodeIds.has(e.source) || !filteredNodeIds.has(e.target)) continue;
    const pairKey = `${e.source}|${e.target}`;
    const cat = relToCategory(e.relationshipType);
    const priority = CATEGORY_PRIORITY[cat] ?? 99;
    const existing = edgePairMap.get(pairKey);

    if (!existing) {
      edgePairMap.set(pairKey, {
        best: e,
        bestCategory: cat,
        bestPriority: priority,
        allDetails: [e.metadata?.sourceField, e.label].filter(Boolean) as string[],
        allLabels: [e.label ?? e.relationshipType],
      });
    } else {
      // Collect all details for the side panel
      if (e.metadata?.sourceField) existing.allDetails.push(e.metadata.sourceField);
      if (e.label) existing.allLabels.push(e.label);
      // Keep the higher-priority edge
      if (priority < existing.bestPriority) {
        existing.best = e;
        existing.bestCategory = cat;
        existing.bestPriority = priority;
      }
    }
  }

  const edges: TopologyEdge[] = Array.from(edgePairMap.values()).map(({ best, bestCategory, allDetails }) => {
    const rawLabel = best.label ?? best.relationshipType;
    return {
      id: best.id,
      source: best.source,
      target: best.target,
      relationshipType: best.relationshipType,
      relationshipCategory: bestCategory,
      label: cleanEdgeLabel(rawLabel, best.relationshipType),
      // Preserve ALL details from merged edges for the detail panel
      detail: allDetails.length > 1
        ? allDetails.filter((v, i, a) => a.indexOf(v) === i).join(" · ")
        : allDetails[0] ?? best.metadata?.sourceField,
      style: "solid",
      animated: best.relationshipType === "selects" || best.relationshipType === "routes",
      healthy: true,
    };
  });

  return {
    metadata: {
      clusterId: graph.metadata?.clusterId ?? "",
      clusterName: clusterName || graph.metadata?.clusterId || "",
      mode: "namespace",
      resourceCount: nodes.length,
      edgeCount: edges.length,
      buildTimeMs: 0,
    },
    nodes,
    edges,
    groups: [],
  };
}
