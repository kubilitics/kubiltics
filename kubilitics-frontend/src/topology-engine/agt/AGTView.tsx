/**
 * AGT — Advanced Graph Topology
 * World-class Kubernetes topology visualization built with ReactFlow.
 *
 * Three view modes:
 *   🌌 Cosmos    — force-directed galaxy, resources cluster by category
 *   🌳 Arborist  — ownership tree (kubectl-tree model, ELK layered)
 *   🔀 Pathfinder — traffic swimlanes (kubectl-service-tree model)
 *
 * Design: Apple + Figma-grade glassmorphism, semantic colors, animated edges.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  getBezierPath,
  MarkerType,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type NodeProps,
  type EdgeProps,
  type Connection,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, X, ChevronRight, Activity, Database, Network, Shield,
  Server, Layers, Cpu, Box, GitBranch, Globe, Key, Lock, Settings,
  HardDrive, Archive, Zap, GitMerge, FileCode, Share2, Eye, EyeOff,
  LayoutGrid, TreePine, Waypoints, Maximize2, RefreshCw, ExternalLink,
  AlertCircle, CheckCircle2, AlertTriangle, Circle, Filter, SlidersHorizontal,
} from 'lucide-react';
import type { TopologyGraph, TopologyNode, TopologyEdge, RelationshipType } from '../types/topology.types';
import ELK from 'elkjs/lib/elk.bundled.js';
import { useD3ForceLayout } from './useD3ForceLayout';
import { useSwimLaneLayout, type LaneDefinition } from './useSwimLaneLayout';
// NamespaceHull removed — convex hull polygons were visually distracting
import { useZoomLevel, type LODLevel } from './interaction/useZoomLevel';
import { DotNode } from './nodes/DotNode';
import { CompactNode } from './nodes/CompactNode';
import { AdjacencyMap } from '../core/adjacencyMap';
import { GraphModel } from '../core/graphModel';
import { getUpstreamChain, getDownstreamChain } from '../core/graphTraversal';
import { computeBlastRadius } from '../utils/blastRadiusCompute';

// ─── Design System ─────────────────────────────────────────────────────────

type GradientDef = { from: string; to: string; text: string; glow: string };

const GRADIENTS: Record<string, GradientDef> = {
  // Workloads — muted blue-indigo
  Deployment:  { from: '#5A8ED9', to: '#2F5CA8', text: '#fff', glow: 'rgba(90,142,217,0.22)' },
  StatefulSet: { from: '#6B72C4', to: '#424898', text: '#fff', glow: 'rgba(107,114,196,0.22)' },
  DaemonSet:   { from: '#7B5EC0', to: '#523D96', text: '#fff', glow: 'rgba(123,94,192,0.22)'  },
  ReplicaSet:  { from: '#6874C4', to: '#3E4898', text: '#fff', glow: 'rgba(104,116,196,0.2)'  },
  ReplicationController: { from: '#6B7280', to: '#3F4451', text: '#fff', glow: 'rgba(107,114,128,0.2)' },
  Pod:         { from: '#5A8ED9', to: '#2B5FAA', text: '#fff', glow: 'rgba(90,142,217,0.2)'   },
  Job:         { from: '#4E96C0', to: '#1E6A96', text: '#fff', glow: 'rgba(78,150,192,0.2)'   },
  CronJob:     { from: '#3D8FB8', to: '#1A5E80', text: '#fff', glow: 'rgba(61,143,184,0.2)'   },
  PodGroup:    { from: '#7EB8D8', to: '#2B6A94', text: '#fff', glow: 'rgba(126,184,216,0.2)'  },

  // Networking — muted teal
  Service:        { from: '#38A89C', to: '#1F7A70', text: '#fff', glow: 'rgba(56,168,156,0.22)'  },
  Ingress:        { from: '#2E9A94', to: '#1A6E6A', text: '#fff', glow: 'rgba(46,154,148,0.22)'  },
  NetworkPolicy:  { from: '#257A68', to: '#144D40', text: '#fff', glow: 'rgba(37,122,104,0.22)'  },
  Endpoints:      { from: '#40A882', to: '#1E7055', text: '#fff', glow: 'rgba(64,168,130,0.2)'   },
  EndpointSlice:  { from: '#4EB896', to: '#1E7860', text: '#fff', glow: 'rgba(78,184,150,0.2)'   },
  IngressClass:   { from: '#6EC8A8', to: '#2E8864', text: '#fff', glow: 'rgba(110,200,168,0.2)'  },
  HorizontalPodAutoscaler: { from: '#2E9A94', to: '#1A6E6A', text: '#fff', glow: 'rgba(46,154,148,0.2)' },
  PodDisruptionBudget: { from: '#B85252', to: '#8A3030', text: '#fff', glow: 'rgba(184,82,82,0.2)' },

  // Storage — muted cyan-amber
  PersistentVolumeClaim: { from: '#4A96C0', to: '#1E6A96', text: '#fff', glow: 'rgba(74,150,192,0.22)'  },
  PersistentVolume:      { from: '#3882B0', to: '#1A5C84', text: '#fff', glow: 'rgba(56,130,176,0.22)'  },
  StorageClass:          { from: '#3A9EB8', to: '#1A6E84', text: '#fff', glow: 'rgba(58,158,184,0.2)'   },
  VolumeAttachment:      { from: '#5AAEC4', to: '#1E7A94', text: '#fff', glow: 'rgba(90,174,196,0.2)'   },
  ConfigMap:             { from: '#C08E4E', to: '#8A6030', text: '#fff', glow: 'rgba(192,142,78,0.22)'  },
  Secret:                { from: '#B85252', to: '#8A3030', text: '#fff', glow: 'rgba(184,82,82,0.22)'   },

  // RBAC — muted violet
  ServiceAccount:     { from: '#9472C8', to: '#6A4898', text: '#fff', glow: 'rgba(148,114,200,0.22)'  },
  Role:               { from: '#A870C0', to: '#7A4898', text: '#fff', glow: 'rgba(168,112,192,0.2)'   },
  ClusterRole:        { from: '#A856BC', to: '#7A2890', text: '#fff', glow: 'rgba(168,86,188,0.22)'   },
  RoleBinding:        { from: '#B464C4', to: '#882898', text: '#fff', glow: 'rgba(180,100,196,0.2)'   },
  ClusterRoleBinding: { from: '#C086CC', to: '#9448A8', text: '#fff', glow: 'rgba(192,134,204,0.2)'   },

  // Infrastructure — muted amber-orange
  Node:      { from: '#C08E4E', to: '#8A6030', text: '#fff', glow: 'rgba(192,142,78,0.22)'  },
  Namespace: { from: '#C07840', to: '#8A5020', text: '#fff', glow: 'rgba(192,120,64,0.22)'  },
  LimitRange:     { from: '#8A8480', to: '#5A544E', text: '#fff', glow: 'rgba(138,132,128,0.2)' },
  ResourceQuota:  { from: '#7A7068', to: '#4A403C', text: '#fff', glow: 'rgba(122,112,104,0.2)' },
  PriorityClass:  { from: '#9A9690', to: '#6A6460', text: '#fff', glow: 'rgba(154,150,144,0.2)' },
  RuntimeClass:   { from: '#8A8EA0', to: '#5A6070', text: '#fff', glow: 'rgba(138,142,160,0.2)' },
  Lease:          { from: '#7A8498', to: '#4A5464', text: '#fff', glow: 'rgba(122,132,152,0.2)' },
  CSIDriver:      { from: '#2E9A94', to: '#1A6E6A', text: '#fff', glow: 'rgba(46,154,148,0.2)'  },
  CSINode:        { from: '#40A882', to: '#1E7055', text: '#fff', glow: 'rgba(64,168,130,0.2)'  },
  Container:      { from: '#5A8ED9', to: '#2B5FAA', text: '#fff', glow: 'rgba(90,142,217,0.18)' },
};

const FALLBACK_GRADIENT: GradientDef = { from: '#5A6878', to: '#323C48', text: '#fff', glow: 'rgba(90,104,120,0.2)' };

function getGradient(kind: string): GradientDef {
  return GRADIENTS[kind] ?? FALLBACK_GRADIENT;
}

// Kind → Lucide icon component name mapping
const KIND_ICONS: Record<string, React.ElementType> = {
  Deployment: Layers, StatefulSet: Database, DaemonSet: Cpu, ReplicaSet: Share2,
  Pod: Box, Job: Zap, CronJob: Activity, PodGroup: GitMerge,
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

function KindIcon({ kind, size = 14, className = '' }: { kind: string; size?: number; className?: string }) {
  const Icon = KIND_ICONS[kind] ?? Box;
  return <Icon size={size} className={className} />;
}

type HealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown';
function healthColor(h: HealthStatus | string | undefined): string {
  if (h === 'healthy') return '#4BA872';
  if (h === 'warning') return '#C4903A';
  if (h === 'critical') return '#B85252';
  return '#607080';
}

// Resource kind → category mapping
type ResourceCategory = 'workload' | 'networking' | 'storage' | 'rbac' | 'infra' | 'system';

const KIND_CATEGORY: Record<string, ResourceCategory> = {
  Deployment: 'workload', StatefulSet: 'workload', DaemonSet: 'workload', ReplicaSet: 'workload',
  Pod: 'workload', Job: 'workload', CronJob: 'workload', PodGroup: 'workload', Container: 'workload',
  ReplicationController: 'workload', HorizontalPodAutoscaler: 'workload', PodDisruptionBudget: 'workload',
  Service: 'networking', Ingress: 'networking', NetworkPolicy: 'networking', Endpoints: 'networking',
  EndpointSlice: 'networking', IngressClass: 'networking',
  PersistentVolumeClaim: 'storage', PersistentVolume: 'storage', StorageClass: 'storage',
  VolumeAttachment: 'storage', ConfigMap: 'storage', Secret: 'storage',
  CSIDriver: 'storage', CSINode: 'storage',
  ServiceAccount: 'rbac', Role: 'rbac', ClusterRole: 'rbac', RoleBinding: 'rbac', ClusterRoleBinding: 'rbac',
  Node: 'infra', Namespace: 'infra', LimitRange: 'infra', ResourceQuota: 'infra',
  PriorityClass: 'system', RuntimeClass: 'system', Lease: 'system',
};

function getCategory(kind: string): ResourceCategory {
  return KIND_CATEGORY[kind] ?? 'system';
}

const CATEGORY_LABELS: Record<ResourceCategory, string> = {
  workload: 'Workloads', networking: 'Networking', storage: 'Storage',
  rbac: 'RBAC', infra: 'Infrastructure', system: 'System',
};

const CATEGORY_ICONS: Record<ResourceCategory, React.ElementType> = {
  workload: Layers, networking: Globe, storage: Database,
  rbac: Shield, infra: Server, system: Settings,
};

// ─── Custom Node Components ─────────────────────────────────────────────────

// Memo comparator — skip re-render when node identity + selection + health unchanged
function agtNodeEqual(
  prev: NodeProps<Node<AGTNodeData>>,
  next: NodeProps<Node<AGTNodeData>>,
): boolean {
  return (
    prev.data.topologyNode.id === next.data.topologyNode.id &&
    prev.data.selected === next.data.selected &&
    prev.selected === next.selected &&
    prev.data.topologyNode.computed?.health === next.data.topologyNode.computed?.health &&
    prev.data.topologyNode.status === next.data.topologyNode.status &&
    prev.data.topologyNode.computed?.replicas?.ready === next.data.topologyNode.computed?.replicas?.ready &&
    prev.data.topologyNode.computed?.replicas?.desired === next.data.topologyNode.computed?.replicas?.desired
  );
}

// Shared card style — white cards on light canvas
const glassBase: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid rgba(0,0,0,0.1)',
  overflow: 'hidden',
  cursor: 'pointer',
  transition: 'box-shadow 0.2s ease, transform 0.15s ease, opacity 0.2s ease',
  userSelect: 'none',
};

type AGTNodeData = {
  topologyNode: TopologyNode;
  selected?: boolean;
};

// ── Workload Node (Deployment / StatefulSet / DaemonSet / ReplicaSet / ReplicationController)
function WorkloadNode({ data, selected }: NodeProps<Node<AGTNodeData>>) {
  const { topologyNode } = data;
  const lod = useZoomLevel();

  if (lod === 'dot') return <DotNode kind={topologyNode.kind} health={topologyNode.computed?.health} />;
  if (lod === 'compact') return <CompactNode node={topologyNode} selected={selected} />;

  const grad = getGradient(topologyNode.kind);
  const health = topologyNode.computed?.health ?? 'unknown';
  const hColor = healthColor(health);
  const replicas = topologyNode.computed?.replicas;

  return (
    <div
      style={{
        ...glassBase,
        width: 200,
        background: '#FFFFFF',
        boxShadow: selected
          ? `0 0 0 2px ${grad.from}, 0 8px 24px rgba(0,0,0,0.15)`
          : `0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)`,
        transform: selected ? 'scale(1.03)' : 'scale(1)',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      {/* Gradient header bar */}
      <div style={{
        height: 6,
        background: `linear-gradient(90deg, ${grad.from}, ${grad.to})`,
        boxShadow: `0 2px 8px ${grad.glow}`,
      }} />

      {/* Health ring accent */}
      <div style={{
        position: 'absolute', top: 6, right: 0,
        width: 4, height: 'calc(100% - 6px)',
        background: hColor,
        opacity: 0.9,
        boxShadow: `0 0 6px ${hColor}60`,
      }} />

      <div style={{ padding: '8px 12px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Kind + health */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
              borderRadius: 6, padding: '2px 5px',
              display: 'flex', alignItems: 'center', gap: 3,
            }}>
              <KindIcon kind={topologyNode.kind} size={11} />
              <span style={{
                fontSize: 9, fontWeight: 700, color: grad.text,
                textTransform: 'uppercase', letterSpacing: '0.05em',
                fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
              }}>
                {topologyNode.kind}
              </span>
            </div>
          </div>

          {replicas && (
            <span style={{
              fontSize: 10, fontWeight: 700, fontFamily: '"SF Mono", "Fira Code", monospace',
              color: replicas.ready === replicas.desired ? '#4BA872'
                : replicas.ready > 0 ? '#C4903A' : '#B85252',
              background: 'rgba(0,0,0,0.05)', borderRadius: 4, padding: '1px 5px',
            }}>
              {replicas.ready}/{replicas.desired}
            </span>
          )}
        </div>

        {/* Name */}
        <span style={{
          fontSize: 13, fontWeight: 600, color: '#1E293B',
          fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
          lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: 160,
        }}>
          {topologyNode.name}
        </span>

        {/* Namespace */}
        {topologyNode.namespace && (
          <span style={{
            fontSize: 10, color: '#64748B', fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {topologyNode.namespace}
          </span>
        )}

        {/* Status indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: hColor }} />
          <span style={{ fontSize: 10, color: '#64748B', textTransform: 'capitalize' }}>
            {health}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Pod Node (compact pill for dense views)
function PodNode({ data, selected }: NodeProps<Node<AGTNodeData>>) {
  const { topologyNode } = data;
  const lod = useZoomLevel();

  if (lod === 'dot') return <DotNode kind="Pod" health={topologyNode.computed?.health} />;
  // Pods are already compact — skip LOD compact tier

  const grad = getGradient('Pod');
  const health = topologyNode.computed?.health ?? 'unknown';

  return (
    <div style={{
      ...glassBase,
      width: 170, height: 38,
      background: '#FFFFFF',
      display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
      boxShadow: selected
        ? `0 0 0 2px ${grad.from}, 0 6px 20px rgba(0,0,0,0.12)`
        : `0 2px 6px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.06)`,
      borderLeft: `3px solid ${healthColor(health)}`,
    }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      <div style={{
        width: 8, height: 8, borderRadius: '50%', background: healthColor(health), flexShrink: 0,
      }} />
      <span style={{
        fontSize: 11, fontWeight: 600, color: '#1E293B',
        fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
      }}>
        {topologyNode.name}
      </span>
      <span style={{
        fontSize: 9, fontWeight: 600, color: healthColor(health),
        background: 'rgba(0,0,0,0.05)', borderRadius: 4, padding: '1px 4px', flexShrink: 0,
        textTransform: 'capitalize',
      }}>
        {topologyNode.status || 'Unknown'}
      </span>
    </div>
  );
}

// ── Network Node (Service / Ingress / NetworkPolicy)
function NetworkNode({ data, selected }: NodeProps<Node<AGTNodeData>>) {
  const { topologyNode } = data;
  const lod = useZoomLevel();

  if (lod === 'dot') return <DotNode kind={topologyNode.kind} health={topologyNode.computed?.health} />;
  if (lod === 'compact') return <CompactNode node={topologyNode} selected={selected} />;

  const grad = getGradient(topologyNode.kind);

  return (
    <div style={{
      ...glassBase,
      width: 188,
      background: '#FFFFFF',
      boxShadow: selected
        ? `0 0 0 2px ${grad.from}, 0 8px 24px rgba(0,0,0,0.15)`
        : `0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)`,
      transform: selected ? 'scale(1.03)' : 'scale(1)',
    }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      <div style={{ height: 6, background: `linear-gradient(90deg, ${grad.from}, ${grad.to})`, boxShadow: `0 2px 8px ${grad.glow}` }} />

      <div style={{ padding: '8px 12px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <div style={{
            background: `linear-gradient(135deg, ${grad.from}35, ${grad.to}25)`,
            border: `1px solid ${grad.from}55`,
            borderRadius: 8, padding: 5,
          }}>
            <KindIcon kind={topologyNode.kind} size={14} className="" style={{ color: grad.from }} />
          </div>
          <div>
            <div style={{
              fontSize: 9, fontWeight: 700, color: grad.from, textTransform: 'uppercase',
              letterSpacing: '0.06em', fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
            }}>
              {topologyNode.kind}
            </div>
          </div>
        </div>

        <span style={{
          fontSize: 13, fontWeight: 600, color: '#1E293B',
          fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
          display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          marginBottom: 2,
        }}>
          {topologyNode.name}
        </span>
        {topologyNode.namespace && (
          <span style={{ fontSize: 10, color: '#64748B', fontFamily: '"SF Pro Text", system-ui, sans-serif' }}>
            {topologyNode.namespace}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Storage Node (PVC / PV / ConfigMap / Secret / StorageClass)
function StorageNode({ data, selected }: NodeProps<Node<AGTNodeData>>) {
  const { topologyNode } = data;
  const lod = useZoomLevel();

  if (lod === 'dot') return <DotNode kind={topologyNode.kind} health={topologyNode.computed?.health} />;
  if (lod === 'compact') return <CompactNode node={topologyNode} selected={selected} />;

  const grad = getGradient(topologyNode.kind);

  return (
    <div style={{
      ...glassBase,
      width: 180,
      background: '#FFFFFF',
      boxShadow: selected
        ? `0 0 0 2px ${grad.from}, 0 8px 24px rgba(0,0,0,0.15)`
        : `0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)`,
      transform: selected ? 'scale(1.03)' : 'scale(1)',
    }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      <div style={{ height: 6, background: `linear-gradient(90deg, ${grad.from}, ${grad.to})`, boxShadow: `0 2px 8px ${grad.glow}` }} />

      <div style={{ padding: '8px 12px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
          borderRadius: 8, padding: 7, flexShrink: 0,
          boxShadow: `0 2px 8px ${grad.glow}`,
        }}>
          <KindIcon kind={topologyNode.kind} size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: grad.from, textTransform: 'uppercase',
            letterSpacing: '0.06em', marginBottom: 2,
            fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
          }}>
            {topologyNode.kind}
          </div>
          <div style={{
            fontSize: 12, fontWeight: 600, color: '#1E293B',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
          }}>
            {topologyNode.name}
          </div>
          {topologyNode.namespace && (
            <div style={{ fontSize: 10, color: '#64748B', fontFamily: '"SF Pro Text", system-ui, sans-serif' }}>
              {topologyNode.namespace}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Infrastructure Node (Node / Namespace — larger)
function InfraNode({ data, selected }: NodeProps<Node<AGTNodeData>>) {
  const { topologyNode } = data;
  const lod = useZoomLevel();

  if (lod === 'dot') return <DotNode kind={topologyNode.kind} health={topologyNode.computed?.health} />;
  if (lod === 'compact') return <CompactNode node={topologyNode} selected={selected} />;

  const grad = getGradient(topologyNode.kind);
  const isNamespace = topologyNode.kind === 'Namespace';

  return (
    <div style={{
      ...glassBase,
      width: isNamespace ? 220 : 210,
      background: '#FFFFFF',
      boxShadow: selected
        ? `0 0 0 2px ${grad.from}, 0 10px 28px rgba(0,0,0,0.15)`
        : `0 3px 10px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.06)`,
      transform: selected ? 'scale(1.04)' : 'scale(1)',
    }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      <div style={{ height: 6, background: `linear-gradient(90deg, ${grad.from}, ${grad.to})` }} />

      <div style={{ padding: '10px 14px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{
            background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
            borderRadius: 10, padding: 8, flexShrink: 0,
            boxShadow: `0 3px 12px ${grad.glow}`,
          }}>
            <KindIcon kind={topologyNode.kind} size={18} />
          </div>
          <div>
            <div style={{
              fontSize: 9, fontWeight: 700, color: grad.from, textTransform: 'uppercase',
              letterSpacing: '0.07em', marginBottom: 1,
              fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
            }}>
              {topologyNode.kind}
            </div>
            <div style={{
              fontSize: 14, fontWeight: 700, color: '#1E293B',
              fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140,
            }}>
              {topologyNode.name}
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'rgba(0,0,0,0.04)', borderRadius: 6, padding: '3px 8px',
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: topologyNode.status === 'Ready' || topologyNode.status === 'Active' ? '#4BA872' : '#607080',
          }} />
          <span style={{
            fontSize: 10, color: '#475569',
            fontFamily: '"SF Pro Text", system-ui, sans-serif',
          }}>
            {topologyNode.status || 'Active'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── RBAC Node
function RBACNode({ data, selected }: NodeProps<Node<AGTNodeData>>) {
  const { topologyNode } = data;
  const lod = useZoomLevel();

  if (lod === 'dot') return <DotNode kind={topologyNode.kind} health={topologyNode.computed?.health} />;
  if (lod === 'compact') return <CompactNode node={topologyNode} selected={selected} />;

  const grad = getGradient(topologyNode.kind);

  return (
    <div style={{
      ...glassBase,
      width: 180,
      background: '#FFFFFF',
      boxShadow: selected
        ? `0 0 0 2px ${grad.from}, 0 8px 24px rgba(0,0,0,0.15)`
        : `0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)`,
      transform: selected ? 'scale(1.03)' : 'scale(1)',
    }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      <div style={{ height: 6, background: `linear-gradient(90deg, ${grad.from}, ${grad.to})`, boxShadow: `0 2px 8px ${grad.glow}` }} />

      <div style={{ padding: '8px 12px 10px', display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{
          background: `linear-gradient(135deg, ${grad.from}25, ${grad.to}15)`,
          border: `1.5px solid ${grad.from}60`,
          borderRadius: 10, padding: 7, flexShrink: 0,
        }}>
          <Shield size={16} style={{ color: grad.from }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: grad.from, textTransform: 'uppercase',
            letterSpacing: '0.06em', marginBottom: 2,
            fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
          }}>
            {topologyNode.kind}
          </div>
          <div style={{
            fontSize: 12, fontWeight: 600, color: '#1E293B',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
          }}>
            {topologyNode.name}
          </div>
          {topologyNode.namespace && (
            <div style={{ fontSize: 10, color: '#64748B', fontFamily: '"SF Pro Text", system-ui, sans-serif' }}>
              {topologyNode.namespace}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Generic/System Node (fallback for all other kinds)
function GenericNode({ data, selected }: NodeProps<Node<AGTNodeData>>) {
  const { topologyNode } = data;
  const lod = useZoomLevel();

  if (lod === 'dot') return <DotNode kind={topologyNode.kind} health={topologyNode.computed?.health} />;
  if (lod === 'compact') return <CompactNode node={topologyNode} selected={selected} />;

  const grad = getGradient(topologyNode.kind);

  return (
    <div style={{
      ...glassBase,
      width: 170,
      background: '#FFFFFF',
      boxShadow: selected
        ? `0 0 0 2px ${grad.from}, 0 6px 20px rgba(0,0,0,0.12)`
        : `0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)`,
      transform: selected ? 'scale(1.03)' : 'scale(1)',
    }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      <div style={{ height: 5, background: `linear-gradient(90deg, ${grad.from}, ${grad.to})`, boxShadow: `0 2px 6px ${grad.glow}` }} />

      <div style={{ padding: '7px 11px 9px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          background: `${grad.from}20`, border: `1px solid ${grad.from}40`,
          borderRadius: 7, padding: 5, flexShrink: 0,
        }}>
          <KindIcon kind={topologyNode.kind} size={13} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: grad.from, textTransform: 'uppercase',
            letterSpacing: '0.05em', marginBottom: 1,
            fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
          }}>
            {topologyNode.kind}
          </div>
          <div style={{
            fontSize: 11, fontWeight: 600, color: '#334155',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
          }}>
            {topologyNode.name}
          </div>
        </div>
      </div>
    </div>
  );
}

// Node type picker by kind
function pickNodeType(kind: string): string {
  const cat = getCategory(kind);
  if (kind === 'Pod') return 'pod';
  if (kind === 'Node' || kind === 'Namespace') return 'infra';
  if (cat === 'workload') return 'workload';
  if (cat === 'networking') return 'network';
  if (cat === 'storage') return 'storage';
  if (cat === 'rbac') return 'rbac';
  return 'generic';
}

// Memoized node components — prevent re-render when props unchanged
const MemoWorkloadNode = React.memo(WorkloadNode, agtNodeEqual);
const MemoPodNode = React.memo(PodNode, agtNodeEqual);
const MemoNetworkNode = React.memo(NetworkNode, agtNodeEqual);
const MemoStorageNode = React.memo(StorageNode, agtNodeEqual);
const MemoInfraNode = React.memo(InfraNode, agtNodeEqual);
const MemoRBACNode = React.memo(RBACNode, agtNodeEqual);
const MemoGenericNode = React.memo(GenericNode, agtNodeEqual);

const NODE_TYPES: NodeTypes = {
  workload: MemoWorkloadNode as any,
  pod: MemoPodNode as any,
  network: MemoNetworkNode as any,
  storage: MemoStorageNode as any,
  infra: MemoInfraNode as any,
  rbac: MemoRBACNode as any,
  generic: MemoGenericNode as any,
};

// ─── Custom Edge Components ──────────────────────────────────────────────────

const EDGE_COLORS: Record<string, string> = {
  owns: '#5A6E82', manages: '#5A6E82',
  selects: '#38A89C', exposes: '#38A89C',
  routes: '#5A8ED9',
  mounts: '#4A96C0', stores: '#4A96C0', backed_by: '#4A96C0',
  configures: '#C08E4E', references: '#C08E4E',
  permits: '#9472C8',
  scheduled_on: '#C07840', runs: '#C07840',
  contains: '#6A7888',
  limits: '#706860',
};

function getEdgeColor(rel: string): string {
  return EDGE_COLORS[rel] ?? '#94A3B8';
}

// ─── Global edge keyframes (injected once) ─────────────────────────────────
const AGT_EDGE_STYLES = `
@keyframes agtDash { to { stroke-dashoffset: -50; } }
@keyframes agtPulse { 0%,100% { opacity: 0.7; } 50% { opacity: 1; } }
`;
const styleInjected = { current: false };
function injectEdgeStyles() {
  if (styleInjected.current || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.textContent = AGT_EDGE_STYLES;
  document.head.appendChild(el);
  styleInjected.current = true;
}

// Animated traffic edge (selects, routes, exposes) — flowing dashes + pulse
function AnimatedTrafficEdge({
  id, sourceX, sourceY, targetX, targetY, data, markerEnd, style,
}: EdgeProps) {
  injectEdgeStyles();
  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY });
  const color = getEdgeColor((data as any)?.rel ?? '');

  return (
    <g>
      {/* Ghost path for wider hit area + soft glow */}
      <BaseEdge
        path={edgePath}
        style={{ stroke: color, strokeWidth: 8, opacity: 0.06, strokeLinecap: 'round' }}
      />
      {/* Main animated edge */}
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: color,
          strokeWidth: 2.5,
          strokeDasharray: '8 5',
          strokeLinecap: 'round',
          animation: 'agtDash 1.5s linear infinite, agtPulse 3s ease-in-out infinite',
        }}
      />
    </g>
  );
}

