/**
 * Topology Engine – World-Class Premium Style System
 * Million-dollar design: vibrant, eye-pleasing, enriching visual experience
 *
 * Design principles:
 *  • Vibrant, saturated colors that pop — no dull pastels
 *  • Clean coloured shapes with labels below
 *  • Dark, high-contrast edge labels
 *  • Premium shadows and glows for depth
 *  • Smooth, polished animations
 */
import type { StylesheetStyle } from 'cytoscape';

// ─── World-Class Vibrant Color Palette ──────────────────────────
// Colors chosen for maximum visual appeal, clarity, and distinction

export const NODE_COLORS: Record<string, { bg: string; border: string; glow: string; text: string }> = {
  // Core Workloads - Vibrant, distinct colors
  Deployment: { bg: '#FF6B35', border: '#E85A2A', glow: 'rgba(255, 107, 53, 0.4)', text: '#fff' }, // Vibrant orange
  ReplicaSet: { bg: '#9B59B6', border: '#8E44AD', glow: 'rgba(155, 89, 182, 0.4)', text: '#fff' }, // Rich purple
  Pod: { bg: '#3498DB', border: '#2980B9', glow: 'rgba(52, 152, 219, 0.4)', text: '#fff' }, // Bright blue
  Service: { bg: '#2ECC71', border: '#27AE60', glow: 'rgba(46, 204, 113, 0.4)', text: '#fff' }, // Fresh green
  Ingress: { bg: '#26A69A', border: '#00897B', glow: 'rgba(38, 166, 154, 0.4)', text: '#fff' }, // Teal/Green matching reference

  // Stateful & Daemon - Distinct blues
  StatefulSet: { bg: '#1E88E5', border: '#1565C0', glow: 'rgba(30, 136, 229, 0.4)', text: '#fff' },
  DaemonSet: { bg: '#5E35B1', border: '#512DA8', glow: 'rgba(94, 53, 177, 0.4)', text: '#fff' },
  PodGroup: { bg: '#42A5F5', border: '#1E88E5', glow: 'rgba(66, 165, 245, 0.4)', text: '#fff' },

  // Storage - Teal/Cyan family
  ConfigMap: { bg: '#FFC107', border: '#FFB300', glow: 'rgba(255, 193, 7, 0.4)', text: '#000' }, // Bright amber
  Secret: { bg: '#E53935', border: '#C62828', glow: 'rgba(229, 57, 53, 0.4)', text: '#fff' }, // Rich red
  PersistentVolumeClaim: { bg: '#00ACC1', border: '#00838F', glow: 'rgba(0, 172, 193, 0.4)', text: '#fff' },
  PersistentVolume: { bg: '#0097A7', border: '#006064', glow: 'rgba(0, 151, 167, 0.4)', text: '#fff' },
  StorageClass: { bg: '#00BCD4', border: '#0097A7', glow: 'rgba(0, 188, 212, 0.4)', text: '#fff' },

  // Infrastructure
  Node: { bg: '#D32F2F', border: '#B71C1C', glow: 'rgba(211, 47, 47, 0.4)', text: '#fff' }, // Deep red
  Namespace: { bg: '#7B1FA2', border: '#6A1B9A', glow: 'rgba(123, 31, 162, 0.4)', text: '#fff' }, // Deep purple

  // Jobs
  Job: { bg: '#F57C00', border: '#E65100', glow: 'rgba(245, 124, 0, 0.4)', text: '#fff' },
  CronJob: { bg: '#FF9800', border: '#F57C00', glow: 'rgba(255, 152, 0, 0.4)', text: '#fff' },

  // RBAC - Pink/Magenta family
  ServiceAccount: { bg: '#AD1457', border: '#880E4F', glow: 'rgba(173, 20, 87, 0.4)', text: '#fff' },
  Role: { bg: '#EC407A', border: '#C2185B', glow: 'rgba(236, 64, 122, 0.4)', text: '#fff' },
  ClusterRole: { bg: '#C2185B', border: '#AD1457', glow: 'rgba(194, 24, 91, 0.4)', text: '#fff' },
  RoleBinding: { bg: '#F06292', border: '#EC407A', glow: 'rgba(240, 98, 146, 0.4)', text: '#fff' },
  ClusterRoleBinding: { bg: '#E91E63', border: '#C2185B', glow: 'rgba(233, 30, 99, 0.4)', text: '#fff' },

  // Workload - Legacy
  ReplicationController: { bg: '#78909C', border: '#546E7A', glow: 'rgba(120, 144, 156, 0.4)', text: '#fff' }, // Blue-grey (legacy workload)

  // Networking & Policy
  NetworkPolicy: { bg: '#FF6F00', border: '#E65100', glow: 'rgba(255, 111, 0, 0.4)', text: '#fff' },
  HorizontalPodAutoscaler: { bg: '#0288D1', border: '#01579B', glow: 'rgba(2, 136, 209, 0.4)', text: '#fff' },
  PodDisruptionBudget: { bg: '#F4511E', border: '#BF360C', glow: 'rgba(244, 81, 30, 0.4)', text: '#fff' }, // Deep orange (policy/protection)

  // Endpoints
  Endpoints: { bg: '#546E7A', border: '#37474F', glow: 'rgba(84, 110, 122, 0.3)', text: '#fff' },
  EndpointSlice: { bg: '#607D8B', border: '#455A64', glow: 'rgba(96, 125, 139, 0.3)', text: '#fff' },

  // Quotas
  ResourceQuota: { bg: '#795548', border: '#5D4037', glow: 'rgba(121, 85, 72, 0.3)', text: '#fff' },
  LimitRange: { bg: '#8D6E63', border: '#6D4C41', glow: 'rgba(141, 110, 99, 0.3)', text: '#fff' },

  // Container
  Container: { bg: '#81D4FA', border: '#4FC3F7', glow: 'rgba(129, 212, 250, 0.3)', text: '#01579B' },

  // Infrastructure — warm stone / slate
  RuntimeClass: { bg: '#78716C', border: '#57534E', glow: 'rgba(120, 113, 108, 0.4)', text: '#fff' }, // Warm stone
  Lease: { bg: '#64748B', border: '#475569', glow: 'rgba(100, 116, 139, 0.35)', text: '#fff' },         // Slate

  // Storage — teal/cyan CSI family
  CSIDriver: { bg: '#2DD4BF', border: '#0D9488', glow: 'rgba(45, 212, 191, 0.4)', text: '#fff' },      // Teal
  CSINode: { bg: '#34D399', border: '#059669', glow: 'rgba(52, 211, 153, 0.4)', text: '#fff' },         // Emerald green

  // Admission/Webhook — pink-rose (policy family)
  MutatingWebhookConfiguration: { bg: '#F9A8D4', border: '#DB2777', glow: 'rgba(249, 168, 212, 0.4)', text: '#831843' },
  ValidatingWebhookConfiguration: { bg: '#FDA4AF', border: '#E11D48', glow: 'rgba(253, 164, 175, 0.4)', text: '#881337' },

  // Flow Control — amber/yellow family
  FlowSchema: { bg: '#FCD34D', border: '#D97706', glow: 'rgba(252, 211, 77, 0.4)', text: '#78350F' },
  PriorityLevelConfiguration: { bg: '#FDE68A', border: '#F59E0B', glow: 'rgba(253, 230, 138, 0.4)', text: '#78350F' },
};

