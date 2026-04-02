package health

import (
	"fmt"
	"sort"
	"time"
)

// Risk level thresholds (inverse of health).
const (
	riskThresholdCritical = 75.0
	riskThresholdHigh     = 55.0
	riskThresholdMedium   = 30.0
)

// riskLevel maps a risk score (0-100) to a human-readable level.
func riskLevel(score float64) string {
	switch {
	case score > riskThresholdCritical:
		return "critical"
	case score >= riskThresholdHigh:
		return "high"
	case score >= riskThresholdMedium:
		return "medium"
	default:
		return "low"
	}
}

// ComputeRiskRanking derives the namespace risk ranking from the health report
// and enriches it with SPOF counts, blast radius data, and cross-NS dependency counts.
func ComputeRiskRanking(clusterID string, data ClusterData, report *HealthReport) *RiskRanking {
	edges := data.GetEdges()
	nsRisks := make([]NamespaceRisk, 0, len(report.Namespaces))

	for _, nh := range report.Namespaces {
		riskScore := 100.0 - nh.Score

		// Count SPOFs in namespace.
		workloads := data.GetWorkloadsInNamespace(nh.Namespace)
		spofCount := 0
		for _, w := range workloads {
			if w.IsSPOF {
				spofCount++
			}
		}

		// Average blast radius: average fan-in for workloads in namespace.
		scores := data.GetCriticalityScores()
		var blastSum float64
		var blastCount int
		for _, w := range workloads {
			if info, ok := scores[w.Key]; ok {
				blastSum += float64(info.FanIn)
				blastCount++
			}
		}
		avgBlast := 0.0
		if blastCount > 0 {
			avgBlast = blastSum / float64(blastCount)
		}

		// Cross-NS dependencies.
		crossNS, _ := countCrossNSDeps(nh.Namespace, edges)

		// Top risks from components with lowest scores.
		topRisks := buildTopRisks(nh.Components)

		nsRisks = append(nsRisks, NamespaceRisk{
			Namespace:           nh.Namespace,
			RiskScore:           riskScore,
			Level:               riskLevel(riskScore),
			SPOFCount:           spofCount,
			AvgBlastRadius:      avgBlast,
			CrossNSDependencies: crossNS,
			WorkloadCount:       nh.WorkloadCount,
			TopRisks:            topRisks,
		})
	}

	// Sort by risk score descending.
	sort.Slice(nsRisks, func(i, j int) bool {
		return nsRisks[i].RiskScore > nsRisks[j].RiskScore
	})

	return &RiskRanking{
		ClusterID:   clusterID,
		Namespaces:  nsRisks,
		GeneratedAt: time.Now(),
	}
}

// buildTopRisks generates human-readable risk descriptions from the worst-scoring components.
func buildTopRisks(components []ComponentScore) []string {
	if len(components) == 0 {
		return []string{}
	}

	// Sort a copy by score ascending (worst first).
	sorted := make([]ComponentScore, len(components))
	copy(sorted, components)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Score < sorted[j].Score
	})

	var risks []string
	for _, c := range sorted {
		if c.Score >= 0.8 {
			break // good enough, skip
		}
		desc := componentRiskDescription(c)
		if desc != "" {
			risks = append(risks, desc)
		}
		if len(risks) >= 3 {
			break
		}
	}

	if risks == nil {
		return []string{}
	}
	return risks
}

// componentRiskDescription returns a human-readable risk description for a low-scoring component.
func componentRiskDescription(c ComponentScore) string {
	pct := int((1.0 - c.Score) * 100)
	switch c.Name {
	case "spof_density":
		return fmt.Sprintf("%d%% of workloads are single points of failure", pct)
	case "pdb_coverage":
		return fmt.Sprintf("%d%% of workloads lack a PodDisruptionBudget", pct)
	case "hpa_coverage":
		return fmt.Sprintf("%d%% of scalable workloads lack an HPA", pct)
	case "redundancy_ratio":
		return fmt.Sprintf("replica redundancy is at %.0f%% of target", c.Score*100)
	case "dependency_depth":
		return "deep dependency chains increase cascading failure risk"
	case "cross_ns_risk":
		return fmt.Sprintf("%d%% of dependencies cross namespace boundaries", pct)
	default:
		return ""
	}
}
