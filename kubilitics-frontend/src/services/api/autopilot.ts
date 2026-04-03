/**
 * API client for Auto-Pilot endpoints.
 * All endpoints are scoped to a cluster: /api/v1/clusters/{clusterId}/autopilot/...
 */
import { backendRequest } from './client';

// ── Types ────────────────────────────────────────────────────────────────────

/** A single detection result from an autopilot rule. */
export interface AutoPilotFinding {
  rule_id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  target_kind: string;
  target_namespace: string;
  target_name: string;
  description: string;
  action_type: string;
  proposed_patch: unknown;
}

/** Per-rule behavior configuration for a cluster. */
export interface AutoPilotRuleConfig {
  rule_id: string;
  mode: 'auto' | 'approval' | 'audit';
  enabled: boolean;
  namespace_includes?: string[];
  namespace_excludes?: string[];
  cooldown_minutes: number;
}

/** Persisted autopilot action for audit and approval workflows. */
export interface AutoPilotAction {
  id: string;
  cluster_id: string;
  rule_id: string;
  status: 'pending' | 'applied' | 'dismissed' | 'audit';
  severity: string;
  target_kind: string;
  target_namespace: string;
  target_name: string;
  description: string;
  action_type: string;
  proposed_patch: unknown;
  safety_delta: number;
  created_at: string;
  updated_at: string;
}

/** Static metadata about a detection rule. */
export interface AutoPilotRuleMeta {
  id: string;
  name: string;
  description: string;
  severity: string;
  action_type: string;
}

/** Response from POST /autopilot/actions/{actionId}/approve or dismiss. */
export interface AutoPilotStatusResponse {
  status: string;
  action_id: string;
}

/** Response from POST /autopilot/scan. */
export interface AutoPilotScanResponse {
  findings: AutoPilotFinding[];
  count: number;
}

// ── API Functions ────────────────────────────────────────────────────────────

function clusterPath(clusterId: string, subpath: string): string {
  return `clusters/${encodeURIComponent(clusterId)}/autopilot/${subpath}`;
}

/** GET /clusters/{id}/autopilot/findings — current findings. */
export async function getAutoPilotFindings(
  baseUrl: string,
  clusterId: string,
): Promise<AutoPilotFinding[]> {
  const result = await backendRequest<AutoPilotFinding[]>(baseUrl, clusterPath(clusterId, 'findings'));
  return result ?? [];
}

/** GET /clusters/{id}/autopilot/actions — paginated action list with optional status filter. */
export async function getAutoPilotActions(
  baseUrl: string,
  clusterId: string,
  status?: string,
  limit = 20,
  offset = 0,
): Promise<AutoPilotAction[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  const result = await backendRequest<AutoPilotAction[]>(
    baseUrl,
    clusterPath(clusterId, `actions?${params.toString()}`),
  );
  return result ?? [];
}

/** GET /clusters/{id}/autopilot/actions/{actionId} — single action detail. */
export async function getAutoPilotAction(
  baseUrl: string,
  clusterId: string,
  actionId: string,
): Promise<AutoPilotAction> {
  return backendRequest<AutoPilotAction>(
    baseUrl,
    clusterPath(clusterId, `actions/${encodeURIComponent(actionId)}`),
  );
}

/** POST /clusters/{id}/autopilot/actions/{actionId}/approve. */
export async function approveAutoPilotAction(
  baseUrl: string,
  clusterId: string,
  actionId: string,
): Promise<AutoPilotStatusResponse> {
  return backendRequest<AutoPilotStatusResponse>(
    baseUrl,
    clusterPath(clusterId, `actions/${encodeURIComponent(actionId)}/approve`),
    { method: 'POST' },
  );
}

/** POST /clusters/{id}/autopilot/actions/{actionId}/dismiss. */
export async function dismissAutoPilotAction(
  baseUrl: string,
  clusterId: string,
  actionId: string,
): Promise<AutoPilotStatusResponse> {
  return backendRequest<AutoPilotStatusResponse>(
    baseUrl,
    clusterPath(clusterId, `actions/${encodeURIComponent(actionId)}/dismiss`),
    { method: 'POST' },
  );
}

/** GET /clusters/{id}/autopilot/config — all rule configs for the cluster. */
export async function getAutoPilotConfig(
  baseUrl: string,
  clusterId: string,
): Promise<AutoPilotRuleConfig[]> {
  const result = await backendRequest<AutoPilotRuleConfig[]>(baseUrl, clusterPath(clusterId, 'config'));
  return result ?? [];
}

/** PUT /clusters/{id}/autopilot/config/{ruleId} — update a rule config. */
export async function updateAutoPilotRuleConfig(
  baseUrl: string,
  clusterId: string,
  ruleId: string,
  config: AutoPilotRuleConfig,
): Promise<AutoPilotRuleConfig> {
  return backendRequest<AutoPilotRuleConfig>(
    baseUrl,
    clusterPath(clusterId, `config/${encodeURIComponent(ruleId)}`),
    { method: 'PUT', body: JSON.stringify(config) },
  );
}

/** POST /clusters/{id}/autopilot/scan — trigger manual scan. */
export async function triggerAutoPilotScan(
  baseUrl: string,
  clusterId: string,
): Promise<AutoPilotScanResponse> {
  return backendRequest<AutoPilotScanResponse>(
    baseUrl,
    clusterPath(clusterId, 'scan'),
    { method: 'POST' },
  );
}

/** GET /clusters/{id}/autopilot/rules — available rules with metadata. */
export async function getAutoPilotRules(
  baseUrl: string,
  clusterId: string,
): Promise<AutoPilotRuleMeta[]> {
  const result = await backendRequest<AutoPilotRuleMeta[]>(baseUrl, clusterPath(clusterId, 'rules'));
  return result ?? [];
}
