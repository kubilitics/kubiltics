/**
 * BlastRadiusTab — Dedicated impact analysis view for resource detail pages.
 *
 * Shows criticality scores, fan-in/fan-out, SPOF detection, and a failure
 * simulation mode that highlights affected resources via BFS traversal.
 */
import { useState, useMemo, useCallback, useRef } from "react";
import {
  Zap,
  AlertTriangle,
  Shield,
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-react";

import { useResourceTopology } from "@/hooks/useResourceTopology";
import { useActiveClusterId } from "@/hooks/useActiveClusterId";
import { TopologyCanvas } from "@/topology/TopologyCanvas";
import { transformGraph } from "@/topology/utils/transformGraph";
import type { TopologyResponse, TopologyNode } from "@/topology/types/topology";
import type { ExportFormat } from "@/topology/TopologyCanvas";

export interface BlastRadiusTabProps {
  kind: string;
  namespace?: string;
  name?: string;
}

/** Criticality level to Tailwind color class mapping */
const LEVEL_COLORS: Record<string, string> = {
  critical: "bg-red-600",
  high: "bg-amber-500",
  medium: "bg-yellow-500",
  low: "bg-emerald-500",
};

const LEVEL_TEXT_COLORS: Record<string, string> = {
  critical: "text-red-600",
  high: "text-amber-500",
  medium: "text-yellow-500",
  low: "text-emerald-500",
};

export function BlastRadiusTab({ kind, namespace, name }: BlastRadiusTabProps) {
  const clusterId = useActiveClusterId();

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [simulatedFailureNodeId, setSimulatedFailureNodeId] = useState<string | null>(null);

  const fitViewRef = useRef<(() => void) | null>(null);
  const exportRef = useRef<((format: ExportFormat, filename: string) => void) | null>(null);
  const centerOnNodeRef = useRef<((nodeId: string) => void) | null>(null);

  const canFetch = !!clusterId && !!kind && !!name;

  // Fetch full graph (depth=3) for blast radius analysis
  const { graph, isLoading, error } = useResourceTopology({
    kind,
    namespace,
    name,
    enabled: canFetch,
    depth: 3,
  });

  // Transform engine graph to v2 format
  const topology = useMemo<TopologyResponse | null>(() => {
    if (!graph) return null;
    const response = transformGraph(graph, clusterId ?? undefined);
    response.metadata.mode = "resource";
    if (namespace) response.metadata.namespace = namespace;
    const focusId = response.nodes.find(
      (n) => n.kind === kind && n.name === name && (!namespace || n.namespace === namespace)
    )?.id;
    if (focusId) response.metadata.focusResource = focusId;
    return response;
  }, [graph, clusterId, namespace, kind, name]);

  // Find the focus node and read its criticality data
  const focusNode = useMemo<TopologyNode | null>(() => {
    if (!topology) return null;
    return (
      topology.nodes.find(
        (n) => n.kind === kind && n.name === name && (!namespace || n.namespace === namespace)
      ) ?? null
    );
  }, [topology, kind, name, namespace]);

  const criticality = focusNode?.criticality ?? null;

  // Highlight the focus node
  const highlightNodeIds = useMemo(() => {
    return focusNode ? [focusNode.id] : [];
  }, [focusNode]);

  // BFS to compute affected nodes when simulating failure
  const simulationAffectedNodes = useMemo(() => {
    if (!simulatedFailureNodeId || !topology) return null;
    // Build adjacency: if Target fails, Source is affected (dependents map)
    const dependents = new Map<string, string[]>();
    for (const edge of topology.edges) {
      if (!dependents.has(edge.target)) dependents.set(edge.target, []);
      dependents.get(edge.target)!.push(edge.source);
    }
    // BFS from the failed node through dependents
    const affected = new Set<string>();
    affected.add(simulatedFailureNodeId);
    const queue = [simulatedFailureNodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dep of dependents.get(current) ?? []) {
        if (!affected.has(dep)) {
          affected.add(dep);
          queue.push(dep);
        }
      }
    }
    return affected;
  }, [simulatedFailureNodeId, topology]);

  const isSimulating = simulationAffectedNodes != null && simulationAffectedNodes.size > 0;
  const impactedCount = isSimulating ? simulationAffectedNodes!.size - 1 : 0;

  // Group affected nodes by kind for the affected resources list
  const affectedByKind = useMemo(() => {
    if (!isSimulating || !topology) return new Map<string, string[]>();
    const groups = new Map<string, string[]>();
    for (const node of topology.nodes) {
      if (simulationAffectedNodes!.has(node.id) && node.id !== simulatedFailureNodeId) {
        const list = groups.get(node.kind) ?? [];
        list.push(node.name);
        groups.set(node.kind, list);
      }
    }
    return groups;
  }, [isSimulating, topology, simulationAffectedNodes, simulatedFailureNodeId]);

  // Simulate failure on the focus node
  const handleSimulateFailure = useCallback(() => {
    if (focusNode) {
      setSimulatedFailureNodeId(focusNode.id);
    }
  }, [focusNode]);

  const handleClearSimulation = useCallback(() => {
    setSimulatedFailureNodeId(null);
  }, []);

  // --- Render ---

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-500 mb-4" />
        <p className="text-sm text-muted-foreground">Analyzing blast radius...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
        <p className="text-destructive font-medium mb-2">Failed to load blast radius data</p>
        <p className="text-sm text-muted-foreground">{error.message || String(error)}</p>
      </div>
    );
  }

  if (!topology || topology.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <Shield className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground font-medium mb-2">No topology data available</p>
        <p className="text-sm text-muted-foreground">
          Cannot compute blast radius without connected resources.
        </p>
      </div>
    );
  }

  const blastRadius = criticality?.blastRadius ?? 0;
  const level = criticality?.level ?? "low";
  const fanIn = criticality?.fanIn ?? 0;
  const fanOut = criticality?.fanOut ?? 0;
  const isSPOF = criticality?.isSPOF ?? false;

  return (
    <div className="flex flex-col gap-4 p-4 w-full">
      {/* Score Cards Row */}
      <div className="grid grid-cols-4 gap-4">
        {/* Blast Radius */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1">
            Blast Radius
          </p>
          <p
            className={`text-2xl font-bold ${
              level === "critical" ? "text-red-600" : "text-gray-900 dark:text-gray-100"
            }`}
          >
            {blastRadius}
          </p>
        </div>

        {/* Criticality Level */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1">
            Level
          </p>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold text-white ${
              LEVEL_COLORS[level] ?? LEVEL_COLORS.low
            }`}
          >
            {level.charAt(0).toUpperCase() + level.slice(1)}
          </span>
        </div>

        {/* Fan-in / Fan-out */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1">
            Fan
          </p>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300">
              <ArrowDownRight className="h-3.5 w-3.5 text-blue-500" />
              IN: {fanIn}
            </span>
            <span className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300">
              <ArrowUpRight className="h-3.5 w-3.5 text-orange-500" />
              OUT: {fanOut}
            </span>
          </div>
        </div>

        {/* SPOF Indicator */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1">
            SPOF
          </p>
          {isSPOF ? (
            <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              Yes
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              <Shield className="h-4 w-4" />
              No
            </span>
          )}
        </div>
      </div>

      {/* Simulation Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {!isSimulating ? (
            <button
              type="button"
              onClick={handleSimulateFailure}
              className="inline-flex items-center gap-2 rounded-lg border-2 border-red-300 dark:border-red-700 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              <Zap className="h-4 w-4" />
              Simulate Failure
            </button>
          ) : (
            <>
              <span
                className={`text-sm font-medium ${LEVEL_TEXT_COLORS[level] ?? "text-gray-600"}`}
              >
                {impactedCount} resource{impactedCount !== 1 ? "s" : ""} impacted
              </span>
              <button
                type="button"
                onClick={handleClearSimulation}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-slate-600 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
              >
                Clear Simulation
              </button>
            </>
          )}
        </div>
      </div>

      {/* Topology Canvas — explicit height for React Flow */}
      <div className="rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden" style={{ height: "500px" }}>
        <TopologyCanvas
          topology={topology}
          selectedNodeId={selectedNodeId}
          highlightNodeIds={highlightNodeIds}
          viewMode="resource"
          onSelectNode={setSelectedNodeId}
          fitViewRef={fitViewRef}
          exportRef={exportRef}
          centerOnNodeRef={centerOnNodeRef}
          simulationAffectedNodes={simulationAffectedNodes}
          simulatedFailureNodeId={simulatedFailureNodeId}
        />
      </div>

      {/* Affected Resources List (visible only during simulation) */}
      {isSimulating && affectedByKind.size > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
            Affected Resources
          </h4>
          <div className="grid grid-cols-3 gap-4">
            {Array.from(affectedByKind.entries()).map(([resourceKind, names]) => (
              <div key={resourceKind}>
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">
                  {resourceKind} ({names.length})
                </p>
                <ul className="space-y-0.5">
                  {names.map((resourceName) => (
                    <li
                      key={resourceName}
                      className="text-sm text-gray-700 dark:text-gray-300 truncate"
                    >
                      {resourceName}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