// ─── Node Sizes ───────────────────────────────────────────────

const NODE_SIZES: Record<string, { w: number; h: number }> = {
  Namespace: { w: 58, h: 58 },
  Node: { w: 52, h: 52 },
  Ingress: { w: 46, h: 46 },
  Service: { w: 46, h: 46 },
  Deployment: { w: 50, h: 50 },
  StatefulSet: { w: 50, h: 50 },
  DaemonSet: { w: 50, h: 50 },
  ReplicaSet: { w: 44, h: 44 },
  PodGroup: { w: 46, h: 46 },
  Pod: { w: 42, h: 42 },
  Container: { w: 32, h: 32 },
  ConfigMap: { w: 42, h: 42 },
  Secret: { w: 42, h: 42 },
  PersistentVolumeClaim: { w: 44, h: 44 },
  PersistentVolume: { w: 44, h: 44 },
  StorageClass: { w: 44, h: 44 },
  Job: { w: 42, h: 42 },
  CronJob: { w: 42, h: 42 },
  Endpoints: { w: 38, h: 38 },
  EndpointSlice: { w: 38, h: 38 },
};

// ─── Node Shapes ──────────────────────────────────────────────

const NODE_SHAPES: Record<string, string> = {
  Namespace: 'ellipse',
  Ingress: 'ellipse',
  Service: 'ellipse',
  Deployment: 'ellipse',
  StatefulSet: 'ellipse',
  DaemonSet: 'ellipse',
  ReplicaSet: 'ellipse',
  PodGroup: 'ellipse',
  Pod: 'ellipse',
  Container: 'ellipse',
  ConfigMap: 'ellipse',
  Secret: 'ellipse',
  PersistentVolumeClaim: 'ellipse',
  PersistentVolume: 'ellipse',
  StorageClass: 'ellipse',
  Node: 'ellipse',
  Job: 'ellipse',
  CronJob: 'ellipse',
};

