package spof

import (
	"fmt"
	"sort"
	"time"
)

// Detector builds a SPOF inventory from graph snapshot data.
type Detector struct{}

// NewDetector creates a new SPOF Detector.
func NewDetector() *Detector {
	return &Detector{}
}

// DetectInput contains the graph data needed for SPOF detection.
type DetectInput struct {
	ClusterID         string
	Nodes             []NodeInfo
	Edges             []EdgeInfo
	CriticalityScores map[string]ScoreInfo
}

// NodeInfo carries the per-resource properties extracted from a GraphSnapshot.
type NodeInfo struct {
	ID        string
	Name      string
	Kind      string
	Namespace string
	Replicas  int
	HasPDB    bool
	HasHPA    bool
}

// EdgeInfo represents a directed dependency edge.
type EdgeInfo struct {
	Source string
	Target string
	Type   string
}

// ScoreInfo carries pre-computed criticality data for a single resource.
type ScoreInfo struct {
	Score       float64
	Level       string
	FanIn       int
	FanOut      int
	IsSPOF      bool
	BlastRadius int
}

// Detect iterates graph data, enriches each SPOF with a reason and remediations,
// sorts by blast radius descending, and returns the full inventory.
func (d *Detector) Detect(input DetectInput) *SPOFInventory {
	var items []SPOFItem

	for _, node := range input.Nodes {
		scoreInfo, ok := input.CriticalityScores[node.ID]
		if !ok || !scoreInfo.IsSPOF {
			continue
		}

		reason, reasonCode := determineSPOFReason(node, scoreInfo)
		level := criticalityLevel(scoreInfo.Score)
		remediations := generateRemediations(node, scoreInfo)

		items = append(items, SPOFItem{
			Name:             node.Name,
			Kind:             node.Kind,
			Namespace:        node.Namespace,
			Reason:           reason,
			ReasonCode:       reasonCode,
			BlastRadiusScore: scoreInfo.Score,
			BlastRadiusLevel: level,
			DependentCount:   scoreInfo.FanIn,
			Remediations:     remediations,
		})
	}

	// Sort by blast radius score descending (highest risk first).
	sort.Slice(items, func(i, j int) bool {
		return items[i].BlastRadiusScore > items[j].BlastRadiusScore
	})

	// Count by severity level.
	var critical, high, medium, low int
	for _, item := range items {
		switch item.BlastRadiusLevel {
		case "critical":
			critical++
		case "high":
			high++
		case "medium":
			medium++
		case "low":
			low++
		}
	}

	// Ensure non-nil slice for JSON serialization.
	if items == nil {
		items = []SPOFItem{}
	}

	return &SPOFInventory{
		ClusterID:   input.ClusterID,
		TotalSPOFs:  len(items),
		Critical:    critical,
		High:        high,
		Medium:      medium,
		Low:         low,
		Items:       items,
		GeneratedAt: time.Now(),
	}
}

// determineSPOFReason returns a human-readable reason and a machine-parseable
// reason code explaining why a resource is classified as a SPOF.
func determineSPOFReason(node NodeInfo, score ScoreInfo) (string, string) {
	// Most specific first: critical dependency hub.
	if score.FanIn > 5 && node.Replicas <= 1 {
		return fmt.Sprintf("Critical dependency hub with single replica \u2014 %d workloads depend on this", score.FanIn),
			"critical-hub"
	}

	// Single replica without redundancy.
	if node.Replicas <= 1 {
		return "Single replica \u2014 no redundancy if this pod fails",
			"single-replica"
	}

	// No PDB (fallback: single replica case above is more common).
	if !node.HasPDB {
		return "No PodDisruptionBudget \u2014 vulnerable to voluntary disruptions",
			"no-pdb"
	}

	// Generic fallback.
	return "Single point of failure detected", "spof"
}

// generateRemediations returns ordered remediation steps for a SPOF resource.
func generateRemediations(node NodeInfo, score ScoreInfo) []Remediation {
	var rems []Remediation

	priority := "high"
	if score.FanIn > 5 {
		priority = "critical"
	}

	// 1. Scale up replicas.
	if node.Replicas <= 1 {
		rems = append(rems, Remediation{
			Type:        "scale",
			Description: "Increase replica count to at least 2 for redundancy",
			Priority:    priority,
		})
	}

	// 2. Add HPA.
	if !node.HasHPA {
		rems = append(rems, Remediation{
			Type:        "hpa",
			Description: "Add a HorizontalPodAutoscaler to scale automatically under load",
			Priority:    "high",
		})
	}

	// 3. Add PDB.
	if !node.HasPDB {
		rems = append(rems, Remediation{
			Type:        "pdb",
			Description: "Add a PodDisruptionBudget to protect against voluntary disruptions (node drains, upgrades)",
			Priority:    "high",
		})
	}

	// 4. Topology spread (always recommended for SPOFs).
	rems = append(rems, Remediation{
		Type:        "topology-spread",
		Description: "Configure topology spread constraints to distribute pods across failure domains",
		Priority:    "medium",
	})

	return rems
}

// criticalityLevel maps a numeric score (0-100) to a human-readable level.
// This mirrors graph.criticalityLevel so the SPOF package is self-contained.
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