// Ownership edge (solid, prominent, structural) — thicker, confident
function OwnershipEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, style }: EdgeProps) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY, curvature: 0.3 });
  return (
    <g>
      <BaseEdge
        path={edgePath}
        style={{ stroke: '#5A6E82', strokeWidth: 6, opacity: 0.04, strokeLinecap: 'round' }}
      />
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{ ...style, stroke: '#5A6E82', strokeWidth: 2.2, opacity: 0.75, strokeLinecap: 'round' }}
      />
    </g>
  );
}

// Storage edge (dotted, teal) — data dependency
function StorageEdge({ sourceX, sourceY, targetX, targetY, markerEnd, style }: EdgeProps) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY });
  return (
    <g>
      <BaseEdge
        path={edgePath}
        style={{ stroke: '#4A96C0', strokeWidth: 6, opacity: 0.04, strokeLinecap: 'round' }}
      />
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{ ...style, stroke: '#4A96C0', strokeWidth: 1.8, strokeDasharray: '3 5', opacity: 0.7, strokeLinecap: 'round' }}
      />
    </g>
  );
}

// RBAC edge (purple dashed) — permission relationship
function RBACEdge({ sourceX, sourceY, targetX, targetY, markerEnd, style }: EdgeProps) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY });
  return (
    <g>
      <BaseEdge
        path={edgePath}
        style={{ stroke: '#9472C8', strokeWidth: 6, opacity: 0.04, strokeLinecap: 'round' }}
      />
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{ ...style, stroke: '#9472C8', strokeWidth: 1.6, strokeDasharray: '6 4', opacity: 0.65, strokeLinecap: 'round' }}
      />
    </g>
  );
}

