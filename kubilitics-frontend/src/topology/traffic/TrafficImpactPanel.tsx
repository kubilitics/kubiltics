/**
 * TrafficImpactPanel — Right-side slide-in panel for dependency analysis,
 * blast radius inspection, and traffic flow visualisation.
 *
 * Three tabs:
 *   1. Dependencies — forward (outgoing) + reverse (incoming) dependency lists
 *   2. Blast Radius — impacted resources with severity badges
 *   3. Traffic Flow — inferred traffic direction with animated arrows
 */
import { useEffect, useMemo, useState } from 'react';
import { X, ArrowRight, ArrowLeft, Zap, AlertTriangle, Activity } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NODE_COLORS } from '@/topology-engine/renderer/styles';
import { computeBlastRadius } from '@/topology-engine/utils/blastRadiusCompute';
import type { TopologyNode, TopologyEdge, TopologyGraph } from '@/topology-engine/types/topology.types';
import { CriticalityBadge } from './CriticalityBadge';
import type { CriticalityBadgeProps } from './CriticalityBadge';

// ─── Public API ───────────────────────────────────────────────

export interface TrafficImpactPanelProps {
  selectedNodeId: string | null;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  onClose: () => void;
}

type TabId = 'dependencies' | 'blast' | 'traffic';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'dependencies', label: 'Dependencies', icon: <ArrowRight className="h-3.5 w-3.5" /> },
  { id: 'blast', label: 'Blast Radius', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  { id: 'traffic', label: 'Traffic Flow', icon: <Activity className="h-3.5 w-3.5" /> },
];

// ─── Component ────────────────────────────────────────────────

export function TrafficImpactPanel({ selectedNodeId, nodes, edges, onClose }: TrafficImpactPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('dependencies');

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Selected node
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  // Build a lightweight TopologyGraph for blast radius compute
  const graph = useMemo<TopologyGraph>(
    () => ({
      schemaVersion: '1',
      nodes,
      edges,
      metadata: { clusterId: '', generatedAt: '', layoutSeed: '', isComplete: true, warnings: [] },
    }),
    [nodes, edges],
  );

  // Forward deps: edges where this node is the source (outgoing)
  const forwardDeps = useMemo(
    () =>
      selectedNodeId
        ? edges
            .filter((e) => e.source === selectedNodeId)
            .map((e) => ({ edge: e, node: nodes.find((n) => n.id === e.target) }))
            .filter((d) => d.node != null)
        : [],
    [selectedNodeId, edges, nodes],
  );

  // Reverse deps: edges where this node is the target (incoming)
  const reverseDeps = useMemo(
    () =>
      selectedNodeId
        ? edges
            .filter((e) => e.target === selectedNodeId)
            .map((e) => ({ edge: e, node: nodes.find((n) => n.id === e.source) }))
            .filter((d) => d.node != null)
        : [],
    [selectedNodeId, edges, nodes],
  );

  // Blast radius
  const blastResult = useMemo(() => {
    if (!selectedNodeId) return null;
    return computeBlastRadius(graph, selectedNodeId, {
      maxDepth: 3,
      includeDownstream: true,
      includeUpstream: false,
    });
  }, [graph, selectedNodeId]);

  // Blast affected list sorted by severity desc
  const blastList = useMemo(() => {
    if (!blastResult) return [];
    return Array.from(blastResult.affectedNodes)
      .map((id) => ({
        node: nodes.find((n) => n.id === id),
        severity: blastResult.severity.get(id) ?? 0,
      }))
      .filter((b) => b.node != null)
      .sort((a, b) => b.severity - a.severity);
  }, [blastResult, nodes]);

  // Traffic edges (all edges connected to selected node)
  const trafficEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return edges
      .filter((e) => e.source === selectedNodeId || e.target === selectedNodeId)
      .map((e) => {
        const isOutgoing = e.source === selectedNodeId;
        const peerId = isOutgoing ? e.target : e.source;
        const peerNode = nodes.find((n) => n.id === peerId);
        return { edge: e, peerNode, isOutgoing };
      })
      .filter((t) => t.peerNode != null);
  }, [selectedNodeId, edges, nodes]);

  if (!selectedNodeId || !selectedNode) return null;

  const nodeColor = NODE_COLORS[selectedNode.kind] ?? { bg: '#6B7280', border: '#4B5563', glow: '', text: '#fff' };

  return (
    <>
      {/* Dim backdrop */}
      <div
        className="fixed inset-0 z-[199] bg-black/15 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Side panel */}
      <div
        className="fixed right-0 top-0 h-full z-[200] flex flex-col bg-white shadow-2xl border-l border-slate-200"
        style={{
          width: 400,
          animation: 'tipSlideIn 0.22s cubic-bezier(0.16,1,0.3,1)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`Traffic & Impact: ${selectedNode.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          @keyframes tipSlideIn {
            from { transform: translateX(100%); opacity: 0; }
            to   { transform: translateX(0);    opacity: 1; }
          }
          @keyframes tipPulse {
            0%, 100% { opacity: 0.5; }
            50%      { opacity: 1; }
          }
        `}</style>

        {/* ── Header ── */}
        <div className="px-5 py-4 flex items-start gap-3 shrink-0 border-b border-slate-100" style={{ background: `${nodeColor.bg}0a` }}>
          <span
            className="shrink-0 mt-0.5 text-[11px] font-bold px-2.5 py-1 rounded-lg leading-tight uppercase tracking-wide"
            style={{ backgroundColor: nodeColor.bg, color: nodeColor.text }}
          >
            {selectedNode.kind}
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-[15px] text-slate-900 break-all leading-snug">{selectedNode.name}</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Traffic & Impact Analysis</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-lg hover:bg-black/10 text-slate-400 hover:text-slate-700 transition-colors"
            aria-label="Close panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Tabs ── */}
        <div className="flex border-b border-slate-100 shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors
                ${activeTab === tab.id ? 'text-slate-900 border-b-2 border-slate-900' : 'text-slate-400 hover:text-slate-600'}
              `}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <ScrollArea className="flex-1">
          <div className="px-5 py-4">
            {activeTab === 'dependencies' && (
              <DependenciesTab forward={forwardDeps} reverse={reverseDeps} />
            )}
            {activeTab === 'blast' && blastResult && (
              <BlastRadiusTab blastList={blastList} totalImpact={blastResult.totalImpact} suggestions={blastResult.suggestions ?? []} />
            )}
            {activeTab === 'traffic' && (
              <TrafficFlowTab trafficEdges={trafficEdges} />
            )}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}

