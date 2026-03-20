import { useMemo } from 'react';
import type { OverlayData } from '../types/overlay.types';
import type { TopologyGraph } from '../types/topology.types';

export interface PerformanceMetrics {
  cpuUsagePercent?: number;
  memoryUsagePercent?: number;
  diskIOPercent?: number;
  networkThroughput?: number;
  latency?: number;
  errorRate?: number;
}

/**
 * Performance Overlay Hook
 *
 * Computes performance heat map for all nodes based on:
 * - CPU utilization (%)
 * - Memory utilization (%)
 * - Disk I/O
 * - Network throughput
 * - Request latency (for services)
 * - Error rate
 *
 * Score mapping:
 * - 0-20: Cool (blue) - low utilization
 * - 21-50: Warm (green) - healthy utilization
 * - 51-80: Hot (orange) - high utilization
 * - 81-100: Critical (red) - overloaded
 *
 * NOTE: Requires backend integration with metrics system
 * (Prometheus, Datadog, New Relic, etc.)
 */
export function usePerformanceOverlay(graph: TopologyGraph): OverlayData {
  const overlayData = useMemo(() => {
    if (import.meta.env?.DEV) console.time('Performance Overlay Computation');
    const nodeValues = new Map<string, number>();

    graph.nodes.forEach(node => {
      let performanceScore = 0;

      // Calculate performance score from available metrics
      const metrics: number[] = [];

      // For Pods: use CPU and Memory utilization
      if (node.kind === 'Pod') {
        const cpuUsage = node.computed?.cpuUsage ?? 0;
        const memoryUsage = node.computed?.memoryUsage ?? 0;

        // CPU utilization score (0-100)
        const cpuScore = Math.min(100, cpuUsage);
        metrics.push(cpuScore);

        // Memory utilization score (0-100)
        const memoryScore = Math.min(100, memoryUsage);
        metrics.push(memoryScore);
      }

      // For Deployments/StatefulSets: average of pod metrics
      if (node.kind === 'Deployment' || node.kind === 'StatefulSet' || node.kind === 'DaemonSet') {
        // Find related pods
        const relatedPods = findRelatedPods(graph, node.id);
        if (relatedPods.length > 0) {
          const avgCPU = relatedPods.reduce((sum, pod) => sum + (pod.computed?.cpuUsage ?? 0), 0) / relatedPods.length;
          const avgMemory = relatedPods.reduce((sum, pod) => sum + (pod.computed?.memoryUsage ?? 0), 0) / relatedPods.length;

          metrics.push(Math.min(100, avgCPU));
          metrics.push(Math.min(100, avgMemory));
        }
      }

      // For Services: use health status as proxy for performance
      if (node.kind === 'Service') {
        // Without latency/errorRate metrics, use health status
        const healthScore = node.computed?.health === 'healthy' ? 20 : 50;
        metrics.push(healthScore);
      }

      // For Nodes (K8s nodes): use overall utilization if available
      if (node.kind === 'Node') {
        // Simplified: assume moderate load
        const cpuUsage = node.computed?.cpuUsage ?? 50;
        const memoryUsage = node.computed?.memoryUsage ?? 50;
        metrics.push(cpuUsage);
        metrics.push(memoryUsage);
      }

      // PersistentVolume: assume moderate usage
      if (node.kind === 'PersistentVolume' || node.kind === 'PersistentVolumeClaim') {
        metrics.push(40); // Default disk usage
      }

      // Calculate overall performance score (max of all metrics)
      if (metrics.length > 0) {
        performanceScore = Math.max(...metrics);
      }

      nodeValues.set(node.id, performanceScore);
    });

    // Calculate aggregate metrics
    const hotNodes = Array.from(nodeValues.values()).filter(v => v > 80).length;
    const avgPerformance = nodeValues.size > 0
      ? Array.from(nodeValues.values()).reduce((sum, v) => sum + v, 0) / nodeValues.size
      : 0;

    if (import.meta.env?.DEV) console.timeEnd('Performance Overlay Computation');
    return {
      type: 'performance' as const,
      nodeValues,
      metadata: {
        timestamp: Date.now(),
        totalNodes: graph.nodes.length,
        hotNodes,
        averagePerformance: avgPerformance,
        criticalNodes: Array.from(nodeValues.values()).filter(v => v > 90).length,
      },
    };
  }, [graph.nodes, graph.edges]);

  return overlayData;
}

/**
 * Find pods related to a Deployment/StatefulSet/DaemonSet
 */
function findRelatedPods(graph: TopologyGraph, controllerId: string): any[] {
  const relatedPods: any[] = [];

  graph.edges.forEach(edge => {
    if (edge.source === controllerId && edge.relationshipType === 'owns') {
      const targetNode = graph.nodes.find(n => n.id === edge.target);
      if (targetNode && targetNode.kind === 'Pod') {
        relatedPods.push(targetNode);
      }
    }
  });

  return relatedPods;
}

/**
 * Parse resource string (CPU or Memory)
 */
function parseResource(resource: string): number {
  if (!resource) return 0;

  // CPU: "4" = 4 cores, "500m" = 0.5 cores
  if (resource.endsWith('m')) {
    return parseInt(resource) / 1000;
  }

  // Memory: "8Gi" = 8192 MB, "512Mi" = 512 MB
  const units: Record<string, number> = {
    'Ki': 1 / 1024,
    'Mi': 1,
    'Gi': 1024,
    'Ti': 1024 * 1024,
  };

  for (const [unit, multiplier] of Object.entries(units)) {
    if (resource.endsWith(unit)) {
      return parseFloat(resource) * multiplier;
    }
  }

  return parseFloat(resource);
}

/**
 * Get color for performance score (heat map)
 */
export function getPerformanceColor(score: number): string {
  if (score < 20) return '#2196F3'; // Blue - cool
  if (score < 50) return '#4CAF50'; // Green - warm
  if (score < 80) return '#FF9800'; // Orange - hot
  return '#E53935'; // Red - critical
}

/**
 * Get performance label from score
 */
export function getPerformanceLabel(score: number): string {
  if (score < 20) return 'Cool';
  if (score < 50) return 'Warm';
  if (score < 80) return 'Hot';
  return 'Critical';
}
