/**
 * API client for Fleet X-Ray endpoints.
 *
 * Provides TypeScript interfaces and fetch functions for all 11 Fleet X-Ray
 * backend endpoints: dashboard, cluster metrics, comparison, golden templates,
 * DR readiness, and health history.
 */
import { backendRequest } from './client';

// ── Types ────────────────────────────────────────────────────────────────────

/** Dimension scores for a cluster (health, coverage, blast radius, etc.) */
export interface XRayDimensions {
  health_score: number;
  spof_count: number;
  critical_count: number;
  pdb_coverage: number;
  hpa_coverage: number;
  netpol_coverage: number;
  blast_radius_avg: number;
  cross_ns_deps: number;
}

/** Trend direction for a cluster metric. */
export type TrendDirection = 'up' | 'down' | 'stable';

/** Single cluster in the X-Ray dashboard. */
export interface XRayCluster {
  id: string;
  name: string;
  context: string;
  provider: string;
  region: string;
  version: string;
  status: string;
  dimensions: XRayDimensions;
  trend: TrendDirection;
  last_scan: string;
}

/** Dashboard response from GET /api/v1/fleet/xray/dashboard */
export interface XRayDashboardResponse {
  clusters: XRayCluster[];
  fleet_health_avg: number;
  total_clusters: number;
  total_spofs: number;
}

/** Single cluster metrics from GET /api/v1/fleet/xray/clusters/{id}/metrics */
export interface XRayClusterMetrics {
  cluster_id: string;
  dimensions: XRayDimensions;
  trend: TrendDirection;
  last_scan: string;
}

/** Structural difference between two clusters. */
export interface StructuralDiff {
  category: string;
  description: string;
  cluster_a_value: string;
  cluster_b_value: string;
  severity: 'info' | 'warning' | 'critical';
}

/** Comparison response from GET /api/v1/fleet/xray/compare */
export interface XRayComparisonResponse {
  cluster_a: XRayCluster;
  cluster_b: XRayCluster;
  structural_diffs: StructuralDiff[];
}

/** Golden template definition. */
export interface GoldenTemplate {
  id: string;
  name: string;
  description: string;
  min_health_score: number;
  max_spofs: number;
  min_pdb_coverage: number;
  min_hpa_coverage: number;
  min_netpol_coverage: number;
  max_blast_radius: number;
  created_at: string;
  updated_at: string;
}

/** Payload for creating/updating a golden template. */
export interface GoldenTemplateInput {
  name: string;
  description: string;
  min_health_score: number;
  max_spofs: number;
  min_pdb_coverage: number;
  min_hpa_coverage: number;
  min_netpol_coverage: number;
  max_blast_radius: number;
}

/** Score of a cluster against a golden template. */
export interface TemplateScore {
  cluster_id: string;
  cluster_name: string;
  match_percent: number;
  gap_count: number;
  gaps: string[];
}

/** Template scores response from GET /api/v1/fleet/xray/templates/{id}/scores */
export interface TemplateScoresResponse {
  template_id: string;
  template_name: string;
  scores: TemplateScore[];
}

/** DR recommendation. */
export interface DRRecommendation {
  category: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
}

/** Coverage entry for DR assessment. */
export interface DRCoverageItem {
  resource_kind: string;
  primary_count: number;
  backup_count: number;
  coverage_percent: number;
}

/** DR assessment response from GET /api/v1/fleet/xray/dr */
export interface DRAssessmentResponse {
  primary_id: string;
  primary_name: string;
  backup_id: string;
  backup_name: string;
  readiness_score: number;
  coverage: DRCoverageItem[];
  parity_score: number;
  recommendations: DRRecommendation[];
}

/** Health history point. */
export interface HealthHistoryPoint {
  timestamp: number;
  health_score: number;
  spof_count: number;
}

/** Health history response from GET /api/v1/fleet/xray/history/{id} */
export interface HealthHistoryResponse {
  cluster_id: string;
  points: HealthHistoryPoint[];
}

// ── API Functions ────────────────────────────────────────────────────────────

const XRAY_PREFIX = 'fleet/xray';

/** GET /api/v1/fleet/xray/dashboard -- all clusters with metrics */
export async function getXRayDashboard(
  baseUrl: string,
): Promise<XRayDashboardResponse> {
  return backendRequest<XRayDashboardResponse>(baseUrl, `${XRAY_PREFIX}/dashboard`);
}

