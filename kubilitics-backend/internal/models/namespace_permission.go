package models

import "time"

// NamespacePermission represents a namespace-level permission
type NamespacePermission struct {
	ID        string    `json:"id" db:"id"`
	UserID    string    `json:"user_id" db:"user_id"`
	ClusterID string    `json:"cluster_id" db:"cluster_id"`
	Namespace string    `json:"namespace" db:"namespace"` // '*' means all namespaces
	Role      string    `json:"role" db:"role"`           // viewer | operator | admin
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// IsWildcard returns true if this permission applies to all namespaces
func (p *NamespacePermission) IsWildcard() bool {
	return p.Namespace == "*"
}
