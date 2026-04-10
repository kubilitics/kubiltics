/**
 * IntelligenceWorkspace — unified canvas merging Topology + Blast Radius + What-If.
 *
 * Route: /intelligence/:kind/:namespace/:name
 *
 * Layout:
 *   ┌────────────────────────────────────────────────┐
 *   │ Top bar  (60px, shrink-0)                      │
 *   ├────────────────────────────────────────────────┤
 *   │ Canvas   (flex-1, relative)                    │
 *   │   TopologyCanvas + overlays                    │
 *   │   FirstPaintOverlay (first load only)          │
 *   │   GraphLegend (bottom-left)                    │
 *   ├────────────────────────────────────────────────┤
 *   │ ImpactBar (shrink-0)                           │
 *   └────────────────────────────────────────────────┘
 *   YAMLDropZone animated overlay (portal-like, on showDropZone)
 */
import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';

import { useWorkspaceData } from '@/hooks/useWorkspaceData';
import type { WorkspaceMode } from '@/hooks/useWorkspaceData';
import { ImpactBar } from '@/components/intelligence/ImpactBar';
import { YAMLDropZone } from '@/components/intelligence/YAMLDropZone';
import { GraphLegend } from '@/components/intelligence/GraphLegend';
import { FirstPaintOverlay } from '@/components/intelligence/FirstPaintOverlay';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { TopologyCanvas } from '@/topology/TopologyCanvas';
import { transformGraph } from '@/topology/utils/transformGraph';
import type { TopologyResponse } from '@/topology/types/topology';
import type { ExportFormat } from '@/topology/TopologyCanvas';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Badge styling for a K8s resource kind */
function kindBadgeClass(kind: string): string {
  const k = kind.toLowerCase();
  if (['deployment', 'replicaset', 'statefulset', 'daemonset', 'pod'].includes(k))
    return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
  if (['service', 'ingress', 'networkpolicy'].includes(k))
    return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30';
  if (['persistentvolumeclaim', 'persistentvolume', 'storageclass'].includes(k))
    return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
  if (['configmap', 'secret'].includes(k))
    return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  return 'bg-slate-600/20 text-slate-300 border-slate-600/30';
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function IntelligenceWorkspace() {
  const { namespace = '', kind = '', name = '' } = useParams<{
    namespace: string;
    kind: string;
    name: string;
  }>();
  const navigate = useNavigate();
  const clusterId = useActiveClusterId();

  const canFetch = !!clusterId && !!kind && !!name;

  const workspace = useWorkspaceData(kind, namespace, name, canFetch);

  // Local UI state
  const [showDropZone, setShowDropZone] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hasPainted, setHasPainted] = useState(false);

  // Simulation state (mirrors BlastRadiusTab)
  const [simulationAffectedNodes, setSimulationAffectedNodes] = useState<Set<string> | null>(null);
  const [simulatedFailureNodeId, setSimulatedFailureNodeId] = useState<string | null>(null);
  const [simulationWaveDepths, setSimulationWaveDepths] = useState<Map<string, number> | null>(null);
  const [currentWave, setCurrentWave] = useState(-1);

  // Canvas refs
  const fitViewRef = useRef<(() => void) | null>(null);
  const exportRef = useRef<((format: ExportFormat, filename: string) => void) | null>(null);
  const centerOnNodeRef = useRef<((nodeId: string) => void) | null>(null);

  // ── Build topology from graph ─────────────────────────────────────────────

  const topology = useMemo<TopologyResponse | null>(() => {
    if (!workspace.graph) return null;
    const response = transformGraph(workspace.graph, clusterId ?? undefined);
    response.metadata.mode = 'resource';
    if (namespace) response.metadata.namespace = namespace;

    // Find and set focus node
    const focusId = response.nodes.find(
      (n) => n.kind === kind && n.name === name && (!namespace || n.namespace === namespace),
    )?.id;
    if (focusId) response.metadata.focusResource = focusId;

    // Inject blast-radius cross-namespace resources not in topology
    const blastData = workspace.blastData;
    if (blastData?.waves) {
      const existingIds = new Set(response.nodes.map((n) => n.id));
      const crossNsGroupIds = new Set<string>();

      for (const wave of blastData.waves) {
        for (const res of wave.resources) {
          const nodeId = `${res.kind}/${res.namespace}/${res.name}`;
          const isCrossNamespace = !!namespace && res.namespace !== namespace;

          if (!existingIds.has(nodeId)) {
            existingIds.add(nodeId);
            response.nodes.push({
              id: nodeId,
              kind: res.kind,
              name: res.name,
              namespace: res.namespace,
              status: 'Active',
              label: res.name,
              category:
                res.kind === 'NetworkPolicy'
                  ? 'policy'
                  : res.kind === 'Ingress'
                  ? 'networking'
                  : 'workload',
              layer: 2,
              metadata: { labels: {}, annotations: {}, createdAt: '' },
              computed: { health: 'healthy' },
            } as TopologyResponse['nodes'][number]);

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
                  backgroundColor: '#fef3c7',
                  borderColor: '#f59e0b',
                },
              });
            }
            const group = response.groups.find((g) => g.id === groupId);
            if (group && !group.members.includes(nodeId)) {
              group.members.push(nodeId);
            }
          }
        }
      }
    }

    return response;
  }, [workspace.graph, workspace.blastData, clusterId, namespace, kind, name]);

  // The focus node (the resource being examined)
  const focusNode = useMemo(() => {
    if (!topology) return null;
    return (
      topology.nodes.find(
        (n) => n.kind === kind && n.name === name && (!namespace || n.namespace === namespace),
      ) ?? null
    );
  }, [topology, kind, name, namespace]);

  const highlightNodeIds = useMemo(
    () => (focusNode ? [focusNode.id] : []),
    [focusNode],
  );

  // ── Auto-simulate blast radius when data loads ────────────────────────────

  useEffect(() => {
    if (
      workspace.mode !== 'live' ||
      !focusNode ||
      !topology ||
      !workspace.blastData?.waves?.length
    )
      return;

    const blastData = workspace.blastData;

    setSimulatedFailureNodeId(focusNode.id);
    setCurrentWave(-1);

    const waveDepthMap = new Map<string, number>();
    const allAffected = new Set<string>([focusNode.id]);

    blastData.waves.forEach((wave) => {
      for (const res of wave.resources) {
        const key = `${res.kind}/${res.namespace}/${res.name}`;
        const match = topology.nodes.find(
          (n) => n.kind === res.kind && n.namespace === res.namespace && n.name === res.name,
        );
        if (match) {
          allAffected.add(match.id);
          if (!waveDepthMap.has(match.id)) {
            waveDepthMap.set(match.id, wave.depth);
          }
        }
      }
    });

    setSimulationAffectedNodes(allAffected);
    setSimulationWaveDepths(waveDepthMap);
    setCurrentWave(blastData.waves.length - 1);
  }, [workspace.blastData, focusNode, topology, workspace.mode]);

  // Mark first paint complete when topology data arrives
  useEffect(() => {
    if (topology && !hasPainted) setHasPainted(true);
  }, [topology, hasPainted]);

  // Reset simulation on mode change to live
  useEffect(() => {
    if (workspace.mode === 'live') return;
    setSimulatedFailureNodeId(null);
    setSimulationAffectedNodes(null);
    setSimulationWaveDepths(null);
    setCurrentWave(-1);
  }, [workspace.mode]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleResetFocus = useCallback(() => {
    fitViewRef.current?.();
    if (focusNode) {
      centerOnNodeRef.current?.(focusNode.id);
      setSelectedNodeId(focusNode.id);
    }
  }, [focusNode]);

  const handleClearPreview = useCallback(() => {
    workspace.clearPreview();
    setShowDropZone(false);
  }, [workspace]);

  const isLoading = workspace.topoLoading || workspace.blastLoading;
  const isEmpty = !isLoading && !topology;
  const showFirstPaint = !hasPainted && isLoading;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-[calc(100vh-60px)] bg-slate-950 text-white overflow-hidden"
      role="main"
      aria-label="Intelligence Workspace"
    >
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div
        className={cn(
          'shrink-0 flex items-center gap-3 px-4 h-12 border-b border-slate-800/70',
          'bg-slate-900 select-none',
        )}
      >
        {/* Back button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-400 hover:text-white shrink-0"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        {/* Resource identity */}
        <div className="flex items-center gap-2 min-w-0 mr-auto">
          <span
            className={cn(
              'shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide border',
              kindBadgeClass(kind),
            )}
          >
            {kind}
          </span>
          <span className="text-sm font-semibold text-white truncate">{name}</span>
          {namespace && (
            <span className="text-xs text-slate-500 truncate hidden sm:inline">
              · {namespace}
            </span>
          )}
        </div>

        {/* Mode indicator */}
        <div className="hidden md:flex items-center gap-1.5 text-xs">
          {workspace.mode === 'live' ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 font-medium">Live Impact</span>
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span className="text-amber-400 font-medium">
                Change Preview
                {workspace.manifestFilename && (
                  <span className="text-slate-400 font-normal ml-1">
                    · {workspace.manifestFilename}
                  </span>
                )}
              </span>
            </>
          )}
        </div>

        {/* Depth selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300 shrink-0"
              aria-label="Select topology depth"
            >
              {workspace.depth} hop{workspace.depth !== 1 ? 's' : ''}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[100px]">
            {[1, 2, 3].map((d) => (
              <DropdownMenuItem
                key={d}
                onClick={() => workspace.setDepth(d)}
                className={cn(workspace.depth === d && 'font-semibold text-primary')}
              >
                {d} hop{d !== 1 ? 's' : ''}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Reset Focus */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-slate-400 hover:text-white shrink-0"
          onClick={handleResetFocus}
          aria-label="Reset canvas focus"
        >
          <RotateCcw className="h-3 w-3" />
          <span className="hidden sm:inline">Reset</span>
        </Button>

        {/* Preview Change / Clear Preview */}
        {workspace.mode === 'preview' ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs bg-slate-800 border-amber-600/40 text-amber-400 hover:bg-amber-900/20 shrink-0"
            onClick={handleClearPreview}
            aria-label="Clear preview and return to live mode"
          >
            <X className="h-3 w-3" />
            Clear Preview
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300 shrink-0"
            onClick={() => setShowDropZone(true)}
            aria-label="Upload manifest to preview change impact"
          >
            <Upload className="h-3 w-3" />
            <span className="hidden sm:inline">Preview Change</span>
          </Button>
        )}
      </div>

      {/* ── Canvas Area ─────────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        {/* Loading spinner (only when no topology yet) */}
        {isLoading && !topology && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/80">
            <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-slate-500">
            <span className="text-4xl select-none">🕸️</span>
            <p className="text-sm">No topology data available.</p>
            {!clusterId && (
              <p className="text-xs text-slate-600">Connect a cluster to get started.</p>
            )}
          </div>
        )}

        {/* TopologyCanvas */}
        {topology && (
          <TopologyCanvas
            topology={topology}
            selectedNodeId={selectedNodeId}
            highlightNodeIds={highlightNodeIds}
            viewMode="default"
            onSelectNode={setSelectedNodeId}
            fitViewRef={fitViewRef}
            exportRef={exportRef}
            centerOnNodeRef={centerOnNodeRef}
            clusterName={clusterId ?? undefined}
            namespace={namespace || undefined}
            // Blast radius simulation overlays (live mode)
            simulationAffectedNodes={
              workspace.mode === 'live' ? simulationAffectedNodes : null
            }
            simulatedFailureNodeId={
              workspace.mode === 'live' ? simulatedFailureNodeId : null
            }
            simulationWaveDepths={
              workspace.mode === 'live' ? simulationWaveDepths : null
            }
            simulationCurrentWave={
              workspace.mode === 'live' ? currentWave : undefined
            }
            simulationTotalWaves={
              workspace.mode === 'live' && workspace.blastData?.waves
                ? workspace.blastData.waves.length
                : undefined
            }
            // Preview diff overlay (preview mode)
            simulationDiff={
              workspace.mode === 'preview' ? workspace.previewDiff : null
            }
          />
        )}

        {/* First-paint overlay */}
        {showFirstPaint && (
          <FirstPaintOverlay resourceName={name} kind={kind} />
        )}

        {/* Graph legend */}
        {topology && <GraphLegend mode={workspace.mode} />}
      </div>

      {/* ── Impact Bar ──────────────────────────────────────────────────── */}
      <ImpactBar
        mode={workspace.mode}
        blastData={workspace.blastData}
        previewData={workspace.previewData}
        isLoading={
          workspace.mode === 'live' ? workspace.blastLoading : workspace.previewLoading
        }
        manifestFilename={workspace.manifestFilename ?? undefined}
      />

      {/* ── YAML Drop Zone overlay ───────────────────────────────────────── */}
      <AnimatePresence>
        {showDropZone && (
          <YAMLDropZone
            onAnalyze={(yaml) => {
              workspace.analyzeManifest(yaml);
              setShowDropZone(false);
            }}
            onSetFilename={workspace.setManifestFilename}
            onClose={() => setShowDropZone(false)}
            isLoading={workspace.previewLoading}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
