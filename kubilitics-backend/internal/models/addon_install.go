package models

import "time"

type AddOnStatus string

const (
	StatusInstalling   AddOnStatus = "INSTALLING"
	StatusInstalled    AddOnStatus = "INSTALLED"
	StatusDegraded     AddOnStatus = "DEGRADED"
	StatusUpgrading    AddOnStatus = "UPGRADING"
	StatusRollingBack  AddOnStatus = "ROLLING_BACK"
	StatusFailed       AddOnStatus = "FAILED"
	StatusDrifted      AddOnStatus = "DRIFTED"
	StatusSuspended    AddOnStatus = "SUSPENDED"
	StatusDeprecated   AddOnStatus = "DEPRECATED"
	StatusUninstalling AddOnStatus = "UNINSTALLING"
)

type AddOnInstall struct {
	ID               string    `json:"id" db:"id"`
	ClusterID        string    `json:"cluster_id" db:"cluster_id"`
	AddonID          string    `json:"addon_id" db:"addon_id"`
	ReleaseName      string    `json:"release_name" db:"release_name"`
	Namespace        string    `json:"namespace" db:"namespace"`
	HelmRevision     int       `json:"helm_revision" db:"helm_revision"`
	InstalledVersion string    `json:"installed_version" db:"installed_version"`
	ValuesJSON       string    `json:"values_json" db:"values_json"`
	Status           string    `json:"status" db:"status"`
	InstalledBy      string    `json:"installed_by,omitempty" db:"installed_by"`
	// IdempotencyKey is a caller-supplied token (X-Idempotency-Key header) used to
	// deduplicate retried install requests. Scoped to (cluster_id, idempotency_key).
	IdempotencyKey   string    `json:"idempotency_key,omitempty" db:"idempotency_key"`
	InstalledAt      time.Time `json:"installed_at" db:"installed_at"`
	UpdatedAt        time.Time `json:"updated_at" db:"updated_at"`
}

type AddOnHealth struct {
	ID             int64     `json:"id" db:"id"`
	AddonInstallID string    `json:"addon_install_id" db:"addon_install_id"`
	LastCheckedAt  time.Time `json:"last_checked_at" db:"last_checked_at"`
	HealthStatus   string    `json:"health_status" db:"health_status"`
	ReadyPods      int       `json:"ready_pods" db:"ready_pods"`
	TotalPods      int       `json:"total_pods" db:"total_pods"`
	LastError      string    `json:"last_error,omitempty" db:"last_error"`
}

type HealthStatus string

const (
	HealthHealthy  HealthStatus = "HEALTHY"
	HealthDegraded HealthStatus = "DEGRADED"
	HealthUnknown  HealthStatus = "UNKNOWN"
)

type UpgradePolicy string

const (
	PolicyConservative UpgradePolicy = "CONSERVATIVE"
	PolicyPatchOnly    UpgradePolicy = "PATCH_ONLY"
	PolicyMinor        UpgradePolicy = "MINOR"
	PolicyManual       UpgradePolicy = "MANUAL"
)

type AddOnUpgradePolicy struct {
	AddonInstallID       string     `json:"addon_install_id" db:"addon_install_id"`
	Policy               string     `json:"policy" db:"policy"`
	PinnedVersion        string     `json:"pinned_version,omitempty" db:"pinned_version"`
	LastCheckAt          *time.Time `json:"last_check_at,omitempty" db:"last_check_at"`
	NextAvailableVersion string     `json:"next_available_version,omitempty" db:"next_available_version"`
	AutoUpgradeEnabled   bool       `json:"auto_upgrade_enabled" db:"auto_upgrade_enabled"`
}

type AddOnInstallWithHealth struct {
	AddOnInstall
	Health       *AddOnHealth        `json:"health,omitempty"`
	Policy       *AddOnUpgradePolicy `json:"policy,omitempty"`
	CatalogEntry *AddOnEntry         `json:"catalog_entry,omitempty"`
}

type HelmReleaseInfo struct {
	Name         string    `json:"name"`
	Namespace    string    `json:"namespace"`
	Status       string    `json:"status"`
	ChartName    string    `json:"chart_name"`
	ChartVersion string    `json:"chart_version"`
	Revision     int       `json:"revision"`
	DeployedAt   time.Time `json:"deployed_at"`
	Description  string    `json:"description"`
}

type HelmReleaseRevision struct {
	Revision     int       `json:"revision"`
	Status       string    `json:"status"`
	ChartVersion string    `json:"chart_version"`
	Description  string    `json:"description"`
	DeployedAt   time.Time `json:"deployed_at"`
	ValuesHash   string    `json:"values_hash"`
}
