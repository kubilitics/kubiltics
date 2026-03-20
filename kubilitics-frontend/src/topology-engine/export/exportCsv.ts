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
export async function downloadCSV(graph: TopologyGraph, filename?: string) {
  const data = exportAsCSV(graph);
  const blob = new Blob([data], { type: 'text/csv' });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await downloadFile(blob, filename ?? `topology-nodes-${ts}.csv`);
}

/** Task 6.4: Download two files – {prefix}-nodes-{timestamp}.csv, {prefix}-edges-{timestamp}.csv */
export async function downloadCSVSummary(graph: TopologyGraph, prefix = 'topology') {
  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const nodesBlob = new Blob([exportAsNodesCSV(graph)], { type: 'text/csv' });
  const edgesBlob = new Blob([exportAsEdgesCSV(graph)], { type: 'text/csv' });
  await downloadFile(nodesBlob, `${prefix}-nodes-${ts}.csv`);
  await downloadFile(edgesBlob, `${prefix}-edges-${ts}.csv`);
}
