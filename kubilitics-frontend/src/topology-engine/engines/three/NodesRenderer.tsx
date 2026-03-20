import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TopologyGraph, TopologyNode, KubernetesKind } from '../../types/topology.types';

export interface NodesRendererProps {
  graph: TopologyGraph;
  selectedNodeId?: string;
  onNodeSelect?: (nodeId: string) => void;
}

// Node geometry mapping for K8s resource types
const NODE_GEOMETRIES: Record<KubernetesKind, () => THREE.BufferGeometry> = {
  'Pod': () => new THREE.OctahedronGeometry(0.7),
  'Service': () => new THREE.TorusGeometry(0.6, 0.2, 16, 32),
  'Deployment': () => new THREE.IcosahedronGeometry(0.9),
  'StatefulSet': () => new THREE.CylinderGeometry(0.6, 0.6, 1.2, 8),
  'DaemonSet': () => new THREE.OctahedronGeometry(0.8),
  'ReplicaSet': () => new THREE.DodecahedronGeometry(0.7),
  'Job': () => new THREE.TetrahedronGeometry(0.8),
  'CronJob': () => new THREE.ConeGeometry(0.7, 1.2, 6),
  'Ingress': () => new THREE.ConeGeometry(0.8, 1.5, 4),
  'ConfigMap': () => new THREE.PlaneGeometry(1, 1),
  'Secret': () => new THREE.BoxGeometry(0.8, 0.8, 0.8),
  'PersistentVolumeClaim': () => new THREE.CylinderGeometry(0.8, 0.8, 0.4, 32),
  'PersistentVolume': () => new THREE.CylinderGeometry(0.9, 0.9, 0.5, 32),
  'Node': () => new THREE.SphereGeometry(1.2, 32, 32),
  'Namespace': () => new THREE.BoxGeometry(3, 0.2, 3),
  'ServiceAccount': () => new THREE.OctahedronGeometry(0.6),
  'ClusterRole': () => new THREE.DodecahedronGeometry(0.7),
  'ClusterRoleBinding': () => new THREE.TorusKnotGeometry(0.5, 0.2, 100, 16),
  'Role': () => new THREE.DodecahedronGeometry(0.6),
  'RoleBinding': () => new THREE.TorusKnotGeometry(0.4, 0.15, 100, 16),
  'NetworkPolicy': () => new THREE.RingGeometry(0.5, 0.9, 8),
  'HorizontalPodAutoscaler': () => new THREE.TorusGeometry(0.7, 0.25, 16, 32),
  'VerticalPodAutoscaler': () => new THREE.TorusGeometry(0.7, 0.25, 16, 32),
  'PodDisruptionBudget': () => new THREE.IcosahedronGeometry(0.7),
  'StorageClass': () => new THREE.BoxGeometry(1, 0.3, 1),
  'CustomResourceDefinition': () => new THREE.DodecahedronGeometry(0.9),
  'LimitRange': () => new THREE.BoxGeometry(1.2, 0.2, 0.8),
  'ResourceQuota': () => new THREE.BoxGeometry(1.2, 0.3, 0.8),
  'Endpoint': () => new THREE.SphereGeometry(0.5, 16, 16),
  'EndpointSlice': () => new THREE.SphereGeometry(0.6, 16, 16),
};

// Node colors for K8s resource types
const NODE_COLORS: Record<KubernetesKind, string> = {
  'Pod': '#4A90E2',
  'Service': '#7B68EE',
  'Deployment': '#50C878',
  'StatefulSet': '#FFB347',
  'DaemonSet': '#FF6B6B',
  'ReplicaSet': '#5DADE2',
  'Job': '#F4D03F',
  'CronJob': '#E8B923',
  'Ingress': '#9B59B6',
  'ConfigMap': '#3498DB',
  'Secret': '#E74C3C',
  'PersistentVolumeClaim': '#34495E',
  'PersistentVolume': '#2C3E50',
  'Node': '#95A5A6',
  'Namespace': '#1ABC9C',
  'ServiceAccount': '#16A085',
  'ClusterRole': '#8E44AD',
  'ClusterRoleBinding': '#9B59B6',
  'Role': '#8E44AD',
  'RoleBinding': '#9B59B6',
  'NetworkPolicy': '#E67E22',
  'HorizontalPodAutoscaler': '#3498DB',
  'VerticalPodAutoscaler': '#2980B9',
  'PodDisruptionBudget': '#D35400',
  'StorageClass': '#7F8C8D',
  'CustomResourceDefinition': '#BDC3C7',
  'LimitRange': '#95A5A6',
  'ResourceQuota': '#7F8C8D',
  'Endpoint': '#1ABC9C',
  'EndpointSlice': '#16A085',
};

function getNodeGeometry(kind: KubernetesKind): THREE.BufferGeometry {
  const geometryFn = NODE_GEOMETRIES[kind];
  return geometryFn ? geometryFn() : new THREE.SphereGeometry(0.7);
}

function getNodeColor(kind: KubernetesKind): string {
  return NODE_COLORS[kind] || '#95A5A6';
}

/**
 * Renders all nodes in 3D space
 */
export function NodesRenderer({ graph, selectedNodeId, onNodeSelect }: NodesRendererProps) {
  const meshRefs = useRef<Map<string, THREE.Mesh>>(new Map());

  // Calculate node positions (simple grid layout for now)
  const nodePositions = useMemo(() => {
    const positions = new Map<string, [number, number, number]>();
    const gridSize = Math.ceil(Math.sqrt(graph.nodes.length));

    graph.nodes.forEach((node, index) => {
      const row = Math.floor(index / gridSize);
      const col = index % gridSize;
      const x = (col - gridSize / 2) * 10;
      const y = 0;
      const z = (row - gridSize / 2) * 10;
      positions.set(node.id, [x, y, z]);
    });

    return positions;
  }, [graph.nodes]);

  // Animate selected node
  useFrame((state) => {
    if (!selectedNodeId) return;

    const mesh = meshRefs.current.get(selectedNodeId);
    if (mesh) {
      const time = state.clock.getElapsedTime();
      mesh.rotation.y = time * 0.5;
      mesh.position.y = Math.sin(time * 2) * 0.5;
    }
  });

  return (
    <group>
      {graph.nodes.map((node) => {
        const position = nodePositions.get(node.id) || [0, 0, 0];
        const geometry = getNodeGeometry(node.kind);
        const color = getNodeColor(node.kind);
        const isSelected = node.id === selectedNodeId;

        return (
          <mesh
            key={node.id}
            ref={(mesh) => {
              if (mesh) {
                meshRefs.current.set(node.id, mesh);
              }
            }}
            position={position}
            onClick={(e) => {
              e.stopPropagation();
              onNodeSelect?.(node.id);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'default';
            }}
          >
            <primitive object={geometry} attach="geometry" />
            <meshStandardMaterial
              color={color}
              emissive={isSelected ? color : '#000000'}
              emissiveIntensity={isSelected ? 0.5 : 0}
              roughness={0.4}
              metalness={0.6}
            />
          </mesh>
        );
      })}
    </group>
  );
}
