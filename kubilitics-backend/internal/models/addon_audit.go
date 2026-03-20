package models

import "time"

type AddOnOperation string

const (
	OpInstall       AddOnOperation = "INSTALL"
	OpUpgrade       AddOnOperation = "UPGRADE"
	OpRollback      AddOnOperation = "ROLLBACK"
	OpUninstall     AddOnOperation = "UNINSTALL"
	OpPolicyChange  AddOnOperation = "POLICY_CHANGE"
	OpDriftDetected AddOnOperation = "DRIFT_DETECTED"
	OpHealthChange  AddOnOperation = "HEALTH_CHANGE"
)

type AddOnAuditEvent struct {
	ID             string    `json:"id" db:"id"`
	ClusterID      string    `json:"cluster_id" db:"cluster_id"`
	AddonInstallID string    `json:"addon_install_id,omitempty" db:"addon_install_id"`
	AddonID        string    `json:"addon_id" db:"addon_id"`
	ReleaseName    string    `json:"release_name" db:"release_name"`
	Actor          string    `json:"actor" db:"actor"`
	Operation      string    `json:"operation" db:"operation"`
	OldVersion     string    `json:"old_version,omitempty" db:"old_version"`
	NewVersion     string    `json:"new_version,omitempty" db:"new_version"`
	ValuesHash     string    `json:"values_hash,omitempty" db:"values_hash"`
	Result         string    `json:"result" db:"result"`
	ErrorMessage   string    `json:"error_message,omitempty" db:"error_message"`
	DurationMs     int64     `json:"duration_ms,omitempty" db:"duration_ms"`
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
}

type AddOnAuditResult string

const (
	ResultSuccess    AddOnAuditResult = "SUCCESS"
	ResultFailure    AddOnAuditResult = "FAILURE"
	ResultInProgress AddOnAuditResult = "IN_PROGRESS"
)

type AddOnAuditFilter struct {
	ClusterID      string     `json:"cluster_id"`
	AddonInstallID string     `json:"addon_install_id"`
	AddonID        string     `json:"addon_id"`
	Actor          string     `json:"actor"`
	Operation      string     `json:"operation"`
	Result         string     `json:"result"`
	From           *time.Time `json:"from"`
	To             *time.Time `json:"to"`
	Limit          int        `json:"limit"`
	Offset         int        `json:"offset"`
}
