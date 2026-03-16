/**
 * TopologyComparison — Historical topology snapshot comparison.
 *
 * Features:
 * - Compare mode: select two timestamps from snapshot list
 * - Diff visualization: green=added, red=removed, amber=changed nodes/edges
 * - Summary card: "5 nodes added, 2 removed, 8 edges changed"
 * - Uses React Flow with custom node styles for diff state
 */
import { memo, useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Handle,
  Position,
  type NodeProps,
} from '@xyflow/react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TopologyNode, TopologyEdge, TopologyResponse } from '@/topology/types/topology';

// ─── Types ──────────────────────────────────────────────────────────────────

export type DiffState = 'added' | 'removed' | 'changed' | 'unchanged';

export interface TopologySnapshot {
  id: string;
  timestamp: string;
  label?: string;
  data: TopologyResponse;
}

export interface DiffSummary {
  nodesAdded: number;
  nodesRemoved: number;
  nodesChanged: number;
  nodesUnchanged: number;
  edgesAdded: number;
  edgesRemoved: number;
  edgesChanged: number;
  edgesUnchanged: number;
}

interface DiffNodeData {
  diffState: DiffState;
  kind: string;
  name: string;
  namespace?: string;
  status: string;
  previousStatus?: string;
}

interface DiffEdgeData {
  diffState: DiffState;
  label?: string;
}

// ─── Diff Colors ────────────────────────────────────────────────────────────

const DIFF_COLORS: Record<DiffState, { bg: string; border: string; text: string; edge: string }> = {
  added:     { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-400 dark:border-emerald-600', text: 'text-emerald-700 dark:text-emerald-300', edge: '#16A34A' },
  removed:   { bg: 'bg-red-50 dark:bg-red-950/30',         border: 'border-red-400 dark:border-red-600',         text: 'text-red-700 dark:text-red-300',         edge: '#DC2626' },
  changed:   { bg: 'bg-amber-50 dark:bg-amber-950/30',     border: 'border-amber-400 dark:border-amber-600',     text: 'text-amber-700 dark:text-amber-300',     edge: '#D97706' },
  unchanged: { bg: 'bg-gray-50 dark:bg-gray-800',           border: 'border-gray-200 dark:border-gray-700',       text: 'text-gray-500 dark:text-gray-400',       edge: '#9CA3AF' },
};

const DIFF_LABELS: Record<DiffState, string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  unchanged: 'Unchanged',
};

// ─── Diff Node Component ────────────────────────────────────────────────────

