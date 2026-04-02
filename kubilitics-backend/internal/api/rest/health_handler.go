package rest

import (
	"net/http"

	"github.com/gorilla/mux"

	"github.com/kubilitics/kubilitics-backend/internal/intelligence/health"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetClusterHealth handles GET /clusters/{clusterId}/health.
// Returns a structural health report for the cluster based on the dependency graph.
func (h *Handler) GetClusterHealth(w http.ResponseWriter, r *http.Request) {
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

	adapter := health.NewSnapshotAdapter(snap)
	report := health.ComputeHealthReport(clusterID, adapter)

	respondJSON(w, http.StatusOK, report)
}

// GetClusterRiskRanking handles GET /clusters/{clusterId}/risk-ranking.
// Returns namespace risk ranking sorted by risk score descending.
func (h *Handler) GetClusterRiskRanking(w http.ResponseWriter, r *http.Request) {
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

	adapter := health.NewSnapshotAdapter(snap)
	report := health.ComputeHealthReport(clusterID, adapter)
	ranking := health.ComputeRiskRanking(clusterID, adapter, report)

	respondJSON(w, http.StatusOK, ranking)
}
