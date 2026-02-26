/**
 * Add-on API types — mirror backend models (Part 1) exactly.
 * Field names match Go JSON tags.
 */

export type AddOnTier = "CORE" | "COMMUNITY" | "PRIVATE";

export type AddOnStatus =
  | "INSTALLING"
  | "INSTALLED"
  | "DEGRADED"
  | "UPGRADING"
  | "ROLLING_BACK"
  | "FAILED"
  | "DRIFTED"
  | "SUSPENDED"
  | "DEPRECATED"
  | "UNINSTALLING";

export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNKNOWN";

export type UpgradePolicy = "CONSERVATIVE" | "PATCH_ONLY" | "MINOR" | "MANUAL";

export type PreflightStatus = "GO" | "WARN" | "BLOCK";

export type InstallStepAction = "INSTALL" | "UPGRADE" | "SKIP" | "BLOCK";

export type DriftSeverity = "COSMETIC" | "STRUCTURAL" | "DESTRUCTIVE";

export interface AddOnEntry {
  id: string;
  name: string;
  display_name: string;
  description: string;
  tier: AddOnTier;
  version: string;
  k8s_compat_min: string;
  k8s_compat_max?: string;
  helm_repo_url: string;
  helm_chart: string;
  helm_chart_version: string;
  icon_url?: string;
  tags: string[] | null;
  home_url?: string;
  source_url?: string;
  maintainer?: string;
  is_deprecated: boolean;
  chart_digest?: string;
  stars?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AddOnDependency {
  id: number;
  addon_id: string;
  depends_on_id: string;
  dependency_type: "required" | "optional";
  version_constraint?: string;
  reason?: string;
}

export interface AddOnConflict {
  id: number;
  addon_id: string;
  conflicts_with_id: string;
  reason: string;
}

export interface AddOnCRDOwnership {
  id: number;
  addon_id: string;
  crd_group: string;
  crd_resource: string;
  crd_version?: string;
}

export interface AddOnRBACRule {
  id: number;
  addon_id: string;
  api_groups: string[];
  resources: string[];
  verbs: string[];
  scope: string;
}

export interface AddOnCostModel {
  id: number;
  addon_id: string;
  cluster_tier: "dev" | "staging" | "production";
  cpu_millicores: number;
  memory_mb: number;
  storage_gb: number;
  monthly_cost_usd_estimate: number;
  replica_count: number;
}

export interface VersionChangelog {
  addon_id?: string;
  version: string;
  release_date: string;
  changelog_url?: string;
  breaking_changes: string[] | null;
  highlights: string[] | null;
}

export interface AddOnDetail extends AddOnEntry {
  dependencies: AddOnDependency[];
  conflicts: AddOnConflict[];
  crds_owned: AddOnCRDOwnership[];
  rbac_required: AddOnRBACRule[];
  cost_models: AddOnCostModel[];
  versions: VersionChangelog[];
}

export interface InstallStep {
  action: InstallStepAction;
  addon_id: string;
  addon_name: string;
  from_version?: string;
  to_version: string;
  namespace: string;
  release_name: string;
  reason: string;
  is_required: boolean;
  dependency_depth: number;
  estimated_duration_sec: number;
  estimated_cost_delta_usd: number;
}

export interface InstallPlan {
  requested_addon_id: string;
  steps: InstallStep[];
  total_estimated_duration_sec: number;
  total_estimated_cost_delta_usd: number;
  has_conflicts: boolean;
  conflict_reasons: string[];
  cluster_id: string;
  generated_at: string;
}

export interface PreflightCheck {
  type: string;
  status: PreflightStatus;
  title: string;
  detail: string;
  resolution?: string;
}

export interface PermissionGap {
  api_group: string;
  resource: string;
  verb: string;
  scope: string;
  namespace?: string;
}

export interface RBACDiff {
  missing: PermissionGap[];
  generated_cluster_role_yaml: string;
  generated_binding_yaml: string;
}

export interface ResourceEstimate {
  addon_id: string;
  release_name: string;
  cpu_millicores: number;
  memory_mb: number;
  storage_gb: number;
  monthly_cost_usd: number;
}

export interface PreflightReport {
  cluster_id: string;
  addon_id: string;
  overall_status: PreflightStatus;
  checks: PreflightCheck[];
  blockers: string[];
  warnings: string[];
  rbac_diff?: RBACDiff;
  resource_estimates: ResourceEstimate[];
  generated_at: string;
}

export interface AddOnInstall {
  id: string;
  cluster_id: string;
  addon_id: string;
  release_name: string;
  namespace: string;
  helm_revision: number;
  installed_version: string;
  values_json: string;
  status: AddOnStatus;
  installed_by?: string;
  installed_at: string;
  updated_at: string;
}

export interface AddOnHealth {
  id: number;
  addon_install_id: string;
  last_checked_at: string;
  health_status: HealthStatus;
  ready_pods: number;
  total_pods: number;
  last_error?: string;
}

export interface AddOnUpgradePolicy {
  addon_install_id: string;
  policy: UpgradePolicy;
  pinned_version?: string;
  last_check_at?: string;
  next_available_version?: string;
  auto_upgrade_enabled: boolean;
}

export interface AddOnInstallWithHealth {
  id: string;
  cluster_id: string;
  addon_id: string;
  release_name: string;
  namespace: string;
  helm_revision: number;
  installed_version: string;
  values_json: string;
  status: AddOnStatus;
  installed_by?: string;
  installed_at: string;
  updated_at: string;
  health?: AddOnHealth;
  policy?: AddOnUpgradePolicy;
  catalog_entry?: AddOnEntry;
}

export interface HelmReleaseRevision {
  revision: number;
  status: string;
  chart_version: string;
  description: string;
  deployed_at: string;
  values_hash: string;
}

export interface AddOnAuditEvent {
  id: string;
  cluster_id: string;
  addon_install_id?: string;
  addon_id: string;
  release_name: string;
  actor: string;
  operation: string;
  old_version?: string;
  new_version?: string;
  values_hash?: string;
  result: string;
  error_message?: string;
  duration_ms?: number;
  created_at: string;
}

export interface DryRunResult {
  manifest: string;
  notes: string;
  resource_count: number;
  resource_diff: ResourceChange[];
}

export interface ResourceChange {
  action: string;
  kind: string;
  namespace: string;
  name: string;
}

export interface CostEstimate {
  addon_id: string;
  release_name: string;
  monthly_cost_usd: number;
  cpu_millicores: number;
  memory_mb: number;
  storage_gb: number;
  cluster_tier: string;
}

export interface PlanCostEstimate {
  steps: CostEstimate[];
  total_monthly_cost_delta_usd: number;
}

export interface FinancialStack {
  prometheus_installed: boolean;
  prometheus_release_name?: string;
  prometheus_namespace?: string;
  prometheus_endpoint: string;
  opencost_installed: boolean;
  opencost_release_name?: string;
  opencost_namespace?: string;
  opencost_endpoint: string;
  kube_state_metrics_installed: boolean;
}

/** Response from GET /projects/{projectId}/financial-stack (recommendation with suggested add-ons). */
export interface FinancialStackPlanResponse {
  suggested_addons?: AddOnEntry[];
  plan?: InstallPlan;
}

export interface InstallRequest {
  addon_id: string;
  release_name: string;
  namespace: string;
  values: Record<string, unknown>;
  create_namespace: boolean;
}

export interface InstallProgressEvent {
  step: string;
  message: string;
  status: "pending" | "running" | "success" | "error" | "complete" | "failed" | "warning";
  timestamp: string;
  /** event_id is used for WebSocket resume (last_event_id query param on reconnect). */
  event_id?: number;
  /** install_run_id correlates all events and backend log lines for a single install run. */
  install_run_id?: string;
}

// ── Cluster Bootstrap Profiles (T8.04 / T8.05) ───────────────────────────────

export interface ProfileAddon {
  addon_id: string;
  namespace: string;
  release_name?: string;
  values_json?: string;
  upgrade_policy?: "auto" | "manual" | "none";
}

export interface ClusterProfile {
  id: string;
  name: string;
  description: string;
  addons: ProfileAddon[];
  is_builtin: boolean;
  created_at?: string;
  updated_at?: string;
}

// ── Private Catalog Sources (T9.04) ──────────────────────────────────────────

export interface PrivateCatalogSource {
  id: string;
  name: string;
  url: string;
  type: string; // "helm" | "oci"
  auth_type: string; // "none" | "basic" | "token"
  sync_enabled: boolean;
  last_synced_at?: string;
  created_at: string;
}
