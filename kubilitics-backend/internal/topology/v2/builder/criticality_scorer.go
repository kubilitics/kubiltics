package builder

import (
	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// CriticalityScore captures how critical a topology node is based on its
// position in the dependency graph.
type CriticalityScore struct {
	NodeID          string  `json:"nodeId"`
	Score           float64 `json:"score"`           // 0-100
	Level           string  `json:"level"`           // "critical", "high", "medium", "low"
	InDegree        int     `json:"inDegree"`        // incoming edges
	OutDegree       int     `json:"outDegree"`       // outgoing edges
	BlastRadius     int     `json:"blastRadius"`     // number of transitively impacted nodes
	DependencyDepth int     `json:"dependencyDepth"` // max depth of dependency chain
	IsSPOF          bool    `json:"isSPOF"`          // single point of failure
}

// ScoreNodes computes a CriticalityScore for every node in the topology.
//
// Scoring formula:
//   - Base = (inDegree * 3 + outDegree * 2)
//   - BlastRadius bonus = blastRadius * 2
//   - SPOF multiplier = 1.5 if only one path exists to downstream services
//   - Depth bonus = maxDependencyDepth * 1.5
//   - Cap at 100
//
// Level thresholds: >=70 critical, >=40 high, >=20 medium, <20 low
func ScoreNodes(nodes []v2.TopologyNode, edges []v2.TopologyEdge) []CriticalityScore {
	if len(nodes) == 0 {
		return nil
	}

	// Build adjacency maps
	inDegree := make(map[string]int, len(nodes))
	outDegree := make(map[string]int, len(nodes))

	// forward: source -> []target (dependencies)
	// reverse: target -> []source (dependents)
	forward := make(map[string][]string, len(nodes))
	reverse := make(map[string][]string, len(nodes))

	for i := range nodes {
		id := nodes[i].ID
		inDegree[id] = 0
		outDegree[id] = 0
	}

	for i := range edges {
		src := edges[i].Source
		tgt := edges[i].Target
		outDegree[src]++
		inDegree[tgt]++
		forward[src] = append(forward[src], tgt)
		reverse[tgt] = append(reverse[tgt], src)
	}

	// Build reverse index for blast radius computation
	ri := BuildReverseIndex(edges)

	scores := make([]CriticalityScore, 0, len(nodes))
	for i := range nodes {
		id := nodes[i].ID
		in := inDegree[id]
		out := outDegree[id]

		// Blast radius: all transitively dependent nodes (unlimited depth via large maxDepth)
		blastRadius := len(ri.GetImpact(id, 100))

		// Dependency depth: max depth of transitive dependency chain (forward traversal)
		depthVal := maxDepth(id, forward, make(map[string]bool))

		// SPOF detection: a node is a single point of failure if any of its
		// downstream targets has exactly one incoming edge (i.e., this node is
		// the only provider).
		spof := isSinglePointOfFailure(id, forward, inDegree)

		// Scoring formula
		score := float64(in*3 + out*2)    // base
		score += float64(blastRadius) * 2  // blast radius bonus
		score += float64(depthVal) * 1.5   // depth bonus

		if spof {
			score *= 1.5 // SPOF multiplier
		}

		// Cap at 100
		if score > 100 {
			score = 100
		}

		level := criticalityLevel(score)

		scores = append(scores, CriticalityScore{
			NodeID:          id,
			Score:           score,
			Level:           level,
			InDegree:        in,
			OutDegree:       out,
			BlastRadius:     blastRadius,
			DependencyDepth: depthVal,
			IsSPOF:          spof,
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
