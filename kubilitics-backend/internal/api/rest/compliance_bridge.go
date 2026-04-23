package rest

import (
	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/intelligence/compliance"
)

// buildComplianceData converts a GraphSnapshot into the ClusterComplianceData
// required by the compliance engine. An optional namespaceFilter scopes the
// evaluation to a single namespace; pass "" for cluster-wide evaluation.
func buildComplianceData(snap *graph.GraphSnapshot, namespaceFilter string) compliance.ClusterComplianceData {
	data := compliance.ClusterComplianceData{
		CriticalityScores: make(map[string]compliance.ScoreInfo),
		NetworkPolicies:   make(map[string]bool),
		ResourceQuotas:    make(map[string]bool),
	}

	// Derive namespace-level data from the node registry in the snapshot.
	// We check for NetworkPolicy and ResourceQuota nodes by kind.
	for _, ref := range snap.Nodes {
		if namespaceFilter != "" && ref.Namespace != namespaceFilter {
			continue
		}

		if ref.Kind == "NetworkPolicy" {
			data.NetworkPolicies[ref.Namespace] = true
		}

		// ResourceQuota nodes are not tracked in the current graph builder,
		// so this map will remain empty (all namespaces will fail CIS-5.1.1).
		// When resource-quota nodes are added to the graph, this will light up.
	}

	// Build workload infos from snapshot nodes that are workload controllers.
	workloadKinds := map[string]bool{
		"Deployment":  true,
		"StatefulSet": true,
		"DaemonSet":   true,
		"Job":         true,
		"CronJob":     true,
	}

	for key, ref := range snap.Nodes {
		if namespaceFilter != "" && ref.Namespace != namespaceFilter {
			continue
		}

		if !workloadKinds[ref.Kind] {
			continue
		}

		replicas := snap.NodeReplicas[key]
		hasPDB := snap.NodeHasPDB[key]
		hasHPA := snap.NodeHasHPA[key]
		fanIn := len(snap.Reverse[key])
		isSPOF := replicas <= 1 && fanIn > 0

		data.Workloads = append(data.Workloads, compliance.WorkloadInfo{
			Name:      ref.Name,
			Kind:      ref.Kind,
			Namespace: ref.Namespace,
			Replicas:  replicas,
			HasPDB:    hasPDB,
			HasHPA:    hasHPA,
			IsSPOF:    isSPOF,
			// HasLimits, HasRequests, Privileged are not available from the
			// graph snapshot today. When the graph builder adds container-level
			// metadata these will be populated.
			HasLimits:   false,
			HasRequests: false,
			Privileged:  false,
		})

		// Criticality score
		score := snap.NodeScores[key]
		data.CriticalityScores[key] = compliance.ScoreInfo{
			Score: score,
			Level: criticalityLevel(score),
		}
	}

	return data
}

// criticalityLevel maps a 0-100 score to a human-readable level.
func criticalityLevel(score float64) string {
	switch {
	case score >= 80:
		return "critical"
	case score >= 60:
		return "high"
	case score >= 40:
		return "medium"
	default:
		return "low"
	}
}

