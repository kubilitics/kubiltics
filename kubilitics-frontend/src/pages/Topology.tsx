/**
 * Kubilitics Topology — Enterprise Architecture Redesign
 *
 * 3 clear views:
 *   1. Application  — how apps run (Ingress → Service → Deployment → Pod → Node)
 *   2. Dependencies — what a resource depends on (radial upstream/downstream)
 *   3. Infrastructure — cluster infra (Node → Pods/Volumes/Controllers)
 *
 * Design: Apple HIG, calm palette, focus-mode interaction, Figma-like canvas.
 * Rule: if a user can't understand the cluster in 3 seconds, it failed.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  BaseEdge,
  getBezierPath,
  MarkerType,
  Panel,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type NodeProps,
  type EdgeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, X, Layers, Globe, Server, Box, Cpu, Database,
  Shield, Key, Lock, HardDrive, Archive, FileCode, Zap,
  Activity, Network, GitBranch, Share2, Waypoints, Filter,
  LayoutGrid, Settings, RefreshCw, Download, ChevronDown,
  AlertCircle, CheckCircle2, AlertTriangle, Loader2,
  Maximize2, SlidersHorizontal,
} from 'lucide-react';
import ELK from 'elkjs/lib/elk.bundled.js';
import { useClusterStore } from '@/stores/clusterStore';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useClusterTopology } from '@/hooks/useClusterTopology';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useNamespacesFromCluster } from '@/hooks/useNamespacesFromCluster';
import { TopologyPage } from '@/topology/TopologyPage';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { GraphModel } from '@/topology-engine/core/graphModel';
import { AdjacencyMap } from '@/topology-engine/core/adjacencyMap';
import { getUpstreamChain, getDownstreamChain } from '@/topology-engine/core/graphTraversal';
import type {
  TopologyGraph, TopologyNode, TopologyEdge, KubernetesKind,
} from '@/topology-engine/types/topology.types';
import {
  downloadJSON, downloadCSVSummary, downloadFile, generateTestGraph,
} from '@/topology-engine';

// ─── View Types ───────────────────────────────────────────────────────────────

type TopologyView = 'application' | 'dependencies' | 'infrastructure';

const VIEW_CONFIG = {
  application: {
    label: 'Application',
    description: 'How apps run in the cluster',
    icon: Layers,
  },
  dependencies: {
    label: 'Dependencies',
    description: 'What resources depend on',
    icon: GitBranch,
  },
  infrastructure: {
    label: 'Infrastructure',
    description: 'Cluster nodes & scheduling',
    icon: Server,
  },
} as const;

// ─── Design System ────────────────────────────────────────────────────────────

// Calm, semantic colors — no neon, no chaos
type GradientDef = { from: string; to: string; text: string };

const GRADIENTS: Record<string, GradientDef> = {
  // Workloads — blue
  Deployment:  { from: '#4A7EC4', to: '#2A52A0', text: '#fff' },
  StatefulSet: { from: '#5B68B8', to: '#3A4290', text: '#fff' },
  DaemonSet:   { from: '#6B52B0', to: '#4A3590', text: '#fff' },
  ReplicaSet:  { from: '#5868B8', to: '#384290', text: '#fff' },
  Pod:         { from: '#4A7EC4', to: '#2A52A0', text: '#fff' },
  PodGroup:    { from: '#6AA8D0', to: '#2A6090', text: '#fff' },
  Job:         { from: '#4290B8', to: '#1A6090', text: '#fff' },
  CronJob:     { from: '#3888B0', to: '#1A5880', text: '#fff' },
  Container:   { from: '#4A7EC4', to: '#2A52A0', text: '#fff' },
  ReplicationController: { from: '#6070A0', to: '#3A4480', text: '#fff' },
  HorizontalPodAutoscaler: { from: '#4290B8', to: '#1A6090', text: '#fff' },
  PodDisruptionBudget: { from: '#A85252', to: '#7A3030', text: '#fff' },

  // Networking — teal
  Service:       { from: '#2A9890', to: '#1A6A62', text: '#fff' },
  Ingress:       { from: '#2A8E88', to: '#1A6260', text: '#fff' },
  NetworkPolicy: { from: '#226A58', to: '#144038', text: '#fff' },
  Endpoints:     { from: '#389878', to: '#1A6050', text: '#fff' },
  EndpointSlice: { from: '#40A888', to: '#1A6858', text: '#fff' },
  IngressClass:  { from: '#60B898', to: '#2A7858', text: '#fff' },

  // Storage — cyan + amber
  PersistentVolumeClaim: { from: '#3A88B0', to: '#1A5A88', text: '#fff' },
  PersistentVolume:      { from: '#2A78A0', to: '#1A4C78', text: '#fff' },
  StorageClass:          { from: '#3090A8', to: '#1A6078', text: '#fff' },
  VolumeAttachment:      { from: '#4A9CB8', to: '#1A6A88', text: '#fff' },
  ConfigMap:             { from: '#A88040', to: '#785028', text: '#fff' },
  Secret:                { from: '#A84848', to: '#782828', text: '#fff' },

  // RBAC — violet
  ServiceAccount:     { from: '#8068B8', to: '#5A4090', text: '#fff' },
  Role:               { from: '#9060B0', to: '#684090', text: '#fff' },
  ClusterRole:        { from: '#9048A8', to: '#682080', text: '#fff' },
  RoleBinding:        { from: '#A058B8', to: '#782890', text: '#fff' },
  ClusterRoleBinding: { from: '#A878C0', to: '#8040A0', text: '#fff' },

  // Infrastructure — warm amber
  Node:          { from: '#A88040', to: '#785028', text: '#fff' },
  Namespace:     { from: '#A86838', to: '#784020', text: '#fff' },
  LimitRange:    { from: '#7A7470', to: '#504A46', text: '#fff' },
  ResourceQuota: { from: '#6A6058', to: '#403838', text: '#fff' },
  PriorityClass: { from: '#8A8680', to: '#5A5450', text: '#fff' },
  RuntimeClass:  { from: '#7A7E90', to: '#4A5060', text: '#fff' },
  Lease:         { from: '#6A7488', to: '#3A4458', text: '#fff' },
  CSIDriver:     { from: '#2A8888', to: '#1A5858', text: '#fff' },
  CSINode:       { from: '#389878', to: '#1A6050', text: '#fff' },
};

const FALLBACK_GRADIENT: GradientDef = { from: '#5A6878', to: '#323C48', text: '#fff' };

function getGradient(kind: string): GradientDef {
  return GRADIENTS[kind] ?? FALLBACK_GRADIENT;
}

// Kind → Lucide icon mapping
const KIND_ICONS: Record<string, React.ElementType> = {
  Deployment: Layers, StatefulSet: Database, DaemonSet: Cpu, ReplicaSet: Share2,
  Pod: Box, Job: Zap, CronJob: Activity, PodGroup: Waypoints,
  Service: Globe, Ingress: Network, NetworkPolicy: Shield, Endpoints: Waypoints,
  EndpointSlice: Waypoints, IngressClass: GitBranch, HorizontalPodAutoscaler: SlidersHorizontal,
  PersistentVolumeClaim: Archive, PersistentVolume: HardDrive, StorageClass: Database,
  ConfigMap: FileCode, Secret: Key, VolumeAttachment: HardDrive,
  ServiceAccount: Lock, Role: Shield, ClusterRole: Shield, RoleBinding: Lock, ClusterRoleBinding: Lock,
  Node: Server, Namespace: LayoutGrid, LimitRange: Filter, ResourceQuota: Filter,
  Container: Box, CSIDriver: HardDrive, CSINode: Server, Lease: Activity,
  ReplicationController: Share2, PodDisruptionBudget: AlertCircle, PriorityClass: Zap,
  RuntimeClass: Settings,
};

function KindIcon({ kind, size = 14 }: { kind: string; size?: number }) {
  const Icon = KIND_ICONS[kind] ?? Box;
  return <Icon size={size} />;
}

function healthColor(h: string | undefined): string {
  if (h === 'healthy') return '#34A853';
  if (h === 'warning') return '#FBBC04';
  if (h === 'critical') return '#EA4335';
  return '#9AA0A6';
}

function healthBorder(h: string | undefined): string {
  if (h === 'healthy') return '2px solid #34A85330';
  if (h === 'warning') return '2px solid #FBBC0440';
  if (h === 'critical') return '2px solid #EA433540';
  return '2px solid #E8EAED';
}

// ─── Application View Tiers ──────────────────────────────────────────────────

const APP_TIER_ORDER: Record<string, number> = {
  Ingress: 0, IngressClass: 0,
  Service: 1, Endpoints: 1, EndpointSlice: 1,
  Deployment: 2, StatefulSet: 2, DaemonSet: 2, Job: 2, CronJob: 2,
  ReplicaSet: 3, ReplicationController: 3,
  Pod: 4, PodGroup: 4, Container: 4,
  Node: 5,
};

const APP_TIER_LABELS = ['Ingress', 'Services', 'Workloads', 'Replica Sets', 'Pods', 'Nodes'];

// Infrastructure grouping
const INFRA_GROUPS = {
  compute: ['Pod', 'PodGroup', 'Container'],
  controllers: ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob'],
  network: ['Service', 'Ingress', 'NetworkPolicy', 'Endpoints', 'EndpointSlice'],
  storage: ['PersistentVolumeClaim', 'PersistentVolume', 'StorageClass', 'VolumeAttachment'],
  config: ['ConfigMap', 'Secret'],
  rbac: ['ServiceAccount', 'Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding'],
};

// ─── Node Components ──────────────────────────────────────────────────────────

// Node data type for ReactFlow
type TopologyNodeData = {
  topologyNode: TopologyNode;
  focused: boolean;   // is this node in the focus set?
  dimmed: boolean;    // should fade out?
};

// Unified node — clean, minimal, Apple-style card
function UnifiedNode({ data, selected }: NodeProps<Node<TopologyNodeData>>) {
  const { topologyNode, dimmed } = data;
  const grad = getGradient(topologyNode.kind);
  const health = topologyNode.computed?.health ?? 'unknown';
  const replicas = topologyNode.computed?.replicas;
  const isPod = topologyNode.kind === 'Pod' || topologyNode.kind === 'PodGroup' || topologyNode.kind === 'Container';

  return (
    <div style={{
      width: isPod ? 160 : 192,
      borderRadius: 12,
      background: '#FFFFFF',
      border: selected ? `2px solid ${grad.from}` : healthBorder(health),
      boxShadow: selected
        ? `0 0 0 1px ${grad.from}30, 0 8px 24px rgba(0,0,0,0.12)`
        : dimmed
          ? '0 1px 3px rgba(0,0,0,0.04)'
          : '0 2px 8px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)',
      opacity: dimmed ? 0.15 : 1,
      transition: 'opacity 0.25s ease, box-shadow 0.2s ease, border-color 0.2s ease',
      cursor: 'pointer',
      overflow: 'hidden',
    }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, width: 8, height: 8 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 8, height: 8 }} />

      {/* Gradient accent bar */}
      <div style={{
        height: 4,
        background: `linear-gradient(90deg, ${grad.from}, ${grad.to})`,
      }} />

      <div style={{ padding: isPod ? '6px 10px 8px' : '8px 12px 10px' }}>
        {/* Kind badge + health dot */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: `${grad.from}12`, borderRadius: 5, padding: '2px 6px',
          }}>
            <KindIcon kind={topologyNode.kind} size={10} />
            <span style={{
              fontSize: 9, fontWeight: 700, color: grad.from,
              textTransform: 'uppercase', letterSpacing: '0.04em',
              fontFamily: '"Inter", system-ui, sans-serif',
            }}>
              {topologyNode.kind}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {replicas && (
              <span style={{
                fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                color: replicas.ready === replicas.desired ? '#34A853' : replicas.ready > 0 ? '#FBBC04' : '#EA4335',
              }}>
                {replicas.ready}/{replicas.desired}
              </span>
            )}
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: healthColor(health),
            }} />
          </div>
        </div>

        {/* Resource name */}
        <div style={{
          fontSize: 12, fontWeight: 600, color: '#1A1A1A',
          fontFamily: '"Inter", system-ui, sans-serif',
          lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {topologyNode.name}
        </div>

        {/* Namespace */}
        {topologyNode.namespace && (
          <div style={{
            fontSize: 10, color: '#6B7280', marginTop: 1,
            fontFamily: '"Inter", system-ui, sans-serif',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {topologyNode.namespace}
          </div>
        )}
      </div>
    </div>
  );
}

const MemoUnifiedNode = React.memo(UnifiedNode, (prev, next) =>
  prev.data.topologyNode.id === next.data.topologyNode.id &&
  prev.data.dimmed === next.data.dimmed &&
  prev.selected === next.selected &&
  prev.data.topologyNode.computed?.health === next.data.topologyNode.computed?.health
);

const NODE_TYPES: NodeTypes = {
  unified: MemoUnifiedNode as unknown as React.ComponentType,
};

// ─── Edge Components ──────────────────────────────────────────────────────────

// Edge styles injected once
const EDGE_KEYFRAMES = `
@keyframes topoDash { to { stroke-dashoffset: -40; } }
`;
let edgeStylesInjected = false;
function injectEdgeStyles() {
  if (edgeStylesInjected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.textContent = EDGE_KEYFRAMES;
  document.head.appendChild(el);
  edgeStylesInjected = true;
}

const EDGE_COLORS: Record<string, string> = {
  owns: '#5A6E82', manages: '#5A6E82',
  selects: '#2A9890', exposes: '#2A9890',
  routes: '#4A7EC4',
  mounts: '#3A88B0', stores: '#3A88B0', backed_by: '#3A88B0',
  configures: '#A88040', references: '#A88040',
  permits: '#8068B8',
  scheduled_on: '#A86838', runs: '#A86838', schedules: '#A86838',
  contains: '#6A7888',
  limits: '#605850',
};

function getEdgeColor(rel: string): string {
  return EDGE_COLORS[rel] ?? '#94A3B8';
}

// Structural edge — clean bezier with directional arrow
function StructuralEdge({ sourceX, sourceY, targetX, targetY, data, style }: EdgeProps) {
  injectEdgeStyles();
  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY, curvature: 0.25 });
  const rel = (data as unknown as Record<string, unknown>)?.rel ?? '';
  const color = getEdgeColor(rel);
  const dimmed = (data as unknown as Record<string, unknown>)?.dimmed ?? false;
  const isTraffic = rel === 'selects' || rel === 'routes' || rel === 'exposes';

  return (
    <g>
      {/* Wider invisible hit area */}
      <BaseEdge
        path={edgePath}
        style={{ stroke: 'transparent', strokeWidth: 16 }}
      />
      {/* Soft glow underline */}
      <BaseEdge
        path={edgePath}
        style={{ stroke: color, strokeWidth: 6, opacity: dimmed ? 0.01 : 0.04, strokeLinecap: 'round' }}
      />
      {/* Main edge */}
      <BaseEdge
        path={edgePath}
        markerEnd={`url(#arrow-${color.replace('#', '')})`}
        style={{
          ...style,
          stroke: color,
          strokeWidth: isTraffic ? 2 : 1.5,
          strokeDasharray: isTraffic ? '6 4' : undefined,
          strokeLinecap: 'round',
          opacity: dimmed ? 0.03 : 0.6,
          transition: 'opacity 0.25s ease',
          animation: isTraffic && !dimmed ? 'topoDash 1.5s linear infinite' : undefined,
        }}
      />
    </g>
  );
}

const EDGE_TYPES: EdgeTypes = {
  structural: StructuralEdge as unknown as React.ComponentType,
};

// ─── Layout Engine ────────────────────────────────────────────────────────────

const elk = new ELK();

async function layoutApplication(
  rfNodes: Node<TopologyNodeData>[],
  rfEdges: Edge[],
): Promise<Node<TopologyNodeData>[]> {
  if (rfNodes.length === 0) return rfNodes;

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.spacing.nodeNode': '35',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.edgeRouting': 'POLYLINE',
    },
    children: rfNodes.map(n => ({
      id: n.id,
      width: n.measured?.width ?? 192,
      height: n.measured?.height ?? 72,
    })),
    edges: rfEdges.map(e => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  const result = await elk.layout(elkGraph);
  const positionMap = new Map<string, { x: number; y: number }>();
  for (const child of result.children ?? []) {
    positionMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  return rfNodes.map(n => ({
    ...n,
    position: positionMap.get(n.id) ?? n.position,
  }));
}

async function layoutInfrastructure(
  rfNodes: Node<TopologyNodeData>[],
  rfEdges: Edge[],
): Promise<Node<TopologyNodeData>[]> {
  if (rfNodes.length === 0) return rfNodes;

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
      'elk.spacing.nodeNode': '30',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    },
    children: rfNodes.map(n => ({
      id: n.id,
      width: n.measured?.width ?? 192,
      height: n.measured?.height ?? 72,
    })),
    edges: rfEdges.map(e => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  const result = await elk.layout(elkGraph);
  const positionMap = new Map<string, { x: number; y: number }>();
  for (const child of result.children ?? []) {
    positionMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  return rfNodes.map(n => ({
    ...n,
    position: positionMap.get(n.id) ?? n.position,
  }));
}

function layoutDependencies(
  rfNodes: Node<TopologyNodeData>[],
  focusNodeId: string | null,
): Node<TopologyNodeData>[] {
  if (rfNodes.length === 0) return rfNodes;

  // Radial layout centered on focus node (or center of all nodes)
  const center = { x: 400, y: 400 };
  const focusNode = focusNodeId ? rfNodes.find(n => n.id === focusNodeId) : null;

  if (!focusNode || rfNodes.length === 1) {
    // Simple grid layout as fallback
    const cols = Math.ceil(Math.sqrt(rfNodes.length));
    return rfNodes.map((n, i) => ({
      ...n,
      position: {
        x: (i % cols) * 230,
        y: Math.floor(i / cols) * 100,
      },
    }));
  }

  // Place focus node at center
  const others = rfNodes.filter(n => n.id !== focusNodeId);
  const ringCount = Math.ceil(others.length / 8);

  const positioned = rfNodes.map(n => {
    if (n.id === focusNodeId) {
      return { ...n, position: center };
    }
    const idx = others.indexOf(n);
    const ring = Math.floor(idx / 8);
    const posInRing = idx % 8;
    const totalInRing = Math.min(8, others.length - ring * 8);
    const angle = (posInRing / totalInRing) * Math.PI * 2 - Math.PI / 2;
    const radius = 200 + ring * 160;

    return {
      ...n,
      position: {
        x: center.x + Math.cos(angle) * radius - 96,
        y: center.y + Math.sin(angle) * radius - 36,
      },
    };
  });

  return positioned;
}

// ─── Graph Filtering ──────────────────────────────────────────────────────────

function filterGraphForView(
  graph: TopologyGraph,
  view: TopologyView,
  focusNodeId: string | null,
): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  const { nodes, edges } = graph;

  if (view === 'application') {
    // Show: Ingress → Service → Deployment/StatefulSet → ReplicaSet → Pod → Node
    // Hide: Config, RBAC, Storage (those go in Dependencies)
    const appKinds = new Set<string>([
      'Ingress', 'IngressClass', 'Service', 'Endpoints', 'EndpointSlice',
      'Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob',
      'ReplicaSet', 'ReplicationController',
      'Pod', 'PodGroup', 'Container',
      'Node',
    ]);
    const filtered = nodes.filter(n => appKinds.has(n.kind));
    const nodeIds = new Set(filtered.map(n => n.id));
    const filteredEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
    return { nodes: filtered, edges: filteredEdges };
  }

  if (view === 'dependencies') {
    if (!focusNodeId) {
      // Show everything but let the layout engine handle it
      return { nodes, edges };
    }
    // Show the focus node + all directly connected resources
    const connected = new Set<string>([focusNodeId]);
    for (const e of edges) {
      if (e.source === focusNodeId) connected.add(e.target);
      if (e.target === focusNodeId) connected.add(e.source);
    }
    const filtered = nodes.filter(n => connected.has(n.id));
    const nodeIds = new Set(filtered.map(n => n.id));
    const filteredEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
    return { nodes: filtered, edges: filteredEdges };
  }

  if (view === 'infrastructure') {
    // Show: Node + everything scheduled on it + controllers + volumes
    const infraKinds = new Set<string>([
      'Node', 'Namespace',
      'Pod', 'PodGroup', 'Container',
      'Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob',
      'PersistentVolumeClaim', 'PersistentVolume', 'StorageClass',
      'Service', 'Ingress', 'NetworkPolicy',
    ]);
    const filtered = nodes.filter(n => infraKinds.has(n.kind));
    const nodeIds = new Set(filtered.map(n => n.id));
    const filteredEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
    return { nodes: filtered, edges: filteredEdges };
  }

  return { nodes, edges };
}

// ─── Convert to ReactFlow ─────────────────────────────────────────────────────

function toRFNodes(
  tNodes: TopologyNode[],
  focusSet: Set<string> | null,
  selectedId: string | null,
): Node<TopologyNodeData>[] {
  return tNodes.map(n => ({
    id: n.id,
    type: 'unified',
    position: { x: 0, y: 0 },
    data: {
      topologyNode: n,
      focused: focusSet ? focusSet.has(n.id) : true,
      dimmed: focusSet ? !focusSet.has(n.id) : false,
    },
    selected: n.id === selectedId,
  }));
}

function toRFEdges(
  tEdges: TopologyEdge[],
  focusSet: Set<string> | null,
): Edge[] {
  // Deduplicate edges by source-target pair
  const seen = new Set<string>();
  const deduped: TopologyEdge[] = [];
  for (const e of tEdges) {
    const key = `${e.source}|${e.target}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(e);
    }
  }

  return deduped.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'structural',
    data: {
      rel: e.relationshipType,
      dimmed: focusSet ? !(focusSet.has(e.source) && focusSet.has(e.target)) : false,
    },
  }));
}

// ─── Arrow Markers ────────────────────────────────────────────────────────────

function ArrowMarkers() {
  const colors = [...new Set(Object.values(EDGE_COLORS))];
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }}>
      <defs>
        {colors.map(color => (
          <marker
            key={color}
            id={`arrow-${color.replace('#', '')}`}
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon
              points="0 0, 10 3.5, 0 7"
              fill={color}
              fillOpacity={0.5}
            />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

// ─── Tier Labels (Application View) ──────────────────────────────────────────

function TierLabel({ label, y }: { label: string; y: number }) {
  return (
    <div style={{
      position: 'absolute',
      left: -120,
      top: y,
      width: 100,
      textAlign: 'right',
      pointerEvents: 'none',
      zIndex: 5,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, color: '#6B7280',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        fontFamily: '"Inter", system-ui, sans-serif',
      }}>
        {label}
      </span>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  node,
  graph,
  onClose,
  onNavigate,
}: {
  node: TopologyNode;
  graph: TopologyGraph;
  onClose: () => void;
  onNavigate: (node: TopologyNode) => void;
}) {
  const grad = getGradient(node.kind);
  const health = node.computed?.health ?? 'unknown';

  // Find relationships
  const outgoing = graph.edges.filter(e => e.source === node.id);
  const incoming = graph.edges.filter(e => e.target === node.id);

  const relatedNodes = useMemo(() => {
    const ids = new Set([
      ...outgoing.map(e => e.target),
      ...incoming.map(e => e.source),
    ]);
    return graph.nodes.filter(n => ids.has(n.id));
  }, [graph, outgoing, incoming]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      style={{
        position: 'absolute', top: 16, right: 16, width: 320,
        background: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(16px)',
        borderRadius: 16,
        border: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
        overflow: 'hidden',
        zIndex: 30,
        fontFamily: '"Inter", system-ui, sans-serif',
        maxHeight: 'calc(100% - 32px)',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
        padding: '16px 18px 14px',
        color: '#fff',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <KindIcon kind={node.kind} size={14} />
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.9 }}>
                {node.kind}
              </span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, wordBreak: 'break-word' }}>
              {node.name}
            </div>
            {node.namespace && (
              <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>
                {node.namespace}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 6,
              padding: 4, cursor: 'pointer', color: '#fff', flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Health + status badges */}
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            background: 'rgba(255,255,255,0.2)', borderRadius: 4, padding: '2px 8px',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: healthColor(health) }} />
            {health}
          </span>
          {node.status && (
            <span style={{
              fontSize: 10, background: 'rgba(255,255,255,0.15)', borderRadius: 4, padding: '2px 8px',
            }}>
              {node.status}
            </span>
          )}
          {node.computed?.replicas && (
            <span style={{
              fontSize: 10, fontFamily: 'monospace',
              background: 'rgba(255,255,255,0.15)', borderRadius: 4, padding: '2px 8px',
            }}>
              {node.computed.replicas.ready}/{node.computed.replicas.desired} replicas
            </span>
          )}
        </div>
      </div>

      {/* Metrics */}
      {(node.computed?.cpuUsage != null || node.computed?.memoryUsage != null || node.computed?.restartCount != null) && (
        <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', gap: 16 }}>
            {node.computed?.cpuUsage != null && (
              <div>
                <div style={{ fontSize: 9, color: '#6B7280', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>CPU</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1A1A1A', fontFamily: 'monospace' }}>{node.computed.cpuUsage}%</div>
              </div>
            )}
            {node.computed?.memoryUsage != null && (
              <div>
                <div style={{ fontSize: 9, color: '#6B7280', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Memory</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1A1A1A', fontFamily: 'monospace' }}>{node.computed.memoryUsage}%</div>
              </div>
            )}
            {node.computed?.restartCount != null && (
              <div>
                <div style={{ fontSize: 9, color: '#6B7280', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Restarts</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: node.computed.restartCount > 3 ? '#EA4335' : '#1A1A1A', fontFamily: 'monospace' }}>{node.computed.restartCount}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Relationships */}
      {relatedNodes.length > 0 && (
        <div style={{ padding: '12px 18px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Related ({relatedNodes.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {relatedNodes.slice(0, 12).map(rn => {
              const rg = getGradient(rn.kind);
              return (
                <button
                  key={rn.id}
                  onClick={() => onNavigate(rn)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 8px', borderRadius: 8,
                    background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.04)',
                    cursor: 'pointer', textAlign: 'left', width: '100%',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.02)')}
                >
                  <div style={{
                    background: `${rg.from}15`, borderRadius: 4, padding: 3,
                    display: 'flex', alignItems: 'center', flexShrink: 0,
                  }}>
                    <KindIcon kind={rn.kind} size={10} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#1A1A1A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {rn.name}
                    </div>
                    <div style={{ fontSize: 9, color: '#9AA0A6' }}>{rn.kind}</div>
                  </div>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: healthColor(rn.computed?.health), flexShrink: 0 }} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ─── Mock Graph ───────────────────────────────────────────────────────────────

function n(partial: Omit<TopologyNode, 'label'>): TopologyNode {
  return { ...partial, label: partial.name };
}

const mockGraph: TopologyGraph = {
  schemaVersion: '1.0',
  nodes: [
    n({ id: 'Namespace/demo', kind: 'Namespace', namespace: '', name: 'demo', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'ns-1' }, computed: { health: 'healthy' } }),
    n({ id: 'Node/worker-1', kind: 'Node', namespace: '', name: 'worker-1', apiVersion: 'v1', status: 'Ready', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'node-1' }, computed: { health: 'healthy', cpuUsage: 45 } }),
    n({ id: 'Ingress/demo/main', kind: 'Ingress', namespace: 'demo', name: 'main-ingress', apiVersion: 'networking.k8s.io/v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'ing-1' }, computed: { health: 'healthy' } }),
    n({ id: 'Service/demo/web', kind: 'Service', namespace: 'demo', name: 'web-svc', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'svc-1' }, computed: { health: 'healthy' } }),
    n({ id: 'Service/demo/api', kind: 'Service', namespace: 'demo', name: 'api-svc', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'svc-2' }, computed: { health: 'healthy' } }),
    n({ id: 'Deployment/demo/web', kind: 'Deployment', namespace: 'demo', name: 'web', apiVersion: 'apps/v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'dep-1' }, computed: { health: 'healthy', replicas: { desired: 3, ready: 3, available: 3 } } }),
    n({ id: 'Deployment/demo/api', kind: 'Deployment', namespace: 'demo', name: 'api-gateway', apiVersion: 'apps/v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'dep-2' }, computed: { health: 'warning', replicas: { desired: 2, ready: 1, available: 1 }, cpuUsage: 78 } }),
    n({ id: 'ReplicaSet/demo/web-rs', kind: 'ReplicaSet', namespace: 'demo', name: 'web-rs-abc', apiVersion: 'apps/v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'rs-1' }, computed: { health: 'healthy', replicas: { desired: 3, ready: 3, available: 3 } } }),
    n({ id: 'Pod/demo/web-1', kind: 'Pod', namespace: 'demo', name: 'web-abc-1', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'pod-1' }, computed: { health: 'healthy', restartCount: 0, cpuUsage: 12 } }),
    n({ id: 'Pod/demo/web-2', kind: 'Pod', namespace: 'demo', name: 'web-abc-2', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'pod-2' }, computed: { health: 'healthy', restartCount: 0, cpuUsage: 18 } }),
    n({ id: 'Pod/demo/web-3', kind: 'Pod', namespace: 'demo', name: 'web-abc-3', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'pod-3' }, computed: { health: 'warning', restartCount: 5, cpuUsage: 62 } }),
    n({ id: 'Pod/demo/api-1', kind: 'Pod', namespace: 'demo', name: 'api-xyz-1', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'pod-4' }, computed: { health: 'healthy', restartCount: 1, cpuUsage: 34 } }),
    n({ id: 'ConfigMap/demo/web-config', kind: 'ConfigMap', namespace: 'demo', name: 'web-config', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'cm-1' }, computed: { health: 'healthy' } }),
    n({ id: 'Secret/demo/api-secrets', kind: 'Secret', namespace: 'demo', name: 'api-secrets', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'sec-1' }, computed: { health: 'healthy' } }),
    n({ id: 'PersistentVolumeClaim/demo/data', kind: 'PersistentVolumeClaim', namespace: 'demo', name: 'data-pvc', apiVersion: 'v1', status: 'Bound', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'pvc-1' }, computed: { health: 'healthy' } }),
    n({ id: 'ServiceAccount/demo/web-sa', kind: 'ServiceAccount', namespace: 'demo', name: 'web-sa', apiVersion: 'v1', status: 'Running', metadata: { labels: {}, annotations: {}, createdAt: '2024-01-01', uid: 'sa-1' }, computed: { health: 'healthy' } }),
  ],
  edges: [
    { id: 'e1', source: 'Ingress/demo/main', target: 'Service/demo/web', relationshipType: 'routes', label: 'routes', metadata: { derivation: 'fieldReference', confidence: 1, sourceField: 'spec.rules' } },
    { id: 'e2', source: 'Ingress/demo/main', target: 'Service/demo/api', relationshipType: 'routes', label: 'routes', metadata: { derivation: 'fieldReference', confidence: 1, sourceField: 'spec.rules' } },
    { id: 'e3', source: 'Service/demo/web', target: 'Pod/demo/web-1', relationshipType: 'selects', label: 'selects', metadata: { derivation: 'labelSelector', confidence: 1, sourceField: 'spec.selector' } },
    { id: 'e4', source: 'Service/demo/web', target: 'Pod/demo/web-2', relationshipType: 'selects', label: 'selects', metadata: { derivation: 'labelSelector', confidence: 1, sourceField: 'spec.selector' } },
    { id: 'e5', source: 'Service/demo/web', target: 'Pod/demo/web-3', relationshipType: 'selects', label: 'selects', metadata: { derivation: 'labelSelector', confidence: 1, sourceField: 'spec.selector' } },
    { id: 'e6', source: 'Service/demo/api', target: 'Pod/demo/api-1', relationshipType: 'selects', label: 'selects', metadata: { derivation: 'labelSelector', confidence: 1, sourceField: 'spec.selector' } },
    { id: 'e7', source: 'Deployment/demo/web', target: 'ReplicaSet/demo/web-rs', relationshipType: 'owns', label: 'owns', metadata: { derivation: 'ownerReference', confidence: 1, sourceField: 'metadata.ownerReferences' } },
    { id: 'e8', source: 'ReplicaSet/demo/web-rs', target: 'Pod/demo/web-1', relationshipType: 'owns', label: 'owns', metadata: { derivation: 'ownerReference', confidence: 1, sourceField: 'metadata.ownerReferences' } },
    { id: 'e9', source: 'ReplicaSet/demo/web-rs', target: 'Pod/demo/web-2', relationshipType: 'owns', label: 'owns', metadata: { derivation: 'ownerReference', confidence: 1, sourceField: 'metadata.ownerReferences' } },
    { id: 'e10', source: 'ReplicaSet/demo/web-rs', target: 'Pod/demo/web-3', relationshipType: 'owns', label: 'owns', metadata: { derivation: 'ownerReference', confidence: 1, sourceField: 'metadata.ownerReferences' } },
    { id: 'e11', source: 'Deployment/demo/api', target: 'Pod/demo/api-1', relationshipType: 'owns', label: 'owns', metadata: { derivation: 'ownerReference', confidence: 1, sourceField: 'metadata.ownerReferences' } },
    { id: 'e12', source: 'Pod/demo/web-1', target: 'Node/worker-1', relationshipType: 'scheduled_on', label: 'runs on', metadata: { derivation: 'fieldReference', confidence: 1, sourceField: 'spec.nodeName' } },
    { id: 'e13', source: 'Pod/demo/web-2', target: 'Node/worker-1', relationshipType: 'scheduled_on', label: 'runs on', metadata: { derivation: 'fieldReference', confidence: 1, sourceField: 'spec.nodeName' } },
    { id: 'e14', source: 'Pod/demo/web-3', target: 'Node/worker-1', relationshipType: 'scheduled_on', label: 'runs on', metadata: { derivation: 'fieldReference', confidence: 1, sourceField: 'spec.nodeName' } },
    { id: 'e15', source: 'Pod/demo/api-1', target: 'Node/worker-1', relationshipType: 'scheduled_on', label: 'runs on', metadata: { derivation: 'fieldReference', confidence: 1, sourceField: 'spec.nodeName' } },
    { id: 'e16', source: 'Deployment/demo/web', target: 'ConfigMap/demo/web-config', relationshipType: 'references', label: 'uses config', metadata: { derivation: 'envReference', confidence: 1, sourceField: 'spec.template.spec.volumes' } },
    { id: 'e17', source: 'Deployment/demo/api', target: 'Secret/demo/api-secrets', relationshipType: 'references', label: 'uses secret', metadata: { derivation: 'envReference', confidence: 1, sourceField: 'spec.template.spec.containers[].envFrom' } },
    { id: 'e18', source: 'Pod/demo/web-1', target: 'PersistentVolumeClaim/demo/data', relationshipType: 'mounts', label: 'mounts', metadata: { derivation: 'volumeMount', confidence: 1, sourceField: 'spec.volumes' } },
    { id: 'e19', source: 'Pod/demo/web-1', target: 'ServiceAccount/demo/web-sa', relationshipType: 'references', label: 'uses SA', metadata: { derivation: 'fieldReference', confidence: 1, sourceField: 'spec.serviceAccountName' } },
  ],
  metadata: {
    clusterId: 'docker-desktop',
    generatedAt: new Date().toISOString(),
    layoutSeed: 'deterministic',
    isComplete: true,
    warnings: [],
  },
};

// ─── Inner Component (uses ReactFlow context) ─────────────────────────────────

function TopologyInner({ graph }: { graph: TopologyGraph }) {
  const { fitView, setCenter } = useReactFlow();
  const navigate = useNavigate();

  const [activeView, setActiveView] = useState<TopologyView>('application');
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TopologyNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [layoutBusy, setLayoutBusy] = useState(false);

  // Graph analysis structures
  const graphModel = useMemo(() => graph?.nodes?.length ? new GraphModel(graph) : null, [graph]);
  const adjacencyMap = useMemo(() => graph?.edges?.length ? new AdjacencyMap(graph.edges) : null, [graph?.edges]);

  // Filter + layout whenever view or focus changes
  const { viewNodes, viewEdges } = useMemo(() => {
    const { nodes: vn, edges: ve } = filterGraphForView(graph, activeView, focusNodeId);
    return { viewNodes: vn, viewEdges: ve };
  }, [graph, activeView, focusNodeId]);

  // Build focus set for highlighting
  const focusSet = useMemo((): Set<string> | null => {
    if (!focusNodeId || !graphModel) return null;

    const upstream = getUpstreamChain(graphModel, focusNodeId);
    const downstream = getDownstreamChain(graphModel, focusNodeId);
    return new Set([...upstream, ...downstream]);
  }, [focusNodeId, graphModel]);

  // Convert to ReactFlow format
  const rfNodes = useMemo(() => toRFNodes(viewNodes, focusSet, selectedNode?.id ?? null), [viewNodes, focusSet, selectedNode?.id]);
  const rfEdges = useMemo(() => toRFEdges(viewEdges, focusSet), [viewEdges, focusSet]);

  // Run layout
  useEffect(() => {
    if (rfNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    setLayoutBusy(true);

    const doLayout = async () => {
      let laidOut: Node<TopologyNodeData>[];

      if (activeView === 'application') {
        laidOut = await layoutApplication(rfNodes, rfEdges);
      } else if (activeView === 'infrastructure') {
        laidOut = await layoutInfrastructure(rfNodes, rfEdges);
      } else {
        laidOut = layoutDependencies(rfNodes, focusNodeId);
      }

      setNodes(laidOut);
      setEdges(rfEdges);
      setLayoutBusy(false);

      // Auto-fit after layout
      setTimeout(() => {
        try { fitView({ padding: 0.15, maxZoom: 1.2, duration: 400 }); } catch { /* intentionally empty */ }
      }, 100);
    };

    doLayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfNodes, rfEdges, activeView, focusNodeId]);

  // Node click → focus mode
  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node<TopologyNodeData>) => {
    const tNode = node.data.topologyNode;

    // Toggle focus
    if (focusNodeId === tNode.id) {
      setFocusNodeId(null);
      setSelectedNode(null);
      return;
    }

    setFocusNodeId(tNode.id);
    setSelectedNode(tNode);
  }, [focusNodeId]);

  // Double click → navigate to detail page
  const handleNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node<TopologyNodeData>) => {
    const tNode = node.data.topologyNode;
    const routeMap: Record<string, string> = {
      Pod: 'pods', Deployment: 'deployments', ReplicaSet: 'replicasets',
      StatefulSet: 'statefulsets', DaemonSet: 'daemonsets', Service: 'services',
      ConfigMap: 'configmaps', Secret: 'secrets', Ingress: 'ingresses',
      Node: 'nodes', Namespace: 'namespaces', Job: 'jobs', CronJob: 'cronjobs',
      PersistentVolume: 'persistentvolumes', PersistentVolumeClaim: 'persistentvolumeclaims',
    };
    const route = routeMap[tNode.kind] ?? tNode.kind.toLowerCase() + 's';
    const path = tNode.namespace ? `/${route}/${tNode.namespace}/${tNode.name}` : `/${route}/${tNode.name}`;
    navigate(path);
  }, [navigate]);

  // Pane click → clear focus
  const handlePaneClick = useCallback(() => {
    setFocusNodeId(null);
    setSelectedNode(null);
  }, []);

  // Navigate to related node from detail panel
  const handleNavigateToNode = useCallback((tNode: TopologyNode) => {
    setFocusNodeId(tNode.id);
    setSelectedNode(tNode);
    // Center on node
    const rfNode = nodes.find(n => n.id === tNode.id);
    if (rfNode) {
      setTimeout(() => {
        try { setCenter(rfNode.position.x + 96, rfNode.position.y + 36, { zoom: 1.2, duration: 500 }); } catch { /* intentionally empty */ }
      }, 50);
    }
  }, [nodes, setCenter]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') {
        setFocusNodeId(null);
        setSelectedNode(null);
      }
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        try { fitView({ padding: 0.15, maxZoom: 1.2, duration: 400 }); } catch { /* intentionally empty */ }
      }
      if (e.key === '1' && !e.metaKey) setActiveView('application');
      if (e.key === '2' && !e.metaKey) setActiveView('dependencies');
      if (e.key === '3' && !e.metaKey) setActiveView('infrastructure');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fitView]);

  // Search results
  const searchMatchIds = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    return graph.nodes
      .filter(n =>
        n.name.toLowerCase().includes(q) ||
        n.kind.toLowerCase().includes(q) ||
        (n.namespace || '').toLowerCase().includes(q)
      )
      .map(n => n.id);
  }, [graph.nodes, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    const pods = graph.nodes.filter(n => n.kind === 'Pod');
    return {
      total: graph.nodes.length,
      pods: pods.length,
      healthy: pods.filter(p => !p.computed?.health || p.computed.health === 'healthy').length,
      warning: pods.filter(p => p.computed?.health === 'warning').length,
      critical: pods.filter(p => p.computed?.health === 'critical').length,
    };
  }, [graph.nodes]);

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      background: '#FAFBFC',
      fontFamily: '"Inter", system-ui, sans-serif',
      overflow: 'hidden',
    }}>
      <ArrowMarkers />

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={handlePaneClick}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
        minZoom={0.05}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'structural',
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(0,0,0,0.04)" />
        <Controls
          showZoom
          showFitView
          showInteractive={false}
          style={{
            background: 'rgba(255,255,255,0.9)',
            backdropFilter: 'blur(8px)',
            borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
          }}
        />
        <MiniMap
          style={{
            background: 'rgba(255,255,255,0.9)',
            borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
          }}
          maskColor="rgba(0,0,0,0.06)"
          pannable
          zoomable
        />

        {/* ── View Selector (centered top) ── */}
        <Panel position="top-center">
          <div style={{
            display: 'flex', alignItems: 'center', gap: 2,
            background: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(16px)',
            borderRadius: 12,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            padding: 3,
          }}>
            {(Object.entries(VIEW_CONFIG) as [TopologyView, typeof VIEW_CONFIG[TopologyView]][]).map(([key, config]) => {
              const isActive = activeView === key;
              const Icon = config.icon;
              return (
                <button
                  key={key}
                  onClick={() => { setActiveView(key); setFocusNodeId(null); setSelectedNode(null); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px',
                    borderRadius: 9,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? '#fff' : '#4B5563',
                    background: isActive ? '#1A1A1A' : 'transparent',
                    transition: 'all 0.2s ease',
                    fontFamily: '"Inter", system-ui, sans-serif',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  <Icon size={14} />
                  {config.label}
                </button>
              );
            })}
          </div>
        </Panel>

        {/* ── Status bar (bottom-left) ── */}
        <Panel position="bottom-left">
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(12px)',
            borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.06)',
            padding: '6px 14px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            fontSize: 11,
            color: '#6B7280',
            fontFamily: '"Inter", system-ui, sans-serif',
          }}>
            <span style={{ fontWeight: 600, color: '#1A1A1A' }}>{viewNodes.length}</span> resources
            <span style={{ width: 1, height: 12, background: 'rgba(0,0,0,0.1)' }} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#34A853' }} />
              {stats.healthy}
            </span>
            {stats.warning > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#FBBC04' }} />
                {stats.warning}
              </span>
            )}
            {stats.critical > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#EA4335' }} />
                {stats.critical}
              </span>
            )}
            {focusNodeId && (
              <>
                <span style={{ width: 1, height: 12, background: 'rgba(0,0,0,0.1)' }} />
                <span style={{ color: '#4A7EC4', fontWeight: 600 }}>Focus mode</span>
                <button
                  onClick={() => { setFocusNodeId(null); setSelectedNode(null); }}
                  style={{
                    background: 'rgba(0,0,0,0.06)', border: 'none', borderRadius: 4,
                    padding: '1px 5px', cursor: 'pointer', fontSize: 10, color: '#6B7280',
                  }}
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </Panel>

        {/* ── Keyboard hint (bottom-center) ── */}
        <Panel position="bottom-center">
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 10, color: '#9AA0A6',
            fontFamily: '"Inter", system-ui, sans-serif',
          }}>
            {[
              ['Click', 'Focus'],
              ['Dbl-click', 'Details'],
              ['Esc', 'Clear'],
              ['F', 'Fit'],
              ['1/2/3', 'View'],
            ].map(([key, label]) => (
              <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <kbd style={{
                  fontSize: 9, background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.08)',
                  borderRadius: 3, padding: '0px 4px', fontFamily: '"Inter", system-ui, sans-serif',
                }}>{key}</kbd>
                <span>{label}</span>
              </span>
            ))}
          </div>
        </Panel>
      </ReactFlow>

      {/* Loading spinner */}
      {layoutBusy && (
        <div style={{
          position: 'absolute', top: 16, right: 16,
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(255,255,255,0.95)', borderRadius: 10,
          padding: '8px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          border: '1px solid rgba(0,0,0,0.06)', zIndex: 25,
          fontSize: 12, color: '#6B7280',
        }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          Computing layout...
        </div>
      )}

      {/* Detail panel */}
      <AnimatePresence>
        {selectedNode && (
          <DetailPanel
            node={selectedNode}
            graph={graph}
            onClose={() => { setSelectedNode(null); setFocusNodeId(null); }}
            onNavigate={handleNavigateToNode}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 16,
      background: '#FAFBFC',
      fontFamily: '"Inter", system-ui, sans-serif',
    }}>
      <div style={{
        width: 56, height: 56,
        background: 'linear-gradient(135deg, #4A7EC4, #2A52A0)',
        borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 6px 24px rgba(74,126,196,0.25)',
      }}>
        <Network size={26} style={{ color: '#fff' }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#1A1A1A', marginBottom: 6 }}>
          Cluster Topology
        </div>
        <div style={{ fontSize: 13, color: '#6B7280' }}>
          Connect to a cluster to visualize your resources
        </div>
      </div>
    </div>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────

// Topology V2 is enabled by default. Set VITE_FEATURE_TOPOLOGY_V2=false to revert to v1.
const FEATURE_TOPOLOGY_V2 =
  !(import.meta.env?.VITE_FEATURE_TOPOLOGY_V2 === 'false' ||
    (typeof process !== 'undefined' && process.env?.VITE_FEATURE_TOPOLOGY_V2 === 'false'));

function TopologyV1() {
  const { activeCluster } = useClusterStore();
  const clusterId = useActiveClusterId();
  const navigate = useNavigate();

  const [selectedNamespace, setSelectedNamespace] = useState('all');

  const { graph: clusterGraph, isLoading: topologyLoading, error: topologyError, refetch: refetchTopology } = useClusterTopology({
    clusterId,
    namespace: selectedNamespace,
    enabled: !!clusterId,
  });

  const { data: clusterNamespaces } = useNamespacesFromCluster(clusterId ?? null);
  const availableNamespaces = useMemo(() => {
    if (clusterNamespaces?.length) return [...clusterNamespaces].sort();
    const ns = new Set<string>();
    (clusterGraph ?? mockGraph).nodes.forEach(n => { if (n.namespace) ns.add(n.namespace); });
    return Array.from(ns).sort();
  }, [clusterNamespaces, clusterGraph]);

  // Performance test graph
  const [perfTestNodes, setPerfTestNodes] = useState<number | null>(null);
  const perfTestGraph = useMemo(
    () => perfTestNodes != null ? generateTestGraph(perfTestNodes) : null,
    [perfTestNodes]
  );

  const displayGraph = perfTestGraph ?? clusterGraph ?? mockGraph;
  const isLiveData = !!clusterGraph;

  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    if (isLiveData) await refetchTopology();
    else await new Promise(r => setTimeout(r, 800));
    setIsRefreshing(false);
    toast.success('Topology refreshed');
  }, [isLiveData, refetchTopology]);

  // Namespace-filtered graph
  const filteredGraph = useMemo(() => {
    if (selectedNamespace === 'all') return displayGraph;
    const filtered = displayGraph.nodes.filter(n => !n.namespace || n.namespace === selectedNamespace);
    const nodeIds = new Set(filtered.map(n => n.id));
    const filteredEdges = displayGraph.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
    return { ...displayGraph, nodes: filtered, edges: filteredEdges };
  }, [displayGraph, selectedNamespace]);

  // Stats for header
  const stats = useMemo(() => {
    const pods = filteredGraph.nodes.filter(n => n.kind === 'Pod');
    return {
      total: filteredGraph.nodes.length,
      healthy: pods.filter(p => !p.computed?.health || p.computed.health === 'healthy').length,
      warning: pods.filter(p => p.computed?.health === 'warning').length,
      critical: pods.filter(p => p.computed?.health === 'critical').length,
    };
  }, [filteredGraph.nodes]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-[calc(100vh-4rem)] gap-2">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/8">
            <Network className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Topology</h1>
            <p className="text-xs text-muted-foreground">
              {activeCluster?.name || 'docker-desktop'} · {filteredGraph.nodes.length} resources
              {topologyLoading && ' · Loading...'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Namespace selector */}
          <Select value={selectedNamespace} onValueChange={setSelectedNamespace}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="All Namespaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Namespaces</SelectItem>
              {availableNamespaces.map(ns => (
                <SelectItem key={ns} value={ns}>{ns}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Export */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1 h-8 text-xs">
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => {
                downloadJSON(filteredGraph, `topology-${Date.now()}.json`);
                toast.success('JSON exported');
              }}>
                JSON (Full Graph)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                downloadCSVSummary(filteredGraph, `topology-${Date.now()}`);
                toast.success('CSV exported');
              }}>
                CSV (Summary)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Refresh */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleRefresh} disabled={isRefreshing}>
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh topology</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Data source banner */}
      {(!isLiveData || perfTestNodes != null) && !topologyLoading && (
        <Alert className="flex-shrink-0 border-amber-500/30 bg-amber-50 dark:bg-amber-500/5 py-2">
          <AlertDescription className="flex items-center gap-3 text-xs">
            <span>
              {perfTestNodes != null
                ? `Performance test: ${perfTestNodes.toLocaleString()} nodes`
                : 'Demo data — connect backend for live topology'}
            </span>
            <Select
              value={perfTestNodes != null ? String(perfTestNodes) : 'live'}
              onValueChange={(v) => setPerfTestNodes(v === 'live' ? null : parseInt(v, 10))}
            >
              <SelectTrigger className="w-[120px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="live">Live / Demo</SelectItem>
                <SelectItem value="100">100 nodes</SelectItem>
                <SelectItem value="1000">1K nodes</SelectItem>
                <SelectItem value="5000">5K nodes</SelectItem>
              </SelectContent>
            </Select>
          </AlertDescription>
        </Alert>
      )}
      {topologyError && (
        <Alert variant="destructive" className="flex-shrink-0 py-2">
          <AlertDescription className="text-xs">
            Failed to load: {topologyError.message}. Showing demo data.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Canvas ── */}
      <div className="flex-1 relative min-h-0 rounded-xl overflow-hidden border border-border/50">
        {topologyLoading && !clusterGraph && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm font-medium text-muted-foreground">Loading topology...</span>
            </div>
          </div>
        )}

        {filteredGraph.nodes.length > 0 ? (
          <ReactFlowProvider>
            <TopologyInner graph={filteredGraph} />
          </ReactFlowProvider>
        ) : (
          <EmptyState />
        )}
      </div>
    </motion.div>
  );
}

export default function Topology() {
  if (FEATURE_TOPOLOGY_V2) {
    return <TopologyPage />;
  }
  return <TopologyV1 />;
}
