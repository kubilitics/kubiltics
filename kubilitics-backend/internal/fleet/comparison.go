package fleet

import (
	"fmt"
	"math"
	"sort"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// ComparisonResult holds the full comparison between two clusters.
type ComparisonResult struct {
	ClusterA    ClusterMetrics        `json:"cluster_a"`
	ClusterB    ClusterMetrics        `json:"cluster_b"`
	Dimensions  []DimensionComparison `json:"dimensions"`
	Differences []StructuralDiff      `json:"structural_differences"`
}

// DimensionComparison is a single metric comparison between two clusters.
type DimensionComparison struct {
	Name   string  `json:"name"`
	ValueA float64 `json:"value_a"`
	ValueB float64 `json:"value_b"`
	Delta  float64 `json:"delta"`
	Better string  `json:"better"` // "a", "b", or "equal"
}

// StructuralDiff is a workload-level structural difference between two clusters.
type StructuralDiff struct {
	WorkloadKey string `json:"workload_key"`
	Issue       string `json:"issue"`
	ClusterA    string `json:"cluster_a_state"`
	ClusterB    string `json:"cluster_b_state"`
}

// Compare performs a dimension-by-dimension and structural comparison of two
// cluster snapshots. It returns aggregated metrics for both clusters,
// metric-level comparisons, and workload-level structural differences.
func Compare(snapA, snapB *graph.GraphSnapshot) *ComparisonResult {
	metricsA := AggregateCluster(snapA)
	metricsB := AggregateCluster(snapB)

	dims := compareDimensions(metricsA, metricsB, snapA, snapB)
	diffs := findStructuralDiffs(snapA, snapB)

	return &ComparisonResult{
		ClusterA:    *metricsA,
		ClusterB:    *metricsB,
		Dimensions:  dims,
		Differences: diffs,
	}
}

// compareDimensions builds dimension-by-dimension comparisons.
func compareDimensions(a, b *ClusterMetrics, snapA, snapB *graph.GraphSnapshot) []DimensionComparison {
	dims := []DimensionComparison{
		makeDim("health_score", a.HealthScore, b.HealthScore, true),
		makeDim("spof_count", float64(a.SPOFCount), float64(b.SPOFCount), false),
		makeDim("pdb_coverage", a.PDBCoverage, b.PDBCoverage, true),
		makeDim("hpa_coverage", a.HPACoverage, b.HPACoverage, true),
		makeDim("netpol_coverage", a.NetPolCoverage, b.NetPolCoverage, true),
		makeDim("avg_blast_radius", avgBlastRadius(snapA), avgBlastRadius(snapB), false),
		makeDim("cross_ns_deps", float64(countCrossNSDeps(snapA)), float64(countCrossNSDeps(snapB)), false),
	}
	return dims
}

// makeDim creates a DimensionComparison. higherIsBetter controls which direction
// is considered "better".
func makeDim(name string, valA, valB float64, higherIsBetter bool) DimensionComparison {
	delta := valA - valB
	better := "equal"
	const epsilon = 0.001
	if math.Abs(delta) > epsilon {
		if higherIsBetter {
			if valA > valB {
				better = "a"
			} else {
				better = "b"
			}
		} else {
			// Lower is better (e.g., SPOF count, blast radius)
			if valA < valB {
				better = "a"
			} else {
				better = "b"
			}
		}
	}
	return DimensionComparison{
		Name:   name,
		ValueA: valA,
		ValueB: valB,
		Delta:  delta,
		Better: better,
	}
}

// avgBlastRadius computes the average blast radius percentage across all nodes
// in a snapshot. This is a lightweight approximation: for each node with
// dependents, compute the percentage of total workloads affected via BFS.
func avgBlastRadius(snap *graph.GraphSnapshot) float64 {
	if snap == nil || snap.TotalWorkloads == 0 || len(snap.Nodes) == 0 {
		return 0
	}

	totalPct := 0.0
	count := 0
	for key := range snap.Nodes {
		fanIn := len(snap.Reverse[key])
		if fanIn == 0 {
			continue
		}
		// Count transitive dependents via reverse adjacency BFS
		affected := bfsCount(snap.Reverse, key)
		pct := float64(affected) / float64(snap.TotalWorkloads) * 100.0
		totalPct += pct
		count++
	}
	if count == 0 {
		return 0
	}
	return totalPct / float64(count)
}

// countCrossNSDeps counts how many nodes have dependents in a different namespace.
func countCrossNSDeps(snap *graph.GraphSnapshot) int {
	if snap == nil {
		return 0
	}
	count := 0
	for key, ref := range snap.Nodes {
		for depKey := range snap.Reverse[key] {
			depRef := snap.Nodes[depKey]
			if depRef.Namespace != ref.Namespace && depRef.Namespace != "" && ref.Namespace != "" {
				count++
				break // count each node at most once
			}
		}
	}
	return count
}

// bfsCount performs a BFS on the adjacency map and returns the count of
// reachable nodes (excluding the start node).
func bfsCount(adj map[string]map[string]bool, startKey string) int {
	visited := make(map[string]bool)
	queue := []string{startKey}
	visited[startKey] = true

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]
		for neighbor := range adj[curr] {
			if !visited[neighbor] {
				visited[neighbor] = true
				queue = append(queue, neighbor)
			}
		}
	}
	return len(visited) - 1 // exclude startKey
}

