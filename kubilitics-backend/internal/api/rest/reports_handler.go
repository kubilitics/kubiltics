package rest

import (
	"net/http"

	"github.com/gorilla/mux"

	"github.com/kubilitics/kubilitics-backend/internal/intelligence/reports"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetResilienceReport handles POST /clusters/{clusterId}/reports/resilience.
// It aggregates data from the graph engine snapshot to produce a full resilience report.
// Optional query param: format=pdf|json (default: json).
func (h *Handler) GetResilienceReport(w http.ResponseWriter, r *http.Request) {
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
		respondError(w, http.StatusServiceUnavailable, "Dependency graph is still building — try again shortly")
		return
	}

	// Resolve cluster name from the cluster service
	clusterName := clusterID
	clusters, err := h.clusterService.ListClusters(r.Context())
	if err == nil {
		for _, c := range clusters {
			if c.ID == clusterID {
				clusterName = c.Name
				break
			}
		}
	}

	gen := reports.NewGenerator()
	report, err := gen.GenerateReport(reports.ReportInput{
		ClusterID:   clusterID,
		ClusterName: clusterName,
		Snapshot:    snap,
	})
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to generate report: "+err.Error())
		return
	}

	// Check requested format
	format := r.URL.Query().Get("format")
	if format == "pdf" {
		data, err := reports.FormatForPDF(report)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to format report for PDF: "+err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write(data) // nosemgrep: go.lang.security.audit.xss.no-direct-write-to-responsewriter.no-direct-write-to-responsewriter
		return
	}

	respondJSON(w, http.StatusOK, report)
}
