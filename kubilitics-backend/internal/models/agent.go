package models

import "time"

// AgentCluster represents a Kubernetes cluster registered via the agent trust model.
// Named AgentCluster to avoid collision with the existing kubeconfig-based Cluster type.
type AgentCluster struct {
	ID              string
	OrganizationID  string
	ClusterUID      string
	Name            string
	K8sVersion      string
	AgentVersion    string
	NodeCount       int
	Status          string // registering|active|degraded|offline|superseded
	CredentialEpoch int
	RegisteredAt    time.Time
	LastHeartbeatAt *time.Time
}

type BootstrapToken struct {
	JTI            string
	OrganizationID string
	CreatedBy      string
	CreatedAt      time.Time
	ExpiresAt      time.Time
	UsedAt         *time.Time
	UsedByCluster  *string
	RevokedAt      *time.Time
}

type AgentCredential struct {
	ID               string
	ClusterID        string
	RefreshTokenHash string
	IssuedAt         time.Time
	ExpiresAt        time.Time
	LastUsedAt       *time.Time
	RevokedAt        *time.Time
	CredentialEpoch  int
}
