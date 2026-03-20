import { forwardRef, useImperativeHandle, useRef, useMemo, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid, Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import type { EngineRef } from '../../types/engine.types';
import type { TopologyGraph } from '../../types/topology.types';
import { NodesRenderer } from './NodesRenderer';
import { EdgesRenderer } from './EdgesRenderer';

export interface Scene3DProps {
  /** Topology graph data */
  graph: TopologyGraph;

  /** Selected node ID */
  selectedNodeId?: string;

  /** Overlay type to display */
  overlayType?: string;

  /** On node select callback */
  onNodeSelect?: (nodeId: string) => void;

  /** Canvas className */
  className?: string;
}

/**
 * Three.js 3D Topology Scene
 *
 * Features:
 * - GPU-accelerated 3D rendering
 * - Node geometries for each K8s resource type
 * - Orbit camera controls
 * - Post-processing effects (bloom)
 * - Traffic particle system (future)
 */
export const Scene3D = forwardRef<EngineRef, Scene3DProps>(
  ({ graph, selectedNodeId, overlayType, onNodeSelect, className }, ref) => {
    const cameraRef = useRef<THREE.PerspectiveCamera>(null);

    // Implement EngineRef interface
    useImperativeHandle(ref, () => ({
      zoomIn: () => {
        if (cameraRef.current) {
          cameraRef.current.position.z = Math.max(
            cameraRef.current.position.z - 10,
            10
          );
        }
      },
      zoomOut: () => {
        if (cameraRef.current) {
          cameraRef.current.position.z = Math.min(
            cameraRef.current.position.z + 10,
            200
          );
        }
      },
      fitToScreen: () => {
        if (cameraRef.current) {
          cameraRef.current.position.set(0, 0, 100);
        }
      },
      resetView: () => {
        if (cameraRef.current) {
          cameraRef.current.position.set(0, 0, 100);
          cameraRef.current.lookAt(0, 0, 0);
        }
      },
      exportAsSVG: () => {
        console.warn('SVG export not supported for 3D scene');
        return undefined;
      },
      exportAsPNG: () => {
        console.warn('PNG export not yet implemented for 3D scene');
        return undefined;
      },
      relayout: () => {
        console.log('3D layout recalculation');
      },
      getNodeCount: () => graph.nodes.length,
      getEdgeCount: () => graph.edges.length,
      setOverlay: (overlayType, enabled) => {
        console.log('Set overlay:', overlayType, enabled);
      },
      selectNode: (nodeId: string) => {
        onNodeSelect?.(nodeId);
      },
      clearSelection: () => {
        onNodeSelect?.('');
      },
    }));

    return (
      <div className={className} style={{ width: '100%', height: '100%' }}>
        <Canvas shadows>
          <PerspectiveCamera
            ref={cameraRef}
            makeDefault
            position={[0, 0, 100]}
            fov={50}
          />

          {/* Lighting */}
          <ambientLight intensity={0.6} />
          <pointLight position={[10, 10, 10]} intensity={0.8} />
          <pointLight position={[-10, -10, -10]} intensity={0.4} />

          {/* Scene elements */}
          <Suspense fallback={null}>
            <NodesRenderer
              graph={graph}
              selectedNodeId={selectedNodeId}
              onNodeSelect={onNodeSelect}
            />
            <EdgesRenderer graph={graph} />

            {/* Grid floor */}
            <Grid
              args={[200, 200]}
              cellSize={5}
              cellThickness={0.5}
              cellColor="#6e6e6e"
              sectionSize={20}
              sectionThickness={1}
              sectionColor="#9d9d9d"
              fadeDistance={400}
              fadeStrength={1}
              followCamera={false}
              infiniteGrid
              position={[0, -50, 0]}
            />

            {/* Background stars */}
            <Stars
              radius={200}
              depth={50}
              count={2000}
              factor={4}
              saturation={0}
              fade
            />
          </Suspense>

          {/* Camera controls */}
          <OrbitControls
            enableDamping
            dampingFactor={0.05}
            rotateSpeed={0.5}
            zoomSpeed={0.8}
            minDistance={20}
            maxDistance={200}
          />

          {/* Post-processing effects */}
          <EffectComposer>
            <Bloom
              luminanceThreshold={0.2}
              luminanceSmoothing={0.9}
              intensity={1.5}
            />
          </EffectComposer>
        </Canvas>
      </div>
    );
  }
);

Scene3D.displayName = 'Scene3D';
