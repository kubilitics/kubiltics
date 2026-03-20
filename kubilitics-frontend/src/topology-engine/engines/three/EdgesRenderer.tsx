import { useMemo } from 'react';
import * as THREE from 'three';
import type { TopologyGraph } from '../../types/topology.types';

export interface EdgesRendererProps {
  graph: TopologyGraph;
}

/**
 * Renders edges (relationships) between nodes in 3D space
 */
export function EdgesRenderer({ graph }: EdgesRendererProps) {
  // Calculate edge geometries
  const edgeGeometries = useMemo(() => {
    const geometries: JSX.Element[] = [];

    // Create a map of node positions (simplified grid for now)
    const gridSize = Math.ceil(Math.sqrt(graph.nodes.length));
    const nodePositions = new Map<string, THREE.Vector3>();

    graph.nodes.forEach((node, index) => {
      const row = Math.floor(index / gridSize);
      const col = index % gridSize;
      const x = (col - gridSize / 2) * 10;
      const y = 0;
      const z = (row - gridSize / 2) * 10;
      nodePositions.set(node.id, new THREE.Vector3(x, y, z));
    });

    // Create edges
    graph.edges.forEach((edge, index) => {
      const sourcePos = nodePositions.get(edge.source);
      const targetPos = nodePositions.get(edge.target);

      if (!sourcePos || !targetPos) return;

      const points = [sourcePos, targetPos];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);

      geometries.push(
        <line key={`edge-${index}`}>
          <primitive object={geometry} attach="geometry" />
          <lineBasicMaterial
            color="#94a3b8"
            opacity={0.6}
            transparent
            linewidth={2}
          />
        </line>
      );
    });

    return geometries;
  }, [graph.nodes, graph.edges]);

  return <group>{edgeGeometries}</group>;
}
