package models

import "time"

type InstallStepAction string

const (
	ActionInstall InstallStepAction = "INSTALL"
	ActionUpgrade InstallStepAction = "UPGRADE"
	ActionSkip    InstallStepAction = "SKIP"
	ActionBlock   InstallStepAction = "BLOCK"
)

type InstallStep struct {
	Action                InstallStepAction `json:"action"`
	AddonID               string            `json:"addon_id"`
	AddonName             string            `json:"addon_name"`
	FromVersion           string            `json:"from_version,omitempty"`
	ToVersion             string            `json:"to_version"`
	Namespace             string            `json:"namespace"`
	ReleaseName           string            `json:"release_name"`
	Reason                string            `json:"reason"`
	IsRequired            bool              `json:"is_required"`
	DependencyDepth       int               `json:"dependency_depth"`
	EstimatedDurationSec  int               `json:"estimated_duration_sec"`
	EstimatedCostDeltaUSD float64           `json:"estimated_cost_delta_usd"`
}

type InstallPlan struct {
	RequestedAddonID           string        `json:"requested_addon_id"`
	Steps                      []InstallStep `json:"steps"`
	TotalEstimatedDurationSec  int           `json:"total_estimated_duration_sec"`
	TotalEstimatedCostDeltaUSD float64       `json:"total_estimated_cost_delta_usd"`
	HasConflicts               bool          `json:"has_conflicts"`
	ConflictReasons            []string      `json:"conflict_reasons"`
	ClusterID                  string        `json:"cluster_id"`
	GeneratedAt                time.Time     `json:"generated_at"`
}

type DependencyNode struct {
	AddonID          string    `json:"addon_id"`
	AddonName        string    `json:"addon_name"`
	Version          string    `json:"version"`
	IsInstalled      bool      `json:"is_installed"`
	InstalledVersion string    `json:"installed_version"`
	Tier             AddOnTier `json:"tier"`
	Dependencies     []string  `json:"dependencies"`
	Depth            int       `json:"depth"`
}

type DependencyGraph struct {
	Nodes     map[string]*DependencyNode `json:"nodes"`
	Edges     []DependencyEdge           `json:"edges"`
	HasCycle  bool                       `json:"has_cycle"`
	CyclePath []string                   `json:"cycle_path"`
}

type DependencyEdge struct {
	FromAddonID       string         `json:"from_addon_id"`
	ToAddonID         string         `json:"to_addon_id"`
	Type              DependencyType `json:"type"`
	VersionConstraint string         `json:"version_constraint"`
}
