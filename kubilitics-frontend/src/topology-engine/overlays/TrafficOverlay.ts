import { useMemo } from 'react';
import type { OverlayData } from '../types/overlay.types';
import type { TopologyGraph } from '../types/topology.types';

export interface TrafficMetrics {
  requestsPerSecond?: number;
  bytesPerSecond?: number;
  activeConnections?: number;
  protocol?: 'HTTP' | 'gRPC' | 'TCP' | 'UDP';
  latency?: number;
  errorRate?: number;
}

/**
 * Traffic Overlay Hook
 *
 * Visualizes live traffic flow between services based on:
 * - Requests per second
 * - Bandwidth (bytes per second)
 * - Active connections
 * - Protocol type
 * - Latency
 * - Error rate
 *
 * Score mapping (for edge thickness/intensity):
 * - 0-20: Low traffic (thin lines)
 * - 21-50: Moderate traffic (medium lines)
 * - 51-80: High traffic (thick lines)
 * - 81-100: Very high traffic (animated pulse)
 *
 * NOTE: Requires backend integration with service mesh or network monitoring
 * (Istio, Linkerd, Envoy, Prometheus)
 */
export function useTrafficOverlay(graph: TopologyGraph): OverlayData {
  const overlayData = useMemo(() => {
    if (import.meta.env?.DEV) console.time('Traffic Overlay Computation');
    const nodeValues = new Map<string, number>();
    const edgeValues = new Map<string, number>();

    // Calculate node traffic (aggregate incoming + outgoing)
    // NOTE: Traffic metrics require backend integration (Prometheus, Istio, Envoy)
    graph.nodes.forEach(node => {
      let trafficScore = 0;

      // For Services and Pods, estimate based on edge count
      if (node.kind === 'Service' || node.kind === 'Pod') {
        // Simplified: more edges = more traffic
        const incomingEdges = graph.edges.filter(e => e.target === node.id);
        const outgoingEdges = graph.edges.filter(e => e.source === node.id);

        const totalEdges = incomingEdges.length + outgoingEdges.length;

        // Normalize: 10 edges = score of 50
        trafficScore = Math.min(100, (totalEdges / 10) * 50);
      }

      // Services likely have more traffic
      if (node.kind === 'Service') {
        trafficScore = Math.min(100, trafficScore * 1.5);
      }

      // Ingress handles external traffic
      if (node.kind === 'Ingress') {
        trafficScore = 70; // Assume high traffic for ingress
      }

      nodeValues.set(node.id, trafficScore);
    });

    // Calculate edge traffic intensity
    // NOTE: Edge-level traffic metrics require backend integration
    graph.edges.forEach(edge => {
      let trafficScore = 0;

      // Simplified: assign traffic based on relationship type
      // Critical relationships likely have more traffic
      const relationshipTrafficScores: Record<string, number> = {
        'routes': 80,          // High traffic: routing
        'exposes': 70,         // High traffic: service exposure
        'selects': 60,         // Moderate traffic: pod selection
        'owns': 40,            // Lower traffic: ownership
        'mounts': 30,          // Lower traffic: volume mounts
        'references': 20,      // Low traffic: config references
        'configures': 15,      // Low traffic: configuration
      };

      trafficScore = relationshipTrafficScores[edge.relationshipType] ?? 10;

      // Store edge traffic
      edgeValues.set(`${edge.source}-${edge.target}`, trafficScore);
    });

    // Calculate aggregate metrics
    const activeEdges = Array.from(edgeValues.values()).filter(v => v > 0).length;
    const totalTraffic = Array.from(nodeValues.values()).reduce((sum, v) => sum + v, 0);
    const avgTraffic = nodeValues.size > 0 ? totalTraffic / nodeValues.size : 0;

    if (import.meta.env?.DEV) console.timeEnd('Traffic Overlay Computation');
    return {
      type: 'traffic' as const,
      nodeValues,
      edgeValues,
      metadata: {
        timestamp: Date.now(),
        totalNodes: graph.nodes.length,
        totalEdges: graph.edges.length,
        activeEdges,
        averageTraffic: avgTraffic,
        highTrafficNodes: Array.from(nodeValues.values()).filter(v => v > 80).length,
      },
    };
  }, [graph.nodes, graph.edges]);

  return overlayData;
}

/**
 * Get color for traffic score (protocol-based)
 */
export function getTrafficColor(score: number, protocol?: string): string {
  // Protocol-specific colors
  const protocolColors: Record<string, string> = {
    'HTTP': '#4CAF50',
    'gRPC': '#2196F3',
    'TCP': '#9C27B0',
    'UDP': '#FF9800',
  };

  if (protocol && protocolColors[protocol]) {
    return protocolColors[protocol];
  }

  // Default: gradient based on intensity
  if (score < 20) return '#90CAF9'; // Light blue - low traffic
  if (score < 50) return '#42A5F5'; // Blue - moderate traffic
  if (score < 80) return '#1E88E5'; // Dark blue - high traffic
  return '#0D47A1'; // Navy - very high traffic
}

/**
 * Get traffic label from score
 */
export function getTrafficLabel(score: number): string {
  if (score < 20) return 'Low Traffic';
  if (score < 50) return 'Moderate Traffic';
  if (score < 80) return 'High Traffic';
  return 'Very High Traffic';
}

/**
 * Get edge animation speed based on traffic intensity
 *
 * Returns animation duration in milliseconds (lower = faster)
 */
export function getEdgeAnimationSpeed(trafficScore: number): number {
  if (trafficScore < 20) return 4000; // Slow
  if (trafficScore < 50) return 2000; // Medium
  if (trafficScore < 80) return 1000; // Fast
  return 500; // Very fast
}

/**
 * Get edge thickness based on traffic volume
 */
export function getEdgeThickness(trafficScore: number): number {
  if (trafficScore < 20) return 1; // Thin
  if (trafficScore < 50) return 2; // Medium
  if (trafficScore < 80) return 3; // Thick
  return 5; // Very thick
}

/**
 * Calculate particle count for traffic visualization
 */
export function getParticleCount(trafficScore: number): number {
  if (trafficScore < 20) return 1;
  if (trafficScore < 50) return 3;
  if (trafficScore < 80) return 5;
  return 10;
}
