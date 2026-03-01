/**
 * Export – CSV format
 * Task 6.4: Nodes + Edges as two files (topology-nodes-YYYY-MM-DD.csv, topology-edges-YYYY-MM-DD.csv)
 */
import type { TopologyGraph } from '../types/topology.types';
import { downloadFile } from '../utils/exportUtils';

function escapeCsv(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '""';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return `"${s}"`;
}

/** Nodes CSV: ID, Kind, Namespace, Name, Status, Health, (optional) Replicas, CPU%, Memory% */
export function exportAsNodesCSV(graph: TopologyGraph): string {
  const header = 'ID,Kind,Namespace,Name,Status,Health,Replicas,CPU %,Memory %\n';
  const rows = graph.nodes.map((n) => {
    const replicas = n.computed?.replicas?.desired ?? n.computed?.replicas?.ready ?? '';
    const cpu = n.computed?.cpuUsage != null ? String(n.computed.cpuUsage) : '';
    const mem = n.computed?.memoryUsage != null ? String(n.computed.memoryUsage) : '';
    return [
      escapeCsv(n.id),
      escapeCsv(n.kind),
      escapeCsv(n.namespace ?? ''),
      escapeCsv(n.name),
      escapeCsv(n.status),
      escapeCsv(n.computed?.health ?? 'unknown'),
      escapeCsv(replicas),
      escapeCsv(cpu),
      escapeCsv(mem),
    ].join(',');
  }).join('\n');
  return header + rows;
}

/** Edges CSV: Source, Target, Relationship, Confidence */
export function exportAsEdgesCSV(graph: TopologyGraph): string {
  const header = 'Source,Target,Relationship,Confidence\n';
  const rows = graph.edges.map((e) => [
    escapeCsv(e.source),
    escapeCsv(e.target),
    escapeCsv(e.relationshipType),
    escapeCsv(e.metadata?.confidence ?? ''),
  ].join(',')).join('\n');
  return header + rows;
}

/** Single-file legacy: nodes only */
export function exportAsCSV(graph: TopologyGraph): string {
  return exportAsNodesCSV(graph);
}

// FIX DESKTOP-EXPORT: Use shared Tauri-aware downloadFile instead of inline blob URL logic

/** Download one CSV file (legacy – nodes only) */
export async function downloadCSV(graph: TopologyGraph, filename = 'topology.csv') {
  const data = exportAsCSV(graph);
  const blob = new Blob([data], { type: 'text/csv' });
  await downloadFile(blob, filename);
}

/** Task 6.4: Download two files – topology-nodes-YYYY-MM-DD.csv, topology-edges-YYYY-MM-DD.csv */
export async function downloadCSVSummary(graph: TopologyGraph) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const nodesBlob = new Blob([exportAsNodesCSV(graph)], { type: 'text/csv' });
  const edgesBlob = new Blob([exportAsEdgesCSV(graph)], { type: 'text/csv' });
  await downloadFile(nodesBlob, `topology-nodes-${dateStr}.csv`);
  await downloadFile(edgesBlob, `topology-edges-${dateStr}.csv`);
}
