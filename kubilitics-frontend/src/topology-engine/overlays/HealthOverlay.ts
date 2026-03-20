import { useMemo } from 'react';
import type { OverlayData } from '../types/overlay.types';
import type { TopologyGraph } from '../types/topology.types';

export interface HealthMetrics {
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
  readyReplicas?: number;
  totalReplicas?: number;
  restartCount?: number;
  lastRestartTime?: string;
}

/**
 * Health Overlay Hook
 *
 * Computes health scores for all nodes based on:
 * - Pod status (Running, Pending, Failed)
 * - Container restart counts
 * - Readiness probe results
 * - Replica availability
 *
 * Score mapping:
 * - healthy: 100 (green)
 * - warning: 50 (yellow)
 * - critical: 0 (red)
 * - unknown: 25 (gray)
 */
export function useHealthOverlay(graph: TopologyGraph): OverlayData {
  const overlayData = useMemo(() => {
    if (import.meta.env?.DEV) console.time('Health Overlay Computation');
    const nodeValues = new Map<string, number>();

    graph.nodes.forEach(node => {
      let healthScore = 25; // Default: unknown

      // Check computed health status
      if (node.computed?.health) {
        const healthMap: Record<string, number> = {
          'healthy': 100,
          'warning': 50,
          'critical': 0,
          'unknown': 25,
        };
        healthScore = healthMap[node.computed.health] ?? 25;
      }

      // Additional logic for specific resource types (use node.computed and node.status only)
      if (node.kind === 'Pod') {
        const status = node.status;
        if (status === 'Running') healthScore = 100;
        else if (status === 'Pending') healthScore = 50;
        else if (status === 'Failed') healthScore = 0;

        const restartCount = node.computed?.restartCount ?? 0;
        if (restartCount > 5) healthScore = Math.min(healthScore, 50);
        else if (restartCount > 10) healthScore = 0;
      }

      // Deployment/ReplicaSet health based on replica counts
      if (node.kind === 'Deployment' || node.kind === 'ReplicaSet' || node.kind === 'StatefulSet') {
        const replicas = node.computed?.replicas;
        const ready = replicas?.ready ?? 0;
        const desired = replicas?.desired ?? 1;

        if (ready === desired && desired > 0) healthScore = 100;
        else if (ready > 0) healthScore = 50;
        else healthScore = 0;
      }

      // Service health: use computed.health or status
      if (node.kind === 'Service') {
        if (node.computed?.health === 'healthy') healthScore = 100;
        else if (node.status === 'Running') healthScore = 80;
        else healthScore = 50;
      }

      nodeValues.set(node.id, healthScore);
    });

    if (import.meta.env?.DEV) console.timeEnd('Health Overlay Computation');
    return {
      type: 'health' as const,
      nodeValues,
      metadata: {
        timestamp: Date.now(),
        totalNodes: graph.nodes.length,
        healthyNodes: Array.from(nodeValues.values()).filter(v => v === 100).length,
        warningNodes: Array.from(nodeValues.values()).filter(v => v === 50).length,
        criticalNodes: Array.from(nodeValues.values()).filter(v => v === 0).length,
      },
    };
  }, [graph.nodes]);

  return overlayData;
}

/**
 * Get color for health score
 */
export function getHealthColor(score: number): string {
  if (score >= 80) return '#4CAF50'; // Green - healthy
  if (score >= 40) return '#FFC107'; // Yellow - warning
  if (score > 0) return '#E53935'; // Red - critical
  return '#9E9E9E'; // Gray - unknown
}

/**
 * Get health label from score
 */
export function getHealthLabel(score: number): string {
  if (score >= 80) return 'Healthy';
  if (score >= 40) return 'Warning';
  if (score > 0) return 'Critical';
  return 'Unknown';
}
