package rest

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/kubilitics/kubilitics-backend/internal/fleet"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// ---------------------------------------------------------------------------
// In-memory golden template store
// ---------------------------------------------------------------------------

// GoldenTemplate is a named set of requirements for fleet compliance scoring.
type GoldenTemplate struct {
	ID           string                    `json:"id"`
	Name         string                    `json:"name"`
	Description  string                    `json:"description"`
	Requirements fleet.TemplateRequirements `json:"requirements"`
	CreatedAt    int64                     `json:"created_at"`
	UpdatedAt    int64                     `json:"updated_at"`
}

// goldenTemplateStore is a simple in-memory store for golden templates.
// In production this would be backed by the database.
var goldenTemplateStore = struct {
	templates map[string]*GoldenTemplate
}{
	templates: make(map[string]*GoldenTemplate),
}

// ---------------------------------------------------------------------------
// 1. GET /fleet/xray/dashboard
// ---------------------------------------------------------------------------

// FleetXRayDashboard returns metrics for every registered cluster.
func (h *Handler) FleetXRayDashboard(w http.ResponseWriter, r *http.Request) {
	type dashboardEntry struct {
		fleet.ClusterMetrics
	}

	var entries []dashboardEntry
	for clusterID, engine := range h.graphEngines {
		snap := engine.Snapshot()
		if snap == nil || !snap.Status().Ready {
			continue
		}
		m := fleet.AggregateCluster(snap)
		m.ClusterID = clusterID
		entries = append(entries, dashboardEntry{ClusterMetrics: *m})
	}

	// Sort by cluster ID for deterministic output
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].ClusterID < entries[j].ClusterID
	})

	if entries == nil {
		entries = []dashboardEntry{}
	}
	respondJSON(w, http.StatusOK, entries)
}

// ---------------------------------------------------------------------------
// 2. GET /fleet/xray/clusters/{clusterId}/metrics
// ---------------------------------------------------------------------------

// FleetXRayClusterMetrics returns detailed metrics for a single cluster.
func (h *Handler) FleetXRayClusterMetrics(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	engine := h.getGraphEngine(clusterID)
	if engine == nil {
		respondError(w, http.StatusNotFound, "Cluster not found or graph engine not available")
		return
	}

	snap := engine.Snapshot()
	if snap == nil || !snap.Status().Ready {
		respondError(w, http.StatusServiceUnavailable, "Graph snapshot not ready")
		return
	}

	m := fleet.AggregateCluster(snap)
	m.ClusterID = clusterID
	respondJSON(w, http.StatusOK, m)
}

// ---------------------------------------------------------------------------
// 3. GET /fleet/xray/compare?cluster_a={id}&cluster_b={id}
// ---------------------------------------------------------------------------

// FleetXRayCompare compares two clusters dimension-by-dimension.
func (h *Handler) FleetXRayCompare(w http.ResponseWriter, r *http.Request) {
	clusterA := strings.TrimSpace(r.URL.Query().Get("cluster_a"))
	clusterB := strings.TrimSpace(r.URL.Query().Get("cluster_b"))

	if clusterA == "" || clusterB == "" {
		respondError(w, http.StatusBadRequest, "Both cluster_a and cluster_b query parameters are required")
		return
	}

	engineA := h.getGraphEngine(clusterA)
	engineB := h.getGraphEngine(clusterB)
	if engineA == nil || engineB == nil {
		respondError(w, http.StatusNotFound, "One or both clusters not found")
		return
	}

	snapA := engineA.Snapshot()
	snapB := engineB.Snapshot()
	if snapA == nil || snapB == nil || !snapA.Status().Ready || !snapB.Status().Ready {
		respondError(w, http.StatusServiceUnavailable, "One or both cluster graphs are not ready")
		return
	}

	result := fleet.Compare(snapA, snapB)
	result.ClusterA.ClusterID = clusterA
	result.ClusterB.ClusterID = clusterB
	respondJSON(w, http.StatusOK, result)
}

// ---------------------------------------------------------------------------
// 4. GET /fleet/xray/templates
// ---------------------------------------------------------------------------