/** GET /api/v1/fleet/xray/clusters/{id}/metrics -- single cluster */
export async function getXRayClusterMetrics(
  baseUrl: string,
  clusterId: string,
): Promise<XRayClusterMetrics> {
  return backendRequest<XRayClusterMetrics>(
    baseUrl,
    `${XRAY_PREFIX}/clusters/${encodeURIComponent(clusterId)}/metrics`,
  );
}

/** GET /api/v1/fleet/xray/compare?cluster_a={id}&cluster_b={id} */
export async function getXRayComparison(
  baseUrl: string,
  clusterAId: string,
  clusterBId: string,
): Promise<XRayComparisonResponse> {
  const params = new URLSearchParams({ cluster_a: clusterAId, cluster_b: clusterBId });
  return backendRequest<XRayComparisonResponse>(
    baseUrl,
    `${XRAY_PREFIX}/compare?${params.toString()}`,
  );
}

/** GET /api/v1/fleet/xray/templates -- list golden templates */
export async function getXRayTemplates(
  baseUrl: string,
): Promise<GoldenTemplate[]> {
  return backendRequest<GoldenTemplate[]>(baseUrl, `${XRAY_PREFIX}/templates`);
}

/** POST /api/v1/fleet/xray/templates -- create template */
export async function createXRayTemplate(
  baseUrl: string,
  template: GoldenTemplateInput,
): Promise<GoldenTemplate> {
  return backendRequest<GoldenTemplate>(baseUrl, `${XRAY_PREFIX}/templates`, {
    method: 'POST',
    body: JSON.stringify(template),
  });
}

/** GET /api/v1/fleet/xray/templates/{id} -- get template */
export async function getXRayTemplate(
  baseUrl: string,
  templateId: string,
): Promise<GoldenTemplate> {
  return backendRequest<GoldenTemplate>(
    baseUrl,
    `${XRAY_PREFIX}/templates/${encodeURIComponent(templateId)}`,
  );
}

/** PUT /api/v1/fleet/xray/templates/{id} -- update template */
export async function updateXRayTemplate(
  baseUrl: string,
  templateId: string,
  template: GoldenTemplateInput,
): Promise<GoldenTemplate> {
  return backendRequest<GoldenTemplate>(
    baseUrl,
    `${XRAY_PREFIX}/templates/${encodeURIComponent(templateId)}`,
    { method: 'PUT', body: JSON.stringify(template) },
  );
}

/** DELETE /api/v1/fleet/xray/templates/{id} -- delete template */
export async function deleteXRayTemplate(
  baseUrl: string,
  templateId: string,
): Promise<void> {
  return backendRequest<void>(
    baseUrl,
    `${XRAY_PREFIX}/templates/${encodeURIComponent(templateId)}`,
    { method: 'DELETE' },
  );
}

/** GET /api/v1/fleet/xray/templates/{id}/scores -- score clusters against template */
export async function getXRayTemplateScores(
  baseUrl: string,
  templateId: string,
): Promise<TemplateScoresResponse> {
  return backendRequest<TemplateScoresResponse>(
    baseUrl,
    `${XRAY_PREFIX}/templates/${encodeURIComponent(templateId)}/scores`,
  );
}

/** GET /api/v1/fleet/xray/dr?primary={id}&backup={id} -- DR assessment */
export async function getXRayDRAssessment(
  baseUrl: string,
  primaryId: string,
  backupId: string,
): Promise<DRAssessmentResponse> {
  const params = new URLSearchParams({ primary: primaryId, backup: backupId });
  return backendRequest<DRAssessmentResponse>(
    baseUrl,
    `${XRAY_PREFIX}/dr?${params.toString()}`,
  );
}

/** GET /api/v1/fleet/xray/history/{id}?from={ms}&to={ms} -- health history */
export async function getXRayHealthHistory(
  baseUrl: string,
  clusterId: string,
  from: number,
  to: number,
): Promise<HealthHistoryResponse> {
  const params = new URLSearchParams({ from: from.toString(), to: to.toString() });
  return backendRequest<HealthHistoryResponse>(
    baseUrl,
    `${XRAY_PREFIX}/history/${encodeURIComponent(clusterId)}?${params.toString()}`,
  );
}
