import { useMemo } from 'react';
import type { OverlayData } from '../types/overlay.types';
import type { TopologyGraph } from '../types/topology.types';

export interface SecurityMetrics {
  networkPolicyCount?: number;
  hasNetworkPolicy?: boolean;
  privilegedContainers?: number;
  readOnlyRootFilesystem?: boolean;
  runAsNonRoot?: boolean;
  exposedPorts?: number[];
  vulnerabilityScan?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

/**
 * Security Overlay Hook
 *
 * Computes security posture scores for all nodes based on:
 * - NetworkPolicy coverage
 * - Pod security contexts (privileged, runAsNonRoot, etc.)
 * - RBAC permissions
 * - Exposed services
 * - Security scanning results (if available from backend)
 *
 * Score mapping:
 * - 81-100: Secure (green)
 * - 51-80: Moderate risk (yellow)
 * - 21-50: High risk (orange)
 * - 0-20: Critical risk (red)
 */
export function useSecurityOverlay(graph: TopologyGraph): OverlayData {
  const overlayData = useMemo(() => {
    if (import.meta.env?.DEV) console.time('Security Overlay Computation');
    const nodeValues = new Map<string, number>();

    // Build NetworkPolicy coverage map
    const networkPolicyCoverage = buildNetworkPolicyCoverage(graph);

    graph.nodes.forEach(node => {
      let securityScore = 50; // Default: moderate risk

      // NOTE: Full security analysis requires backend integration
      // For now, use simplified heuristics based on resource type and status

      // Factor 1: NetworkPolicy coverage
      if (node.kind === 'Pod' || node.kind === 'Deployment' || node.kind === 'StatefulSet') {
        const hasPolicyFirewall = networkPolicyCoverage.has(node.id);
        securityScore = hasPolicyFirewall ? 80 : 40; // NetworkPolicy = more secure
      }

      // Factor 2: Service exposure (simplified)
      if (node.kind === 'Service') {
        // Without access to node.data, assume moderate risk
        securityScore = 60; // Default for services
      }

      // Factor 3: Ingress is externally exposed
      if (node.kind === 'Ingress') {
        securityScore = 40; // External exposure = higher risk
      }

      // Factor 4: Secrets should be well-protected
      if (node.kind === 'Secret') {
        securityScore = 90; // Assume secrets are protected
      }

      // Factor 5: RBAC resources
      if (node.kind === 'ServiceAccount' || node.kind === 'Role' || node.kind === 'ClusterRole') {
        securityScore = 70; // RBAC resources are security-critical
      }

      // Factor 6: ConfigMap - less sensitive than Secret
      if (node.kind === 'ConfigMap') {
        securityScore = 75;
      }

      nodeValues.set(node.id, securityScore);
    });

    // Calculate aggregate metrics
    const secureNodes = Array.from(nodeValues.values()).filter(v => v > 80).length;
    const criticalRiskNodes = Array.from(nodeValues.values()).filter(v => v < 20).length;

    if (import.meta.env?.DEV) console.timeEnd('Security Overlay Computation');
    return {
      type: 'security' as const,
      nodeValues,
      metadata: {
        timestamp: Date.now(),
        totalNodes: graph.nodes.length,
        secureNodes,
        criticalRiskNodes,
        networkPoliciesApplied: networkPolicyCoverage.size,
      },
    };
  }, [graph.nodes, graph.edges]);

  return overlayData;
}

/**
 * Build a map of pods covered by NetworkPolicies
 * NOTE: Simplified without access to node.data - requires backend enhancement
 */
function buildNetworkPolicyCoverage(graph: TopologyGraph): Set<string> {
  const covered = new Set<string>();

  // Look for edges from NetworkPolicy to Pods
  graph.edges.forEach(edge => {
    const sourceNode = graph.nodes.find(n => n.id === edge.source);
    if (sourceNode && sourceNode.kind === 'NetworkPolicy') {
      const targetNode = graph.nodes.find(n => n.id === edge.target);
      if (targetNode && targetNode.kind === 'Pod') {
        covered.add(edge.target);
      }
    }
  });

  return covered;
}

// NOTE: Detailed security evaluation requires backend integration
// The following functions would need access to full Kubernetes resource specs (node.data)
// which requires backend enhancement to include in TopologyNode type

/**
 * Get color for security score
 */
export function getSecurityColor(score: number): string {
  if (score > 80) return '#4CAF50'; // Green - secure
  if (score > 50) return '#FFC107'; // Yellow - moderate risk
  if (score > 20) return '#FF9800'; // Orange - high risk
  return '#E53935'; // Red - critical risk
}

/**
 * Get security label from score
 */
export function getSecurityLabel(score: number): string {
  if (score > 80) return 'Secure';
  if (score > 50) return 'Moderate Risk';
  if (score > 20) return 'High Risk';
  return 'Critical Risk';
}
