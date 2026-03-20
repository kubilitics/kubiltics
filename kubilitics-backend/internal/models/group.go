package models

import "time"

// Group represents a group/team
type Group struct {
	ID          string    `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	Description string    `json:"description,omitempty" db:"description"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

// GroupMember represents a user's membership in a group
type GroupMember struct {
	ID        string    `json:"id" db:"id"`
	GroupID   string    `json:"group_id" db:"group_id"`
	UserID    string    `json:"user_id" db:"user_id"`
	Role      string    `json:"role" db:"role"` // member, admin
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// GroupClusterPermission represents a group's permission on a cluster
type GroupClusterPermission struct {
	ID        string    `json:"id" db:"id"`
	GroupID   string    `json:"group_id" db:"group_id"`
	ClusterID string    `json:"cluster_id" db:"cluster_id"`
	Role      string    `json:"role" db:"role"` // viewer, operator, admin
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// GroupNamespacePermission represents a group's permission on a namespace
type GroupNamespacePermission struct {
	ID        string    `json:"id" db:"id"`
	GroupID   string    `json:"group_id" db:"group_id"`
	ClusterID string    `json:"cluster_id" db:"cluster_id"`
	Namespace string    `json:"namespace" db:"namespace"`
	Role      string    `json:"role" db:"role"` // viewer, operator, admin
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// OIDCGroupMapping maps OIDC group names to Kubilitics groups
type OIDCGroupMapping struct {
	ID           string    `json:"id" db:"id"`
	GroupID      string    `json:"group_id" db:"group_id"`
	OIDCGroupName string   `json:"oidc_group_name" db:"oidc_group_name"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
}
