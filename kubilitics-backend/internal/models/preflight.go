package models

import "time"

type PreflightStatus string

const (
	PreflightGO    PreflightStatus = "GO"
	PreflightWARN  PreflightStatus = "WARN"
	PreflightBLOCK PreflightStatus = "BLOCK"
)

type PreflightCheckType string

const (
	CheckRBAC              PreflightCheckType = "RBAC"
	CheckAPIGroups         PreflightCheckType = "API_GROUPS"
	CheckCRDConflict       PreflightCheckType = "CRD_CONFLICT"
	CheckResourceHeadroom  PreflightCheckType = "RESOURCE_HEADROOM"
	CheckStorageClass      PreflightCheckType = "STORAGE_CLASS"
	CheckExistingInstall   PreflightCheckType = "EXISTING_INSTALL"
	CheckNodeSelector      PreflightCheckType = "NODE_SELECTOR"
	CheckNetworkPolicy     PreflightCheckType = "NETWORK_POLICY"
	CheckNamespaceConflict PreflightCheckType = "NAMESPACE_CONFLICT"
	CheckImageSecurity     PreflightCheckType = "IMAGE_SECURITY"
	CheckChartSignature    PreflightCheckType = "CHART_SIGNATURE"
)

type PreflightCheck struct {
	Type       PreflightCheckType `json:"type"`
	Status     PreflightStatus    `json:"status"`
	Title      string             `json:"title"`
	Detail     string             `json:"detail"`
	Resolution string             `json:"resolution,omitempty"`
}

type PermissionGap struct {
	APIGroup  string `json:"api_group"`
	Resource  string `json:"resource"`
	Verb      string `json:"verb"`
	Scope     string `json:"scope"`
	Namespace string `json:"namespace,omitempty"`
}

type RBACDiff struct {
	Missing                  []PermissionGap `json:"missing"`
	GeneratedClusterRoleYAML string          `json:"generated_cluster_role_yaml"`
	GeneratedBindingYAML     string          `json:"generated_binding_yaml"`
}

type ResourceEstimate struct {
	AddonID        string  `json:"addon_id"`
	ReleaseName    string  `json:"release_name"`
	CPUMillicores  int     `json:"cpu_millicores"`
	MemoryMB       int     `json:"memory_mb"`
	StorageGB      int     `json:"storage_gb"`
	MonthlyCostUSD float64 `json:"monthly_cost_usd"`
}

type PreflightReport struct {
	ClusterID         string             `json:"cluster_id"`
	AddonID           string             `json:"addon_id"`
	OverallStatus     PreflightStatus    `json:"overall_status"`
	Checks            []PreflightCheck   `json:"checks"`
	Blockers          []string           `json:"blockers"`
	Warnings          []string           `json:"warnings"`
	RBACDiff          *RBACDiff          `json:"rbac_diff,omitempty"`
	ResourceEstimates []ResourceEstimate `json:"resource_estimates"`
	GeneratedAt       time.Time          `json:"generated_at"`
}
