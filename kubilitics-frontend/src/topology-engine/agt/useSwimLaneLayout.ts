/**
 * useSwimLaneLayout – Explicit column positioning for Pathfinder mode
 *
 * Arranges nodes into swim lanes: Ingress -> Service -> Workload -> ReplicaSet -> Pod
 * Vertical ordering: grouped by namespace, then alphabetical within groups.
 */

import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';

interface AGTNodeData {
  topologyNode: {
    id: string;
    kind: string;
    namespace: string;
    name: string;
    [key: string]: unknown;
  };
  selected?: boolean;
}

export interface LaneDefinition {
  id: string;
  label: string;
  x: number;
  width: number;
  nodeCount: number;
  kinds: string[];
}

interface SwimLaneResult {
  nodes: Node<AGTNodeData>[];
  laneDefinitions: LaneDefinition[];
}

// Lane configuration: order matters (left to right)
const LANE_CONFIG: { id: string; label: string; kinds: Set<string> }[] = [
  {
    id: 'ingress',
    label: 'Ingress',
    kinds: new Set(['Ingress', 'IngressClass']),
  },
  {
    id: 'service',
    label: 'Service',
    kinds: new Set(['Service', 'Endpoints', 'EndpointSlice']),
  },
  {
    id: 'workload',
    label: 'Workload',
    kinds: new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob']),
  },
  {
    id: 'replicaset',
    label: 'ReplicaSet',
    kinds: new Set(['ReplicaSet', 'ReplicationController']),
  },
  {
    id: 'pod',
    label: 'Pod',
    kinds: new Set(['Pod', 'PodGroup', 'Container']),
  },
];

// Config/RBAC/Storage nodes get placed in a "Support" lane at the far right
const SUPPORT_LANE = {
  id: 'support',
  label: 'Config & RBAC',
  kinds: new Set([
    'ConfigMap', 'Secret', 'ServiceAccount', 'Role', 'ClusterRole',
    'RoleBinding', 'ClusterRoleBinding', 'PersistentVolumeClaim',
    'PersistentVolume', 'StorageClass', 'NetworkPolicy',
    'HorizontalPodAutoscaler', 'PodDisruptionBudget',
    'Node', 'Namespace', 'LimitRange', 'ResourceQuota',
    'VolumeAttachment', 'CSIDriver', 'CSINode',
    'PriorityClass', 'RuntimeClass', 'Lease',
  ]),
};

const LANE_WIDTH = 240;
const LANE_GAP = 60;
const NODE_HEIGHT = 80;
const POD_HEIGHT = 38;
const NODE_VERTICAL_GAP = 20;
const NAMESPACE_GROUP_GAP = 40;
const TOP_PADDING = 80;

function getLaneIndex(kind: string): number {
  for (let i = 0; i < LANE_CONFIG.length; i++) {
    if (LANE_CONFIG[i].kinds.has(kind)) return i;
  }
  return LANE_CONFIG.length; // Support lane
}

export function useSwimLaneLayout(
  rfNodes: Node<AGTNodeData>[],
  rfEdges: Edge[],
  enabled: boolean,
): SwimLaneResult {
  return useMemo(() => {
    if (!enabled || rfNodes.length === 0) {
      return { nodes: rfNodes, laneDefinitions: [] };
    }

    // Group nodes by lane
    const laneGroups = new Map<number, Node<AGTNodeData>[]>();
    for (const node of rfNodes) {
      const laneIdx = getLaneIndex(node.data.topologyNode.kind);
      if (!laneGroups.has(laneIdx)) laneGroups.set(laneIdx, []);
      laneGroups.get(laneIdx)!.push(node);
    }

    // Build lane definitions
    const allLanes = [...LANE_CONFIG, SUPPORT_LANE];
    const laneDefinitions: LaneDefinition[] = [];
    const activeLanes: number[] = [];

    for (let i = 0; i < allLanes.length; i++) {
      if (laneGroups.has(i) && laneGroups.get(i)!.length > 0) {
        activeLanes.push(i);
      }
    }

    // Compute lane X positions (only for active lanes)
    const laneXPositions = new Map<number, number>();
    activeLanes.forEach((laneIdx, visualIdx) => {
      const x = visualIdx * (LANE_WIDTH + LANE_GAP);
      laneXPositions.set(laneIdx, x);

      const lane = allLanes[laneIdx];
      laneDefinitions.push({
        id: lane.id,
        label: lane.label,
        x,
        width: LANE_WIDTH,
        nodeCount: laneGroups.get(laneIdx)?.length ?? 0,
        kinds: Array.from(lane.kinds),
      });
    });

    // Position nodes within each lane
    const positionedNodes: Node<AGTNodeData>[] = [];

    for (const [laneIdx, laneNodes] of laneGroups) {
      const laneX = laneXPositions.get(laneIdx);
      if (laneX === undefined) continue;

      // Group by namespace, then sort alphabetically
      const byNamespace = new Map<string, Node<AGTNodeData>[]>();
      for (const node of laneNodes) {
        const ns = node.data.topologyNode.namespace || '__cluster__';
        if (!byNamespace.has(ns)) byNamespace.set(ns, []);
        byNamespace.get(ns)!.push(node);
      }

      // Sort namespaces
      const sortedNamespaces = Array.from(byNamespace.keys()).sort();

      let currentY = TOP_PADDING;

      for (const ns of sortedNamespaces) {
        const nsNodes = byNamespace.get(ns)!;

        // Sort nodes within namespace alphabetically
        nsNodes.sort((a, b) =>
          a.data.topologyNode.name.localeCompare(b.data.topologyNode.name),
        );

        for (const node of nsNodes) {
          const isPod = node.data.topologyNode.kind === 'Pod';
          const nodeH = isPod ? POD_HEIGHT : NODE_HEIGHT;

          // Center node within lane
          const nodeWidth = isPod ? 170 : 200;
          const xOffset = (LANE_WIDTH - nodeWidth) / 2;

          positionedNodes.push({
            ...node,
            position: {
              x: laneX + xOffset,
              y: currentY,
            },
          });

          currentY += nodeH + NODE_VERTICAL_GAP;
        }

        currentY += NAMESPACE_GROUP_GAP;
      }
    }

    return {
      nodes: positionedNodes,
      laneDefinitions,
    };
  }, [rfNodes, rfEdges, enabled]);
}
