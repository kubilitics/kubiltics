/**
 * useNodeTrafficImpact — Fetches traffic edges and impact data for a selected topology node.
 *
 * Only fetches when a node is selected (not on every render).
 * Uses react-query for caching, following the useClusterTopology pattern.
 */
import { useQuery } from "@tanstack/react-query";
import { backendRequest } from "@/services/backendApiClient";
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from "@/stores/backendConfigStore";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CriticalityLevel = "critical" | "high" | "medium" | "low";

export interface NodeCriticality {
  level: CriticalityLevel;
  pageRank: number;       // 0-100
  fanIn: number;
  fanOut: number;
  isSpof: boolean;
}

export interface TrafficEdge {
  id: string;
  source: string;
  sourceName: string;
  sourceKind: string;
  target: string;
  targetName: string;
  targetKind: string;
  port: number;
  protocol: string;
  direction: "incoming" | "outgoing";
  confidence: number;     // 0-1
}

export interface ImpactedResource {
  kind: string;
  name: string;
  namespace: string;
  depth: number;
}

export interface NodeTrafficImpactResult {
  criticality: NodeCriticality | null;
  trafficEdges: TrafficEdge[];
  impactedResources: ImpactedResource[];
  blastRadius: number;
  isLoading: boolean;
  isSimulating: boolean;
  error: Error | null;
}

// ─── API response types ───────────────────────────────────────────────────────

interface TrafficApiResponse {
  edges: Array<{
    id: string;
    source: string;
    sourceName?: string;
    sourceKind?: string;
    target: string;
    targetName?: string;
    targetKind?: string;
    port?: number;
    protocol?: string;
    confidence?: number;
  }>;
}

interface ImpactApiResponse {
  impacted: Array<{
    kind: string;
    name: string;
    namespace: string;
    depth?: number;
  }>;
  criticality?: {
    level?: string;
    pageRank?: number;
    fanIn?: number;
    fanOut?: number;
    isSpof?: boolean;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseNodeId(nodeId: string): { kind: string; namespace: string; name: string } | null {
  // Expected format: "Kind/Namespace/Name" or "Kind//Name" (cluster-scoped)
  const parts = nodeId.split("/");
  if (parts.length < 3) return null;
  return {
    kind: parts[0],
    namespace: parts[1],
    name: parts.slice(2).join("/"), // name might contain slashes
  };
}

function normalizeCriticality(level: string | undefined): CriticalityLevel {
  const l = (level ?? "low").toLowerCase();
  if (l === "critical") return "critical";
  if (l === "high") return "high";
  if (l === "medium") return "medium";
  return "low";
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNodeTrafficImpact(
  clusterId: string | null,
  nodeId: string | null
): NodeTrafficImpactResult {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  const parsed = nodeId ? parseNodeId(nodeId) : null;
  const enabled = !!clusterId && !!parsed && isBackendConfigured();

  // Fetch traffic edges
  const trafficQuery = useQuery<TrafficEdge[], Error>({
    queryKey: ["topology-traffic", clusterId, nodeId],
    queryFn: async () => {
      if (!clusterId || !parsed) throw new Error("Missing params");
      const path = `clusters/${encodeURIComponent(clusterId)}/topology/v2/traffic`;
      const data = await backendRequest<TrafficApiResponse>(effectiveBaseUrl, path);

      const edges: TrafficEdge[] = [];
      for (const e of data.edges ?? []) {
        const isSource = e.source === nodeId;
        const isTarget = e.target === nodeId;
        if (!isSource && !isTarget) continue;

        edges.push({
          id: e.id,
          source: e.source,
          sourceName: e.sourceName ?? e.source.split("/").pop() ?? e.source,
          sourceKind: e.sourceKind ?? e.source.split("/")[0] ?? "",
          target: e.target,
          targetName: e.targetName ?? e.target.split("/").pop() ?? e.target,
          targetKind: e.targetKind ?? e.target.split("/")[0] ?? "",
          port: e.port ?? 0,
          protocol: e.protocol ?? "TCP",
          direction: isSource ? "outgoing" : "incoming",
          confidence: e.confidence ?? 0.5,
        });
      }
      return edges;
    },
    enabled,
    staleTime: 120_000,
  });

  // Fetch impact + criticality
  const impactQuery = useQuery<{ impacted: ImpactedResource[]; criticality: NodeCriticality }, Error>({
    queryKey: ["topology-impact", clusterId, nodeId],
    queryFn: async () => {
      if (!clusterId || !parsed) throw new Error("Missing params");
      const path = `clusters/${encodeURIComponent(clusterId)}/topology/v2/impact/${encodeURIComponent(parsed.kind)}/${encodeURIComponent(parsed.namespace)}/${encodeURIComponent(parsed.name)}?depth=3`;
      const data = await backendRequest<ImpactApiResponse>(effectiveBaseUrl, path);

      const impacted: ImpactedResource[] = (data.impacted ?? []).map((r) => ({
        kind: r.kind,
        name: r.name,
        namespace: r.namespace,
        depth: r.depth ?? 1,
      }));

      const criticality: NodeCriticality = {
        level: normalizeCriticality(data.criticality?.level),
        pageRank: data.criticality?.pageRank ?? 0,
        fanIn: data.criticality?.fanIn ?? 0,
        fanOut: data.criticality?.fanOut ?? 0,
        isSpof: data.criticality?.isSpof ?? false,
      };

      return { impacted, criticality };
    },
    enabled,
    staleTime: 120_000,
  });

  return {
    criticality: impactQuery.data?.criticality ?? null,
    trafficEdges: trafficQuery.data ?? [],
    impactedResources: impactQuery.data?.impacted ?? [],
    blastRadius: impactQuery.data?.impacted?.length ?? 0,
    isLoading: trafficQuery.isLoading || impactQuery.isLoading,
    isSimulating: false,
    error: trafficQuery.error ?? impactQuery.error ?? null,
  };
}