// Config edge (amber dashed) — configuration dependency
function ConfigEdge({ sourceX, sourceY, targetX, targetY, markerEnd, style }: EdgeProps) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY });
  return (
    <g>
      <BaseEdge
        path={edgePath}
        style={{ stroke: '#C08E4E', strokeWidth: 6, opacity: 0.04, strokeLinecap: 'round' }}
      />
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{ ...style, stroke: '#C08E4E', strokeWidth: 1.6, strokeDasharray: '5 5', opacity: 0.6, strokeLinecap: 'round' }}
      />
    </g>
  );
}

function pickEdgeType(rel: string): string {
  if (rel === 'owns' || rel === 'manages') return 'ownership';
  if (rel === 'selects' || rel === 'routes' || rel === 'exposes') return 'traffic';
  if (rel === 'mounts' || rel === 'stores' || rel === 'backed_by') return 'storage';
  if (rel === 'permits') return 'rbac';
  if (rel === 'configures' || rel === 'references') return 'config';
  return 'ownership';
}

const EDGE_TYPES: EdgeTypes = {
  ownership: OwnershipEdge as any,
  traffic: AnimatedTrafficEdge as any,
  storage: StorageEdge as any,
  rbac: RBACEdge as any,
  config: ConfigEdge as any,
};

