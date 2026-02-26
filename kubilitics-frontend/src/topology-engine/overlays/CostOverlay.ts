import { useMemo } from 'react';
import type { OverlayData } from '../types/overlay.types';
import type { TopologyGraph } from '../types/topology.types';

export interface CostMetrics {
  hourlyRate?: number;
  monthlyRate?: number;
  cpuCost?: number;
  memoryCost?: number;
  storageCost?: number;
}

/**
 * Cost Overlay Hook
 *
 * Computes cost scores for all nodes based on:
 * - CPU resource requests/usage
 * - Memory resource requests/usage
 * - Storage volumes
 * - Estimated cloud provider pricing
 *
 * Score mapping:
 * - 0-20: Very cheap (green)
 * - 21-50: Moderate cost (yellow-green)
 * - 51-80: Expensive (orange)
 * - 81-100: Very expensive (red)
 *
 * NOTE: Uses local heuristics (CPU/memory usage, replica count). For actual
 * cost data, integrate with a cost tracking service or cloud billing APIs.
 */
export function useCostOverlay(graph: TopologyGraph): OverlayData {
  const overlayData = useMemo(() => {
    if (import.meta.env?.DEV) console.time('Cost Overlay Computation');
    const nodeValues = new Map<string, number>();

    // Cost estimation constants (simplified - should come from backend)
    const CPU_COST_PER_CORE_HOUR = 0.04; // $0.04 per vCPU per hour (approximate)
    const MEMORY_COST_PER_GB_HOUR = 0.005; // $0.005 per GB per hour
    const STORAGE_COST_PER_GB_MONTH = 0.10; // $0.10 per GB per month

    graph.nodes.forEach(node => {
      let costScore = 0;

      // NOTE: Cost calculation requires backend integration with cost tracking
      // For now, use simplified estimation based on available metrics

      // Estimate based on resource usage (CPU/Memory as proxy for cost)
      if (node.kind === 'Pod') {
        const cpuUsage = node.computed?.cpuUsage ?? 0;
        const memoryUsage = node.computed?.memoryUsage ?? 0;

        // Simple heuristic: higher resource usage = higher cost
        // Normalize to 0-100 scale
        costScore = Math.min(100, Math.max(cpuUsage, memoryUsage));
      }

      // Deployment/StatefulSet: use replica count as cost factor
      if (node.kind === 'Deployment' || node.kind === 'ReplicaSet' || node.kind === 'StatefulSet') {
        const replicas = node.computed?.replicas;
        const desired = replicas?.desired ?? 1;

        // More replicas = higher cost (10 replicas = score of 50)
        costScore = Math.min(100, (desired / 10) * 50);

        // Add CPU/Memory if available
        const cpuUsage = node.computed?.cpuUsage ?? 0;
        const memoryUsage = node.computed?.memoryUsage ?? 0;
        costScore = Math.max(costScore, Math.max(cpuUsage, memoryUsage));
      }

      // PersistentVolume: assume moderate cost
      if (node.kind === 'PersistentVolume' || node.kind === 'PersistentVolumeClaim') {
        costScore = 30; // Default storage cost
      }

      // Service with LoadBalancer = higher cost
      if (node.kind === 'Service') {
        // LoadBalancer services are more expensive
        // This is a placeholder until backend provides actual cost data
        costScore = 20;
      }

      nodeValues.set(node.id, costScore);
    });

    // Calculate aggregate metrics
    const totalCost = Array.from(nodeValues.values()).reduce((sum, score) => sum + score, 0);
    const avgCost = nodeValues.size > 0 ? totalCost / nodeValues.size : 0;

    if (import.meta.env?.DEV) console.timeEnd('Cost Overlay Computation');
    return {
      type: 'cost' as const,
      nodeValues,
      metadata: {
        timestamp: Date.now(),
        totalNodes: graph.nodes.length,
        totalCostScore: totalCost,
        averageCostScore: avgCost,
        expensiveNodes: Array.from(nodeValues.values()).filter(v => v > 80).length,
      },
    };
  }, [graph.nodes]);

  return overlayData;
}

/**
 * Parse CPU string to cores (e.g., "500m" -> 0.5, "2" -> 2)
 */
function parseCPU(cpu: string): number {
  if (!cpu) return 0;
  if (cpu.endsWith('m')) {
    return parseInt(cpu) / 1000;
  }
  return parseFloat(cpu);
}

/**
 * Parse memory string to MB (e.g., "512Mi" -> 512, "2Gi" -> 2048)
 */
function parseMemory(memory: string): number {
  if (!memory) return 0;

  const units: Record<string, number> = {
    'Ki': 1 / 1024,
    'Mi': 1,
    'Gi': 1024,
    'Ti': 1024 * 1024,
    'K': 1 / 1024,
    'M': 1,
    'G': 1024,
    'T': 1024 * 1024,
  };

  for (const [unit, multiplier] of Object.entries(units)) {
    if (memory.endsWith(unit)) {
      return parseFloat(memory) * multiplier;
    }
  }

  // No unit = bytes
  return parseFloat(memory) / (1024 * 1024);
}

/**
 * Get color for cost score
 */
export function getCostColor(score: number): string {
  if (score < 20) return '#4CAF50'; // Green - cheap
  if (score < 50) return '#8BC34A'; // Light green - moderate
  if (score < 80) return '#FF9800'; // Orange - expensive
  return '#E53935'; // Red - very expensive
}

/**
 * Get cost label from score
 */
export function getCostLabel(score: number): string {
  if (score < 20) return 'Very Cheap';
  if (score < 50) return 'Moderate';
  if (score < 80) return 'Expensive';
  return 'Very Expensive';
}
