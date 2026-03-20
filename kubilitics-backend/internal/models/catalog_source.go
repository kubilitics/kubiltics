package models

import "time"

// PrivateCatalogSource represents a user-configured private Helm or OCI repository
// that extends the built-in addon catalog with PRIVATE tier entries.
type PrivateCatalogSource struct {
	ID          string     `json:"id"             db:"id"`
	Name        string     `json:"name"           db:"name"`
	URL         string     `json:"url"            db:"url"`
	Type        string     `json:"type"           db:"type"`      // "helm" | "oci"
	AuthType    string     `json:"auth_type"      db:"auth_type"` // "none" | "basic" | "token"
	SyncEnabled bool       `json:"sync_enabled"   db:"sync_enabled"`
	// LastSyncedAt is nil until the first successful sync.
	LastSyncedAt *time.Time `json:"last_synced_at" db:"last_synced_at"`
	CreatedAt    time.Time  `json:"created_at"     db:"created_at"`
}
