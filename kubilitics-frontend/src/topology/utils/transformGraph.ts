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

/** Convert engine TopologyGraph → v2 TopologyResponse */
export function transformGraph(graph: TopologyGraph): TopologyResponse {
  const nodes: TopologyNode[] = graph.nodes.map((n: EngineNode) => ({
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
  }));

  const edges: TopologyEdge[] = graph.edges.map((e: EngineEdge) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    relationshipType: e.relationshipType,
    relationshipCategory: relToCategory(e.relationshipType),
    label: e.label ?? e.relationshipType,
    detail: e.metadata?.sourceField,
    style: "solid",
    animated: e.relationshipType === "selects" || e.relationshipType === "routes",
    healthy: true,
  }));

  return {
    metadata: {
      clusterId: graph.metadata?.clusterId ?? "",
      clusterName: graph.metadata?.clusterId ?? "",
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
