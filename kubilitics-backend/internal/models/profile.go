package models

import "time"

// ProfileAddon describes a single addon entry inside a ClusterProfile.
// Namespace, ReleaseName, ValuesJSON, and UpgradePolicy can be overridden
// per-profile; empty values fall back to addon catalog defaults.
type ProfileAddon struct {
	AddonID       string `json:"addon_id"`
	Namespace     string `json:"namespace"`
	ReleaseName   string `json:"release_name,omitempty"`
	ValuesJSON    string `json:"values_json,omitempty"`
	UpgradePolicy string `json:"upgrade_policy,omitempty"` // "auto", "manual", "none"
}

// ClusterProfile is a named set of addons that can be applied together
// to bootstrap a cluster with a common configuration.
type ClusterProfile struct {
	ID          string         `json:"id" db:"id"`
	Name        string         `json:"name" db:"name"`
	Description string         `json:"description" db:"description"`
	Addons      []ProfileAddon `json:"addons" db:"-"`
	IsBuiltin   bool           `json:"is_builtin" db:"is_builtin"`
	CreatedAt   time.Time      `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at" db:"updated_at"`
}