// ─── ELK Layout ─────────────────────────────────────────────────────────────

type ViewMode = 'cosmos' | 'arborist' | 'pathfinder';

const elk = new ELK();

async function runELKLayout(
  rfNodes: Node<AGTNodeData>[],
  rfEdges: Edge[],
  viewMode: ViewMode,
): Promise<{ nodes: Node<AGTNodeData>[]; edges: Edge[] }> {
  if (rfNodes.length === 0) return { nodes: rfNodes, edges: rfEdges };

  const layoutOptions: Record<string, string> = viewMode === 'arborist'
    ? {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
        'elk.spacing.nodeNode': '40',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      }
    : viewMode === 'pathfinder'
    ? {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.layered.spacing.nodeNodeBetweenLayers': '120',
        'elk.spacing.nodeNode': '30',
      }
    : {
        'elk.algorithm': 'force',
        'elk.force.repulsion': '300',
        'elk.spacing.nodeNode': '60',
        'elk.force.iterations': '300',
      };

  const elkGraph = {
    id: 'root',
    layoutOptions,
    children: rfNodes.map(n => ({
      id: n.id,
      width: (n.style?.width as number) ?? 200,
      height: (n.style?.height as number) ?? 80,
    })),
    edges: rfEdges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  try {
    const result = await elk.layout(elkGraph);
    const positionMap = new Map<string, { x: number; y: number }>();
    for (const child of result.children ?? []) {
      if (child.x !== undefined && child.y !== undefined) {
        positionMap.set(child.id, { x: child.x, y: child.y });
      }
    }
    return {
      nodes: rfNodes.map(n => {
        const pos = positionMap.get(n.id);
        return pos ? { ...n, position: pos } : n;
      }),
      edges: rfEdges,
    };
  } catch {
    return { nodes: rfNodes, edges: rfEdges };
  }
}

// ─── Topology → ReactFlow Conversion ────────────────────────────────────────

function filterForView(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  viewMode: ViewMode,
): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  if (viewMode === 'arborist') {
    const ownershipRels = new Set<string>(['owns', 'manages']);
    const filteredEdges = edges.filter(e => ownershipRels.has(e.relationshipType));
    const usedIds = new Set<string>([
      ...filteredEdges.map(e => e.source),
      ...filteredEdges.map(e => e.target),
    ]);
    // If no ownership edges, show all nodes anyway
    const filteredNodes = filteredEdges.length > 0
      ? nodes.filter(n => usedIds.has(n.id))
      : nodes;
    return { nodes: filteredNodes, edges: filteredEdges };
  }
  if (viewMode === 'pathfinder') {
    const trafficRels = new Set<string>(['routes', 'selects', 'exposes']);
    const filteredEdges = edges.filter(e => trafficRels.has(e.relationshipType));
    const usedIds = new Set<string>([
      ...filteredEdges.map(e => e.source),
      ...filteredEdges.map(e => e.target),
    ]);
    // In pathfinder: show ingresses, services, workloads, pods
    const pathfinderKinds = new Set([
      'Ingress', 'Service', 'Deployment', 'StatefulSet', 'DaemonSet',
      'ReplicaSet', 'Pod', 'Endpoints', 'EndpointSlice',
    ]);
    const filteredNodes = nodes.filter(
      n => usedIds.has(n.id) || (filteredEdges.length === 0 && pathfinderKinds.has(n.kind))
    );
    return { nodes: filteredNodes, edges: filteredEdges };
  }
  // Cosmos — show everything
  return { nodes, edges };
}