// FleetXRayListTemplates returns all golden templates.
func (h *Handler) FleetXRayListTemplates(w http.ResponseWriter, _ *http.Request) {
	var templates []*GoldenTemplate
	for _, t := range goldenTemplateStore.templates {
		templates = append(templates, t)
	}
	sort.Slice(templates, func(i, j int) bool {
		return templates[i].Name < templates[j].Name
	})
	if templates == nil {
		templates = []*GoldenTemplate{}
	}
	respondJSON(w, http.StatusOK, templates)
}

// ---------------------------------------------------------------------------
// 5. POST /fleet/xray/templates
// ---------------------------------------------------------------------------

// FleetXRayCreateTemplate creates a new golden template.
func (h *Handler) FleetXRayCreateTemplate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name         string                    `json:"name"`
		Description  string                    `json:"description"`
		Requirements fleet.TemplateRequirements `json:"requirements"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid JSON body: "+err.Error())
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		respondError(w, http.StatusBadRequest, "Template name is required")
		return
	}

	now := time.Now().UnixMilli()
	tmpl := &GoldenTemplate{
		ID:           uuid.New().String(),
		Name:         body.Name,
		Description:  body.Description,
		Requirements: body.Requirements,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	goldenTemplateStore.templates[tmpl.ID] = tmpl
	respondJSON(w, http.StatusCreated, tmpl)
}

// ---------------------------------------------------------------------------
// 6. GET /fleet/xray/templates/{templateId}
// ---------------------------------------------------------------------------

// FleetXRayGetTemplate returns a single golden template.
func (h *Handler) FleetXRayGetTemplate(w http.ResponseWriter, r *http.Request) {
	templateID := mux.Vars(r)["templateId"]
	tmpl, ok := goldenTemplateStore.templates[templateID]
	if !ok {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Template not found", requestID)
		return
	}
	respondJSON(w, http.StatusOK, tmpl)
}

// ---------------------------------------------------------------------------
// 7. PUT /fleet/xray/templates/{templateId}
// ---------------------------------------------------------------------------

// FleetXRayUpdateTemplate updates an existing golden template.
func (h *Handler) FleetXRayUpdateTemplate(w http.ResponseWriter, r *http.Request) {
	templateID := mux.Vars(r)["templateId"]
	tmpl, ok := goldenTemplateStore.templates[templateID]
	if !ok {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Template not found", requestID)
		return
	}

	var body struct {
		Name         string                    `json:"name"`
		Description  string                    `json:"description"`
		Requirements fleet.TemplateRequirements `json:"requirements"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid JSON body: "+err.Error())
		return
	}

	if strings.TrimSpace(body.Name) != "" {
		tmpl.Name = body.Name
	}
	tmpl.Description = body.Description
	tmpl.Requirements = body.Requirements
	tmpl.UpdatedAt = time.Now().UnixMilli()
	respondJSON(w, http.StatusOK, tmpl)
}

// ---------------------------------------------------------------------------
// 8. DELETE /fleet/xray/templates/{templateId}
// ---------------------------------------------------------------------------

// FleetXRayDeleteTemplate deletes a golden template.
func (h *Handler) FleetXRayDeleteTemplate(w http.ResponseWriter, r *http.Request) {
	templateID := mux.Vars(r)["templateId"]
	if _, ok := goldenTemplateStore.templates[templateID]; !ok {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Template not found", requestID)
		return
	}
	delete(goldenTemplateStore.templates, templateID)
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// 9. GET /fleet/xray/templates/{templateId}/scores
// ---------------------------------------------------------------------------

// FleetXRayTemplateScores scores all registered clusters against a template.
func (h *Handler) FleetXRayTemplateScores(w http.ResponseWriter, r *http.Request) {
	templateID := mux.Vars(r)["templateId"]
	tmpl, ok := goldenTemplateStore.templates[templateID]
	if !ok {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, "Template not found", requestID)
		return
	}

	var scores []*fleet.TemplateScore
	for clusterID, engine := range h.graphEngines {
		snap := engine.Snapshot()
		if snap == nil || !snap.Status().Ready {
			continue
		}
		m := fleet.AggregateCluster(snap)
		m.ClusterID = clusterID
		score := fleet.ScoreAgainstTemplate(m, tmpl.Requirements)
		score.ClusterID = clusterID
		scores = append(scores, score)
	}

	sort.Slice(scores, func(i, j int) bool {
		return scores[i].ClusterID < scores[j].ClusterID
	})
	if scores == nil {
		scores = []*fleet.TemplateScore{}
	}
	respondJSON(w, http.StatusOK, scores)
}