function DiffNodeComponent({ data }: NodeProps) {
  const d = data as unknown as DiffNodeData;
  const colors = DIFF_COLORS[d.diffState];

  return (
    <div
      className={`min-w-[200px] rounded-lg border-2 ${colors.border} ${colors.bg} p-3 shadow-sm transition-all duration-200`}
      role="treeitem"
      aria-label={`${d.kind}: ${d.name}, ${DIFF_LABELS[d.diffState]}`}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-gray-300" />

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {d.kind}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${colors.text} ${colors.bg}`}
        >
          {DIFF_LABELS[d.diffState]}
        </span>
      </div>

      <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
        {d.name}
      </div>

      {d.namespace && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400">{d.namespace}</div>
      )}

      {d.diffState === 'changed' && d.previousStatus && (
        <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
          Status: {d.previousStatus} → {d.status}
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-gray-300" />
    </div>
  );
}

const DiffNode = memo(DiffNodeComponent);

const diffNodeTypes = {
  diffNode: DiffNode,
};

// ─── Diff Engine ────────────────────────────────────────────────────────────

function computeNodeDiff(
  before: TopologyNode[],
  after: TopologyNode[],
): { nodes: Array<TopologyNode & { diffState: DiffState; previousStatus?: string }>; summary: Pick<DiffSummary, 'nodesAdded' | 'nodesRemoved' | 'nodesChanged' | 'nodesUnchanged'> } {
  const beforeMap = new Map(before.map((n) => [n.id, n]));
  const afterMap = new Map(after.map((n) => [n.id, n]));

  const result: Array<TopologyNode & { diffState: DiffState; previousStatus?: string }> = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;

  // Nodes in "after" snapshot
  for (const node of after) {
    const prev = beforeMap.get(node.id);
    if (!prev) {
      result.push({ ...node, diffState: 'added' });
      added++;
    } else if (
      prev.status !== node.status ||
      prev.name !== node.name ||
      JSON.stringify(prev.metrics) !== JSON.stringify(node.metrics)
    ) {
      result.push({ ...node, diffState: 'changed', previousStatus: prev.status });
      changed++;
    } else {
      result.push({ ...node, diffState: 'unchanged' });
      unchanged++;
    }
  }

  // Nodes only in "before" snapshot (removed)
  for (const node of before) {
    if (!afterMap.has(node.id)) {
      result.push({ ...node, diffState: 'removed' });
      removed++;
    }
  }

  return {
    nodes: result,
    summary: { nodesAdded: added, nodesRemoved: removed, nodesChanged: changed, nodesUnchanged: unchanged },
  };
}

function computeEdgeDiff(
  before: TopologyEdge[],
  after: TopologyEdge[],
): { edges: Array<TopologyEdge & { diffState: DiffState }>; summary: Pick<DiffSummary, 'edgesAdded' | 'edgesRemoved' | 'edgesChanged' | 'edgesUnchanged'> } {
  const beforeMap = new Map(before.map((e) => [e.id, e]));
  const afterMap = new Map(after.map((e) => [e.id, e]));

  const result: Array<TopologyEdge & { diffState: DiffState }> = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;

  for (const edge of after) {
    const prev = beforeMap.get(edge.id);
    if (!prev) {
      result.push({ ...edge, diffState: 'added' });
      added++;
    } else if (
      prev.label !== edge.label ||
      prev.healthy !== edge.healthy ||
      prev.relationshipType !== edge.relationshipType
    ) {
      result.push({ ...edge, diffState: 'changed' });
      changed++;
    } else {
      result.push({ ...edge, diffState: 'unchanged' });
      unchanged++;
    }
  }

  for (const edge of before) {
    if (!afterMap.has(edge.id)) {
      result.push({ ...edge, diffState: 'removed' });
      removed++;
    }
  }

  return {
    edges: result,
    summary: { edgesAdded: added, edgesRemoved: removed, edgesChanged: changed, edgesUnchanged: unchanged },
  };
}

// ─── Snapshot Selector ──────────────────────────────────────────────────────

interface SnapshotSelectorProps {
  snapshots: TopologySnapshot[];
  selectedId: string | null;
  label: string;
  onSelect: (id: string) => void;
}

const SnapshotSelector = memo(function SnapshotSelector({
  snapshots,
  selectedId,
  label,
  onSelect,
}: SnapshotSelectorProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </label>
      <select
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        aria-label={`Select ${label} snapshot`}
      >
        <option value="" disabled>Select snapshot...</option>
        {snapshots.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label ?? new Date(s.timestamp).toLocaleString()}
          </option>
        ))}
      </select>
    </div>
  );
});

// ─── Summary Card ───────────────────────────────────────────────────────────

interface DiffSummaryCardProps {
  summary: DiffSummary;
  filterState: DiffState | 'all';
  onFilterChange: (state: DiffState | 'all') => void;
}

const DiffSummaryCard = memo(function DiffSummaryCard({
  summary,
  filterState,
  onFilterChange,
}: DiffSummaryCardProps) {
  const items: Array<{ state: DiffState | 'all'; label: string; count: number }> = [
    { state: 'all', label: 'All', count: summary.nodesAdded + summary.nodesRemoved + summary.nodesChanged + summary.nodesUnchanged },
    { state: 'added', label: 'Added', count: summary.nodesAdded },
    { state: 'removed', label: 'Removed', count: summary.nodesRemoved },
    { state: 'changed', label: 'Changed', count: summary.nodesChanged },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
    >
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
        Comparison Summary
      </h3>

      <div className="mb-3 text-xs text-gray-600 dark:text-gray-300">
        {summary.nodesAdded} node{summary.nodesAdded !== 1 ? 's' : ''} added,{' '}
        {summary.nodesRemoved} removed,{' '}
        {summary.edgesChanged + summary.edgesAdded + summary.edgesRemoved} edge{summary.edgesChanged + summary.edgesAdded + summary.edgesRemoved !== 1 ? 's' : ''} changed
      </div>

      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <button
            key={item.state}
            onClick={() => onFilterChange(item.state)}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              filterState === item.state
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            {item.state !== 'all' && (
              <span
                className={`h-2 w-2 rounded-full`}
                style={{ backgroundColor: item.state === 'all' ? '#6B7280' : DIFF_COLORS[item.state].edge }}
              />
            )}
            {item.label} ({item.count})
          </button>
        ))}
      </div>
    </motion.div>
  );
});

// ─── Legend ──────────────────────────────────────────────────────────────────

const DiffLegend = memo(function DiffLegend() {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white/90 px-3 py-2 text-[11px] shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-800/90">
      {(['added', 'removed', 'changed', 'unchanged'] as DiffState[]).map((state) => (
        <div key={state} className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-sm border"
            style={{
              backgroundColor: DIFF_COLORS[state].edge + '20',
              borderColor: DIFF_COLORS[state].edge,
            }}
          />
          <span className="text-gray-600 dark:text-gray-300">{DIFF_LABELS[state]}</span>
        </div>
      ))}
    </div>
  );
});

// ─── Main Component ─────────────────────────────────────────────────────────

export interface TopologyComparisonProps {
  snapshots: TopologySnapshot[];
  /** Initial "before" snapshot ID */
  initialBeforeId?: string;
  /** Initial "after" snapshot ID */
  initialAfterId?: string;
  /** Callback when comparison mode is exited */
  onClose?: () => void;
}

export const TopologyComparison = memo(function TopologyComparison({
  snapshots,
  initialBeforeId,
  initialAfterId,
  onClose,
}: TopologyComparisonProps) {
  const [beforeId, setBeforeId] = useState<string | null>(initialBeforeId ?? null);
  const [afterId, setAfterId] = useState<string | null>(initialAfterId ?? null);
  const [filterState, setFilterState] = useState<DiffState | 'all'>('all');

  const beforeSnapshot = snapshots.find((s) => s.id === beforeId);
  const afterSnapshot = snapshots.find((s) => s.id === afterId);

  // Compute diff
  const { diffNodes, diffEdges, summary } = useMemo(() => {
    if (!beforeSnapshot || !afterSnapshot) {
      return {
        diffNodes: [],
        diffEdges: [],
        summary: {
          nodesAdded: 0, nodesRemoved: 0, nodesChanged: 0, nodesUnchanged: 0,
          edgesAdded: 0, edgesRemoved: 0, edgesChanged: 0, edgesUnchanged: 0,
        } as DiffSummary,
      };
    }

    const nodeDiff = computeNodeDiff(beforeSnapshot.data.nodes, afterSnapshot.data.nodes);
    const edgeDiff = computeEdgeDiff(beforeSnapshot.data.edges, afterSnapshot.data.edges);

    return {
      diffNodes: nodeDiff.nodes,
      diffEdges: edgeDiff.edges,
      summary: { ...nodeDiff.summary, ...edgeDiff.summary },
    };
  }, [beforeSnapshot, afterSnapshot]);

  // Convert to React Flow nodes/edges
  const { flowNodes, flowEdges } = useMemo(() => {
    const filteredNodes = filterState === 'all'
      ? diffNodes
      : diffNodes.filter((n) => n.diffState === filterState);

    const visibleNodeIds = new Set(filteredNodes.map((n) => n.id));

    const flowNodes: Node[] = filteredNodes.map((n, i) => ({
      id: n.id,
      type: 'diffNode',
      position: {
        x: (i % 6) * 280,
        y: Math.floor(i / 6) * 140,
      },
      data: {
        diffState: n.diffState,
        kind: n.kind,
        name: n.name,
        namespace: n.namespace,
        status: n.status,
        previousStatus: n.previousStatus,
      } satisfies DiffNodeData,
    }));

    const filteredEdges = filterState === 'all'
      ? diffEdges
      : diffEdges.filter((e) => e.diffState === filterState);

    const flowEdges: Edge[] = filteredEdges
      .filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'default',
        style: {
          stroke: DIFF_COLORS[e.diffState].edge,
          strokeWidth: e.diffState === 'unchanged' ? 1 : 2,
          strokeDasharray: e.diffState === 'removed' ? '6 3' : undefined,
        },
        label: e.label,
        data: {
          diffState: e.diffState,
          label: e.label,
        } satisfies DiffEdgeData,
      }));

    return { flowNodes, flowEdges };
  }, [diffNodes, diffEdges, filterState]);

  const handleFilterChange = useCallback((state: DiffState | 'all') => {
    setFilterState(state);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-4 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
        <SnapshotSelector
          snapshots={snapshots}
          selectedId={beforeId}
          label="Before"
          onSelect={setBeforeId}
        />

        <div className="flex items-center pt-5">
          <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </div>

        <SnapshotSelector
          snapshots={snapshots}
          selectedId={afterId}
          label="After"
          onSelect={setAfterId}
        />

        <div className="ml-auto flex items-center gap-3 pt-5">
          <DiffLegend />
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Exit Comparison
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1">
        {/* Summary sidebar */}
        {beforeSnapshot && afterSnapshot && (
          <div className="w-72 shrink-0 border-r border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
            <DiffSummaryCard
              summary={summary}
              filterState={filterState}
              onFilterChange={handleFilterChange}
            />
          </div>
        )}

        {/* React Flow canvas */}
        <div className="flex-1">
          {!beforeSnapshot || !afterSnapshot ? (
            <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-500">
              <div className="text-center">
                <svg className="mx-auto mb-3 h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                <p className="text-sm font-medium">Select two snapshots to compare</p>
                <p className="mt-1 text-xs">Choose a "Before" and "After" snapshot above</p>
              </div>
            </div>
          ) : (
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={diffNodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.05}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} size={1} color="#d4d4d8" />
              <Controls position="bottom-right" />
              <MiniMap
                position="bottom-left"
                nodeColor={(node) => {
                  const d = node.data as unknown as DiffNodeData;
                  return DIFF_COLORS[d?.diffState ?? 'unchanged'].edge;
                }}
                maskColor="rgba(0,0,0,0.1)"
              />
            </ReactFlow>
          )}
        </div>
      </div>
    </div>
  );
});

export default TopologyComparison;
