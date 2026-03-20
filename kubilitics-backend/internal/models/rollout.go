package models

import "time"

// RolloutStrategy determines how clusters are targeted during a fleet rollout.
type RolloutStrategy string

const (
	// StrategyAllAtOnce upgrades all target clusters simultaneously.
	StrategyAllAtOnce RolloutStrategy = "all-at-once"
	// StrategyCanary upgrades a percentage of clusters first, then the rest.
	StrategyCanary RolloutStrategy = "canary"
)

// RolloutStatus represents the lifecycle state of an AddonRollout.
type RolloutStatus string

const (
	RolloutPending   RolloutStatus = "pending"
	RolloutRunning   RolloutStatus = "running"
	RolloutCompleted RolloutStatus = "completed"
	RolloutFailed    RolloutStatus = "failed"
	RolloutAborted   RolloutStatus = "aborted"
)

// AddonRollout records a fleet-wide addon upgrade operation across multiple clusters.
type AddonRollout struct {
	ID            string          `json:"id"              db:"id"`
	AddonID       string          `json:"addon_id"        db:"addon_id"`
	TargetVersion string          `json:"target_version"  db:"target_version"`
	Strategy      RolloutStrategy `json:"strategy"        db:"strategy"`
	CanaryPercent int             `json:"canary_percent"  db:"canary_percent"`
	Status        RolloutStatus   `json:"status"          db:"status"`
	CreatedBy     string          `json:"created_by"      db:"created_by"`
	CreatedAt     time.Time       `json:"created_at"      db:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"      db:"updated_at"`
	// ClusterStatuses is populated by GetRollout but not stored in the rollouts table.
	ClusterStatuses []RolloutClusterStatus `json:"cluster_statuses,omitempty" db:"-"`
}

// RolloutClusterStatus tracks the upgrade progress for one cluster within a rollout.
type RolloutClusterStatus struct {
	RolloutID    string     `json:"rollout_id"              db:"rollout_id"`
	ClusterID    string     `json:"cluster_id"              db:"cluster_id"`
	Status       string     `json:"status"                  db:"status"`
	ErrorMessage string     `json:"error_message,omitempty" db:"error_message"`
	StartedAt    *time.Time `json:"started_at,omitempty"    db:"started_at"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"  db:"completed_at"`
}
