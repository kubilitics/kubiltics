package builder

import (
	"math"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// PageRank-based criticality scoring
//
// Industry standard approach (Google SRE, Microsoft Research):
// 1. Build directed dependency graph from edges
// 2. Run iterative PageRank with damping factor 0.85
// 3. Weight edges by relationship confidence (ownerRef=1.0, selector=0.9, etc.)
// 4. Add SPOF detection as a multiplier
// 5. Normalize to 0-100 scale
//
// Confidence levels clearly labeled:
// - "observed" if service mesh/trace data available (future)
// - "inferred" if based on K8s metadata only (current)

const (
	// pageRankDamping is the standard damping factor used in PageRank.
	pageRankDamping = 0.85

	// pageRankMaxIter is the maximum number of PageRank iterations.
	pageRankMaxIter = 50

	// pageRankConvergence is the L1-norm convergence threshold.
	pageRankConvergence = 0.0001

	// spofMultiplier boosts the score of single-point-of-failure nodes.
	spofMultiplier = 1.5
)

// CriticalityScore captures how critical a topology node is based on its
// position in the dependency graph, computed via weighted PageRank.
type CriticalityScore struct {
	NodeID          string  `json:"nodeId"`
	Score           float64 `json:"score"`           // 0-100 (normalized PageRank)
	Level           string  `json:"level"`           // "critical", "high", "medium", "low"
	PageRank        float64 `json:"pageRank"`        // raw PageRank value
	FanIn           int     `json:"fanIn"`           // services that depend on this node
	FanOut          int     `json:"fanOut"`           // services this node depends on
	InDegree        int     `json:"inDegree"`        // incoming edges
	OutDegree       int     `json:"outDegree"`       // outgoing edges
	BlastRadius     int     `json:"blastRadius"`     // number of transitively impacted nodes
	DependencyDepth int     `json:"dependencyDepth"` // max depth of dependency chain
	IsSPOF          bool    `json:"isSPOF"`          // single point of failure
	Confidence      string  `json:"confidence"`      // "inferred" (K8s metadata) or "observed" (mesh/traces)
}

// edgeWeight returns the weight for a given relationship type.
// Weights reflect the confidence and strength of each dependency kind.
func edgeWeight(relType v2.RelationshipType) float64 {
	switch string(relType) {
	case "ownerRef", "owns":
		return 1.0 // deterministic ownership
	case "endpoint_target":
		return 0.95 // active traffic
	case "selector":
		return 0.9 // label match
	case "ingress_backend":
		return 0.85 // routing
	case "volume_mount", "env_ref":
		return 0.8 // configuration dependency
	case "headless_service", "webhook_service", "service_account_ref":
		return 0.7 // indirect service dependency
	case "role_binding", "tolerates":
		return 0.7 // RBAC / scheduling affinity
	case "scheduling":
		return 0.6 // placement, not a dependency
	case "namespace":
		return 0.3 // containment, low weight
	default:
		return 0.7
	}
}

// weightedEdge stores a directed edge with its weight.
type weightedEdge struct {
	target string
	weight float64
}

// ScoreNodes computes a CriticalityScore for every node in the topology using
// a weighted PageRank variant.
//
// Algorithm:
//  1. Build weighted adjacency lists from edges
//  2. Run iterative PageRank (damping=0.85, max 50 iterations, convergence=0.0001)
//  3. Detect SPOFs and apply 1.5x multiplier
//  4. Normalize to 0-100 using min-max normalization
//
// Level thresholds: >=70 critical, >=40 high, >=20 medium, <20 low
func ScoreNodes(nodes []v2.TopologyNode, edges []v2.TopologyEdge) []CriticalityScore {
	if len(nodes) == 0 {
		return nil
	}

	n := len(nodes)

	// Map node IDs to indices for efficient matrix operations.
	idToIdx := make(map[string]int, n)
	idxToID := make([]string, n)
	for i := range nodes {
		id := nodes[i].ID
		idToIdx[id] = i
		idxToID[i] = id
	}

	// Build weighted adjacency: outEdges[src] = []weightedEdge
	// and compute degree counts.
	inDegree := make([]int, n)
	outDegree := make([]int, n)
	outEdges := make([][]weightedEdge, n)
	// fanIn: number of distinct sources pointing at this node
	// fanOut: number of distinct targets this node points to
	// (same as inDegree/outDegree for simple graphs, but we track them separately
	// to support future multi-edge deduplication)
	fanIn := make([]int, n)
	fanOut := make([]int, n)

	// Also build forward/inDegreeMap for SPOF detection.
	forward := make(map[string][]string, n)
	inDegreeMap := make(map[string]int, n)

	for i := range nodes {
		id := nodes[i].ID
		inDegreeMap[id] = 0
	}

	for i := range edges {
		srcID := edges[i].Source
		tgtID := edges[i].Target
		srcIdx, srcOk := idToIdx[srcID]
		tgtIdx, tgtOk := idToIdx[tgtID]
		if !srcOk || !tgtOk {
			continue // skip edges referencing unknown nodes
		}

		w := edgeWeight(edges[i].RelationshipType)
		outEdges[srcIdx] = append(outEdges[srcIdx], weightedEdge{target: tgtID, weight: w})
		outDegree[srcIdx]++
		inDegree[tgtIdx]++
		fanOut[srcIdx]++
		fanIn[tgtIdx]++
		forward[srcID] = append(forward[srcID], tgtID)
		inDegreeMap[tgtID]++
	}

	// Compute weighted out-degree (sum of outgoing edge weights) per node.
	weightedOutDeg := make([]float64, n)
	for i := 0; i < n; i++ {
		for _, e := range outEdges[i] {
			weightedOutDeg[i] += e.weight
		}
	}

	// --- PageRank iteration ---
	// PR(node) = (1-d)/N + d * sum(PR(parent) * weight(parent,node) / weightedOutDeg(parent))
	pr := make([]float64, n)
	prNext := make([]float64, n)
	initial := 1.0 / float64(n)
	for i := 0; i < n; i++ {
		pr[i] = initial
	}

	base := (1.0 - pageRankDamping) / float64(n)

	for iter := 0; iter < pageRankMaxIter; iter++ {
		for i := 0; i < n; i++ {
			prNext[i] = base
		}

		for srcIdx := 0; srcIdx < n; srcIdx++ {
			if weightedOutDeg[srcIdx] == 0 {
				// Dangling node: distribute its rank evenly (standard PageRank handling).
				share := pageRankDamping * pr[srcIdx] / float64(n)
				for j := 0; j < n; j++ {
					prNext[j] += share
				}
				continue
			}
			for _, e := range outEdges[srcIdx] {
				tgtIdx := idToIdx[e.target]
				prNext[tgtIdx] += pageRankDamping * pr[srcIdx] * e.weight / weightedOutDeg[srcIdx]
			}
		}

		// Check convergence (L1-norm).
		diff := 0.0
		for i := 0; i < n; i++ {
			diff += math.Abs(prNext[i] - pr[i])
		}
		pr, prNext = prNext, pr // swap
		if diff < pageRankConvergence {
			break
		}
	}

	// --- SPOF detection ---
	spof := make([]bool, n)
	for i := 0; i < n; i++ {
		id := idxToID[i]
		spof[i] = isSinglePointOfFailure(id, forward, inDegreeMap)
	}

	// Apply SPOF multiplier to raw PageRank.
	adjustedPR := make([]float64, n)
	copy(adjustedPR, pr)
	for i := 0; i < n; i++ {
		if spof[i] {
			adjustedPR[i] *= spofMultiplier
		}
	}

	// --- Min-max normalization to 0-100 ---
	minPR, maxPR := adjustedPR[0], adjustedPR[0]
	for i := 1; i < n; i++ {
		if adjustedPR[i] < minPR {
			minPR = adjustedPR[i]
		}
		if adjustedPR[i] > maxPR {
			maxPR = adjustedPR[i]
		}
	}

	rangePR := maxPR - minPR
	if rangePR == 0 {
		rangePR = 1 // avoid division by zero when all ranks are equal
	}

	// Build reverse index for blast radius.
	ri := BuildReverseIndex(edges)

	scores := make([]CriticalityScore, 0, n)
	for i := 0; i < n; i++ {
		id := idxToID[i]

		normalizedScore := (adjustedPR[i] - minPR) / rangePR * 100.0

		blastRadius := len(ri.GetImpact(id, 100))
		depthVal := maxDepth(id, forward, make(map[string]bool))

		scores = append(scores, CriticalityScore{
			NodeID:          id,
			Score:           normalizedScore,
			Level:           criticalityLevel(normalizedScore),
			PageRank:        pr[i],
			FanIn:           fanIn[i],
			FanOut:          fanOut[i],
			InDegree:        inDegree[i],
			OutDegree:       outDegree[i],
			BlastRadius:     blastRadius,
			DependencyDepth: depthVal,
			IsSPOF:          spof[i],
			Confidence:      "inferred",
		})
	}

	return scores
}

// maxDepth computes the longest dependency chain starting from nodeID using DFS.
func maxDepth(nodeID string, forward map[string][]string, visited map[string]bool) int {
	if visited[nodeID] {
		return 0 // cycle protection
	}
	visited[nodeID] = true
	defer func() { visited[nodeID] = false }()

	best := 0
	for _, child := range forward[nodeID] {
		d := 1 + maxDepth(child, forward, visited)
		if d > best {
			best = d
		}
	}
	return best
}

// isSinglePointOfFailure returns true if the node is the sole provider for at
// least one downstream target — i.e., removing this node would completely cut
// off access to that target.
func isSinglePointOfFailure(nodeID string, forward map[string][]string, inDegree map[string]int) bool {
	for _, target := range forward[nodeID] {
		if inDegree[target] == 1 {
			return true
		}
	}
	return false
}

// criticalityLevel maps a numeric score to a human-readable level.
func criticalityLevel(score float64) string {
	switch {
	case score >= 70:
		return "critical"
	case score >= 40:
		return "high"
	case score >= 20:
		return "medium"
	default:
		return "low"
	}
}
