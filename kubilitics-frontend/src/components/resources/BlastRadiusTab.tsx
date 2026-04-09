/**
 * BlastRadiusTab — Complete rewrite using V2 cluster-wide graph API.
 *
 * Composes: CriticalityBanner, RiskIndicatorCards, SimulationControls,
 * TopologyCanvas, WaveBreakdown, and RiskPanel.
 *
 * Handles loading, error, graph-building, and data-ready states.
 */
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, Shield } from 'lucide-react';

import { useBlastRadius } from '@/hooks/useBlastRadius';
import { useResourceTopology } from '@/hooks/useResourceTopology';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { kindToRoutePath } from '@/utils/resourceKindMapper';
import { TopologyCanvas } from '@/topology/TopologyCanvas';
import { transformGraph } from '@/topology/utils/transformGraph';
import type { TopologyResponse } from '@/topology/types/topology';
import type { ExportFormat } from '@/topology/TopologyCanvas';

import { CriticalityBanner } from '@/components/blast-radius/CriticalityBanner';
import { RiskIndicatorCards } from '@/components/blast-radius/RiskIndicatorCards';
import { SimulationControls } from '@/components/blast-radius/SimulationControls';
import { SimulationEngine } from '@/components/blast-radius/SimulationEngine';
import { WaveBreakdown } from '@/components/blast-radius/WaveBreakdown';
import { RiskPanel } from '@/components/blast-radius/RiskPanel';
import { cn } from '@/lib/utils';

export interface BlastRadiusTabProps {
  kind: string;
  namespace?: string;
  name?: string;
}

/** Build a detail page path for a resource. */
function buildResourceDetailPath(
  resourceKind: string,
  resourceName: string,
  resourceNamespace?: string,
): string {
  const route = kindToRoutePath(resourceKind);
  if (resourceNamespace) {
    return `/${route}/${resourceNamespace}/${resourceName}`;
  }
  return `/${route}/${resourceName}`;
}

// ── Graph Building Skeleton ──────────────────────────────────────────────

// ── Main Component ───────────────────────────────────────────────────────

