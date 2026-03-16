/**
 * RelationshipMiniGraph — Small React Flow canvas showing 1-hop neighbors.
 *
 * Layout: incoming nodes on the left, center resource in the middle,
 * outgoing nodes on the right. Each node is clickable for navigation.
 *
 * Uses @xyflow/react v12 with no zoom controls (scroll-to-zoom still works).
 * Full dark mode support via Tailwind's `dark:` classes and inline style tokens.
 */
import { memo, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import { BezierEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { RelationshipNeighbor } from '@/hooks/useResourceRelationships';
import { getCategoryColor, getEdgeColor } from '@/topology/constants/designTokens';
import { categoryConfig, canvasColors } from '@/topology/nodes/nodeConfig';
import { useThemeStore } from '@/stores/themeStore';

// ─── Types ──────────────────────────────────────────────────────────────────

interface MiniNodeData {
  label: string;
  kind: string;
  category: string;
  status: string;
  isCenter?: boolean;
  [key: string]: unknown;
}

interface MiniEdgeData {
  label: string;
  category: string;
  [key: string]: unknown;
}

export interface RelationshipMiniGraphProps {
  centerKind: string;
  centerName: string;
  centerCategory: string;
  centerStatus: string;
  incoming: RelationshipNeighbor[];
  outgoing: RelationshipNeighbor[];
  onNodeClick?: (kind: string, name: string, namespace: string) => void;
  className?: string;
}

// ─── Layout constants ───────────────────────────────────────────────────────

const NODE_WIDTH = 140;
const NODE_HEIGHT = 44;
const COLUMN_GAP = 200;
const ROW_GAP = 58;
const CENTER_X = COLUMN_GAP + NODE_WIDTH / 2;

// ─── Mini Node ──────────────────────────────────────────────────────────────

function MiniNodeInner({ data }: NodeProps<MiniNodeData>) {
  const isDark = useThemeStore((s) => s.resolvedTheme === 'dark');
  const catConfig = categoryConfig[data.category] ?? categoryConfig.workload;
  const accent = getCategoryColor(data.category).accent;

  const kindAbbrev = data.kind.length > 3
    ? data.kind.substring(0, 3).toUpperCase()
    : data.kind.toUpperCase();

  return (
    <div
      className={`
        flex items-center gap-2 rounded-lg px-2.5 py-1.5 shadow-sm border
        cursor-pointer select-none
        transition-all duration-150 ease-in-out
        hover:shadow-md hover:scale-[1.03]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
        ${data.isCenter ? 'ring-2 ring-offset-1' : ''}
      `}
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        backgroundColor: isDark ? catConfig.nodeBg.dark : catConfig.nodeBg.light,
        borderColor: isDark ? catConfig.borderColor.dark : catConfig.borderColor.light,
        ...(data.isCenter ? { ringColor: accent } : {}),
      }}
      tabIndex={0}
      role="button"
      aria-label={`${data.kind}: ${data.label}`}
    >
      <Handle type="target" position={Position.Left} className="!w-1.5 !h-1.5 !bg-gray-400 !border-0 !opacity-0" />
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center text-[9px] font-bold text-white shrink-0"
        style={{ backgroundColor: accent }}
      >
        {kindAbbrev}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className="text-[10px] font-semibold leading-tight truncate"
          style={{ color: isDark ? canvasColors.dark.primaryText : canvasColors.light.primaryText }}
        >
          {data.label}
        </div>
        <div
          className="text-[8px] font-medium mt-0.5 truncate"
          style={{ color: isDark ? canvasColors.dark.secondaryText : canvasColors.light.secondaryText }}
        >
          {data.kind}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!w-1.5 !h-1.5 !bg-gray-400 !border-0 !opacity-0" />
    </div>
  );
}

const MiniNode = memo(MiniNodeInner);

// ─── Mini Edge ──────────────────────────────────────────────────────────────