// ─── Full Kind Names ──────────────────────────────────────

export const NODE_ICONS: Record<string, string> = {
  Namespace: 'Namespace',
  Ingress: 'Ingress',
  Service: 'Service',
  Deployment: 'Deployment',
  StatefulSet: 'StatefulSet',
  DaemonSet: 'DaemonSet',
  ReplicaSet: 'ReplicaSet',
  PodGroup: 'PodGroup',
  Pod: 'Pod',
  Container: 'Container',
  ConfigMap: 'ConfigMap',
  Secret: 'Secret',
  PersistentVolumeClaim: 'PersistentVolumeClaim',
  PersistentVolume: 'PersistentVolume',
  StorageClass: 'StorageClass',
  Node: 'Node',
  Job: 'Job',
  CronJob: 'CronJob',
  ServiceAccount: 'ServiceAccount',
  Role: 'Role',
  ClusterRole: 'ClusterRole',
  RoleBinding: 'RoleBinding',
  ClusterRoleBinding: 'ClusterRoleBinding',
  NetworkPolicy: 'NetworkPolicy',
  HorizontalPodAutoscaler: 'HorizontalPodAutoscaler',
  ReplicationController: 'ReplicationController',
  PodDisruptionBudget: 'PodDisruptionBudget',
  Endpoints: 'Endpoints',
  EndpointSlice: 'EndpointSlice',
  ResourceQuota: 'ResourceQuota',
  LimitRange: 'LimitRange',
  VolumeAttachment: 'VolumeAttachment',
  IngressClass: 'IngressClass',
  PriorityClass: 'PriorityClass',
  RuntimeClass: 'RuntimeClass',
  Lease: 'Lease',
  CSIDriver: 'CSIDriver',
  CSINode: 'CSINode',
  MutatingWebhookConfiguration: 'MutatingWebhookConfiguration',
  ValidatingWebhookConfiguration: 'ValidatingWebhookConfiguration',
  FlowSchema: 'FlowSchema',
  PriorityLevelConfiguration: 'PriorityLevelConfiguration',
};

// ─── Public Helpers ───────────────────────────────────────────

export function getNodeColor(kind: string) {
  return NODE_COLORS[kind] || { bg: '#6b7280', border: '#4b5563', glow: 'rgba(107, 114, 128, 0.2)', text: '#fff' };
}

export function getNodeDataAttributes(kind: string) {
  const colors = getNodeColor(kind);
  const size = NODE_SIZES[kind] || { w: 44, h: 44 };
  const shape = NODE_SHAPES[kind] || 'round-rectangle';
  const icon = NODE_ICONS[kind] || kind;

  return {
    bgColor: colors.bg,
    borderColor: colors.border,
    glowColor: colors.glow,
    textColor: colors.text,
    nodeWidth: size.w,
    nodeHeight: size.h,
    nodeShape: shape,
    iconLabel: icon,
  };
}

export function getHealthColor(health: string) {
  switch (health) {
    case 'healthy': return { bg: '#2ECC71', border: '#27AE60', glow: 'rgba(46, 204, 113, 0.5)' };
    case 'warning': return { bg: '#F39C12', border: '#E67E22', glow: 'rgba(243, 156, 18, 0.5)' };
    case 'critical': return { bg: '#E74C3C', border: '#C0392B', glow: 'rgba(231, 76, 60, 0.5)' };
    default: return { bg: '#95A5A6', border: '#7F8C8D', glow: 'rgba(149, 165, 166, 0.3)' };
  }
}

// ─── Heatmap Colors ───────────────────────────────────────────

export function getHeatmapColor(value: number, max: number): string {
  if (max === 0) return '#2ECC71';
  const ratio = Math.min(value / max, 1);
  if (ratio < 0.3) return '#2ECC71';
  if (ratio < 0.6) return '#F39C12';
  if (ratio < 0.8) return '#E67E22';
  return '#E74C3C';
}

