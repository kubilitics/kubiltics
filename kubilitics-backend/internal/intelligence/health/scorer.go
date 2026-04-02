package health

import (
	"fmt"
	"math"
)

// Component weights for the structural health score.
const (
	weightSPOFDensity    = 0.25
	weightPDBCoverage    = 0.20
	weightHPACoverage    = 0.15
	weightRedundancy     = 0.20
	weightDepDepth       = 0.10
	weightCrossNSRisk    = 0.10
	maxPossibleDepth     = 10
)

// Health level thresholds.
const (
	thresholdHealthy  = 80.0
	thresholdWarning  = 50.0
	thresholdDegraded = 25.0
)

// healthLevel maps a health score (0-100) to a human-readable level.
func healthLevel(score float64) string {
	switch {
	case score >= thresholdHealthy:
		return "healthy"
	case score >= thresholdWarning:
		return "warning"
	case score >= thresholdDegraded:
		return "degraded"
	default:
		return "critical"
	}
}

// ComputeHealthReport calculates the full structural health report for a cluster.
func ComputeHealthReport(clusterID string, data ClusterData) *HealthReport {
	namespaces := data.GetNamespaces()
	edges := data.GetEdges()

	nsHealths := make([]NamespaceHealth, 0, len(namespaces))

	for _, ns := range namespaces {
		nh := computeNamespaceHealth(ns, data, edges)
		nsHealths = append(nsHealths, nh)
	}

	// Cluster score = weighted average of namespace scores, weighted by workload count.
	clusterScore, clusterComponents := aggregateClusterScore(nsHealths)

	return &HealthReport{
		ClusterID:  clusterID,
		Score:      clusterScore,
		Level:      healthLevel(clusterScore),
		Components: clusterComponents,
		Namespaces: nsHealths,
	}
}

// computeNamespaceHealth computes the health score for a single namespace.
func computeNamespaceHealth(ns string, data ClusterData, allEdges []EdgeInfo) NamespaceHealth {
	workloads := data.GetWorkloadsInNamespace(ns)
	total := len(workloads)

	// Empty namespace is perfectly healthy (no risk).
	if total == 0 {
		return NamespaceHealth{
			Namespace:     ns,
			Score:         100.0,
			Level:         "healthy",
			Components:    emptyComponents(),
			WorkloadCount: 0,
		}
	}

	// Count various workload properties.
	var spofCount, pdbCount, hpaCount, scalableCount int
	var replicaSum, replicaCount int

	for _, w := range workloads {
		if w.IsSPOF {
			spofCount++
		}
		if w.HasPDB {
			pdbCount++
		}
		if w.IsScalable {
			scalableCount++
			if w.HasHPA {
				hpaCount++
			}
		}
		if w.Replicas > 0 {
			target := w.Replicas
			if target < 2 {
				target = 2
			}
			ratio := float64(w.Replicas) / float64(target)
			if ratio > 1.0 {
				ratio = 1.0
			}
			replicaSum += int(ratio * 1000) // fixed-point to avoid float accumulation
			replicaCount++
		}
	}

	// --- Component 1: SPOF density ---
	spofDensity := 1.0 - float64(spofCount)/float64(total)

	// --- Component 2: PDB coverage ---
	pdbCoverage := 0.0
	if total > 0 {
		pdbCoverage = float64(pdbCount) / float64(total)
	}

	// --- Component 3: HPA coverage ---
	hpaCoverage := 1.0 // default if no scalable workloads
	if scalableCount > 0 {
		hpaCoverage = float64(hpaCount) / float64(scalableCount)
	}

	// --- Component 4: Redundancy ratio ---
	redundancy := 1.0
	if replicaCount > 0 {
		redundancy = float64(replicaSum) / float64(replicaCount) / 1000.0
	}

	// --- Component 5: Dependency depth ---
	maxCritPath := computeMaxCriticalPathLength(ns, data)
	depDepth := 1.0 - float64(maxCritPath)/float64(maxPossibleDepth)
	if depDepth < 0 {
		depDepth = 0
	}

	// --- Component 6: Cross-NS risk ---
	crossNSCount, totalDeps := countCrossNSDeps(ns, allEdges)
	crossNSRisk := 1.0
	if totalDeps > 0 {
		crossNSRisk = 1.0 - float64(crossNSCount)/float64(totalDeps)
	}

	components := []ComponentScore{
		{
			Name:   "spof_density",
			Score:  spofDensity,
			Weight: weightSPOFDensity,
			Detail: fmt.Sprintf("%d of %d workloads are single points of failure", spofCount, total),
		},
		{
			Name:   "pdb_coverage",
			Score:  pdbCoverage,
			Weight: weightPDBCoverage,
			Detail: fmt.Sprintf("%d of %d workloads have a PodDisruptionBudget", pdbCount, total),
		},
		{
			Name:   "hpa_coverage",
			Score:  hpaCoverage,
			Weight: weightHPACoverage,
			Detail: fmt.Sprintf("%d of %d scalable workloads have an HPA", hpaCount, scalableCount),
		},
		{
			Name:   "redundancy_ratio",
			Score:  redundancy,
			Weight: weightRedundancy,
			Detail: fmt.Sprintf("average replica redundancy ratio: %.2f", redundancy),
		},
		{
			Name:   "dependency_depth",
			Score:  depDepth,
			Weight: weightDepDepth,
			Detail: fmt.Sprintf("max critical path length: %d (capped at %d)", maxCritPath, maxPossibleDepth),
		},
		{
			Name:   "cross_ns_risk",
			Score:  crossNSRisk,
			Weight: weightCrossNSRisk,
			Detail: fmt.Sprintf("%d of %d dependencies cross namespace boundaries", crossNSCount, totalDeps),
		},
	}

	score := computeWeightedScore(components)

	return NamespaceHealth{
		Namespace:     ns,
		Score:         score,
		Level:         healthLevel(score),
		Components:    components,
		WorkloadCount: total,
	}
}

