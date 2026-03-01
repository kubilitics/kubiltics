/**
 * Export – JSON format (Task 6.3)
 * Full topology graph matching TopologyResponse: schemaVersion, metadata, nodes, edges
 */
import type { TopologyGraph } from '../types/topology.types';
import { downloadFile } from '../utils/exportUtils';

export interface ExportedTopologyJSON {
  schemaVersion: string;
  metadata: {
    clusterId: string;
    generatedAt: string;
    nodeCount: number;
    edgeCount: number;
    isComplete: boolean;
    warnings: Array<{ message: string; [k: string]: unknown }>;
  };
  nodes: TopologyGraph['nodes'];
  edges: TopologyGraph['edges'];
}

export function exportAsJSON(graph: TopologyGraph): string {
  const exportData: ExportedTopologyJSON = {
    schemaVersion: graph.schemaVersion ?? '1.0',
    metadata: {
      clusterId: graph.metadata.clusterId,
      generatedAt: new Date().toISOString(),
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      isComplete: graph.metadata.isComplete,
      warnings: graph.metadata.warnings ?? [],
    },
    nodes: graph.nodes,
    edges: graph.edges,
  };
  return JSON.stringify(exportData, null, 2);
}

// FIX DESKTOP-EXPORT: Use shared Tauri-aware downloadFile instead of inline blob URL logic
export async function downloadJSON(graph: TopologyGraph, filename = 'topology.json') {
  const data = exportAsJSON(graph);
  const blob = new Blob([data], { type: 'application/json' });
  await downloadFile(blob, filename);
}
