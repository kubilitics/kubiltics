package graph

import (
	"fmt"
	"sort"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// refKey builds a canonical "Kind/Namespace/Name" key for a ResourceRef.
func refKey(r models.ResourceRef) string {
	return fmt.Sprintf("%s/%s/%s", r.Kind, r.Namespace, r.Name)
}

// GraphSnapshot is an immutable, point-in-time view of the cluster dependency graph.
// It is designed to be swapped atomically (via atomic.Value) so that all blast-radius
// queries can read without locks.
type GraphSnapshot struct {
	Nodes   map[string]models.ResourceRef // refKey -> ref
	Forward map[string]map[string]bool    // source -> targets (what I depend on)
	Reverse map[string]map[string]bool    // target -> sources (what depends on me)
	Edges   []models.BlastDependencyEdge

	NodeScores   map[string]float64           // pre-computed criticality scores
	NodeRisks    map[string][]models.RiskIndicator
	NodeReplicas map[string]int
	NodeHasHPA   map[string]bool
	NodeHasPDB   map[string]bool
	NodeIngress  map[string][]string // refKey -> ingress hosts

	TotalWorkloads int
	BuiltAt        int64         // unix ms
	BuildDuration  time.Duration
	Namespaces     map[string]bool
}

// bfsWalk performs a BFS traversal over the adjacency map starting from startKey
// and returns the set of all reachable keys (excluding startKey itself).
func bfsWalk(adj map[string]map[string]bool, startKey string) map[string]bool {
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

	delete(visited, startKey)
	return visited
}

// bfsWalkWithDepth performs a BFS traversal and returns a map of reachable keys
// to their BFS depth from startKey. startKey itself is not included.
func bfsWalkWithDepth(adj map[string]map[string]bool, startKey string) map[string]int {
	depth := make(map[string]int)
	depth[startKey] = 0
	queue := []string{startKey}

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]
		for neighbor := range adj[curr] {
			if _, seen := depth[neighbor]; !seen {
				depth[neighbor] = depth[curr] + 1
				queue = append(queue, neighbor)
			}
		}
	}

	delete(depth, startKey)
	return depth
}

// shortestPath returns the BFS shortest path from src to dst as a slice of keys,
// including both src and dst. Returns nil if no path exists.
func shortestPath(adj map[string]map[string]bool, src, dst string) []string {
	if src == dst {
		return []string{src}
	}

	parent := map[string]string{src: ""}
	queue := []string{src}

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]
		for neighbor := range adj[curr] {
			if _, seen := parent[neighbor]; !seen {
				parent[neighbor] = curr
				if neighbor == dst {
					// reconstruct
					path := []string{dst}
					for at := dst; at != src; at = parent[at] {
						path = append(path, parent[at])
					}
					// reverse
					for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
						path[i], path[j] = path[j], path[i]
					}
					return path
				}
				queue = append(queue, neighbor)
			}
		}
	}

	return nil
}

// edgeType looks up the edge type between two adjacent nodes from the Edges slice.
func (s *GraphSnapshot) edgeType(fromKey, toKey string) string {
	fromRef := s.Nodes[fromKey]
	toRef := s.Nodes[toKey]
	for _, e := range s.Edges {
		if refKey(e.Source) == refKey(fromRef) && refKey(e.Target) == refKey(toRef) {
			return e.Type
		}
	}
	return "dependency"
}

// buildFailurePath constructs the failure propagation chain from targetKey to affectedKey
// by finding the shortest path in the Reverse adjacency and building PathHops.
func (s *GraphSnapshot) buildFailurePath(targetKey, affectedKey string) []models.PathHop {
	path := shortestPath(s.Reverse, targetKey, affectedKey)
	if len(path) < 2 {
		return nil
	}

	hops := make([]models.PathHop, 0, len(path)-1)
	for i := 0; i < len(path)-1; i++ {
		fromRef := s.Nodes[path[i]]
		toRef := s.Nodes[path[i+1]]
		hops = append(hops, models.PathHop{
			From:     fromRef,
			To:       toRef,
			EdgeType: s.edgeType(path[i+1], path[i]),
			Detail:   fmt.Sprintf("%s/%s -> %s/%s", fromRef.Kind, fromRef.Name, toRef.Kind, toRef.Name),
		})
	}
	return hops
}

