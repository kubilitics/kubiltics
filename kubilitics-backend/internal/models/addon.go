package models

import "time"

type AddOnTier string

const (
	TierCORE      AddOnTier = "CORE"
	TierCommunity AddOnTier = "COMMUNITY"
	TierPrivate   AddOnTier = "PRIVATE"
)

type AddOnEntry struct {
	ID               string    `json:"id" db:"id"`
	Name             string    `json:"name" db:"name"`
	DisplayName      string    `json:"display_name" db:"display_name"`
	Description      string    `json:"description" db:"description"`
	Tier             string    `json:"tier" db:"tier"`
	Version          string    `json:"version" db:"version"`
	K8sCompatMin     string    `json:"k8s_compat_min" db:"k8s_compat_min"`
	K8sCompatMax     string    `json:"k8s_compat_max,omitempty" db:"k8s_compat_max"`
	HelmRepoURL      string    `json:"helm_repo_url" db:"helm_repo_url"`
	HelmChart        string    `json:"helm_chart" db:"helm_chart"`
	HelmChartVersion string    `json:"helm_chart_version" db:"helm_chart_version"`
	IconURL          string    `json:"icon_url,omitempty" db:"icon_url"`
	Tags             []string  `json:"tags" db:"-"`
	HomeURL          string    `json:"home_url,omitempty" db:"home_url"`
	SourceURL        string    `json:"source_url,omitempty" db:"source_url"`
	Maintainer       string    `json:"maintainer,omitempty" db:"maintainer"`
	IsDeprecated     bool      `json:"is_deprecated" db:"is_deprecated"`
	ChartDigest      string    `json:"chart_digest,omitempty" db:"chart_digest"`
	Stars            int       `json:"stars,omitempty" db:"stars"`
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time `json:"updated_at" db:"updated_at"`
}

type AddOnDependency struct {
	ID                int64  `json:"id" db:"id"`
	AddonID           string `json:"addon_id" db:"addon_id"`
	DependsOnID       string `json:"depends_on_id" db:"depends_on_id"`
	DependencyType    string `json:"dependency_type" db:"dependency_type"`
	VersionConstraint string `json:"version_constraint,omitempty" db:"version_constraint"`
	Reason            string `json:"reason,omitempty" db:"reason"`
}

type DependencyType string

const (
	DependencyRequired DependencyType = "required"
	DependencyOptional DependencyType = "optional"
)

type AddOnConflict struct {
	ID              int64  `json:"id" db:"id"`
	AddonID         string `json:"addon_id" db:"addon_id"`
	ConflictsWithID string `json:"conflicts_with_id" db:"conflicts_with_id"`
	Reason          string `json:"reason" db:"reason"`
}

type AddOnCRDOwnership struct {
	ID          int64  `json:"id" db:"id"`
	AddonID     string `json:"addon_id" db:"addon_id"`
	CRDGroup    string `json:"crd_group" db:"crd_group"`
	CRDResource string `json:"crd_resource" db:"crd_resource"`
	CRDVersion  string `json:"crd_version,omitempty" db:"crd_version"`
}

type AddOnRBACRule struct {
	ID        int64    `json:"id" db:"id"`
	AddonID   string   `json:"addon_id" db:"addon_id"`
	APIGroups []string `json:"api_groups" db:"-"`
	Resources []string `json:"resources" db:"-"`
	Verbs     []string `json:"verbs" db:"-"`
	Scope     string   `json:"scope" db:"scope"`
}

type RBACScope string

const (
	ScopeCluster   RBACScope = "cluster"
	ScopeNamespace RBACScope = "namespace"
)

type AddOnCostModel struct {
	ID                     int64   `json:"id" db:"id"`
	AddonID                string  `json:"addon_id" db:"addon_id"`
	ClusterTier            string  `json:"cluster_tier" db:"cluster_tier"`
	CPUMillicores          int     `json:"cpu_millicores" db:"cpu_millicores"`
	MemoryMB               int     `json:"memory_mb" db:"memory_mb"`
	StorageGB              int     `json:"storage_gb" db:"storage_gb"`
	MonthlyCostUSDEstimate float64 `json:"monthly_cost_usd_estimate" db:"monthly_cost_usd_estimate"`
	ReplicaCount           int     `json:"replica_count" db:"replica_count"`
}

type ClusterTier string

const (
	TierDev        ClusterTier = "dev"
	TierStaging    ClusterTier = "staging"
	TierProduction ClusterTier = "production"
)

type VersionChangelog struct {
	AddonID         string   `json:"addon_id,omitempty"`
	Version         string   `json:"version"`
	ReleaseDate     string   `json:"release_date"`
	ChangelogURL    string   `json:"changelog_url,omitempty"`
	BreakingChanges []string `json:"breaking_changes,omitempty"`
	Highlights      []string `json:"highlights,omitempty"`
}

type AddOnDetail struct {
	AddOnEntry
	Dependencies []AddOnDependency   `json:"dependencies"`
	Conflicts    []AddOnConflict     `json:"conflicts"`
	CRDsOwned    []AddOnCRDOwnership `json:"crds_owned"`
	RBACRequired []AddOnRBACRule     `json:"rbac_required"`
	CostModels   []AddOnCostModel    `json:"cost_models"`
	Versions     []VersionChangelog  `json:"versions,omitempty"`
}

type AdvisorRecommendation struct {
	AddonID     string `json:"addon_id"`
	Reason      string `json:"reason"`
	Priority    string `json:"priority"` // high, medium, low
	Description string `json:"description"`
}
