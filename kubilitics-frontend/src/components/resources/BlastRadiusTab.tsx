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

  // Transform engine graph to ReactFlow topology format
  const topology = useMemo<TopologyResponse | null>(() => {
    if (!graph) return null;
    const response = transformGraph(graph, clusterId ?? undefined);
    response.metadata.mode = 'resource';
    if (namespace) response.metadata.namespace = namespace;
    const focusId = response.nodes.find(
      (n) => n.kind === kind && n.name === name && (!namespace || n.namespace === namespace),
    )?.id;
    if (focusId) response.metadata.focusResource = focusId;
    return response;
  }, [graph, clusterId, namespace, kind, name]);

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
    if (!blastData?.waves?.length || !focusNode) return;

    const engine = new SimulationEngine(blastData.waves);
    engineRef.current = engine;

    setSimulatedFailureNodeId(focusNode.id);
    setIsSimulating(true);
    setCurrentWave(-1);

    // Track which wave each node was first affected in (wave depth = wave index + 1)
    const waveDepthMap = new Map<string, number>();

    engine.onWave((wave, affected) => {
      setCurrentWave(wave);
      // Build canvas-compatible node IDs: match topology node IDs
      const canvasAffected = new Set<string>();
      canvasAffected.add(focusNode.id);
      for (const nodeId of affected) {
        // SimulationEngine uses kind/namespace/name — find matching topology node
        const parts = nodeId.split('/');
        if (parts.length >= 3) {
          const [rKind, rNs, ...rest] = parts;
          const rName = rest.join('/');
          const match = topology?.nodes.find(
            (n) => n.kind === rKind && n.namespace === rNs && n.name === rName,
          );
          if (match) {
            canvasAffected.add(match.id);
            // Record wave depth (1-indexed) — only first time seen
            if (!waveDepthMap.has(match.id)) {
              waveDepthMap.set(match.id, wave + 1);
            }
          }
        }
      }
      setSimulationAffectedNodes(canvasAffected);
      setSimulationWaveDepths(new Map(waveDepthMap));
    });

    engine.onComplete(() => {
      // Keep final state visible — don't auto-clear
    });

    engine.start();
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
  const totalWaves = blastData?.waves?.length ?? 0;

  return (
    <div className="flex flex-col gap-4 p-4 w-full">
      {/* 1. Criticality Banner */}
      {hasBlastData && blastData && (
        <CriticalityBanner
          criticalityScore={blastData.criticality_score}
          criticalityLevel={blastData.criticality_level}
          blastRadiusPercent={blastData.blast_radius_percent}
          totalAffected={blastData.total_affected}
          affectedNamespaces={blastData.affected_namespaces}
          targetName={targetName}
        />
      )}

      {/* 2. Risk Indicator Cards */}
      {hasBlastData && blastData && (
        <RiskIndicatorCards
          isSPOF={blastData.is_spof}
          blastRadiusPercent={blastData.blast_radius_percent}
          criticalityLevel={blastData.criticality_level}
          fanIn={blastData.fan_in}
          fanOut={blastData.fan_out}
          affectedNamespaces={blastData.affected_namespaces}
          replicaCount={blastData.replica_count}
        />
      )}

      {/* 3. Simulation Controls */}
      <SimulationControls
        onSimulate={handleSimulate}
        onClear={handleClearSimulation}
        onFitView={handleFitView}
        onExport={handleExport}
        isSimulating={isSimulating}
        currentWave={currentWave}
        totalWaves={totalWaves}
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
              waves={blastData.waves}
              onResourceClick={handleResourceClick}
            />
          </div>
          <div
            className={cn(
              'rounded-lg border border-slate-200 dark:border-slate-700 p-4',
              'bg-white dark:bg-slate-900',
            )}
          >
            <RiskPanel risks={blastData.risk_indicators} />
          </div>
        </div>
      )}
    </div>
  );
}