// computeWeightedScore computes the weighted average of component scores, scaled to 0-100.
func computeWeightedScore(components []ComponentScore) float64 {
	totalWeight := 0.0
	weightedSum := 0.0
	for _, c := range components {
		weightedSum += c.Score * c.Weight
		totalWeight += c.Weight
	}
	if totalWeight == 0 {
		return 100.0
	}
	return math.Round((weightedSum/totalWeight)*10000) / 100 // 0-100, 2 decimal places
}

// aggregateClusterScore computes the cluster-wide score from namespace scores,
// weighted by workload count. Also returns cluster-level aggregate components.
func aggregateClusterScore(nsHealths []NamespaceHealth) (float64, []ComponentScore) {
	totalWorkloads := 0
	weightedSum := 0.0

	// Aggregate component scores across namespaces.
	componentSums := make(map[string]float64)
	componentWeights := make(map[string]float64)
	componentNames := []string{
		"spof_density", "pdb_coverage", "hpa_coverage",
		"redundancy_ratio", "dependency_depth", "cross_ns_risk",
	}

	for _, nh := range nsHealths {
		w := float64(nh.WorkloadCount)
		if w == 0 {
			w = 1 // empty namespace contributes minimally
		}
		totalWorkloads += nh.WorkloadCount
		weightedSum += nh.Score * w

		for _, c := range nh.Components {
			componentSums[c.Name] += c.Score * w
			componentWeights[c.Name] += w
		}
	}

	var clusterScore float64
	if totalWorkloads == 0 {
		clusterScore = 100.0
	} else {
		clusterScore = math.Round(weightedSum/float64(totalWorkloads)*100) / 100
	}

	// Build cluster-level component averages.
	components := make([]ComponentScore, 0, len(componentNames))
	for _, name := range componentNames {
		total := componentWeights[name]
		score := 1.0
		if total > 0 {
			score = componentSums[name] / total
		}
		weight := lookupWeight(name)
		components = append(components, ComponentScore{
			Name:   name,
			Score:  math.Round(score*1000) / 1000,
			Weight: weight,
			Detail: fmt.Sprintf("cluster-wide average for %s", name),
		})
	}

	return clusterScore, components
}

// lookupWeight returns the weight for a component name.
func lookupWeight(name string) float64 {
	switch name {
	case "spof_density":
		return weightSPOFDensity
	case "pdb_coverage":
		return weightPDBCoverage
	case "hpa_coverage":
		return weightHPACoverage
	case "redundancy_ratio":
		return weightRedundancy
	case "dependency_depth":
		return weightDepDepth
	case "cross_ns_risk":
		return weightCrossNSRisk
	default:
		return 0
	}
}

// computeMaxCriticalPathLength finds the longest dependency chain within a namespace
// using BFS from each workload.
func computeMaxCriticalPathLength(ns string, data ClusterData) int {
	workloads := data.GetWorkloadsInNamespace(ns)
	edges := data.GetEdges()

	// Build adjacency for workloads in this namespace.
	adj := make(map[string][]string)
	nsWorkloadSet := make(map[string]bool)
	for _, w := range workloads {
		nsWorkloadSet[w.Key] = true
	}

	for _, e := range edges {
		if e.SourceNamespace == ns && e.TargetNamespace == ns {
			if nsWorkloadSet[e.SourceKey] && nsWorkloadSet[e.TargetKey] {
				adj[e.SourceKey] = append(adj[e.SourceKey], e.TargetKey)
			}
		}
	}

	maxDepth := 0
	for _, w := range workloads {
		depth := bfsMaxDepth(adj, w.Key)
		if depth > maxDepth {
			maxDepth = depth
		}
	}
	return maxDepth
}

// bfsMaxDepth finds the longest shortest path from start to any reachable node.
func bfsMaxDepth(adj map[string][]string, start string) int {
	visited := map[string]bool{start: true}
	queue := []string{start}
	depthMap := map[string]int{start: 0}
	maxDepth := 0

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]
		for _, next := range adj[curr] {
			if !visited[next] {
				visited[next] = true
				d := depthMap[curr] + 1
				depthMap[next] = d
				if d > maxDepth {
					maxDepth = d
				}
				queue = append(queue, next)
			}
		}
	}
	return maxDepth
}

// countCrossNSDeps counts edges involving the given namespace that cross namespace boundaries,
// and the total edges involving the namespace.
func countCrossNSDeps(ns string, edges []EdgeInfo) (crossNS, total int) {
	for _, e := range edges {
		if e.SourceNamespace == ns || e.TargetNamespace == ns {
			total++
			if e.SourceNamespace != e.TargetNamespace {
				crossNS++
			}
		}
	}
	return
}

// emptyComponents returns perfect-score components for empty namespaces.
func emptyComponents() []ComponentScore {
	return []ComponentScore{
		{Name: "spof_density", Score: 1.0, Weight: weightSPOFDensity, Detail: "no workloads"},
		{Name: "pdb_coverage", Score: 1.0, Weight: weightPDBCoverage, Detail: "no workloads"},
		{Name: "hpa_coverage", Score: 1.0, Weight: weightHPACoverage, Detail: "no workloads"},
		{Name: "redundancy_ratio", Score: 1.0, Weight: weightRedundancy, Detail: "no workloads"},
		{Name: "dependency_depth", Score: 1.0, Weight: weightDepDepth, Detail: "no workloads"},
		{Name: "cross_ns_risk", Score: 1.0, Weight: weightCrossNSRisk, Detail: "no workloads"},
	}
}
