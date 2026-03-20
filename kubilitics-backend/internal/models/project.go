package models

import "time"

// Project represents a logical grouping of clusters and namespaces for multi-cluster, multi-tenancy management.
// Example: Project "abc" with 4 clusters (prod/non-prod × region1/region2) and namespaces per team.
type Project struct {
	ID          string    `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	Description string    `json:"description" db:"description"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at" db:"updated_at"`
}

// ProjectListItem extends Project with cluster and namespace counts for list views.
type ProjectListItem struct {
	Project
	ClusterCount   int `json:"cluster_count" db:"cluster_count"`
	NamespaceCount int `json:"namespace_count" db:"namespace_count"`
}

// ProjectCluster links a project to a cluster. Simple association for multi-cluster projects.
type ProjectCluster struct {
	ProjectID string `json:"project_id" db:"project_id"`
	ClusterID string `json:"cluster_id" db:"cluster_id"`
}

// ProjectNamespace links a project to a namespace within a cluster, optionally tagged by team.
// Supports multi-tenancy: abc team namespaces, cde team namespaces.
type ProjectNamespace struct {
	ProjectID     string `json:"project_id" db:"project_id"`
	ClusterID     string `json:"cluster_id" db:"cluster_id"`
	NamespaceName string `json:"namespace_name" db:"namespace_name"`
	Team          string `json:"team" db:"team"` // abc team, cde team, etc.
}

// ProjectWithDetails extends Project with clusters and namespaces for detail views.
type ProjectWithDetails struct {
	Project
	Clusters   []ProjectClusterWithInfo   `json:"clusters"`
	Namespaces []ProjectNamespaceWithInfo `json:"namespaces"`
}

// ProjectClusterWithInfo extends ProjectCluster with cluster metadata from clusters table.
type ProjectClusterWithInfo struct {
	ProjectCluster
	ClusterName   string `json:"cluster_name"`
	ClusterStatus string `json:"cluster_status"`
	ClusterProvider string `json:"cluster_provider"`
}

// ProjectNamespaceWithInfo extends ProjectNamespace with cluster name.
type ProjectNamespaceWithInfo struct {
	ProjectNamespace
	ClusterName string `json:"cluster_name"`
}
