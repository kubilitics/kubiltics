package graph

import (
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// FailureMode describes what type of failure is being simulated.
const (
	FailureModePodCrash           = "pod-crash"
	FailureModeWorkloadDeletion   = "workload-deletion"
	FailureModeNamespaceDeletion  = "namespace-deletion"
	FailureModeNodeDrain          = "node-drain"
)

// ValidFailureMode returns true if mode is a recognized failure mode string.
func ValidFailureMode(mode string) bool {
	switch mode {
	case FailureModePodCrash, FailureModeWorkloadDeletion, FailureModeNamespaceDeletion, FailureModeNodeDrain:
		return true
	default:
		return false
	}
}

// simplePageRank computes an iterative PageRank over the graph and returns
// a map of nodeKey -> normalized score in the [0, 1] range.
//
// Parameters:
//
//	nodes   – refKey -> ResourceRef mapping (keys are the node identifiers)
//	forward – adjacency map: source -> set of targets (what source depends on)
//	reverse – adjacency map: target -> set of sources (what depends on target)
func simplePageRank(
	nodes map[string]models.ResourceRef,
	forward map[string]map[string]bool,
	_ map[string]map[string]bool, // reverse — accepted for API symmetry; PageRank only needs forward
) map[string]float64 {
	nodeList := make([]string, 0, len(nodes))
	for k := range nodes {
		nodeList = append(nodeList, k)
	}
	return pageRankOnKeys(nodeList, forward)
}

// pageRankOnKeys is the core PageRank implementation operating on a plain
// slice of node keys.
func pageRankOnKeys(
	nodeList []string,
	forward map[string]map[string]bool,
) map[string]float64 {
	const damping = 0.85
	const maxIter = 50
	const convergenceThreshold = 0.0001

	n := len(nodeList)
	if n == 0 {
		return map[string]float64{}
	}

	rank := make(map[string]float64, n)
	initial := 1.0 / float64(n)
	for _, k := range nodeList {
		rank[k] = initial
	}

	for iter := 0; iter < maxIter; iter++ {
		newRank := make(map[string]float64, n)
		for _, k := range nodeList {
			newRank[k] = (1.0 - damping) / float64(n)
		}

		for _, k := range nodeList {
			// outDegree = number of outgoing edges (forward links)
			out := len(forward[k])
			if out == 0 {
				// Dangling node: distribute rank evenly to all nodes
				share := rank[k] / float64(n)
				for _, dest := range nodeList {
					newRank[dest] += damping * share
				}
			} else {
				share := rank[k] / float64(out)
				for dest := range forward[k] {
					newRank[dest] += damping * share
				}
			}
		}

		// Check convergence
		delta := 0.0
		for _, k := range nodeList {
			d := newRank[k] - rank[k]
			if d < 0 {
				d = -d
			}
			delta += d
		}
		rank = newRank
		if delta < convergenceThreshold {
			break
		}
	}

	// Normalize to [0, 1]
	maxVal := 0.0
	for _, v := range rank {
		if v > maxVal {
			maxVal = v
		}
	}
	if maxVal > 0 {
		for k, v := range rank {
			rank[k] = v / maxVal
		}
	}

	return rank
}