// ComputeBlastRadius performs the full blast-radius analysis for a target resource.
func (s *GraphSnapshot) ComputeBlastRadius(target models.ResourceRef) (*models.BlastRadiusResult, error) {
	key := refKey(target)
	if _, ok := s.Nodes[key]; !ok {
		return nil, fmt.Errorf("resource %s not found in graph", key)
	}

	// BFS reverse: what breaks if target fails
	affectedDepths := bfsWalkWithDepth(s.Reverse, key)

	// BFS forward: what target depends on
	forwardReachable := bfsWalk(s.Forward, key)

	// Direct dependents (fan-in) and dependencies (fan-out)
	fanIn := len(s.Reverse[key])
	fanOut := len(s.Forward[key])

	// Group affected by wave depth
	waveMap := make(map[int][]models.AffectedResource)
	affectedNS := make(map[string]bool)

	for aKey, depth := range affectedDepths {
		ref := s.Nodes[aKey]
		affectedNS[ref.Namespace] = true

		impact := "transitive"
		if depth == 1 {
			impact = "direct"
		}

		ar := models.AffectedResource{
			Kind:        ref.Kind,
			Name:        ref.Name,
			Namespace:   ref.Namespace,
			Impact:      impact,
			WaveDepth:   depth,
			FailurePath: s.buildFailurePath(key, aKey),
		}
		waveMap[depth] = append(waveMap[depth], ar)
	}

	// Sort wave depths
	var depths []int
	for d := range waveMap {
		depths = append(depths, d)
	}
	sort.Ints(depths)

	waves := make([]models.BlastWave, 0, len(depths))
	for _, d := range depths {
		resources := waveMap[d]
		sort.Slice(resources, func(i, j int) bool {
			return resources[i].Kind+"/"+resources[i].Namespace+"/"+resources[i].Name <
				resources[j].Kind+"/"+resources[j].Namespace+"/"+resources[j].Name
		})
		waves = append(waves, models.BlastWave{
			Depth:     d,
			Resources: resources,
		})
	}

	// Blast radius percentage
	totalAffected := len(affectedDepths)
	var blastPercent float64
	if s.TotalWorkloads > 0 {
		blastPercent = float64(totalAffected) / float64(s.TotalWorkloads) * 100.0
	}

	// Gather pre-computed data
	score := s.NodeScores[key]
	risks := s.NodeRisks[key]
	replicas := s.NodeReplicas[key]
	hasHPA := s.NodeHasHPA[key]
	hasPDB := s.NodeHasPDB[key]
	ingressHosts := s.NodeIngress[key]

	// SPOF: single replica, no HPA, and has dependents
	isSPOF := replicas <= 1 && !hasHPA && fanIn > 0

	// Staleness
	stalenessMs := time.Now().UnixMilli() - s.BuiltAt

	// Collect dependency chain edges relevant to the forward/reverse reachable sets
	var chain []models.BlastDependencyEdge
	allRelevant := make(map[string]bool)
	allRelevant[key] = true
	for k := range affectedDepths {
		allRelevant[k] = true
	}
	for k := range forwardReachable {
		allRelevant[k] = true
	}
	for _, e := range s.Edges {
		sk := refKey(e.Source)
		tk := refKey(e.Target)
		if allRelevant[sk] && allRelevant[tk] {
			chain = append(chain, e)
		}
	}

	return &models.BlastRadiusResult{
		TargetResource:     target,
		CriticalityScore:   score,
		CriticalityLevel:   criticalityLevel(score),
		BlastRadiusPercent: blastPercent,

		FanIn:              fanIn,
		FanOut:             fanOut,
		TotalAffected:      totalAffected,
		AffectedNamespaces: len(affectedNS),

		IsSPOF:           isSPOF,
		HasHPA:           hasHPA,
		HasPDB:           hasPDB,
		IsIngressExposed: len(ingressHosts) > 0,
		IngressHosts:     ingressHosts,
		ReplicaCount:     replicas,

		Waves:           waves,
		DependencyChain: chain,
		RiskIndicators:  risks,

		GraphNodeCount:   len(s.Nodes),
		GraphEdgeCount:   len(s.Edges),
		GraphStalenessMs: stalenessMs,
	}, nil
}

// criticalityLevel maps a numeric score (0-100) to a human-readable level.
func criticalityLevel(score float64) string {
	switch {
	case score >= 75:
		return "critical"
	case score >= 50:
		return "high"
	case score >= 25:
		return "medium"
	default:
		return "low"
	}
}

// GetSummary returns the top N most critical resources sorted by criticality score descending.
func (s *GraphSnapshot) GetSummary(limit int) []models.BlastRadiusSummaryEntry {
	type entry struct {
		key   string
		score float64
	}

	entries := make([]entry, 0, len(s.NodeScores))
	for k, sc := range s.NodeScores {
		entries = append(entries, entry{key: k, score: sc})
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].score > entries[j].score
	})

	if limit > 0 && limit < len(entries) {
		entries = entries[:limit]
	}

	result := make([]models.BlastRadiusSummaryEntry, 0, len(entries))
	for _, e := range entries {
		ref := s.Nodes[e.key]
		fanIn := len(s.Reverse[e.key])

		// Count affected namespaces via BFS
		affected := bfsWalk(s.Reverse, e.key)
		nsSet := make(map[string]bool)
		for aKey := range affected {
			nsSet[s.Nodes[aKey].Namespace] = true
		}

		// Blast radius percent
		var blastPct float64
		if s.TotalWorkloads > 0 {
			blastPct = float64(len(affected)) / float64(s.TotalWorkloads) * 100.0
		}

		replicas := s.NodeReplicas[e.key]
		hasHPA := s.NodeHasHPA[e.key]
		isSPOF := replicas <= 1 && !hasHPA && fanIn > 0

		result = append(result, models.BlastRadiusSummaryEntry{
			Resource:           ref,
			CriticalityScore:   e.score,
			CriticalityLevel:   criticalityLevel(e.score),
			BlastRadiusPercent: blastPct,
			FanIn:              fanIn,
			IsSPOF:             isSPOF,
			AffectedNamespaces: len(nsSet),
		})
	}
	return result
}

// Status returns the current health information of the graph.
func (s *GraphSnapshot) Status() models.GraphStatus {
	stalenessMs := time.Now().UnixMilli() - s.BuiltAt
	return models.GraphStatus{
		Ready:          len(s.Nodes) > 0,
		NodeCount:      len(s.Nodes),
		EdgeCount:      len(s.Edges),
		NamespaceCount: len(s.Namespaces),
		LastRebuildMs:  s.BuiltAt,
		StalenessMs:    stalenessMs,
	}
}
