/**
 * API client for cluster-wide blast radius endpoints (V2).
 */
import { backendRequest } from './client';
import type { BlastRadiusResult, GraphStatus, BlastRadiusSummaryEntry } from './types';

/**
 * GET /api/v1/clusters/{clusterId}/blast-radius/{namespace}/{kind}/{name}
 * Returns blast radius analysis for a specific resource.
 */
export async function getBlastRadius(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  kind: string,
  name: string,
): Promise<BlastRadiusResult> {
  const ns = namespace || '-';
  const path = `clusters/${encodeURIComponent(clusterId)}/blast-radius/${encodeURIComponent(ns)}/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`;
  const result = await backendRequest<BlastRadiusResult>(baseUrl, path);
  // Defensive: backend Go serializes nil slices as "null" in JSON.
  // Normalize all array fields to empty arrays to prevent frontend crashes.
  result.waves = result.waves ?? [];
  result.dependencyChain = result.dependencyChain ?? [];
  result.riskIndicators = result.riskIndicators ?? [];
  result.ingressHosts = result.ingressHosts ?? [];
  result.remediations = result.remediations ?? [];
  result.affectedServices = result.affectedServices ?? [];
  for (const wave of result.waves) {
    wave.resources = wave.resources ?? [];
    for (const res of wave.resources) {
      res.failurePath = res.failurePath ?? [];
    }
  }
  return result;
}

/**
 * GET /api/v1/clusters/{clusterId}/blast-radius/summary
 * Returns top-N resources by blast radius for the cluster.
 */
export async function getBlastRadiusSummary(
  baseUrl: string,
  clusterId: string,
): Promise<BlastRadiusSummaryEntry[]> {
  const path = `clusters/${encodeURIComponent(clusterId)}/blast-radius/summary`;
  return backendRequest<BlastRadiusSummaryEntry[]>(baseUrl, path);
}

/**
 * GET /api/v1/clusters/{clusterId}/blast-radius/graph-status
 * Returns the current state of the cluster dependency graph.
 */
export async function getGraphStatus(
  baseUrl: string,
  clusterId: string,
): Promise<GraphStatus> {
  const path = `clusters/${encodeURIComponent(clusterId)}/blast-radius/graph-status`;
  return backendRequest<GraphStatus>(baseUrl, path);
}