// ─── Dependencies Tab ─────────────────────────────────────────

interface DepEntry {
  edge: TopologyEdge;
  node: TopologyNode | undefined;
}

function DependenciesTab({ forward, reverse }: { forward: DepEntry[]; reverse: DepEntry[] }) {
  return (
    <div className="space-y-5">
      <DepSection
        title="Forward Dependencies"
        subtitle="Resources this node calls or uses"
        icon={<ArrowRight className="h-3.5 w-3.5 text-blue-500" />}
        deps={forward}
        direction="forward"
      />
      <DepSection
        title="Reverse Dependencies"
        subtitle="Resources that call or use this node"
        icon={<ArrowLeft className="h-3.5 w-3.5 text-violet-500" />}
        deps={reverse}
        direction="reverse"
      />
    </div>
  );
}

function DepSection({
  title,
  subtitle,
  icon,
  deps,
  direction: _direction,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  deps: DepEntry[];
  direction: 'forward' | 'reverse';
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        {icon}
        <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{title}</h4>
        <span className="ml-auto text-[10px] text-slate-400 font-medium tabular-nums">{deps.length}</span>
      </div>
      <p className="text-[10px] text-slate-400 mb-2">{subtitle}</p>
      {deps.length === 0 ? (
        <p className="text-xs text-slate-300 italic py-3 text-center">None</p>
      ) : (
        <div className="space-y-1">
          {deps.map(({ edge, node }) => {
            if (!node) return null;
            const c = NODE_COLORS[node.kind] ?? { bg: '#6B7280', text: '#fff' };
            return (
              <div
                key={edge.id}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <span
                  className="shrink-0 w-2 h-2 rounded-full"
                  style={{ backgroundColor: c.bg }}
                />
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 shrink-0 w-16">
                  {node.kind}
                </span>
                <span className="text-xs text-slate-800 font-medium truncate flex-1">{node.name}</span>
                <span className="text-[10px] text-slate-400 font-mono shrink-0">{edge.relationshipType}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Blast Radius Tab ─────────────────────────────────────────

function severityToLevel(score: number): CriticalityBadgeProps['level'] {
  if (score >= 70) return 'critical';
  if (score >= 40) return 'high';
  if (score >= 15) return 'medium';
  return 'low';
}

function BlastRadiusTab({
  blastList,
  totalImpact,
  suggestions,
}: {
  blastList: { node: TopologyNode | undefined; severity: number }[];
  totalImpact: number;
  suggestions: string[];
}) {
  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
        <Zap className="h-4 w-4 text-amber-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-700">
            Total Impact Score
          </p>
          <p className="text-[10px] text-slate-400">{blastList.length} resource{blastList.length !== 1 ? 's' : ''} affected</p>
        </div>
        <CriticalityBadge level={severityToLevel(totalImpact)} score={totalImpact} />
      </div>

      {/* Affected resources */}
      {blastList.length === 0 ? (
        <p className="text-xs text-slate-300 italic py-4 text-center">No downstream impact detected</p>
      ) : (
        <div className="space-y-1">
          {blastList.map(({ node, severity }) => {
            if (!node) return null;
            const c = NODE_COLORS[node.kind] ?? { bg: '#6B7280', text: '#fff' };
            return (
              <div
                key={node.id}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <span className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: c.bg }} />
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 shrink-0 w-16">
                  {node.kind}
                </span>
                <span className="text-xs text-slate-800 font-medium truncate flex-1">{node.name}</span>
                <CriticalityBadge level={severityToLevel(severity)} score={severity} />
              </div>
            );
          })}
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Mitigation Suggestions
          </h4>
          <ul className="space-y-1.5">
            {suggestions.map((s, i) => (
              <li key={i} className="text-xs text-slate-600 flex items-start gap-2">
                <span className="shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-blue-400" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Traffic Flow Tab ─────────────────────────────────────────

interface TrafficEntry {
  edge: TopologyEdge;
  peerNode: TopologyNode | undefined;
  isOutgoing: boolean;
}

function TrafficFlowTab({ trafficEdges }: { trafficEdges: TrafficEntry[] }) {
  const outgoing = trafficEdges.filter((t) => t.isOutgoing);
  const incoming = trafficEdges.filter((t) => !t.isOutgoing);

  return (
    <div className="space-y-5">
      {trafficEdges.length === 0 ? (
        <p className="text-xs text-slate-300 italic py-4 text-center">No traffic edges detected</p>
      ) : (
        <>
          <TrafficGroup title="Outgoing Traffic" entries={outgoing} directionLabel="to" />
          <TrafficGroup title="Incoming Traffic" entries={incoming} directionLabel="from" />
        </>
      )}
    </div>
  );
}

function TrafficGroup({ title, entries, directionLabel }: { title: string; entries: TrafficEntry[]; directionLabel: string }) {
  if (entries.length === 0) return null;
  return (
    <div>
      <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{title}</h4>
      <div className="space-y-1">
        {entries.map(({ edge, peerNode, isOutgoing }) => {
          if (!peerNode) return null;
          const c = NODE_COLORS[peerNode.kind] ?? { bg: '#6B7280', text: '#fff' };
          return (
            <div
              key={edge.id}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors group"
            >
              {/* Animated arrow indicator */}
              <span className="relative shrink-0 flex items-center justify-center w-5 h-5">
                {isOutgoing ? (
                  <ArrowRight className="h-3.5 w-3.5 text-emerald-500" style={{ animation: 'tipPulse 2s ease-in-out infinite' }} />
                ) : (
                  <ArrowLeft className="h-3.5 w-3.5 text-blue-500" style={{ animation: 'tipPulse 2s ease-in-out infinite' }} />
                )}
              </span>
              <span className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: c.bg }} />
              <span className="text-[10px] text-slate-400 shrink-0">{directionLabel}</span>
              <span className="text-xs text-slate-800 font-medium truncate flex-1">{peerNode.name}</span>
              <span className="text-[10px] text-slate-400 font-mono shrink-0">{edge.relationshipType}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
