/**
 * ImpactSimulator — "Simulate Failure" dialog.
 *
 * Shows an expanding blast-radius animation with impacted resources
 * grouped by depth level, a circular impact score indicator, and
 * estimated service / pod counts.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { X, Zap } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { NODE_COLORS } from '@/topology-engine/renderer/styles';
import { computeBlastRadius } from '@/topology-engine/utils/blastRadiusCompute';
import type { TopologyNode, TopologyEdge, TopologyGraph } from '@/topology-engine/types/topology.types';
import type { BlastRadiusResult } from '@/topology-engine/types/interaction.types';
import { CriticalityBadge } from './CriticalityBadge';
import type { CriticalityBadgeProps } from './CriticalityBadge';

// ─── Public API ───────────────────────────────────────────────

export interface ImpactSimulatorProps {
  /** The node to simulate failure on */
  nodeId: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  /** Close callback */
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────

function severityToLevel(score: number): CriticalityBadgeProps['level'] {
  if (score >= 70) return 'critical';
  if (score >= 40) return 'high';
  if (score >= 15) return 'medium';
  return 'low';
}

/** Build a lightweight TopologyGraph for the compute function. */
function buildGraph(nodes: TopologyNode[], edges: TopologyEdge[]): TopologyGraph {
  return {
    schemaVersion: '1',
    nodes,
    edges,
    metadata: { clusterId: '', generatedAt: '', layoutSeed: '', isComplete: true, warnings: [] },
  };
}

/**
 * Re-run blast radius at increasing depths so we can group results by level.
 * Returns an array where index 0 = depth-1 only, index 1 = depth-2 only, etc.
 */
function computeByDepth(
  graph: TopologyGraph,
  nodeId: string,
  maxDepth: number,
): { depth: number; nodeIds: string[] }[] {
  const levels: { depth: number; nodeIds: string[] }[] = [];
  const seenSoFar = new Set<string>();

  for (let d = 1; d <= maxDepth; d++) {
    const result = computeBlastRadius(graph, nodeId, {
      maxDepth: d,
      includeDownstream: true,
      includeUpstream: false,
    });
    const newAtThisDepth: string[] = [];
    result.affectedNodes.forEach((id) => {
      if (!seenSoFar.has(id)) {
        newAtThisDepth.push(id);
        seenSoFar.add(id);
      }
    });
    if (newAtThisDepth.length > 0) {
      levels.push({ depth: d, nodeIds: newAtThisDepth });
    }
  }

  return levels;
}

// ─── Circular Progress ────────────────────────────────────────