export function BlastRadiusTab({ kind, namespace, name }: BlastRadiusTabProps) {
  const clusterId = useActiveClusterId();
  const navigate = useNavigate();

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [simulationAffectedNodes, setSimulationAffectedNodes] = useState<Set<string> | null>(null);
  const [simulatedFailureNodeId, setSimulatedFailureNodeId] = useState<string | null>(null);
  const [simulationWaveDepths, setSimulationWaveDepths] = useState<Map<string, number> | null>(null);
  const [currentWave, setCurrentWave] = useState(-1);
  const [isSimulating, setIsSimulating] = useState(false);

  const fitViewRef = useRef<(() => void) | null>(null);
  const exportRef = useRef<((format: ExportFormat, filename: string) => void) | null>(null);
  const centerOnNodeRef = useRef<((nodeId: string) => void) | null>(null);
  const engineRef = useRef<SimulationEngine | null>(null);

  const canFetch = !!clusterId && !!kind && !!name;

  // ── V2 blast radius API ────────────────────────────────────────────────
  const {
    data: blastData,
    isLoading: brLoading,
    error: brError,
    isGraphReady,
  } = useBlastRadius({ kind, namespace, name, enabled: canFetch });

  // ── Topology graph (for the canvas visualization) ──────────────────────
  const { graph, isLoading: topoLoading, error: topoError } = useResourceTopology({
    kind,
    namespace,
    name,
    enabled: canFetch,
    depth: 3,
  });

  const isLoading = topoLoading || (brLoading && !brError);
  const error = topoError; // Only show error if topology fails — V2 blast errors are handled gracefully

  // Transform engine graph to ReactFlow topology format, then inject blast radius
  // affected resources that the topology BFS didn't reach (cross-namespace).
  const topology = useMemo<TopologyResponse | null>(() => {
    if (!graph) return null;
    const response = transformGraph(graph, clusterId ?? undefined);
    response.metadata.mode = 'resource';
    if (namespace) response.metadata.namespace = namespace;
    const focusId = response.nodes.find(
      (n) => n.kind === kind && n.name === name && (!namespace || n.namespace === namespace),
    )?.id;
    if (focusId) response.metadata.focusResource = focusId;

    // Inject blast radius affected resources not already in the topology graph.
    // This ensures cross-namespace resources (found by the graph engine) are visible.
    // Cross-namespace resources get namespace group containers and visual markers.
    if (blastData?.waves) {
      const existingIds = new Set(response.nodes.map((n) => n.id));
      const crossNsGroupIds = new Set<string>();

      for (const wave of blastData.waves) {
        for (const res of wave.resources) {
          const nodeId = `${res.kind}/${res.namespace}/${res.name}`;
          const isCrossNamespace = !!namespace && res.namespace !== namespace;

          if (!existingIds.has(nodeId)) {
            existingIds.add(nodeId);
            // Add as a minimal topology node
            response.nodes.push({
              id: nodeId,
              kind: res.kind,
              name: res.name,
              namespace: res.namespace,
              status: 'Active',
              label: res.name,
              category: res.kind === 'NetworkPolicy' ? 'policy' : res.kind === 'Ingress' ? 'networking' : 'workload',
              layer: 2,
              metadata: { labels: {}, annotations: {}, createdAt: '' },
              computed: { health: 'healthy' },
            } as TopologyResponse['nodes'][number]);

            // Add edge from focus resource to this blast-affected resource
            if (focusId) {
              response.edges.push({
                id: `blast:${focusId}→${nodeId}`,
                source: focusId,
                target: nodeId,
                relationshipType: isCrossNamespace ? 'blast_cross_ns' : 'blast_impact',
                relationshipCategory: 'policy',
                label: isCrossNamespace
                  ? `wave ${wave.depth} → ${res.namespace}`
                  : `wave ${wave.depth} impact`,
                detail: res.impact,
                style: 'dashed',
                healthy: true,
              } as TopologyResponse['edges'][number]);
            }
          }

          // Track cross-namespace groups and assign nodes to them
          if (isCrossNamespace) {
            const groupId = `ns-group-${res.namespace}`;
            if (!crossNsGroupIds.has(groupId)) {
              crossNsGroupIds.add(groupId);
              response.groups.push({
                id: groupId,
                label: res.namespace,
                type: 'namespace',
                members: [],
                collapsed: false,
                style: {
                  backgroundColor: '#fef3c7',  // amber-100
                  borderColor: '#f59e0b',       // amber-500
                },
              });
            }
            // Add this resource as a member of its namespace group
            const group = response.groups.find((g) => g.id === groupId);
            if (group && !group.members.includes(nodeId)) {
              group.members.push(nodeId);
            }
          }
        }
      }
    }

    return response;
  }, [graph, clusterId, namespace, kind, name, blastData]);

  // Focus node for canvas highlight
  const focusNode = useMemo(() => {
    if (!topology) return null;
    return (
      topology.nodes.find(
        (n) => n.kind === kind && n.name === name && (!namespace || n.namespace === namespace),
      ) ?? null
    );
  }, [topology, kind, name, namespace]);

  const highlightNodeIds = useMemo(() => {
    return focusNode ? [focusNode.id] : [];
  }, [focusNode]);

  // ── Simulation ─────────────────────────────────────────────────────────

  // Cleanup simulation engine on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.stop();
    };
  }, []);

  const handleSimulate = useCallback(() => {
    if (!focusNode || !topology) return;

    // If we have blast data with waves, use the SimulationEngine for wave-by-wave animation
    if (blastData?.waves?.length) {
      const engine = new SimulationEngine(blastData.waves);
      engineRef.current = engine;

      setSimulatedFailureNodeId(focusNode.id);
      setIsSimulating(true);
      setCurrentWave(-1);

      const waveDepthMap = new Map<string, number>();

      engine.onWave((wave, affected) => {
        setCurrentWave(wave);
        const canvasAffected = new Set<string>();
        canvasAffected.add(focusNode.id);
        for (const nodeId of affected) {
          const parts = nodeId.split('/');
          if (parts.length >= 3) {
            const [rKind, rNs, ...rest] = parts;
            const rName = rest.join('/');
            const match = topology.nodes.find(
              (n) => n.kind === rKind && n.namespace === rNs && n.name === rName,
            );
            if (match) {
              canvasAffected.add(match.id);
              if (!waveDepthMap.has(match.id)) {
                waveDepthMap.set(match.id, wave + 1);
              }
            }
          }
        }
        setSimulationAffectedNodes(canvasAffected);
        setSimulationWaveDepths(new Map(waveDepthMap));
      });

      engine.onComplete(() => {});
      engine.start();
      return;
    }

    // Fallback: BFS from topology edges (no blast data needed)
    const adj = new Map<string, Set<string>>();
    for (const edge of topology.edges) {
      if (!adj.has(edge.source)) adj.set(edge.source, new Set());
      if (!adj.has(edge.target)) adj.set(edge.target, new Set());
      adj.get(edge.source)!.add(edge.target);
      adj.get(edge.target)!.add(edge.source);
    }

    // BFS from focus node — animate wave by wave
    const visited = new Map<string, number>();
    visited.set(focusNode.id, 0);
    let queue = [focusNode.id];
    let wave = 0;
    const waveGroups: string[][] = [];

    while (queue.length > 0) {
      wave++;
      const nextQueue: string[] = [];
      const waveNodes: string[] = [];
      for (const nodeId of queue) {
        for (const neighbor of adj.get(nodeId) ?? []) {
          if (!visited.has(neighbor)) {
            visited.set(neighbor, wave);
            nextQueue.push(neighbor);
            waveNodes.push(neighbor);
          }
        }
      }
      if (waveNodes.length > 0) waveGroups.push(waveNodes);
      queue = nextQueue;
    }

    setSimulatedFailureNodeId(focusNode.id);
    setIsSimulating(true);
    setCurrentWave(-1);

    // Animate wave by wave at 800ms intervals
    const totalWavesCount = waveGroups.length;
    const allAffected = new Set<string>([focusNode.id]);
    const depthMap = new Map<string, number>();
    let currentIdx = 0;

    const animateWave = () => {
      if (currentIdx >= totalWavesCount) return;
      for (const nodeId of waveGroups[currentIdx]) {
        allAffected.add(nodeId);
        if (!depthMap.has(nodeId)) depthMap.set(nodeId, currentIdx + 1);
      }
      setCurrentWave(currentIdx);
      setSimulationAffectedNodes(new Set(allAffected));
      setSimulationWaveDepths(new Map(depthMap));
      currentIdx++;
      if (currentIdx < totalWavesCount) {
        setTimeout(animateWave, 800);
      }
    };

    setTimeout(animateWave, 800);
  }, [blastData, focusNode, topology]);

  const handleClearSimulation = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    setSimulatedFailureNodeId(null);
    setSimulationAffectedNodes(null);
    setSimulationWaveDepths(null);
    setIsSimulating(false);
    setCurrentWave(-1);
  }, []);

  const handleFitView = useCallback(() => {
    fitViewRef.current?.();
  }, []);

  const handleExport = useCallback(() => {
    const exportName = `blast-radius-${kind}-${name}`;
    exportRef.current?.('png', exportName);
  }, [kind, name]);

  const handleExportCSV = useCallback(async () => {
    if (!topology) return;
    const { exportTopologyCSV } = await import('@/topology/export/exportCSV');
    const baseUrl = (await import('@/stores/backendConfigStore')).getEffectiveBackendBaseUrl(
      (await import('@/stores/backendConfigStore')).useBackendConfigStore.getState().backendBaseUrl
    );
    await exportTopologyCSV(topology, baseUrl, clusterId ?? '', {
      resourceKind: kind,
      resourceName: name,
    });
  }, [topology, clusterId, kind, name]);

  const handleResourceClick = useCallback(
    (resourceKind: string, resourceNamespace: string, resourceName: string) => {
      navigate(buildResourceDetailPath(resourceKind, resourceName, resourceNamespace));
    },
    [navigate],
  );

  // ── Render States ──────────────────────────────────────────────────────

  // Loading (only block on topology loading, not blast radius)
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 dark:border-slate-700 border-t-blue-500 dark:border-t-blue-400 mb-4" />
        <p className="text-sm text-slate-500 dark:text-slate-400">Analyzing blast radius...</p>
      </div>
    );
  }

  // When V2 API fails (graph engine not running), show topology-only view
  // Don't show error — just skip the V2 components and show the graph
  const hasBlastData = !!blastData && !brError;

  // No data at all
  if (!topology || topology.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <Shield className="h-12 w-12 text-slate-400 dark:text-slate-500 mb-4" />
        <p className="text-slate-600 dark:text-slate-300 font-medium mb-2">
          No topology data available
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Cannot compute blast radius without connected resources.
        </p>
      </div>
    );
  }

  const targetName = `${kind}/${name}`;
  // Total waves = from blast data, or from simulation wave depths (BFS fallback)
  const totalWaves = blastData?.waves?.length ?? (simulationWaveDepths ? Math.max(...Array.from(simulationWaveDepths.values()), 0) : 0);

  return (
    <div className="flex flex-col gap-4 p-4 w-full">
      {/* 1. Criticality Banner */}
      {hasBlastData && blastData && (
        <CriticalityBanner
          criticalityScore={blastData.criticalityScore}
          criticalityLevel={blastData.criticalityLevel}
          blastRadiusPercent={blastData.blastRadiusPercent}
          totalAffected={blastData.totalAffected}
          affectedNamespaces={blastData.affectedNamespaces}
          targetName={targetName}
        />
      )}

      {/* 2. Risk Indicator Cards */}
      {hasBlastData && blastData && (
        <RiskIndicatorCards
          isSPOF={blastData.isSPOF}
          blastRadiusPercent={blastData.blastRadiusPercent}
          criticalityLevel={blastData.criticalityLevel}
          fanIn={blastData.fanIn}
          fanOut={blastData.fanOut}
          affectedNamespaces={blastData.affectedNamespaces}
          replicaCount={blastData.replicaCount}
        />
      )}

      {/* 3. Simulation Controls */}
      <SimulationControls
        onSimulate={handleSimulate}
        onClear={handleClearSimulation}
        onFitView={handleFitView}
        onExport={handleExport}
        onExportCSV={handleExportCSV}
        isSimulating={isSimulating}
        affectedCount={simulationAffectedNodes ? simulationAffectedNodes.size - 1 : 0}
      />

      {/* 4. Topology Canvas */}
      <div
        className={cn(
          'rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden',
          'bg-white dark:bg-slate-900',
        )}
        style={{ height: '500px' }}
      >
        <TopologyCanvas
          topology={topology}
          selectedNodeId={selectedNodeId}
          highlightNodeIds={highlightNodeIds}
          viewMode="resource"
          namespace={namespace}
          onSelectNode={setSelectedNodeId}
          fitViewRef={fitViewRef}
          exportRef={exportRef}
          centerOnNodeRef={centerOnNodeRef}
          simulationAffectedNodes={simulationAffectedNodes}
          simulatedFailureNodeId={simulatedFailureNodeId}
          simulationWaveDepths={simulationWaveDepths}
          simulationCurrentWave={currentWave}
          simulationTotalWaves={totalWaves}
        />
      </div>

      {/* 5. Bottom split panel: WaveBreakdown | RiskPanel */}
      {hasBlastData && blastData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div
            className={cn(
              'rounded-lg border border-slate-200 dark:border-slate-700 p-4',
              'bg-white dark:bg-slate-900',
            )}
          >
            <WaveBreakdown
              waves={blastData.waves ?? []}
              targetNamespace={namespace}
              onResourceClick={handleResourceClick}
            />
          </div>
          <div
            className={cn(
              'rounded-lg border border-slate-200 dark:border-slate-700 p-4',
              'bg-white dark:bg-slate-900',
            )}
          >
            <RiskPanel risks={blastData.riskIndicators ?? []} />
          </div>
        </div>
      )}
    </div>
  );
}