// ─── Canvas Background ────────────────────────────────────────

export const CANVAS_BG = '#ffffff'; // Pure white to match reference D3.js design
export const CANVAS_BG_DARK = 'linear-gradient(145deg, hsl(222.2 47.4% 6.2%), hsl(222.2 47.4% 9.2%))';
export const EXPORT_BG = '#ffffff';

// ─── Cytoscape Stylesheet ────────────────────────────────────

export function getStylesheet(): StylesheetStyle[] {
  return [
    // ═══════════════════════════════════════════════════
    // ─── Node Styles ─────────────────────────────────
    // ═══════════════════════════════════════════════════

    // Base node: vibrant colored shape, label BELOW
    {
      selector: 'node',
      style: {
        // Two-line label placed below the node (Kind \n Name)
        'label': 'data(label)',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 8,
        'text-wrap': 'wrap',
        'text-max-width': 140,
        'font-size': 10,
        'font-family': '"Inter", "SF Pro Text", system-ui, -apple-system, sans-serif',
        'font-weight': 600,
        'color': '#1a1a1a',                      // Near-black for maximum contrast
        'text-background-color': '#ffffff',
        'text-background-opacity': 0.92,
        'text-background-padding': '4px',
        'text-background-shape': 'roundrectangle',
        'text-outline-width': 0,
        'text-outline-opacity': 0,
        'min-zoomed-font-size': 5,
        // Visual shape - vibrant colors
        'width': 'data(nodeWidth)',
        'height': 'data(nodeHeight)',
        'shape': 'data(nodeShape)',
        'background-color': 'data(bgColor)',
        'border-width': 2.5,
        'border-color': 'data(borderColor)',
        'border-opacity': 1,
        'background-opacity': 1,
        // Clean, subtle shadow matching D3.js reference
        'shadow-blur': 8,
        'shadow-color': 'rgba(0, 0, 0, 0.15)',
        'shadow-opacity': 1,
        'shadow-offset-x': 0,
        'shadow-offset-y': 2,
        // Smooth transitions
        'transition-property': 'background-color, border-color, opacity, shadow-opacity, width, height',
        'transition-duration': 200,
        'transition-timing-function': 'cubic-bezier(0.4, 0, 0.2, 1)',
      } as any,
    },

    // ─── Compound / Namespace nodes ──────────────────
    {
      selector: 'node.compound',
      style: {
        'background-opacity': 0.08,
        'background-color': '#7B1FA2',
        'border-style': 'dashed',
        'border-width': 2.5,
        'border-color': '#9B59B6',
        'padding': '40px',
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': 12,
        'label': 'data(displayLabel)',
        'font-size': 13,
        'font-weight': 700,
        'color': '#7B1FA2',
        'text-background-color': '#ffffff',
        'text-background-opacity': 0.95,
        'text-background-padding': '5px',
        'shadow-opacity': 0.12,
        'shape': 'round-rectangle',
      } as any,
    },

    // ─── Selected ────────────────────────────────────
    {
      selector: 'node:selected',
      style: {
        'border-width': 5,
        'border-color': '#0288D1',
        'shadow-color': 'rgba(2, 136, 209, 0.7)',
        'shadow-opacity': 1,
        'shadow-blur': 32,
        'z-index': 999,
      } as any,
    },

    // ─── Current node (resource detail page) ─────────
    {
      selector: 'node.current',
      style: {
        'border-width': 6,
        'border-color': '#0288D1',
        'shadow-color': 'rgba(2, 136, 209, 0.75)',
        'shadow-opacity': 1,
        'shadow-blur': 36,
        'z-index': 999,
        'width': (ele: any) => (ele.data('nodeWidth') || 44) * 1.2,
        'height': (ele: any) => (ele.data('nodeHeight') || 44) * 1.2,
      } as any,
    },

    // ─── Active (drag / mousedown) ───────────────────
    {
      selector: 'node:active',
      style: {
        'overlay-color': '#0288D1',
        'overlay-padding': 8,
        'overlay-opacity': 0.1,
      } as any,
    },

    // ─── Hovered node (scale + enhanced glow) ─────────────────
    {
      selector: 'node.hovered',
      style: {
        'border-width': 4,
        'shadow-opacity': 1,
        'shadow-blur': 32,
        'z-index': 999,
        'width': (ele: any) => (ele.data('nodeWidth') || 44) * 1.15,
        'height': (ele: any) => (ele.data('nodeHeight') || 44) * 1.15,
        'font-weight': 700,
      } as any,
    },

    // ─── Faded (blast radius dimming) ────────────────
    {
      selector: 'node.faded',
      style: {
        'opacity': 0.08,
        'text-opacity': 0.04,
      },
    },

    // ─── Highlighted neighbor ────────────────────────
    {
      selector: 'node.highlighted',
      style: {
        'border-width': 4,
        'shadow-opacity': 1,
        'shadow-blur': 26,
        'z-index': 100,
      },
    },

    // ─── Heatmap overlay ─────────────────────────────
    {
      selector: 'node.heatmap-green',
      style: { 'border-color': '#2ECC71', 'border-width': 3.5, 'shadow-color': 'rgba(46, 204, 113, 0.5)' } as any,
    },
    {
      selector: 'node.heatmap-yellow',
      style: { 'border-color': '#F39C12', 'border-width': 3.5, 'shadow-color': 'rgba(243, 156, 18, 0.5)' } as any,
    },
    {
      selector: 'node.heatmap-orange',
      style: { 'border-color': '#E67E22', 'border-width': 3.5, 'shadow-color': 'rgba(230, 126, 34, 0.5)' } as any,
    },
    {
      selector: 'node.heatmap-red',
      style: { 'border-color': '#E74C3C', 'border-width': 3.5, 'shadow-color': 'rgba(231, 76, 60, 0.5)' } as any,
    },

    // ─── Blast radius overlay ─────────────────────────
    {
      selector: 'node.blast-target',
      style: { 'border-color': '#DC2626', 'border-width': 5, 'shadow-color': 'rgba(220, 38, 38, 0.7)', 'shadow-blur': 24, 'z-index': 500 } as any,
    },
    {
      selector: 'node.blast-direct',
      style: { 'border-color': '#EA580C', 'border-width': 4, 'shadow-color': 'rgba(234, 88, 12, 0.5)', 'shadow-blur': 20, 'z-index': 400 } as any,
    },
    {
      selector: 'node.blast-transitive',
      style: { 'border-color': '#CA8A04', 'border-width': 3.5, 'shadow-color': 'rgba(202, 138, 4, 0.4)', 'z-index': 300 } as any,
    },
    {
      selector: 'node.blast-dim',
      style: { 'opacity': 0.08, 'text-opacity': 0.04 } as any,
    },

    // ─── Insight overlay (value 0-100: green=good, yellow=mid, red=bad) ─────
    {
      selector: 'node.overlay-green',
      style: { 'border-color': '#16A34A', 'border-width': 3.5, 'shadow-color': 'rgba(22, 163, 74, 0.4)' } as any,
    },
    {
      selector: 'node.overlay-yellow',
      style: { 'border-color': '#CA8A04', 'border-width': 3.5, 'shadow-color': 'rgba(202, 138, 4, 0.4)' } as any,
    },
    {
      selector: 'node.overlay-red',
      style: { 'border-color': '#DC2626', 'border-width': 3.5, 'shadow-color': 'rgba(220, 38, 38, 0.4)' } as any,
    },

    // ─── Hidden ──────────────────────────────────────
    {
      selector: 'node.hidden',
      style: { 'display': 'none' },
    },

    // ═══════════════════════════════════════════════════
    // ─── Edge Styles ─────────────────────────────────
    // ═══════════════════════════════════════════════════

    {
      selector: 'edge',
      style: {
        'width': 2,
        'line-color': '#90A4AE',
        'target-arrow-color': '#90A4AE',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.8,
        'curve-style': 'taxi',
        'taxi-direction': 'downward',
        'taxi-turn': '50%',
        'opacity': 0.6,
        // Edge labels — dark, high-contrast, clearly readable
        'label': 'data(label)',
        'font-size': 11,
        'font-family': '"Inter", system-ui, sans-serif',
        'font-weight': 600,
        'color': '#0a0a0a',                        // Near-black for maximum readability
        'text-background-color': '#ffffff',
        'text-background-opacity': 0.95,
        'text-background-padding': '5px',
        'text-background-shape': 'roundrectangle',
        'text-rotation': 'autorotate',
        'text-margin-y': -8,
        'min-zoomed-font-size': 7,
        'transition-property': 'line-color, opacity, width',
        'transition-duration': 200,
      } as any,
    },

    // Ownership (solid, prominent)
    {
      selector: 'edge[relationshipType="owns"]',
      style: {
        'line-color': '#546E7A',
        'target-arrow-color': '#546E7A',
        'width': 2.5,
        'opacity': 0.7,
      },
    },

    // Selects (dashed)
    {
      selector: 'edge[relationshipType="selects"]',
      style: {
        'line-color': '#78909C',
        'target-arrow-color': '#78909C',
        'line-style': 'dashed',
        'width': 2,
      },
    },

    // Routes / Exposes (vibrant green, traffic-capable)
    {
      selector: 'edge[relationshipType="exposes"], edge[relationshipType="routes"]',
      style: {
        'line-color': '#2ECC71',
        'target-arrow-color': '#2ECC71',
        'width': 3,
        'opacity': 0.8,
      },
    },

    // Storage (vibrant teal, dotted)
    {
      selector: 'edge[relationshipType="mounts"], edge[relationshipType="stores"], edge[relationshipType="backed_by"]',
      style: {
        'line-color': '#00ACC1',
        'target-arrow-color': '#00ACC1',
        'line-style': 'dotted',
        'width': 2,
      },
    },

    // References (vibrant amber, dashed)
    {
      selector: 'edge[relationshipType="references"], edge[relationshipType="configures"]',
      style: {
        'line-color': '#FFC107',
        'target-arrow-color': '#FFC107',
        'line-style': 'dashed',
        'width': 2,
      },
    },

    // Scheduled_on (vibrant orange)
    {
      selector: 'edge[relationshipType="scheduled_on"], edge[relationshipType="runs"]',
      style: {
        'line-color': '#FF6B35',
        'target-arrow-color': '#FF6B35',
        'width': 2.2,
      },
    },

    // Contains (namespace)
    {
      selector: 'edge[relationshipType="contains"]',
      style: {
        'line-color': '#9B59B6',
        'target-arrow-color': '#9B59B6',
        'line-style': 'dashed',
        'opacity': 0.4,
        'width': 1.5,
      },
    },

    // Permits (RBAC - vibrant pink)
    {
      selector: 'edge[relationshipType="permits"]',
      style: {
        'line-color': '#EC407A',
        'target-arrow-color': '#EC407A',
        'line-style': 'dashed',
        'width': 2,
      },
    },

    // Limits
    {
      selector: 'edge[relationshipType="limits"]',
      style: {
        'line-color': '#795548',
        'target-arrow-color': '#795548',
        'line-style': 'dashed',
        'width': 1.5,
        'opacity': 0.5,
      },
    },

    // Manages (vibrant blue)
    {
      selector: 'edge[relationshipType="manages"]',
      style: {
        'line-color': '#3498DB',
        'target-arrow-color': '#3498DB',
        'width': 2.5,
        'opacity': 0.75,
      },
    },

    // ─── Traffic flow animation (pulsing edge) ───────
    {
      selector: 'edge.traffic-flow',
      style: {
        'line-color': '#2ECC71',
        'target-arrow-color': '#2ECC71',
        'width': 3.5,
        'opacity': 1,
        'line-style': 'solid',
        'z-index': 200,
      } as any,
    },

    // ─── Faded edges ─────────────────────────────────
    {
      selector: 'edge.faded',
      style: {
        'opacity': 0.03,
        'text-opacity': 0,
      },
    },

    // ─── Blast radius edges ───────────────────────────
    {
      selector: 'edge.blast-affected',
      style: { 'line-color': '#EA580C', 'target-arrow-color': '#EA580C', 'width': 3.5, 'opacity': 1, 'z-index': 350 } as any,
    },
    {
      selector: 'edge.blast-alternative',
      style: { 'line-color': '#16A34A', 'target-arrow-color': '#16A34A', 'width': 3, 'opacity': 1, 'z-index': 340 } as any,
    },
    {
      selector: 'edge.blast-dim',
      style: { 'opacity': 0.03, 'text-opacity': 0 } as any,
    },

    // ─── Highlighted edges ───────────────────────────
    {
      selector: 'edge.highlighted',
      style: {
        'width': 4,
        'opacity': 1,
        'z-index': 100,
        'line-color': '#0288D1',
        'target-arrow-color': '#0288D1',
        'color': '#01579B',
        'text-background-color': '#E3F2FD',
        'text-background-opacity': 0.98,
        'font-weight': 700,
      } as any,
    },

    // Hidden edges
    {
      selector: 'edge.hidden',
      style: { 'display': 'none' },
    },
  ];
}
