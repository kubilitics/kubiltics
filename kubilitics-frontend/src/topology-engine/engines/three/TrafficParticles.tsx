import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TopologyGraph, TopologyEdge } from '../../types/topology.types';

interface TrafficParticlesProps {
  graph: TopologyGraph;
  trafficData?: Map<string, number>; // Edge ID -> traffic intensity (0-100)
  enabled?: boolean;
}

interface Particle {
  edge: TopologyEdge;
  position: THREE.Vector3;
  progress: number; // 0-1 along edge
  speed: number;
  size: number;
  color: THREE.Color;
}

/**
 * TrafficParticles - Animated particles showing live traffic flow
 *
 * Features:
 * - Particles flow along edges based on traffic intensity
 * - Particle count scales with traffic volume
 * - Particle speed scales with traffic intensity
 * - Color indicates protocol or traffic type
 * - GPU instancing for performance
 */
export const TrafficParticles: React.FC<TrafficParticlesProps> = ({
  graph,
  trafficData = new Map(),
  enabled = true,
}) => {
  const particlesRef = useRef<THREE.InstancedMesh>(null);
  const particles = useRef<Particle[]>([]);

  // Node positions map (for particle path calculation)
  const nodePositions = useMemo(() => {
    const positions = new Map<string, THREE.Vector3>();

    graph.nodes.forEach((node, index) => {
      // Calculate position based on node metadata or layout
      const x = node.position?.x ?? (Math.random() - 0.5) * 100;
      const y = node.position?.y ?? (Math.random() - 0.5) * 100;
      const z = node.position?.z ?? 0;

      positions.set(node.id, new THREE.Vector3(x, y, z));
    });

    return positions;
  }, [graph.nodes]);

  // Initialize particles based on traffic data
  useEffect(() => {
    if (!enabled) {
      particles.current = [];
      return;
    }

    const newParticles: Particle[] = [];

    graph.edges.forEach(edge => {
      const edgeKey = `${edge.source}-${edge.target}`;
      const trafficIntensity = trafficData.get(edgeKey) ?? 0;

      if (trafficIntensity === 0) return; // No traffic, no particles

      const sourcePos = nodePositions.get(edge.source);
      const targetPos = nodePositions.get(edge.target);

      if (!sourcePos || !targetPos) return;

      // Calculate particle count based on traffic intensity
      const particleCount = Math.ceil((trafficIntensity / 100) * 10); // 1-10 particles

      for (let i = 0; i < particleCount; i++) {
        // Distribute particles along the edge
        const progress = i / particleCount;

        // Calculate speed: higher traffic = faster particles
        const baseSpeed = 0.005;
        const speedMultiplier = 1 + (trafficIntensity / 100) * 2; // 1x to 3x
        const speed = baseSpeed * speedMultiplier;

        // Particle size based on traffic volume
        const size = 0.5 + (trafficIntensity / 100) * 1.5; // 0.5 to 2.0

        // Color based on protocol or traffic type
        const color = getTrafficColor(edge);

        newParticles.push({
          edge,
          position: sourcePos.clone().lerp(targetPos, progress),
          progress,
          speed,
          size,
          color,
        });
      }
    });

    particles.current = newParticles;

    // Update instanced mesh count
    if (particlesRef.current) {
      particlesRef.current.count = newParticles.length;
    }
  }, [graph.edges, trafficData, nodePositions, enabled]);

  // Animate particles
  useFrame((state, delta) => {
    if (!enabled || !particlesRef.current) return;

    const mesh = particlesRef.current;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    particles.current.forEach((particle, i) => {
      // Update particle progress
      particle.progress += particle.speed;

      // Loop particle when it reaches the end
      if (particle.progress >= 1.0) {
        particle.progress = 0;
      }

      // Calculate position along edge
      const sourcePos = nodePositions.get(particle.edge.source);
      const targetPos = nodePositions.get(particle.edge.target);

      if (!sourcePos || !targetPos) return;

      particle.position.lerpVectors(sourcePos, targetPos, particle.progress);

      // Update instance matrix
      matrix.makeTranslation(particle.position.x, particle.position.y, particle.position.z);
      matrix.scale(new THREE.Vector3(particle.size, particle.size, particle.size));
      mesh.setMatrixAt(i, matrix);

      // Update instance color
      mesh.setColorAt(i, particle.color);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  });

  // Geometry and material
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 16, 16), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.8,
      }),
    []
  );

  if (!enabled || particles.current.length === 0) {
    return null;
  }

  return (
    <instancedMesh
      ref={particlesRef}
      args={[geometry, material, particles.current.length]}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 16, 16]} />
      <meshBasicMaterial transparent opacity={0.8} />
    </instancedMesh>
  );
};

