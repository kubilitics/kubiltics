package health

import "time"

// HealthReport is the structural health assessment for an entire cluster,
// composed of per-namespace health scores weighted by workload count.
type HealthReport struct {
	ClusterID  string            `json:"cluster_id"`
	Score      float64           `json:"score"`      // 0-100, higher = healthier
	Level      string            `json:"level"`      // "healthy", "warning", "degraded", "critical"
	Components []ComponentScore  `json:"components"` // cluster-wide aggregate components
	Namespaces []NamespaceHealth `json:"namespaces"`
}

// ComponentScore is one dimension of the health assessment.
type ComponentScore struct {
	Name   string  `json:"name"`   // "spof_density", "pdb_coverage", etc.
	Score  float64 `json:"score"`  // 0-1 normalized
	Weight float64 `json:"weight"` // contribution weight
	Detail string  `json:"detail"` // human-readable explanation
}

// NamespaceHealth is the health assessment for a single namespace.
type NamespaceHealth struct {
	Namespace     string           `json:"namespace"`
	Score         float64          `json:"score"`
	Level         string           `json:"level"`
	Components    []ComponentScore `json:"components"`
	WorkloadCount int              `json:"workload_count"`
}

// NamespaceRisk is the risk-enriched view of a namespace, derived from health scores.
type NamespaceRisk struct {
	Namespace           string   `json:"namespace"`
	RiskScore           float64  `json:"risk_score"`           // 100 - healthScore
	Level               string   `json:"level"`                // "critical", "high", "medium", "low"
	SPOFCount           int      `json:"spof_count"`
	AvgBlastRadius      float64  `json:"avg_blast_radius"`
	CrossNSDependencies int      `json:"cross_ns_dependencies"`
	WorkloadCount       int      `json:"workload_count"`
	TopRisks            []string `json:"top_risks"` // human-readable top risk factors
}

// RiskRanking is the cluster-wide namespace risk ranking, sorted by risk score descending.
type RiskRanking struct {
	ClusterID   string          `json:"cluster_id"`
	Namespaces  []NamespaceRisk `json:"namespaces"` // sorted by risk_score descending
	GeneratedAt time.Time       `json:"generated_at"`
}

// WorkloadInfo describes a single workload for health scoring purposes.
type WorkloadInfo struct {
	Key        string // "Kind/Namespace/Name"
	Kind       string
	Name       string
	Namespace  string
	Replicas   int
	IsSPOF     bool
	HasHPA     bool
	HasPDB     bool
	IsScalable bool // Deployment, StatefulSet, ReplicaSet (not DaemonSet, Job, CronJob)
}

// CriticalityInfo holds precomputed criticality data for a workload.
type CriticalityInfo struct {
	Score      float64
	FanIn      int
	IsSPOF     bool
	HasHPA     bool
	HasPDB     bool
	Replicas   int
	IsScalable bool
}

// EdgeInfo describes a dependency edge in the cluster graph.
type EdgeInfo struct {
	SourceKey       string
	TargetKey       string
	SourceNamespace string
	TargetNamespace string
}

// ClusterData is the interface the scorer uses to read graph and criticality data.
// Implementations adapt from the existing graph.GraphSnapshot.
type ClusterData interface {
	GetNamespaces() []string
	GetWorkloadsInNamespace(ns string) []WorkloadInfo
	GetCriticalityScores() map[string]CriticalityInfo
	GetEdges() []EdgeInfo
}
