package models

import "time"

// ClusterPermission represents a user's role for a specific cluster (BE-AUTHZ-001).
type ClusterPermission struct {
	ID        string    `json:"id" db:"id"`
	UserID    string    `json:"user_id" db:"user_id"`
	ClusterID string    `json:"cluster_id" db:"cluster_id"`
	Role      string    `json:"role" db:"role"` // viewer | operator | admin
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}