/**
 * Get traffic color based on edge metadata
 */
function getTrafficColor(edge: TopologyEdge): THREE.Color {
  // Color based on protocol
  const protocol = edge.computed?.protocol;

  const protocolColors: Record<string, string> = {
    'HTTP': '#4CAF50', // Green
    'HTTPS': '#2196F3', // Blue
    'gRPC': '#9C27B0', // Purple
    'TCP': '#FF9800', // Orange
    'UDP': '#F44336', // Red
  };

  if (protocol && protocolColors[protocol]) {
    return new THREE.Color(protocolColors[protocol]);
  }

  // Default: blue
  return new THREE.Color('#2196F3');
}

/**
 * TrafficPulse - Pulsing effect on high-traffic edges
 *
 * Alternative to particles: shows traffic as pulsing glow on edges
 */
export const TrafficPulse: React.FC<{
  edge: TopologyEdge;
  sourcePos: THREE.Vector3;
  targetPos: THREE.Vector3;
  intensity: number; // 0-100
}> = ({ edge, sourcePos, targetPos, intensity }) => {
  const lineRef = useRef<THREE.Line>(null);

  // Animate pulse
  useFrame((state) => {
    if (!lineRef.current) return;

    const material = lineRef.current.material as THREE.LineBasicMaterial;

    // Pulsing opacity based on intensity
    const pulseSpeed = 1 + (intensity / 100) * 2; // Faster pulse for higher traffic
    const opacity = 0.3 + Math.sin(state.clock.elapsedTime * pulseSpeed) * 0.3;

    material.opacity = opacity * (intensity / 100);
  });

  const points = useMemo(() => [sourcePos, targetPos], [sourcePos, targetPos]);
  const lineGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return geometry;
  }, [points]);

  const lineWidth = 2 + (intensity / 100) * 3; // 2-5 px

  return (
    <line ref={lineRef}>
      <bufferGeometry attach="geometry" {...lineGeometry} />
      <lineBasicMaterial
        attach="material"
        color={getTrafficColor(edge)}
        transparent
        opacity={0.6}
        linewidth={lineWidth}
      />
    </line>
  );
};

/**
 * TrafficHeatMap - Heat map overlay showing traffic intensity
 *
 * Creates a gradient overlay on edges based on traffic volume
 */
export const TrafficHeatMap: React.FC<TrafficParticlesProps> = ({
  graph,
  trafficData = new Map(),
  enabled = true,
}) => {
  const nodePositions = useMemo(() => {
    const positions = new Map<string, THREE.Vector3>();

    graph.nodes.forEach((node) => {
      const x = node.position?.x ?? (Math.random() - 0.5) * 100;
      const y = node.position?.y ?? (Math.random() - 0.5) * 100;
      const z = node.position?.z ?? 0;

      positions.set(node.id, new THREE.Vector3(x, y, z));
    });

    return positions;
  }, [graph.nodes]);

  if (!enabled) return null;

  return (
    <group>
      {graph.edges.map((edge, index) => {
        const edgeKey = `${edge.source}-${edge.target}`;
        const intensity = trafficData.get(edgeKey) ?? 0;

        if (intensity === 0) return null;

        const sourcePos = nodePositions.get(edge.source);
        const targetPos = nodePositions.get(edge.target);

        if (!sourcePos || !targetPos) return null;

        return (
          <TrafficPulse
            key={index}
            edge={edge}
            sourcePos={sourcePos}
            targetPos={targetPos}
            intensity={intensity}
          />
        );
      })}
    </group>
  );
};