// ---------------------------------------------------------------------------
// 10. GET /fleet/xray/dr?primary={id}&backup={id}
// ---------------------------------------------------------------------------

// FleetXRayDRAssessment evaluates DR readiness between primary and backup clusters.
func (h *Handler) FleetXRayDRAssessment(w http.ResponseWriter, r *http.Request) {
	primaryID := strings.TrimSpace(r.URL.Query().Get("primary"))
	backupID := strings.TrimSpace(r.URL.Query().Get("backup"))

	if primaryID == "" || backupID == "" {
		respondError(w, http.StatusBadRequest, "Both primary and backup query parameters are required")
		return
	}

	engineP := h.getGraphEngine(primaryID)
	engineB := h.getGraphEngine(backupID)
	if engineP == nil || engineB == nil {
		respondError(w, http.StatusNotFound, "One or both clusters not found")
		return
	}

	snapP := engineP.Snapshot()
	snapB := engineB.Snapshot()
	if snapP == nil || snapB == nil || !snapP.Status().Ready || !snapB.Status().Ready {
		respondError(w, http.StatusServiceUnavailable, "One or both cluster graphs are not ready")
		return
	}

	result := fleet.AssessDR(snapP, snapB)
	result.PrimaryID = primaryID
	result.BackupID = backupID
	respondJSON(w, http.StatusOK, result)
}

// ---------------------------------------------------------------------------
// 11. GET /fleet/xray/history/{clusterId}?from={date}&to={date}
// ---------------------------------------------------------------------------

// FleetXRayHistory returns historical fleet health records for a cluster.
func (h *Handler) FleetXRayHistory(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	// Parse time range
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")

	var fromMs, toMs int64

	if fromStr != "" {
		t, err := time.Parse("2006-01-02", fromStr)
		if err != nil {
			// Try as unix ms
			if ms, parseErr := strconv.ParseInt(fromStr, 10, 64); parseErr == nil {
				fromMs = ms
			} else {
				respondError(w, http.StatusBadRequest, "Invalid 'from' parameter: use YYYY-MM-DD or unix milliseconds")
				return
			}
		} else {
			fromMs = t.UnixMilli()
		}
	} else {
		// Default: 7 days ago
		fromMs = time.Now().Add(-7 * 24 * time.Hour).UnixMilli()
	}

	if toStr != "" {
		t, err := time.Parse("2006-01-02", toStr)
		if err != nil {
			if ms, parseErr := strconv.ParseInt(toStr, 10, 64); parseErr == nil {
				toMs = ms
			} else {
				respondError(w, http.StatusBadRequest, "Invalid 'to' parameter: use YYYY-MM-DD or unix milliseconds")
				return
			}
		} else {
			// End of the day
			toMs = t.Add(24*time.Hour - time.Millisecond).UnixMilli()
		}
	} else {
		toMs = time.Now().UnixMilli()
	}

	// Query the repository
	if h.repo == nil {
		// No database configured; return empty
		respondJSON(w, http.StatusOK, []models.FleetHealthRecord{})
		return
	}

	fromTime := time.UnixMilli(fromMs)
	toTime := time.UnixMilli(toMs)
	records, err := h.repo.GetFleetHealthHistory(r.Context(), clusterID, fromTime, toTime)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, "Failed to fetch health history: "+err.Error(), requestID)
		return
	}

	if records == nil {
		records = []models.FleetHealthRecord{}
	}
	respondJSON(w, http.StatusOK, records)
}
