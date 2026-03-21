// Package models defines the canonical metrics domain model for Kubilitics.
// All metrics queries are derived from ResourceIdentity; no resource-specific branching.

package models

// ResourceType is the canonical Kubernetes resource kind (lowercase, singular).
// Used to resolve metrics source: pod/node are direct; controllers aggregate from owned pods.
type ResourceType string

const (
	ResourceTypePod          ResourceType = "pod"
	ResourceTypeNode         ResourceType = "node"
	ResourceTypeDeployment   ResourceType = "deployment"
	ResourceTypeReplicaSet   ResourceType = "replicaset"
	ResourceTypeStatefulSet  ResourceType = "statefulset"
	ResourceTypeDaemonSet    ResourceType = "daemonset"
	ResourceTypeJob          ResourceType = "job"
	ResourceTypeCronJob      ResourceType = "cronjob"
	ResourceTypeService      ResourceType = "service"
	ResourceTypeNamespace   ResourceType = "namespace"
)

// OwnerRef identifies a controlling resource (e.g. ReplicaSet owned by Deployment).
// Used to avoid double-counting and to resolve controller → pods.
type OwnerRef struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	UID        string `json:"uid,omitempty"`
}

// ResourceIdentity is the canonical identity for any Kubernetes resource in metrics.
// All metrics APIs accept this; resolution (controller → pods, etc.) is internal.
type ResourceIdentity struct {
	ClusterID    string       `json:"cluster_id"`
	Namespace    string       `json:"namespace"`     // empty for cluster-scoped (e.g. node)
	ResourceType ResourceType `json:"resource_type"`
	ResourceName string       `json:"resource_name"`
	OwnerRefs    []OwnerRef   `json:"owner_refs,omitempty"`
}

// Valid returns true if identity has required fields for a metrics query.
func (r *ResourceIdentity) Valid() bool {
	if r.ClusterID == "" || r.ResourceName == "" || r.ResourceType == "" {
		return false
	}
	// namespace required for namespaced types
	namespaced := map[ResourceType]bool{
		ResourceTypePod: true, ResourceTypeDeployment: true, ResourceTypeReplicaSet: true,
		ResourceTypeStatefulSet: true, ResourceTypeDaemonSet: true, ResourceTypeJob: true,
		ResourceTypeCronJob: true, ResourceTypeService: true, ResourceTypeNamespace: true,
	}
	if namespaced[r.ResourceType] && r.Namespace == "" {
		return false
	}
	return true
}

// IsController returns true if this resource type aggregates metrics from owned pods.
func (r ResourceType) IsController() bool {
	switch r {
	case ResourceTypeDeployment, ResourceTypeReplicaSet, ResourceTypeStatefulSet,
		ResourceTypeDaemonSet, ResourceTypeJob, ResourceTypeCronJob, ResourceTypeService:
		return true
	default:
		return false
	}
}

// ContainerUsage is per-container CPU/memory from Metrics Server.
type ContainerUsage struct {
	Name   string `json:"name"`
	CPU    string `json:"cpu"`    // e.g. "10.50m"
	Memory string `json:"memory"` // e.g. "32.00Mi"
}

// PodUsage is usage for a single pod (from Metrics Server or aggregation).
type PodUsage struct {
	Name           string            `json:"name"`
	Namespace      string            `json:"namespace"`
	CPU            string            `json:"cpu"`
	Memory         string            `json:"memory"`
	Containers     []ContainerUsage  `json:"containers,omitempty"`
	NetworkRxBytes int64             `json:"network_rx_bytes,omitempty"` // from kubelet stats/summary
	NetworkTxBytes int64             `json:"network_tx_bytes,omitempty"`
}

// MetricsSummary is the unified response for GET /metrics/summary.
// Same shape for pod (single), controller (aggregated), or node.
type MetricsSummary struct {
	// Identity echoed for correlation
	ClusterID    string       `json:"cluster_id"`
	Namespace    string       `json:"namespace"`
	ResourceType ResourceType `json:"resource_type"`
	ResourceName string       `json:"resource_name"`
	// Usage
	TotalCPU       string      `json:"total_cpu"`    // e.g. "125.00m"
	TotalMemory    string      `json:"total_memory"` // e.g. "256.50Mi"
	TotalNetworkRx int64       `json:"total_network_rx,omitempty"` // bytes received (all pods)
	TotalNetworkTx int64       `json:"total_network_tx,omitempty"` // bytes transmitted (all pods)
	PodCount       int         `json:"pod_count"`   // 1 for pod, N for controller
	Pods           []PodUsage  `json:"pods,omitempty"` // per-pod breakdown for controllers
	// Observability: why data might be missing (no silent failures)
	Source   string `json:"source"`   // e.g. "metrics_server"
	Warning  string `json:"warning,omitempty"`  // e.g. "3 pods skipped (not yet scheduled)"
}

// MetricsQueryResult wraps summary with query metadata for observability.
type MetricsQueryResult struct {
	Summary   *MetricsSummary `json:"summary"`
	QueryMs   int64           `json:"query_ms,omitempty"`
	CacheHit  bool            `json:"cache_hit,omitempty"`
	Error     string          `json:"error,omitempty"`
	ErrorCode string          `json:"error_code,omitempty"` // e.g. "CLUSTER_NOT_FOUND", "METRICS_SERVER_UNAVAILABLE"
}

// ---------------------------------------------------------------------------
// Historical metrics (ring-buffer backed, in-memory)
// ---------------------------------------------------------------------------

type ContainerHistoryPoint struct {
	Name      string  `json:"name"`
	CPUMilli  float64 `json:"cpu_milli"`
	MemoryMiB float64 `json:"memory_mib"`
}

type PodHistoryPoint struct {
	Name       string                  `json:"name"`
	CPUMilli   float64                 `json:"cpu_milli"`
	MemoryMiB  float64                 `json:"memory_mib"`
	NetworkRx  int64                   `json:"network_rx,omitempty"`
	NetworkTx  int64                   `json:"network_tx,omitempty"`
	Containers []ContainerHistoryPoint `json:"containers,omitempty"`
}

type MetricsHistoryPoint struct {
	Timestamp  int64              `json:"ts"`
	CPUMilli   float64            `json:"cpu_milli"`
	MemoryMiB  float64            `json:"memory_mib"`
	NetworkRx  int64              `json:"network_rx,omitempty"`
	NetworkTx  int64              `json:"network_tx,omitempty"`
	PodPoints  []PodHistoryPoint  `json:"pods,omitempty"`
}

type MetricsHistoryResponse struct {
	ClusterID    string               `json:"cluster_id"`
	Namespace    string               `json:"namespace"`
	ResourceType ResourceType         `json:"resource_type"`
	ResourceName string               `json:"resource_name"`
	Points       []MetricsHistoryPoint `json:"points"`
	IntervalSec  int                  `json:"interval_sec"`
	MaxDuration  string               `json:"max_duration"`
}