function toReactFlowNodes(
  tNodes: TopologyNode[],
  selectedId: string | null,
): Node<AGTNodeData>[] {
  return tNodes.map(tn => ({
    id: tn.id,
    type: pickNodeType(tn.kind),
    position: { x: 0, y: 0 }, // ELK will compute positions
    data: { topologyNode: tn, selected: tn.id === selectedId },
    selectable: true,
  }));
}

function toReactFlowEdges(tEdges: TopologyEdge[]): Edge[] {
  return tEdges.map(te => {
    const color = getEdgeColor(te.relationshipType);
    const isTraffic = ['selects', 'routes', 'exposes'].includes(te.relationshipType);
    return {
      id: te.id,
      source: te.source,
      target: te.target,
      type: pickEdgeType(te.relationshipType),
      data: { rel: te.relationshipType },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: isTraffic ? 16 : 12,
        height: isTraffic ? 16 : 12,
        color,
      },
      label: te.label,
      labelStyle: {
        fontSize: 10, fill: '#475569', fontWeight: 500,
        fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
      },
      labelBgStyle: {
        fill: 'rgba(255,255,255,0.94)', fillOpacity: 1,
      },
      labelBgPadding: [4, 7] as [number, number],
      labelBgBorderRadius: 5,
      animated: false,
    };
  });
}

// ─── Node Detail Panel ───────────────────────────────────────────────────────

