/**
 * Poster Layout – Leadership-ready export
 * Re-runs layout with increased spacing for presentation-grade output
 */
import type { Core } from 'cytoscape';
import { applyELKLayout } from '../renderer/useELKLayout';
import type { TopologyGraph } from '../types/topology.types';
import { GraphModel } from '../core/graphModel';

export interface PosterMetadata {
  title: string;
  clusterName: string;
  generatedAt: string;
  nodeCount: number;
  edgeCount: number;
  namespaceSummary: Record<string, number>;
  resourceSummary: Record<string, number>;
}

/**
 * Generate metadata block for poster export
 */
export function generatePosterMetadata(graph: TopologyGraph, clusterName: string): PosterMetadata {
  const model = new GraphModel(graph);
  const namespaceSummary: Record<string, number> = {};
  for (const node of graph.nodes) {
    if (node.namespace) {
      namespaceSummary[node.namespace] = (namespaceSummary[node.namespace] || 0) + 1;
    }
  }

  return {
    title: `Kubilitics Cluster Topology – ${clusterName}`,
    clusterName,
    generatedAt: new Date().toISOString(),
    nodeCount: model.nodeCount,
    edgeCount: model.edgeCount,
    namespaceSummary,
    resourceSummary: model.getResourceSummary(),
  };
}

/**
 * Apply poster-mode layout with 3x spacing
 */
export async function applyPosterLayout(cy: Core): Promise<void> {
  await applyELKLayout(cy, { isExport: true, posterMode: true, animate: false });
}