function MiniEdgeInner(props: EdgeProps<MiniEdgeData>) {
  const { data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const isDark = useThemeStore((s) => s.resolvedTheme === 'dark');
  const color = getEdgeColor(data?.category);

  const [, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
  });

  return (
    <>
      <BezierEdge
        {...props}
        style={{
          stroke: color,
          strokeWidth: 1.5,
          opacity: 0.6,
        }}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded px-1 py-0.5 text-[8px] leading-none font-medium border"
            style={{
              left: labelX,
              top: labelY,
              backgroundColor: isDark ? canvasColors.dark.edgeLabelBg : canvasColors.light.edgeLabelBg,
              borderColor: isDark ? canvasColors.dark.edgeLabelBorder : canvasColors.light.edgeLabelBorder,
              color: isDark ? canvasColors.dark.secondaryText : canvasColors.light.secondaryText,
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const MiniEdge = memo(MiniEdgeInner);

// ─── Node & Edge type registries ────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  mini: MiniNode as unknown as NodeTypes[string],
};

const edgeTypes: EdgeTypes = {
  labeled: MiniEdge as unknown as EdgeTypes[string],
};

// ─── Category guesser ───────────────────────────────────────────────────────

function guessCategory(kind: string): string {
  const map: Record<string, string> = {
    Pod: 'workload', Deployment: 'workload', ReplicaSet: 'workload',
    StatefulSet: 'workload', DaemonSet: 'workload', Job: 'workload',
    CronJob: 'workload', ReplicationController: 'workload',
    Service: 'networking', Ingress: 'networking', IngressClass: 'networking',
    Endpoints: 'networking', EndpointSlice: 'networking', NetworkPolicy: 'networking',
    ConfigMap: 'config', Secret: 'config',
    PersistentVolumeClaim: 'storage', PersistentVolume: 'storage', StorageClass: 'storage',
    Node: 'cluster', Namespace: 'cluster',
    ServiceAccount: 'rbac', Role: 'rbac', ClusterRole: 'rbac',
    RoleBinding: 'rbac', ClusterRoleBinding: 'rbac',
    HorizontalPodAutoscaler: 'scaling', PodDisruptionBudget: 'scaling',
  };
  return map[kind] ?? 'workload';
}

// ─── Graph builder ──────────────────────────────────────────────────────────

function buildGraph(
  centerKind: string,
  centerName: string,
  centerCategory: string,
  centerStatus: string,
  incoming: RelationshipNeighbor[],
  outgoing: RelationshipNeighbor[],
): { nodes: Node<MiniNodeData>[]; edges: Edge<MiniEdgeData>[] } {
  const nodes: Node<MiniNodeData>[] = [];
  const edges: Edge<MiniEdgeData>[] = [];

  // Deduplicate neighbors by kind+name+namespace
  const dedup = (list: RelationshipNeighbor[]) => {
    const seen = new Set<string>();
    return list.filter((n) => {
      const key = `${n.kind}/${n.namespace}/${n.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const uniqueIncoming = dedup(incoming);
  const uniqueOutgoing = dedup(outgoing);

  // Calculate vertical positions to center each column
  const incomingCount = uniqueIncoming.length;
  const outgoingCount = uniqueOutgoing.length;
  const maxCount = Math.max(incomingCount, outgoingCount, 1);

  const totalHeight = maxCount * ROW_GAP;
  const centerY = totalHeight / 2;

  // Center node
  nodes.push({
    id: 'center',
    type: 'mini',
    position: { x: CENTER_X - NODE_WIDTH / 2, y: centerY - NODE_HEIGHT / 2 },
    data: {
      label: centerName,
      kind: centerKind,
      category: centerCategory,
      status: centerStatus,
      isCenter: true,
    },
  });

  // Incoming nodes (left column)
  const inStartY = centerY - ((incomingCount - 1) * ROW_GAP) / 2;
  uniqueIncoming.forEach((neighbor, i) => {
    const id = `in-${i}`;
    const cat = neighbor.category !== 'containment' ? neighbor.category : guessCategory(neighbor.kind);
    nodes.push({
      id,
      type: 'mini',
      position: { x: 0, y: inStartY + i * ROW_GAP - NODE_HEIGHT / 2 },
      data: {
        label: neighbor.name,
        kind: neighbor.kind,
        category: cat,
        status: neighbor.status,
      },
    });
    edges.push({
      id: `e-${id}-center`,
      source: id,
      target: 'center',
      type: 'labeled',
      data: {
        label: formatEdgeLabel(neighbor.type),
        category: neighbor.category,
      },
    });
  });

  // Outgoing nodes (right column)
  const outStartY = centerY - ((outgoingCount - 1) * ROW_GAP) / 2;
  uniqueOutgoing.forEach((neighbor, i) => {
    const id = `out-${i}`;
    const cat = neighbor.category !== 'containment' ? neighbor.category : guessCategory(neighbor.kind);
    nodes.push({
      id,
      type: 'mini',
      position: { x: CENTER_X + NODE_WIDTH / 2 + COLUMN_GAP - NODE_WIDTH, y: outStartY + i * ROW_GAP - NODE_HEIGHT / 2 },
      data: {
        label: neighbor.name,
        kind: neighbor.kind,
        category: cat,
        status: neighbor.status,
      },
    });
    edges.push({
      id: `e-center-${id}`,
      source: 'center',
      target: id,
      type: 'labeled',
      data: {
        label: formatEdgeLabel(neighbor.type),
        category: neighbor.category,
      },
    });
  });

  return { nodes, edges };
}

/** Format edge labels: "scheduled_on" -> "scheduled-on", keep short labels */
function formatEdgeLabel(type: string): string {
  const friendlyMap: Record<string, string> = {
    owns: 'owns',
    selects: 'selects',
    mounts: 'mounts',
    routes: 'routes-to',
    references: 'refs',
    configures: 'configures',
    stores: 'stores',
    contains: 'contains',
    exposes: 'exposes',
    backed_by: 'backed-by',
    permits: 'permits',
    limits: 'limits',
    manages: 'manages',
    scheduled_on: 'scheduled-on',
  };
  return friendlyMap[type] ?? type.replace(/_/g, '-');
}

// ─── Component ──────────────────────────────────────────────────────────────

function RelationshipMiniGraphInner({
  centerKind,
  centerName,
  centerCategory,
  centerStatus,
  incoming,
  outgoing,
  onNodeClick,
  className,
}: RelationshipMiniGraphProps) {
  const isDark = useThemeStore((s) => s.resolvedTheme === 'dark');

  const { nodes, edges } = useMemo(
    () => buildGraph(centerKind, centerName, centerCategory, centerStatus, incoming, outgoing),
    [centerKind, centerName, centerCategory, centerStatus, incoming, outgoing],
  );

  // Map node IDs back to resource info for click handling
  const nodeResourceMap = useMemo(() => {
    const map = new Map<string, { kind: string; name: string; namespace: string }>();
    map.set('center', { kind: centerKind, name: centerName, namespace: '' });
    incoming.forEach((n, i) => map.set(`in-${i}`, { kind: n.kind, name: n.name, namespace: n.namespace }));
    outgoing.forEach((n, i) => map.set(`out-${i}`, { kind: n.kind, name: n.name, namespace: n.namespace }));
    return map;
  }, [centerKind, centerName, incoming, outgoing]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const resource = nodeResourceMap.get(node.id);
      if (resource && onNodeClick) {
        onNodeClick(resource.kind, resource.name, resource.namespace);
      }
    },
    [nodeResourceMap, onNodeClick],
  );

  return (
    <div
      className={`w-full rounded-lg border overflow-hidden ${className ?? ''}`}
      style={{
        height: Math.max(250, Math.max(incoming.length, outgoing.length, 1) * ROW_GAP + 80),
        backgroundColor: isDark ? canvasColors.dark.background : canvasColors.light.background,
        borderColor: isDark ? canvasColors.dark.nodeBorder : canvasColors.light.nodeBorder,
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={1.5}
        zoomOnScroll
        panOnScroll={false}
        panOnDrag
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={isDark ? canvasColors.dark.gridDots : canvasColors.light.gridDots}
        />
      </ReactFlow>
    </div>
  );
}

export function RelationshipMiniGraph(props: RelationshipMiniGraphProps) {
  return (
    <ReactFlowProvider>
      <RelationshipMiniGraphInner {...props} />
    </ReactFlowProvider>
  );
}