function NodeDetailPanel({
  node,
  edges,
  onClose,
  onNavigate,
}: {
  node: TopologyNode;
  edges: TopologyEdge[];
  onClose: () => void;
  onNavigate?: (node: TopologyNode) => void;
}) {
  const grad = getGradient(node.kind);
  const health = node.computed?.health ?? 'unknown';

  const outEdges = edges.filter(e => e.source === node.id);
  const inEdges = edges.filter(e => e.target === node.id);

  const relGroups: Record<string, TopologyEdge[]> = {};
  for (const e of [...outEdges, ...inEdges]) {
    const key = e.relationshipType;
    if (!relGroups[key]) relGroups[key] = [];
    relGroups[key].push(e);
  }

  const labelEntries = Object.entries(node.metadata.labels ?? {}).slice(0, 6);

  return (
    <motion.div
      initial={{ x: 340, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 340, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 340, damping: 34 }}
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, width: 320,
        background: 'rgba(255,255,255,0.98)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderLeft: '1px solid rgba(0,0,0,0.1)',
        display: 'flex', flexDirection: 'column',
        zIndex: 100,
        fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
        overflowY: 'auto',
      }}
    >
      {/* Gradient header */}
      <div style={{
        height: 6,
        background: `linear-gradient(90deg, ${grad.from}, ${grad.to})`,
        flexShrink: 0,
      }} />

      {/* Top section */}
      <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(0,0,0,0.08)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <div style={{
            background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
            borderRadius: 10, padding: 9, flexShrink: 0,
            boxShadow: `0 4px 16px ${grad.glow}`,
          }}>
            <KindIcon kind={node.kind} size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: grad.from, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>
              {node.kind}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1E293B', lineHeight: 1.2, wordBreak: 'break-word' }}>
              {node.name}
            </div>
            {node.namespace && (
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                {node.namespace}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.1)',
              borderRadius: 8, padding: '4px 4px', cursor: 'pointer', color: '#64748B',
              display: 'flex', alignItems: 'center', flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Status + health row */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'rgba(0,0,0,0.04)', borderRadius: 6, padding: '4px 9px',
          }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: healthColor(health) }} />
            <span style={{ fontSize: 11, color: '#475569', textTransform: 'capitalize' }}>{health}</span>
          </div>
          {node.status && (
            <div style={{
              background: 'rgba(0,0,0,0.04)', borderRadius: 6, padding: '4px 9px',
            }}>
              <span style={{ fontSize: 11, color: '#94A3B8' }}>{node.status}</span>
            </div>
          )}
          {node.computed?.replicas && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'rgba(0,0,0,0.04)', borderRadius: 6, padding: '4px 9px',
            }}>
              <span style={{ fontSize: 11, color: '#475569', fontFamily: '"SF Mono", monospace' }}>
                {node.computed.replicas.ready}/{node.computed.replicas.desired}
              </span>
              <span style={{ fontSize: 10, color: '#64748B' }}>pods</span>
            </div>
          )}
        </div>
      </div>

      {/* Relationships */}
      {Object.keys(relGroups).length > 0 && (
        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(0,0,0,0.08)', flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Relationships
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Object.entries(relGroups).map(([rel, relEdges]) => {
              const color = getEdgeColor(rel);
              return (
                <div key={rel} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'rgba(0,0,0,0.03)', borderRadius: 7, padding: '5px 9px',
                }}>
                  <div style={{ width: 3, height: 16, borderRadius: 2, background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color, flex: 1 }}>{rel}</span>
                  <span style={{
                    fontSize: 10, color: '#64748B',
                    background: 'rgba(0,0,0,0.04)', borderRadius: 4, padding: '1px 5px',
                  }}>
                    {relEdges.length}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Labels */}
      {labelEntries.length > 0 && (
        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(0,0,0,0.08)', flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Labels
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {labelEntries.map(([k, v]) => (
              <div key={k} style={{
                background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 5, padding: '2px 7px',
              }}>
                <span style={{ fontSize: 10, color: '#64748B' }}>{k}=</span>
                <span style={{ fontSize: 10, color: '#475569' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Age */}
      {node.metadata?.createdAt && (
        <div style={{ padding: '10px 18px', flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: '#475569' }}>Created: </span>
          <span style={{ fontSize: 10, color: '#94A3B8' }}>
            {new Date(node.metadata.createdAt).toLocaleDateString()}
          </span>
        </div>
      )}
    </motion.div>
  );
}

// ─── Spotlight Search ────────────────────────────────────────────────────────

function SpotlightSearch({
  nodes,
  onSelect,
  onClose,
}: {
  nodes: TopologyNode[];
  onSelect: (node: TopologyNode) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    if (!query.trim()) return nodes.slice(0, 20);
    const q = query.toLowerCase();
    return nodes
      .filter(n =>
        n.name.toLowerCase().includes(q) ||
        n.kind.toLowerCase().includes(q) ||
        n.namespace.toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [query, nodes]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === 'Enter' && results[cursor]) { onSelect(results[cursor]); onClose(); }
    if (e.key === 'Escape') onClose();
  };

  // Group by category
  const grouped = useMemo(() => {
    const groups = new Map<ResourceCategory, TopologyNode[]>();
    for (const n of results) {
      const cat = getCategory(n.kind);
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(n);
    }
    return groups;
  }, [results]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
        fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ y: -20, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -20, opacity: 0, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 400, damping: 36 }}
        style={{
          width: 580, maxHeight: '65vh',
          background: 'rgba(255,255,255,0.98)',
          border: '1px solid rgba(0,0,0,0.12)',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 32px 80px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.06)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
          borderBottom: '1px solid rgba(0,0,0,0.08)',
        }}>
          <Search size={16} style={{ color: '#64748B', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={handleKey}
            placeholder="Search resources... (name, kind, namespace)"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 15, color: '#1E293B',
              fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
            }}
          />
          <kbd style={{
            fontSize: 11, color: '#475569', background: 'rgba(0,0,0,0.04)',
            border: '1px solid rgba(0,0,0,0.1)', borderRadius: 5, padding: '2px 6px',
          }}>
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div style={{ overflowY: 'auto', padding: '8px 0' }}>
          {results.length === 0 ? (
            <div style={{ padding: '32px 18px', textAlign: 'center', color: '#475569', fontSize: 13 }}>
              No resources found
            </div>
          ) : (
            Array.from(grouped.entries()).map(([cat, catNodes]) => {
              const CatIcon = CATEGORY_ICONS[cat];
              return (
                <div key={cat}>
                  <div style={{
                    padding: '8px 18px 4px',
                    fontSize: 10, fontWeight: 700, color: '#475569',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    <CatIcon size={10} />
                    {CATEGORY_LABELS[cat]}
                  </div>
                  {catNodes.map(n => {
                    const flat = results.indexOf(n);
                    const isActive = flat === cursor;
                    const grad = getGradient(n.kind);
                    return (
                      <div
                        key={n.id}
                        onClick={() => { onSelect(n); onClose(); }}
                        onMouseEnter={() => setCursor(flat)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 18px', cursor: 'pointer',
                          background: isActive ? 'rgba(74,126,196,0.12)' : 'transparent',
                          borderLeft: isActive ? `2px solid ${grad.from}` : '2px solid transparent',
                          transition: 'background 0.1s',
                        }}
                      >
                        <div style={{
                          background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
                          borderRadius: 6, padding: '3px 5px', flexShrink: 0,
                        }}>
                          <KindIcon kind={n.kind} size={11} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {n.name}
                          </div>
                          <div style={{ fontSize: 10, color: '#64748B' }}>
                            {n.kind}{n.namespace ? ` · ${n.namespace}` : ''}
                          </div>
                        </div>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: healthColor(n.computed?.health ?? 'unknown'), flexShrink: 0 }} />
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: '8px 18px', borderTop: '1px solid rgba(0,0,0,0.06)',
          display: 'flex', gap: 14, flexShrink: 0,
        }}>
          {[['↑↓', 'Navigate'], ['↵', 'Select'], ['Esc', 'Close']].map(([key, label]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <kbd style={{
                fontSize: 10, color: '#475569', background: 'rgba(0,0,0,0.04)',
                border: '1px solid rgba(0,0,0,0.08)', borderRadius: 4, padding: '1px 5px',
              }}>{key}</kbd>
              <span style={{ fontSize: 10, color: '#475569' }}>{label}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Category Filter Chips ───────────────────────────────────────────────────

const ALL_CATEGORIES: ResourceCategory[] = ['workload', 'networking', 'storage', 'rbac', 'infra', 'system'];

const CATEGORY_COLORS: Record<ResourceCategory, string> = {
  workload: '#5A8ED9', networking: '#38A89C', storage: '#4A96C0',
  rbac: '#9472C8', infra: '#C08E4E', system: '#728FA6',
};

// ─── Highlight Interaction Types ──────────────────────────────────────────────

type HighlightMode = 'none' | 'hover' | 'focus' | 'blast-radius';

interface HighlightState {
  mode: HighlightMode;
  activeNodeIds: Set<string>;
  activeEdgeIds: Set<string>;
  severityMap?: Map<string, number>;   // blast-radius severity scores
  blastOriginId?: string;
}

const EMPTY_HIGHLIGHT: HighlightState = {
  mode: 'none',
  activeNodeIds: new Set(),
  activeEdgeIds: new Set(),
};

// ─── Swim Lane Headers ───────────────────────────────────────────────────────

function SwimLaneHeaders({ lanes, enabled }: { lanes: LaneDefinition[]; enabled: boolean }) {
  if (!enabled || lanes.length === 0) return null;

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0,
      height: 60, zIndex: 5, pointerEvents: 'none',
      display: 'flex', gap: 0,
    }}>
      {lanes.map((lane) => (
        <div key={lane.id} style={{
          position: 'absolute',
          left: lane.x,
          width: lane.width,
          top: 10,
          textAlign: 'center',
        }}>
          <div style={{
            background: 'rgba(255,255,255,0.95)',
            border: '1px solid rgba(0,0,0,0.1)',
            borderRadius: 8,
            padding: '6px 12px',
            display: 'inline-block',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: '#334155',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
            }}>
              {lane.label}
            </span>
            <span style={{
              fontSize: 10, color: '#475569', marginLeft: 6,
              fontFamily: '"SF Mono", monospace',
            }}>
              {lane.nodeCount}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Inner Component (needs ReactFlow context) ─────────────────────────

function AGTInner({ graph }: { graph: TopologyGraph }) {
  const { setCenter, fitView } = useReactFlow();

  const [viewMode, setViewMode] = useState<ViewMode>('cosmos');
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AGTNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);
  const [showSpotlight, setShowSpotlight] = useState(false);
  const [hiddenCategories, setHiddenCategories] = useState<Set<ResourceCategory>>(new Set());
  const [layoutInProgress, setLayoutInProgress] = useState(false);
  const [highlight, setHighlight] = useState<HighlightState>(EMPTY_HIGHLIGHT);

  // Pre-computed graph structures for O(1) lookups
  const adjacencyMap = useMemo(() => {
    if (!graph?.edges?.length) return null;
    return new AdjacencyMap(graph.edges);
  }, [graph?.edges]);

  const graphModel = useMemo(() => {
    if (!graph?.nodes?.length) return null;
    return new GraphModel(graph);
  }, [graph]);

  // Build base RF nodes/edges from graph + view mode + category filter
  const { baseRfNodes, baseRfEdges, visibleTopologyEdges } = useMemo(() => {
    if (!graph?.nodes?.length) return { baseRfNodes: [], baseRfEdges: [], visibleTopologyEdges: [] as TopologyEdge[] };

    const { nodes: tNodes, edges: tEdges } = filterForView(graph.nodes, graph.edges, viewMode);
    const visibleNodes = tNodes.filter(n => !hiddenCategories.has(getCategory(n.kind)));
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    const visibleEdges = tEdges.filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));

    return {
      baseRfNodes: toReactFlowNodes(visibleNodes, selectedNode?.id ?? null),
      baseRfEdges: toReactFlowEdges(visibleEdges),
      visibleTopologyEdges: visibleEdges,
    };
  }, [graph, viewMode, hiddenCategories, selectedNode?.id]);

  // ── Layout Engines ──

  // D3 Force for Cosmos mode
  const {
    nodes: cosmosNodes,
    isSimulating: cosmosSimulating,
    reheat: cosmosReheat,
  } = useD3ForceLayout(baseRfNodes, baseRfEdges, viewMode === 'cosmos');

  // Swim Lane for Pathfinder mode
  const {
    nodes: pathfinderNodes,
    laneDefinitions,
  } = useSwimLaneLayout(baseRfNodes, baseRfEdges, viewMode === 'pathfinder');

  // ELK layout for Arborist mode (kept as-is, works well)
  useEffect(() => {
    if (viewMode !== 'arborist' || baseRfNodes.length === 0) return;

    setLayoutInProgress(true);
    runELKLayout(baseRfNodes, baseRfEdges, 'arborist').then(({ nodes: laidOut, edges: laidOutEdges }) => {
      setNodes(laidOut);
      setEdges(laidOutEdges);
      setLayoutInProgress(false);
    });
  }, [baseRfNodes, baseRfEdges, viewMode]);

  // Route layout output based on active mode
  useEffect(() => {
    if (viewMode === 'cosmos') {
      setNodes(cosmosNodes);
      setEdges(baseRfEdges);
    } else if (viewMode === 'pathfinder') {
      setNodes(pathfinderNodes);
      setEdges(baseRfEdges);
    }
    // Arborist is handled by its own useEffect above
  }, [viewMode, cosmosNodes, pathfinderNodes, cosmosSimulating]);

  // Apply highlight opacity to nodes and edges
  useEffect(() => {
    if (highlight.mode === 'none') {
      // Reset all opacity
      setNodes(nds => nds.map(n => ({
        ...n,
        style: { ...n.style, opacity: 1, transition: 'opacity 0.2s ease' },
        data: { ...n.data, selected: n.id === selectedNode?.id },
      })));
      setEdges(eds => eds.map(e => ({
        ...e,
        style: { ...e.style, opacity: 1, transition: 'opacity 0.2s ease' },
      })));
      return;
    }

    const { activeNodeIds, activeEdgeIds, mode, severityMap, blastOriginId } = highlight;

    setNodes(nds => nds.map(n => {
      const isActive = activeNodeIds.has(n.id);
      const isOrigin = n.id === blastOriginId;

      let opacity = isActive ? 1 : 0.08;
      let boxShadowExtra = '';

      if (mode === 'blast-radius' && isActive && severityMap) {
        const severity = severityMap.get(n.id) ?? 50;
        if (isOrigin) {
          boxShadowExtra = '0 0 20px rgba(184,82,82,0.6)';
        } else if (severity > 70) {
          opacity = 1;
        } else if (severity > 30) {
          opacity = 0.85;
        } else {
          opacity = 0.7;
        }
      }

      return {
        ...n,
        style: {
          ...n.style,
          opacity,
          transition: 'opacity 0.2s ease',
          filter: isOrigin && mode === 'blast-radius'
            ? 'drop-shadow(0 0 8px rgba(184,82,82,0.5))'
            : undefined,
        },
        data: { ...n.data, selected: n.id === selectedNode?.id },
      };
    }));

    setEdges(eds => eds.map(e => {
      const isActive = activeEdgeIds.has(e.id);
      return {
        ...e,
        style: {
          ...e.style,
          opacity: isActive ? 1 : 0.03,
          transition: 'opacity 0.2s ease',
        },
      };
    }));
  }, [highlight, selectedNode?.id]);

  // ── Hover Neighborhood Highlighting ──
  const handleNodeMouseEnter = useCallback((_: React.MouseEvent, node: Node<AGTNodeData>) => {
    if (!adjacencyMap || highlight.mode === 'focus' || highlight.mode === 'blast-radius') return;

    const nodeId = node.id;
    const neighborhood = adjacencyMap.getNeighborhood(nodeId);
    const edgeIds = adjacencyMap.getEdgeIds(nodeId);

    setHighlight({
      mode: 'hover',
      activeNodeIds: neighborhood,
      activeEdgeIds: edgeIds,
    });
  }, [adjacencyMap, highlight.mode]);

  const handleNodeMouseLeave = useCallback(() => {
    if (highlight.mode === 'hover') {
      setHighlight(EMPTY_HIGHLIGHT);
    }
  }, [highlight.mode]);

  // ── Click Interactions ──
  const handleNodeClick = useCallback((event: React.MouseEvent, node: Node<AGTNodeData>) => {
    const tNode = node.data.topologyNode;

    // Shift+Click = Blast Radius
    if (event.shiftKey && graph) {
      const result = computeBlastRadius(graph, tNode.id, {
        maxDepth: 3,
        includeDownstream: true,
        includeUpstream: false,
      });

      // Map blast radius edge keys to actual edge IDs
      const blastEdgeIds = new Set<string>();
      for (const edge of graph.edges) {
        const key = `${edge.source}-${edge.target}`;
        if (result.affectedEdges.has(key)) {
          blastEdgeIds.add(edge.id);
        }
      }

      // Include the origin node itself
      const allNodes = new Set(result.affectedNodes);
      allNodes.add(tNode.id);

      setHighlight({
        mode: 'blast-radius',
        activeNodeIds: allNodes,
        activeEdgeIds: blastEdgeIds,
        severityMap: result.severity,
        blastOriginId: tNode.id,
      });
      setSelectedNode(tNode);
      return;
    }

    // Normal click = Focus mode (upstream + downstream chain)
    if (graphModel) {
      const upstream = getUpstreamChain(graphModel, tNode.id);
      const downstream = getDownstreamChain(graphModel, tNode.id);

      const focusNodeIds = new Set<string>([...upstream, ...downstream]);

      // Find edges connecting focused nodes
      const focusEdgeIds = new Set<string>();
      for (const edge of visibleTopologyEdges) {
        if (focusNodeIds.has(edge.source) && focusNodeIds.has(edge.target)) {
          focusEdgeIds.add(edge.id);
        }
      }

      // Toggle focus if clicking same node
      if (selectedNode?.id === tNode.id && highlight.mode === 'focus') {
        setHighlight(EMPTY_HIGHLIGHT);
        setSelectedNode(null);
        return;
      }

      setHighlight({
        mode: 'focus',
        activeNodeIds: focusNodeIds,
        activeEdgeIds: focusEdgeIds,
      });
    }

    setSelectedNode(prev => prev?.id === tNode.id ? null : tNode);
  }, [graph, graphModel, selectedNode, highlight.mode, visibleTopologyEdges]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSpotlight(s => !s);
      }
      if (e.key === 'Escape') {
        setShowSpotlight(false);
        setSelectedNode(null);
        setHighlight(EMPTY_HIGHLIGHT);
      }
      // 'f' = fit all nodes in view
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        try { fitView({ padding: 0.12, maxZoom: 1.2, duration: 500 }); } catch {}
      }
      // '1' = zoom to 100%
      if (e.key === '1' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        try { setCenter(0, 0, { zoom: 1, duration: 300 }); } catch {}
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fitView, setCenter]);

  const handleSpotlightSelect = useCallback((tNode: TopologyNode) => {
    setSelectedNode(tNode);
    setHighlight(EMPTY_HIGHLIGHT);
    setNodes(nds => {
      const found = nds.find(n => n.id === tNode.id);
      if (found) {
        setTimeout(() => {
          setCenter(found.position.x + 100, found.position.y + 40, { zoom: 1.4, duration: 500 });
        }, 50);
      }
      return nds;
    });
  }, [setCenter, setNodes]);

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
    setHighlight(EMPTY_HIGHLIGHT);
  }, []);

  const toggleCategory = useCallback((cat: ResourceCategory) => {
    setHiddenCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // Stats
  const stats = useMemo(() => {
    const nodeCount = graph?.nodes?.length ?? 0;
    const edgeCount = graph?.edges?.length ?? 0;
    const healthCounts = { healthy: 0, warning: 0, critical: 0, unknown: 0 };
    for (const n of graph?.nodes ?? []) {
      const h = (n.computed?.health ?? 'unknown') as keyof typeof healthCounts;
      if (h in healthCounts) healthCounts[h]++;
    }
    return { nodeCount, edgeCount, healthCounts };
  }, [graph]);

  const showLayoutSpinner = layoutInProgress || (viewMode === 'cosmos' && cosmosSimulating);

  // Auto-fit when layout completes or view mode changes
  const prevViewModeRef = useRef(viewMode);
  const hasAutoFit = useRef(false);
  useEffect(() => {
    if (nodes.length === 0) return;
    const modeChanged = prevViewModeRef.current !== viewMode;
    prevViewModeRef.current = viewMode;
    // Auto-fit on first layout or mode change
    if (modeChanged || !hasAutoFit.current) {
      hasAutoFit.current = true;
      setTimeout(() => {
        try { fitView({ padding: 0.12, maxZoom: 1.2, duration: 400 }); } catch {}
      }, 100);
    }
  }, [nodes, viewMode, fitView]);

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      background: '#F8FAFC',
      fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
      overflow: 'hidden',
    }}>
      {/* ── Fixed Overlay Controls (stay visible during scroll) ── */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20 }}>

      {/* Top control bar */}
      <div style={{
        pointerEvents: 'auto',
        position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {/* View mode toggle */}
        <div style={{
          display: 'flex', background: 'rgba(255,255,255,0.95)',
          border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12,
          padding: 4, gap: 2,
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
        }}>
          {([
            ['cosmos', '🌌', 'Cosmos'],
            ['arborist', '🌳', 'Arborist'],
            ['pathfinder', '🔀', 'Pathfinder'],
          ] as const).map(([mode, emoji, label]) => (
            <button
              key={mode}
              onClick={() => { setViewMode(mode); setHighlight(EMPTY_HIGHLIGHT); }}
              style={{
                background: viewMode === mode
                  ? 'linear-gradient(135deg, #4A7EC4, #2A52A0)'
                  : 'transparent',
                border: 'none', borderRadius: 8,
                padding: '6px 14px', cursor: 'pointer',
                color: viewMode === mode ? '#fff' : '#64748B',
                fontSize: 12, fontWeight: 600,
                transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', gap: 5,
                boxShadow: viewMode === mode ? '0 2px 8px rgba(74,126,196,0.3)' : 'none',
                fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
              }}
            >
              <span style={{ fontSize: 13 }}>{emoji}</span> {label}
            </button>
          ))}
        </div>

        {/* Reheat button for Cosmos */}
        {viewMode === 'cosmos' && (
          <button
            onClick={cosmosReheat}
            title="Re-simulate forces"
            style={{
              background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(0,0,0,0.1)',
              borderRadius: 10, padding: '7px 10px', cursor: 'pointer',
              color: cosmosSimulating ? '#4A7EC4' : '#64748B',
              backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
              display: 'flex', alignItems: 'center',
              animation: cosmosSimulating ? 'spin 1s linear infinite' : 'none',
            }}
          >
            <RefreshCw size={14} />
          </button>
        )}

        {/* Spotlight search button */}
        <button
          onClick={() => setShowSpotlight(true)}
          style={{
            background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(0,0,0,0.1)',
            borderRadius: 10, padding: '7px 14px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 7,
            color: '#64748B', fontSize: 12, fontWeight: 500,
            backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
            fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
          }}
        >
          <Search size={13} />
          <span>Search</span>
          <kbd style={{
            fontSize: 10, color: '#334155', background: 'rgba(0,0,0,0.04)',
            border: '1px solid rgba(0,0,0,0.08)', borderRadius: 4, padding: '1px 5px',
          }}>⌘K</kbd>
        </button>
      </div>

      {/* Stats panel — top-left */}
      <div style={{
        pointerEvents: 'auto',
        position: 'absolute', top: 16, left: 16,
        background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(0,0,0,0.1)',
        borderRadius: 12, padding: '10px 14px',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
          Cluster
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1E293B', lineHeight: 1 }}>
              {stats.nodeCount}
            </div>
            <div style={{ fontSize: 10, color: '#475569' }}>Resources</div>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1E293B', lineHeight: 1 }}>
              {stats.edgeCount}
            </div>
            <div style={{ fontSize: 10, color: '#475569' }}>Edges</div>
          </div>
          <div style={{ width: 1, background: 'rgba(0,0,0,0.08)', margin: '0 2px' }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {[
              { key: 'healthy', color: '#4BA872' },
              { key: 'warning', color: '#C4903A' },
              { key: 'critical', color: '#B85252' },
            ].map(({ key, color }) => (
              stats.healthCounts[key as keyof typeof stats.healthCounts] > 0 && (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#334155' }}>
                    {stats.healthCounts[key as keyof typeof stats.healthCounts]}
                  </span>
                </div>
              )
            ))}
          </div>
        </div>

        {/* Highlight mode indicator */}
        {highlight.mode !== 'none' && (
          <div style={{
            marginTop: 8, display: 'flex', alignItems: 'center', gap: 6,
            background: highlight.mode === 'blast-radius'
              ? 'rgba(184,82,82,0.15)'
              : 'rgba(74,126,196,0.15)',
            borderRadius: 6, padding: '3px 8px',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: highlight.mode === 'blast-radius' ? '#B85252' : '#4A7EC4',
            }} />
            <span style={{ fontSize: 10, color: '#475569', fontWeight: 600 }}>
              {highlight.mode === 'hover' ? 'Neighborhood'
                : highlight.mode === 'focus' ? 'Focus Chain'
                : 'Blast Radius'}
            </span>
            <span style={{ fontSize: 10, color: '#64748B' }}>
              {highlight.activeNodeIds.size} nodes
            </span>
          </div>
        )}
      </div>

      {/* Category filter chips — bottom-left */}
      <div style={{
        pointerEvents: 'auto',
        position: 'absolute', bottom: 80, left: 16,
        display: 'flex', flexDirection: 'column', gap: 5,
      }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>
          Filter
        </div>
        {ALL_CATEGORIES.map(cat => {
          const CatIcon = CATEGORY_ICONS[cat];
          const isHidden = hiddenCategories.has(cat);
          const color = CATEGORY_COLORS[cat];
          return (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: isHidden ? 'rgba(0,0,0,0.05)' : `${color}18`,
                border: `1px solid ${isHidden ? 'rgba(0,0,0,0.08)' : `${color}40`}`,
                borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
                opacity: isHidden ? 0.45 : 1,
                transition: 'all 0.2s',
                backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
              }}
            >
              <CatIcon size={11} style={{ color: isHidden ? '#475569' : color }} />
              <span style={{
                fontSize: 11, fontWeight: 600,
                color: isHidden ? '#94A3B8' : '#334155',
                fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
              }}>
                {CATEGORY_LABELS[cat]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Interaction hints — bottom-right */}
      <div style={{
        pointerEvents: 'auto',
        position: 'absolute', bottom: 16, right: 16,
        background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(0,0,0,0.1)',
        borderRadius: 8, padding: '6px 10px',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            ['Hover', 'Neighborhood'],
            ['Click', 'Focus chain'],
            ['\u21e7+Click', 'Blast radius'],
            ['F', 'Fit view'],
            ['Esc', 'Clear'],
          ].map(([key, label]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <kbd style={{
                fontSize: 9, color: '#475569', background: 'rgba(0,0,0,0.05)',
                border: '1px solid rgba(0,0,0,0.1)', borderRadius: 3, padding: '1px 4px',
                fontFamily: '"SF Mono", monospace',
              }}>{key}</kbd>
              <span style={{ fontSize: 9, color: '#64748B' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Loading overlay */}
      <AnimatePresence>
        {showLayoutSpinner && viewMode === 'arborist' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              pointerEvents: 'auto',
              position: 'absolute', inset: 0, zIndex: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(248,250,252,0.7)', backdropFilter: 'blur(4px)',
            }}
          >
            <div style={{
              background: 'rgba(255,255,255,0.98)', border: '1px solid rgba(0,0,0,0.1)',
              borderRadius: 14, padding: '20px 32px', textAlign: 'center',
              boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
            }}>
              <div style={{
                width: 32, height: 32, border: '3px solid rgba(74,126,196,0.25)',
                borderTop: '3px solid #4A7EC4', borderRadius: '50%',
                margin: '0 auto 12px', animation: 'spin 0.8s linear infinite',
              }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <div style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>
                Computing layout…
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Node detail panel (in overlay layer) */}
      <AnimatePresence>
        {selectedNode && (
          <div style={{ pointerEvents: 'auto' }}>
            <NodeDetailPanel
              node={selectedNode}
              edges={graph?.edges ?? []}
              onClose={() => { setSelectedNode(null); setHighlight(EMPTY_HIGHLIGHT); }}
            />
          </div>
        )}
      </AnimatePresence>

      </div>{/* End overlay layer */}

      {/* Swim lane headers (Pathfinder mode only — rendered in overlay layer) */}
      {viewMode === 'pathfinder' && laneDefinitions.length > 0 && (
        <SwimLaneHeaders lanes={laneDefinitions} enabled={true} />
      )}

      {/* ── Infinite Canvas — ReactFlow handles all pan/zoom ── */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onPaneClick={handlePaneClick}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.05}
        maxZoom={2.5}
        zoomOnScroll
        panOnScroll={false}
        panOnDrag
        selectionOnDrag={false}
        preventScrolling
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1.2 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'transparent', width: '100%', height: '100%' }}
        defaultEdgeOptions={{
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.2}
          color="rgba(0,0,0,0.06)"
        />

        <Controls
          showInteractive={false}
          style={{
            background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(0,0,0,0.1)',
            borderRadius: 10, overflow: 'hidden',
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
          }}
        />

        <MiniMap
          pannable
          zoomable
          style={{
            background: 'rgba(255,255,255,0.95)',
            border: '1px solid rgba(0,0,0,0.1)',
            borderRadius: 10,
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
          }}
          nodeColor={n => {
            const tNode = (n.data as AGTNodeData)?.topologyNode;
            if (!tNode) return '#5A6878';
            const health = tNode.computed?.health;
            if (health === 'critical') return '#B85252';
            if (health === 'warning') return '#C4903A';
            return getGradient(tNode.kind).from;
          }}
          nodeStrokeColor={n => {
            const tNode = (n.data as AGTNodeData)?.topologyNode;
            if (!tNode) return 'transparent';
            return healthColor(tNode.computed?.health);
          }}
          nodeStrokeWidth={2}
          maskColor="rgba(0,0,0,0.06)"
        />

        <Panel position="bottom-center">
          <div style={{
            background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(0,0,0,0.1)',
            borderRadius: 8, padding: '4px 12px',
            fontSize: 10, color: '#64748B',
            backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}>
            {viewMode === 'cosmos' && 'Cosmos — physics clustering · hover to explore · shift+click for blast radius'}
            {viewMode === 'arborist' && 'Arborist — ownership hierarchy · click to trace dependencies'}
            {viewMode === 'pathfinder' && 'Pathfinder — traffic swim lanes (Ingress \u2192 Service \u2192 Workload \u2192 Pod)'}
          </div>
        </Panel>
      </ReactFlow>

      {/* Spotlight overlay */}
      <AnimatePresence>
        {showSpotlight && (
          <SpotlightSearch
            nodes={graph?.nodes ?? []}
            onSelect={handleSpotlightSelect}
            onClose={() => setShowSpotlight(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Public Component (wraps ReactFlowProvider) ──────────────────────────────

interface AGTViewProps {
  graph: TopologyGraph | null;
}

export default function AGTView({ graph }: AGTViewProps) {
  const empty: TopologyGraph = {
    schemaVersion: '1.0',
    nodes: [],
    edges: [],
    metadata: {
      clusterId: '',
      generatedAt: new Date().toISOString(),
      isComplete: false,
      warnings: [],
      layoutSeed: '',
    },
  };

  const safeGraph = graph ?? empty;

  if (!graph || (graph.nodes.length === 0 && graph.edges.length === 0)) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', flexDirection: 'column', gap: 16,
        background: '#F8FAFC',
        fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
      }}>
        <div style={{
          width: 56, height: 56,
          background: 'linear-gradient(135deg, #4A7EC4, #2A52A0)',
          borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 24px rgba(74,126,196,0.25)',
        }}>
          <Waypoints size={26} style={{ color: '#fff' }} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#1E293B', marginBottom: 6 }}>
            Advanced Graph Topology
          </div>
          <div style={{ fontSize: 13, color: '#475569' }}>
            Connect to a cluster to visualize your resources
          </div>
        </div>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <AGTInner graph={safeGraph} />
    </ReactFlowProvider>
  );
}