function CircularProgress({ value, size = 96 }: { value: number; size?: number }) {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  const color =
    value >= 70 ? '#DC2626' :
    value >= 40 ? '#EA580C' :
    value >= 15 ? '#F59E0B' :
    '#10B981';

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth={stroke}
      />
      {/* Value ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)' }}
      />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────

export function ImpactSimulator({ nodeId, nodes, edges, onClose }: ImpactSimulatorProps) {
  const [simulating, setSimulating] = useState(false);
  const [revealedLevel, setRevealedLevel] = useState(0);

  const originNode = useMemo(() => nodes.find((n) => n.id === nodeId), [nodes, nodeId]);
  const graph = useMemo(() => buildGraph(nodes, edges), [nodes, edges]);

  // Full blast radius result (for totals)
  const blastResult = useMemo<BlastRadiusResult | null>(() => {
    return computeBlastRadius(graph, nodeId, { maxDepth: 3, includeDownstream: true });
  }, [graph, nodeId]);

  // Levels grouped by depth
  const levels = useMemo(() => computeByDepth(graph, nodeId, 3), [graph, nodeId]);

  // Estimated counts
  const estimatedServices = useMemo(() => {
    if (!blastResult) return 0;
    let count = 0;
    blastResult.affectedNodes.forEach((id) => {
      const n = nodes.find((nd) => nd.id === id);
      if (n && n.kind === 'Service') count++;
    });
    return count;
  }, [blastResult, nodes]);

  const estimatedPods = useMemo(() => {
    if (!blastResult) return 0;
    let count = 0;
    blastResult.affectedNodes.forEach((id) => {
      const n = nodes.find((nd) => nd.id === id);
      if (n && n.kind === 'Pod') count++;
    });
    return count;
  }, [blastResult, nodes]);

  // Animation: reveal one level per 600ms
  useEffect(() => {
    if (!simulating) return;
    if (revealedLevel >= levels.length) return;
    const timer = setTimeout(() => setRevealedLevel((l) => l + 1), 600);
    return () => clearTimeout(timer);
  }, [simulating, revealedLevel, levels.length]);

  const startSimulation = useCallback(() => {
    setSimulating(true);
    setRevealedLevel(0);
    // Kick off the first reveal immediately after a short delay for animation effect
    setTimeout(() => setRevealedLevel(1), 100);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!originNode || !blastResult) return null;

  const originColor = NODE_COLORS[originNode.kind] ?? { bg: '#6B7280', text: '#fff' };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[299] bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      {/* Dialog */}
      <div
        className="fixed z-[300] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] max-h-[85vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Impact Simulator"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'isDialogIn 0.25s cubic-bezier(0.16,1,0.3,1)' }}
      >
        <style>{`
          @keyframes isDialogIn {
            from { transform: translate(-50%, -50%) scale(0.95); opacity: 0; }
            to   { transform: translate(-50%, -50%) scale(1);    opacity: 1; }
          }
          @keyframes isRingExpand {
            from { transform: scale(0); opacity: 1; }
            to   { transform: scale(1); opacity: 0.15; }
          }
        `}</style>

        {/* Header */}
        <div className="px-6 py-4 flex items-center gap-3 border-b border-slate-100 shrink-0">
          <Zap className="h-5 w-5 text-amber-500" />
          <div className="flex-1">
            <h2 className="text-sm font-bold text-slate-900">Simulate Failure</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              <span className="font-mono px-1 py-0.5 rounded bg-slate-100 text-slate-600">{originNode.kind}</span>{' '}
              {originNode.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <ScrollArea className="flex-1">
          <div className="px-6 py-5 space-y-5">
            {/* Pre-simulation: trigger button */}
            {!simulating && (
              <div className="flex flex-col items-center py-6">
                {/* Rings preview */}
                <div className="relative w-24 h-24 mb-5">
                  <div className="absolute inset-0 rounded-full border-2 border-dashed border-slate-200" />
                  <div className="absolute inset-3 rounded-full border-2 border-dashed border-slate-300" />
                  <div
                    className="absolute inset-7 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: originColor.bg }}
                  >
                    <span className="text-[9px] font-bold" style={{ color: originColor.text }}>
                      {originNode.kind.slice(0, 3).toUpperCase()}
                    </span>
                  </div>
                </div>
                <Button
                  onClick={startSimulation}
                  className="bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-2 text-sm"
                >
                  Simulate Failure
                </Button>
                <p className="text-[10px] text-slate-400 mt-2">Calculates cascading failure impact across 3 levels</p>
              </div>
            )}

            {/* Post-simulation */}
            {simulating && (
              <>
                {/* Impact score with circular indicator */}
                <div className="flex items-center gap-5 bg-slate-50 rounded-xl px-5 py-4">
                  <div className="relative shrink-0">
                    <CircularProgress value={blastResult.totalImpact} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-lg font-bold text-slate-800 tabular-nums">
                        {Math.round(blastResult.totalImpact)}
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <p className="text-xs font-semibold text-slate-700">Total Impact Score</p>
                    <CriticalityBadge level={severityToLevel(blastResult.totalImpact)} />
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                      <div>
                        <p className="text-[10px] text-slate-400">Services affected</p>
                        <p className="text-sm font-bold text-slate-800 tabular-nums">{estimatedServices}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400">Pods affected</p>
                        <p className="text-sm font-bold text-slate-800 tabular-nums">{estimatedPods}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanding rings animation */}
                <div className="flex justify-center py-3">
                  <div className="relative w-32 h-32">
                    {/* Animated expanding rings */}
                    {levels.map((_, i) => {
                      const revealed = i < revealedLevel;
                      const ringSize = 32 + (i + 1) * 30;
                      const offset = (128 - ringSize) / 2;
                      const ringColor =
                        i === 0 ? 'rgba(220,38,38,0.5)' :
                        i === 1 ? 'rgba(234,88,12,0.4)' :
                        'rgba(245,158,11,0.3)';
                      return (
                        <div
                          key={i}
                          className="absolute rounded-full border-2"
                          style={{
                            width: ringSize,
                            height: ringSize,
                            left: offset,
                            top: offset,
                            borderColor: ringColor,
                            backgroundColor: revealed ? ringColor : 'transparent',
                            transform: revealed ? 'scale(1)' : 'scale(0)',
                            opacity: revealed ? 1 : 0,
                            transition: 'all 0.5s cubic-bezier(0.16,1,0.3,1)',
                          }}
                        />
                      );
                    })}
                    {/* Center node */}
                    <div
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center z-10 shadow-lg"
                      style={{ backgroundColor: originColor.bg }}
                    >
                      <span className="text-[8px] font-bold" style={{ color: originColor.text }}>
                        {originNode.kind.slice(0, 3).toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Resources grouped by depth */}
                {levels.map((level, i) => {
                  const revealed = i < revealedLevel;
                  return (
                    <div
                      key={level.depth}
                      style={{
                        opacity: revealed ? 1 : 0,
                        transform: revealed ? 'translateY(0)' : 'translateY(12px)',
                        transition: 'all 0.4s cubic-bezier(0.16,1,0.3,1)',
                      }}
                    >
                      <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-2">
                        <span
                          className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                          style={{
                            backgroundColor:
                              level.depth === 1 ? '#DC2626' :
                              level.depth === 2 ? '#EA580C' :
                              '#F59E0B',
                          }}
                        >
                          {level.depth}
                        </span>
                        Level {level.depth}
                        <span className="text-[10px] text-slate-400 font-normal normal-case tracking-normal">
                          {level.nodeIds.length} resource{level.nodeIds.length !== 1 ? 's' : ''}
                        </span>
                      </h4>
                      <div className="space-y-1 ml-7">
                        {level.nodeIds.map((nid) => {
                          const n = nodes.find((nd) => nd.id === nid);
                          if (!n) return null;
                          const c = NODE_COLORS[n.kind] ?? { bg: '#6B7280', text: '#fff' };
                          const sev = blastResult.severity.get(nid) ?? 0;
                          return (
                            <div
                              key={nid}
                              className="flex items-center gap-2.5 rounded-lg px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors"
                            >
                              <span className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: c.bg }} />
                              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 shrink-0 w-16">
                                {n.kind}
                              </span>
                              <span className="text-xs text-slate-800 font-medium truncate flex-1">{n.name}</span>
                              <CriticalityBadge level={severityToLevel(sev)} score={sev} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}
