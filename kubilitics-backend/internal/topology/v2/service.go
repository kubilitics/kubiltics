package v2

import (
	"context"
)

// ViewMode represents the supported topology view modes in v2.
// Mirrors the PRD: cluster, namespace, workload, resource, rbac.
type ViewMode string

const (
	ViewModeCluster   ViewMode = "cluster"
	ViewModeNamespace ViewMode = "namespace"
	ViewModeWorkload  ViewMode = "workload"
	ViewModeResource  ViewMode = "resource"
	ViewModeRBAC      ViewMode = "rbac"
)

// Options captures the parameters for building a topology graph in v2.
type Options struct {
	ClusterID      string
	ClusterName    string
	Mode           ViewMode
	Namespace      string
	Resource       string
	Depth          int
	IncludeMetrics bool
	IncludeHealth  bool
	IncludeCost    bool
}

// Service defines the v2 topology service entry point.
// It is intentionally decoupled from v1 service and models.
type Service interface {
	// BuildTopology constructs a topology graph for the given options.
	BuildTopology(ctx context.Context, opts Options) (*TopologyResponse, error)
}

