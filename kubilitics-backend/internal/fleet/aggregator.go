package fleet

import (
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// ClusterMetrics holds aggregated metrics for a single cluster, derived
// from a GraphSnapshot. These metrics power the Fleet X-Ray dashboard.
type ClusterMetrics struct {
	ClusterID      string  `json:"cluster_id"`
	ClusterName    string  `json:"cluster_name"`
	HealthScore    float64 `json:"health_score"`
	SPOFCount      int     `json:"spof_count"`
	CriticalCount  int     `json:"critical_count"`
	PDBCoverage    float64 `json:"pdb_coverage"`
	HPACoverage    float64 `json:"hpa_coverage"`
	NetPolCoverage float64 `json:"netpol_coverage"`
	TotalWorkloads int     `json:"total_workloads"`
	TotalNodes     int     `json:"total_nodes"`
}

// AggregateCluster computes fleet-level metrics from a live GraphSnapshot.
// It uses the same scoring logic as the blast-radius engine: SPOF detection
// via replica+HPA+fanIn, criticality via NodeScores, and coverage via the
// pre-built HPA/PDB/Namespace maps.
func AggregateCluster(snapshot *graph.GraphSnapshot) *ClusterMetrics {
	if snapshot == nil {
		return &ClusterMetrics{}
	}

	m := &ClusterMetrics{
		TotalWorkloads: snapshot.TotalWorkloads,
		TotalNodes:     len(snapshot.Nodes),
	}

	// --- SPOF count and critical count ---
	// A resource is a SPOF when: replicas <= 1, no HPA, and has dependents (fanIn > 0).
	// A resource is critical when its pre-computed criticality score >= 70.
	for key := range snapshot.Nodes {
		replicas := snapshot.NodeReplicas[key]
		hasHPA := snapshot.NodeHasHPA[key]
		fanIn := len(snapshot.Reverse[key])

		if replicas <= 1 && !hasHPA && fanIn > 0 {
			m.SPOFCount++
		}

		if snapshot.NodeScores[key] >= 70.0 {
			m.CriticalCount++
		}
	}

	// --- PDB coverage ---
	// Fraction of workload-kind nodes that have a PDB.
	workloadPDBCount, workloadTotal := countWorkloadCoverage(snapshot, func(key string) bool {
		return snapshot.NodeHasPDB[key]
	})
	if workloadTotal > 0 {
		m.PDBCoverage = float64(workloadPDBCount) / float64(workloadTotal) * 100.0
	}

	// --- HPA coverage ---
	workloadHPACount, _ := countWorkloadCoverage(snapshot, func(key string) bool {
		return snapshot.NodeHasHPA[key]
	})
	if workloadTotal > 0 {
		m.HPACoverage = float64(workloadHPACount) / float64(workloadTotal) * 100.0
	}

	// --- NetworkPolicy coverage ---
	// A namespace is "covered" if there is at least one NetworkPolicy node in that namespace.
	coveredNS := make(map[string]bool)
	for _, ref := range snapshot.Nodes {
		if ref.Kind == "NetworkPolicy" && ref.Namespace != "" {
			coveredNS[ref.Namespace] = true
		}
	}
	totalNS := len(snapshot.Namespaces)
	if totalNS > 0 {
		m.NetPolCoverage = float64(len(coveredNS)) / float64(totalNS) * 100.0
	}

	// --- Health score ---
	// Composite: 100 minus penalties for SPOFs, low coverage, and high critical count.
	m.HealthScore = computeHealthScore(m)

	return m
}

// computeHealthScore returns a 0-100 health score for a cluster.
// Starts at 100 and deducts penalties:
//   - Each SPOF: -3 (max -30)
//   - PDB coverage gap: -(100 - pdbCov) * 0.15
//   - HPA coverage gap: -(100 - hpaCov) * 0.10
//   - NetPol coverage gap: -(100 - netpolCov) * 0.10
//   - Critical count: -1 per critical resource (max -15)
func computeHealthScore(m *ClusterMetrics) float64 {
	score := 100.0

	// SPOF penalty: each SPOF costs 3 points, capped at 30
	spofPenalty := float64(m.SPOFCount) * 3.0
	if spofPenalty > 30.0 {
		spofPenalty = 30.0
	}
	score -= spofPenalty

	// PDB coverage gap penalty
	score -= (100.0 - m.PDBCoverage) * 0.15

	// HPA coverage gap penalty
	score -= (100.0 - m.HPACoverage) * 0.10

	// NetPol coverage gap penalty
	score -= (100.0 - m.NetPolCoverage) * 0.10

	// Critical resource penalty
	critPenalty := float64(m.CriticalCount) * 1.0
	if critPenalty > 15.0 {
		critPenalty = 15.0
	}
	score -= critPenalty

	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	return score
}

// countWorkloadCoverage counts how many workload-kind nodes satisfy the predicate
// and returns (matching, total). Workload kinds: Deployment, StatefulSet, DaemonSet.
func countWorkloadCoverage(snapshot *graph.GraphSnapshot, predicate func(key string) bool) (int, int) {
	matching := 0
	total := 0
	for key, ref := range snapshot.Nodes {
		if !isWorkloadKind(ref.Kind) {
			continue
		}
		total++
		if predicate(key) {
			matching++
		}
	}
	return matching, total
}

// isWorkloadKind returns true for Kubernetes workload resource kinds.
func isWorkloadKind(kind string) bool {
	switch kind {
	case "Deployment", "StatefulSet", "DaemonSet":
		return true
	}
	return false
}

// RefKey builds the canonical "Kind/Namespace/Name" key for a ResourceRef,
// matching the graph package's internal key format.
func RefKey(r models.ResourceRef) string {
	return fmt.Sprintf("%s/%s/%s", r.Kind, r.Namespace, r.Name)
}