// workloadKey builds a key for matching workloads across clusters: Kind/Namespace/Name
func workloadKey(ref models.ResourceRef) string {
	return fmt.Sprintf("%s/%s/%s", ref.Kind, ref.Namespace, ref.Name)
}

// findStructuralDiffs finds workloads that exist in both clusters but have
// different resilience properties (replica count, PDB, HPA, SPOF status).
func findStructuralDiffs(snapA, snapB *graph.GraphSnapshot) []StructuralDiff {
	if snapA == nil || snapB == nil {
		return []StructuralDiff{}
	}

	// Build workload maps: key -> refKey for each snapshot
	workloadsA := buildWorkloadMap(snapA)
	workloadsB := buildWorkloadMap(snapB)

	var diffs []StructuralDiff

	// Find workloads present in both clusters
	for wKey, refKeyA := range workloadsA {
		refKeyB, inB := workloadsB[wKey]
		if !inB {
			continue
		}

		replicasA := snapA.NodeReplicas[refKeyA]
		replicasB := snapB.NodeReplicas[refKeyB]
		hpaA := snapA.NodeHasHPA[refKeyA]
		hpaB := snapB.NodeHasHPA[refKeyB]
		pdbA := snapA.NodeHasPDB[refKeyA]
		pdbB := snapB.NodeHasPDB[refKeyB]
		fanInA := len(snapA.Reverse[refKeyA])
		fanInB := len(snapB.Reverse[refKeyB])
		spofA := replicasA <= 1 && !hpaA && fanInA > 0
		spofB := replicasB <= 1 && !hpaB && fanInB > 0

		// Different replica count
		if replicasA != replicasB {
			diffs = append(diffs, StructuralDiff{
				WorkloadKey: wKey,
				Issue:       "different_replica_count",
				ClusterA:    fmt.Sprintf("replicas=%d", replicasA),
				ClusterB:    fmt.Sprintf("replicas=%d", replicasB),
			})
		}

		// One has PDB, other does not
		if pdbA != pdbB {
			diffs = append(diffs, StructuralDiff{
				WorkloadKey: wKey,
				Issue:       "pdb_mismatch",
				ClusterA:    fmt.Sprintf("has_pdb=%v", pdbA),
				ClusterB:    fmt.Sprintf("has_pdb=%v", pdbB),
			})
		}

		// One has HPA, other does not
		if hpaA != hpaB {
			diffs = append(diffs, StructuralDiff{
				WorkloadKey: wKey,
				Issue:       "hpa_mismatch",
				ClusterA:    fmt.Sprintf("has_hpa=%v", hpaA),
				ClusterB:    fmt.Sprintf("has_hpa=%v", hpaB),
			})
		}

		// Different SPOF status
		if spofA != spofB {
			diffs = append(diffs, StructuralDiff{
				WorkloadKey: wKey,
				Issue:       "spof_mismatch",
				ClusterA:    fmt.Sprintf("is_spof=%v", spofA),
				ClusterB:    fmt.Sprintf("is_spof=%v", spofB),
			})
		}
	}

	// Sort for deterministic output
	sort.Slice(diffs, func(i, j int) bool {
		if diffs[i].WorkloadKey != diffs[j].WorkloadKey {
			return diffs[i].WorkloadKey < diffs[j].WorkloadKey
		}
		return diffs[i].Issue < diffs[j].Issue
	})

	return diffs
}

// buildWorkloadMap returns a map of "Kind/Namespace/Name" -> refKey for workload
// nodes in the snapshot.
func buildWorkloadMap(snap *graph.GraphSnapshot) map[string]string {
	m := make(map[string]string)
	for key, ref := range snap.Nodes {
		if isWorkloadKind(ref.Kind) {
			m[workloadKey(ref)] = key
		}
	}
	return m
}
