package simulation

import (
	"github.com/kubilitics/kubilitics-backend/internal/graph"
)

// rescoreSnapshot recomputes PageRank, criticality scores, and SPOF status on the
// given (mutated) snapshot. It writes directly into the snapshot's NodeScores map.
// It reuses the exact same scoring functions from graph/scoring.go via the
// exported wrappers in graph/scoring_export.go.
func rescoreSnapshot(snap *graph.GraphSnapshot) {
	// Step 1: Recompute PageRank on the mutated graph
	pageRanks := graph.SimplePageRank(snap.Nodes, snap.Forward, snap.Reverse)

	// Step 2: Recompute criticality score for every node
	snap.NodeScores = make(map[string]float64, len(snap.Nodes))

	for key, ref := range snap.Nodes {
		fanIn := len(snap.Reverse[key])
		hasHPA := snap.NodeHasHPA[key]
		hasPDB := snap.NodeHasPDB[key]
		replicas := snap.NodeReplicas[key]
		ingressHosts := snap.NodeIngress[key]
		isIngressExposed := len(ingressHosts) > 0

		// Determine if data store: StatefulSets
		isDataStore := ref.Kind == "StatefulSet"

		// Count cross-namespace dependents via BFS on reverse adjacency
		affected := graph.BfsWalk(snap.Reverse, key)
		nsSet := make(map[string]bool)
		for aKey := range affected {
			if aRef, ok := snap.Nodes[aKey]; ok {
				nsSet[aRef.Namespace] = true
			}
		}
		crossNsCount := len(nsSet)

		isSPOF := replicas <= 1 && !hasHPA && fanIn > 0

		score := graph.ComputeCriticalityScore(graph.ScoringParams{
			PageRank:         pageRanks[key],
			FanIn:            fanIn,
			CrossNsCount:     crossNsCount,
			IsDataStore:      isDataStore,
			IsIngressExposed: isIngressExposed,
			IsSPOF:           isSPOF,
			HasHPA:           hasHPA,
			HasPDB:           hasPDB,
		})

		snap.NodeScores[key] = score
	}
}

// computeHealthScore computes a single 0-100 health score from the snapshot's
// criticality scores, SPOF count, and node metadata. This mirrors the weighted
// formula used by the rest of the system:
//
//	health = 100 - (avgCriticality * 0.4) - (spofPenalty * 0.3) - (noHPAPenalty * 0.3)
func computeHealthScore(snap *graph.GraphSnapshot) float64 {
	if len(snap.Nodes) == 0 {
		return 100.0
	}

	var totalScore float64
	var spofCount int
	var noHPACount int
	var workloadCount int

	for key, ref := range snap.Nodes {
		// Only count workload kinds for health
		switch ref.Kind {
		case "Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "CronJob":
			workloadCount++
		default:
			continue
		}

		totalScore += snap.NodeScores[key]

		fanIn := len(snap.Reverse[key])
		replicas := snap.NodeReplicas[key]
		hasHPA := snap.NodeHasHPA[key]

		if replicas <= 1 && !hasHPA && fanIn > 0 {
			spofCount++
		}
		if !hasHPA {
			noHPACount++
		}
	}

	if workloadCount == 0 {
		return 100.0
	}

	avgCriticality := totalScore / float64(workloadCount)

	spofPenalty := float64(spofCount) / float64(workloadCount) * 100.0
	noHPAPenalty := float64(noHPACount) / float64(workloadCount) * 100.0

	health := 100.0 - (avgCriticality * 0.4) - (spofPenalty * 0.3) - (noHPAPenalty * 0.3)

	if health < 0 {
		health = 0
	}
	if health > 100 {
		health = 100
	}

	return health
}

// countSPOFs returns the total number of single-points-of-failure in the snapshot.
// Only workload controllers (Deployment, StatefulSet, DaemonSet) are candidates —
// Pods, Services, ConfigMaps etc. are not workloads that have replicas.
func countSPOFs(snap *graph.GraphSnapshot) int {
	count := 0
	for key, ref := range snap.Nodes {
		switch ref.Kind {
		case "Deployment", "StatefulSet", "DaemonSet":
			// Only workload types can be SPOFs
		default:
			continue
		}
		fanIn := len(snap.Reverse[key])
		replicas := snap.NodeReplicas[key]
		hasHPA := snap.NodeHasHPA[key]
		if replicas <= 1 && !hasHPA && fanIn > 0 {
			count++
		}
	}
	return count
}

// isSPOF returns whether the given node key is a single-point-of-failure.
// Only workload controllers can be SPOFs.
func isSPOF(snap *graph.GraphSnapshot, key string) bool {
	ref, ok := snap.Nodes[key]
	if !ok {
		return false
	}
	switch ref.Kind {
	case "Deployment", "StatefulSet", "DaemonSet":
		// Only workload types
	default:
		return false
	}
	fanIn := len(snap.Reverse[key])
	replicas := snap.NodeReplicas[key]
	hasHPA := snap.NodeHasHPA[key]
	return replicas <= 1 && !hasHPA && fanIn > 0
}
