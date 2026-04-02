package rest

import (
	"net/http"
	"strings"

	"github.com/gorilla/mux"

	"github.com/kubilitics/kubilitics-backend/internal/intelligence/spof"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetSPOFInventory handles GET /clusters/{clusterId}/spofs.
// It reads the graph snapshot, runs SPOF detection, applies optional filters
// (namespace, kind, severity), and returns the enriched SPOF inventory.
func (h *Handler) GetSPOFInventory(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	engine := h.getOrStartGraphEngine(r, clusterID)
	if engine == nil {
		respondError(w, http.StatusServiceUnavailable, "Graph engine not available for this cluster")
		return
	}

	snap := engine.Snapshot()
	if !snap.Status().Ready {
		respondError(w, http.StatusServiceUnavailable, "Dependency graph is still building")
		return
	}

	// Build DetectInput from the graph snapshot.
	nodes := make([]spof.NodeInfo, 0, len(snap.Nodes))
	scores := make(map[string]spof.ScoreInfo, len(snap.Nodes))

	for key, ref := range snap.Nodes {
		fanIn := len(snap.Reverse[key])
		fanOut := len(snap.Forward[key])
		replicas := snap.NodeReplicas[key]
		hasHPA := snap.NodeHasHPA[key]
		hasPDB := snap.NodeHasPDB[key]

		// Match the graph engine's SPOF determination: replicas <= 1 && !hasHPA && fanIn > 0
		isSPOF := replicas <= 1 && !hasHPA && fanIn > 0

		nodes = append(nodes, spof.NodeInfo{
			ID:        key,
			Name:      ref.Name,
			Kind:      ref.Kind,
			Namespace: ref.Namespace,
			Replicas:  replicas,
			HasPDB:    hasPDB,
			HasHPA:    hasHPA,
		})

		scores[key] = spof.ScoreInfo{
			Score:  snap.NodeScores[key],
			Level:  criticalityLevelFromScore(snap.NodeScores[key]),
			FanIn:  fanIn,
			FanOut: fanOut,
			IsSPOF: isSPOF,
		}
	}

	input := spof.DetectInput{
		ClusterID:         clusterID,
		Nodes:             nodes,
		CriticalityScores: scores,
	}

	detector := spof.NewDetector()
	inventory := detector.Detect(input)

	// Apply optional query-param filters.
	nsFilter := strings.TrimSpace(r.URL.Query().Get("namespace"))
	kindFilter := strings.TrimSpace(r.URL.Query().Get("kind"))
	severityFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("severity")))

	if nsFilter != "" || kindFilter != "" || severityFilter != "" {
		filtered := make([]spof.SPOFItem, 0, len(inventory.Items))
		for _, item := range inventory.Items {
			if nsFilter != "" && item.Namespace != nsFilter {
				continue
			}
			if kindFilter != "" && !strings.EqualFold(item.Kind, kindFilter) {
				continue
			}
			if severityFilter != "" && item.BlastRadiusLevel != severityFilter {
				continue
			}
			filtered = append(filtered, item)
		}

		// Recount severity buckets after filtering.
		var critical, high, medium, low int
		for _, item := range filtered {
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

		inventory.Items = filtered
		inventory.TotalSPOFs = len(filtered)
		inventory.Critical = critical
		inventory.High = high
		inventory.Medium = medium
		inventory.Low = low
	}

	respondJSON(w, http.StatusOK, inventory)
}

// criticalityLevelFromScore mirrors graph.criticalityLevel (unexported).
func criticalityLevelFromScore(score float64) string {
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
