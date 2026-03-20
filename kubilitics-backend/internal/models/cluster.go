package models

import "time"

// Cluster represents a Kubernetes cluster configuration
type Cluster struct {
	ID             string    `json:"id" db:"id"`
	Name           string    `json:"name" db:"name"`
	Context        string    `json:"context" db:"context"`
	KubeconfigPath string    `json:"kubeconfig_path" db:"kubeconfig_path"`
	ServerURL      string    `json:"server_url" db:"server_url"`
	Version        string    `json:"version" db:"version"`
	Status         string    `json:"status" db:"status"`     // connected, disconnected, error
	Provider       string    `json:"provider" db:"provider"` // EKS, GKE, AKS, OpenShift, Rancher, k3s, Kind, Minikube, Docker Desktop, on-prem
	IsCurrent      bool      `json:"is_current" db:"is_current"`
	NodeCount      int       `json:"node_count" db:"-"`
	NamespaceCount int       `json:"namespace_count" db:"-"`
	LastConnected  time.Time `json:"last_connected" db:"last_connected"`
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
	UpdatedAt      time.Time `json:"updated_at" db:"updated_at"`
}

// ClusterSummary provides cluster statistics
type ClusterSummary struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	NodeCount          int    `json:"node_count"`
	NamespaceCount     int    `json:"namespace_count"`
	PodCount           int    `json:"pod_count"`
	DeploymentCount    int    `json:"deployment_count"`
	ServiceCount       int    `json:"service_count"`
	StatefulSetCount   int    `json:"statefulset_count"`
	ReplicaSetCount    int    `json:"replicaset_count"`
	DaemonSetCount     int    `json:"daemonset_count"`
	JobCount           int    `json:"job_count"`
	CronJobCount       int    `json:"cronjob_count"`
	HealthStatus       string `json:"health_status"`
}
