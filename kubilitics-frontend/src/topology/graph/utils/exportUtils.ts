/**
 * File download & export utilities — works in both web and Tauri desktop environments.
 */

import type { TopologyGraph, TopologyNode, TopologyEdge } from '../types/topology.types';

/**
 * Download a Blob as a file. Uses Tauri save dialog when in desktop app,
 * falls back to anchor click for web.
 */
export async function downloadFile(blob: Blob, filename: string): Promise<string | null> {
  // Sanitize filename — remove colons and other characters illegal on Windows/macOS
  const safeFilename = filename.replace(/[<>:"/\\|?*]/g, '-');

  // Check if running in Tauri desktop
  const w = typeof window !== 'undefined' ? window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown } : null;
  const isTauriEnv = !!(w?.__TAURI_INTERNALS__ ?? w?.__TAURI__);

  if (isTauriEnv) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeFile } = await import('@tauri-apps/plugin-fs');

      // Show native save dialog
      const savePath = await save({
        defaultPath: safeFilename,
        title: `Save ${safeFilename}`,
      });
      if (!savePath) return null; // User cancelled

      // Write file to disk
      const arrayBuffer = await blob.arrayBuffer();
      await writeFile(savePath, new Uint8Array(arrayBuffer));
      return savePath;
    } catch {
      // Fall through to web download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return null;
}

/**
 * Open the parent folder of a file path in Finder/Explorer.
 */
export async function showInFolder(filePath: string) {
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    await revealItemInDir(filePath);
  } catch {
    // Fallback: try shell open on the parent directory
    try {
      const parentDir = filePath.substring(0, filePath.lastIndexOf('/')) || filePath.substring(0, filePath.lastIndexOf('\\'));
      const { openPath } = await import('@tauri-apps/plugin-opener');
      await openPath(parentDir);
    } catch {
      // Not in Tauri or plugins unavailable — ignore
    }
  }
}

/**
 * Download a TopologyGraph as a JSON file.
 */
export async function downloadJSON(graph: TopologyGraph, filename: string) {
  const json = JSON.stringify(graph, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  await downloadFile(blob, filename);
}

/**
 * Download a CSV summary of the topology graph (nodes + edges).
 */
export async function downloadCSVSummary(graph: TopologyGraph, filenamePrefix: string) {
  // Nodes CSV
  const nodeHeaders = ['id', 'kind', 'namespace', 'name', 'status', 'health'];
  const nodeRows = graph.nodes.map((n: TopologyNode) =>
    [n.id, n.kind, n.namespace, n.name, n.status, n.computed.health].join(',')
  );
  const nodesCSV = [nodeHeaders.join(','), ...nodeRows].join('\n');
  const nodesBlob = new Blob([nodesCSV], { type: 'text/csv' });
  await downloadFile(nodesBlob, `${filenamePrefix}-nodes.csv`);

  // Edges CSV
  const edgeHeaders = ['id', 'source', 'target', 'relationship', 'label'];
  const edgeRows = graph.edges.map((e: TopologyEdge) =>
    [e.id, e.source, e.target, e.relationshipType, e.label].join(',')
  );
  const edgesCSV = [edgeHeaders.join(','), ...edgeRows].join('\n');
  const edgesBlob = new Blob([edgesCSV], { type: 'text/csv' });
  await downloadFile(edgesBlob, `${filenamePrefix}-edges.csv`);
}

/**
 * Generate a synthetic test graph for performance testing.
 * Creates a simple chain topology with the given number of nodes.
 */
export function generateTestGraph(nodeCount: number): TopologyGraph {
  const kinds: TopologyNode['kind'][] = ['Namespace', 'Service', 'Deployment', 'ReplicaSet', 'Pod', 'Node'];
  const now = new Date().toISOString();

  const nodes: TopologyNode[] = Array.from({ length: nodeCount }, (_, i) => {
    const kind = kinds[i % kinds.length];
    return {
      id: `test-node-${i}`,
      kind,
      namespace: `ns-${Math.floor(i / 10)}`,
      name: `${kind.toLowerCase()}-${i}`,
      apiVersion: 'v1',
      status: 'Running' as const,
      label: `${kind}-${i}`,
      metadata: {
        labels: {},
        annotations: {},
        createdAt: now,
        uid: `uid-${i}`,
      },
      computed: {
        health: 'healthy' as const,
      },
    };
  });

  const edges: TopologyEdge[] = [];
  for (let i = 1; i < nodeCount; i++) {
    edges.push({
      id: `test-edge-${i}`,
      source: nodes[i - 1].id,
      target: nodes[i].id,
      relationshipType: 'owns',
      label: 'owns',
      metadata: {
        derivation: 'test',
        confidence: 1,
        sourceField: 'spec',
      },
    });
  }

  return {
    schemaVersion: '1.0',
    nodes,
    edges,
    metadata: {
      clusterId: 'test-cluster',
      generatedAt: now,
      layoutSeed: 'test',
      isComplete: true,
      warnings: [],
    },
  };
}
