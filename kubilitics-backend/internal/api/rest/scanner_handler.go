package rest

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/service"
)

// ScannerHandler handles /api/v1/scanner/* endpoints.
type ScannerHandler struct {
	svc service.ScannerService
}

// NewScannerHandler creates a new scanner handler.
func NewScannerHandler(svc service.ScannerService) *ScannerHandler {
	return &ScannerHandler{svc: svc}
}

// RegisterRoutes registers scanner routes on the API router.
func (h *ScannerHandler) RegisterRoutes(router *mux.Router) {
	router.HandleFunc("/scanner/runs", h.StartScan).Methods("POST")
	router.HandleFunc("/scanner/runs", h.ListRuns).Methods("GET")
	router.HandleFunc("/scanner/runs/{runId}", h.GetRun).Methods("GET")
	router.HandleFunc("/scanner/runs/{runId}/findings", h.ListRunFindings).Methods("GET")
	router.HandleFunc("/scanner/runs/{runId}/report", h.GetReport).Methods("GET")
	router.HandleFunc("/scanner/findings", h.ListAllFindings).Methods("GET")
	router.HandleFunc("/scanner/stats", h.GetStats).Methods("GET")
	router.HandleFunc("/scanner/tools", h.ListTools).Methods("GET")
}

// allowedTargetTypes restricts scan target types.
var allowedTargetTypes = map[string]bool{
	"directory":       true,
	"container_image": true,
	"helm_chart":      true,
}

// allowedReportFormats restricts report download formats.
var allowedReportFormats = map[string]string{
	"json":     "json",
	"html":     "html",
	"markdown": "markdown",
	"md":       "markdown",
}

type startScanRequest struct {
	TargetType string   `json:"target_type"`
	TargetPath string   `json:"target_path"`
	Scanners   []string `json:"scanners,omitempty"`
}

// StartScan handles POST /scanner/runs — starts a new scan asynchronously.
// Requires admin role to prevent arbitrary filesystem scanning.
func (h *ScannerHandler) StartScan(w http.ResponseWriter, r *http.Request) {
	// Require admin for scan triggering (prevents path traversal abuse)
	claims := auth.ClaimsFromContext(r.Context())
	if claims != nil && claims.Role != "admin" && claims.Role != "" {
		respondError(w, http.StatusForbidden, "Admin access required to trigger scans")
		return
	}

	var req startScanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.TargetType == "" {
		req.TargetType = "directory"
	}
	if !allowedTargetTypes[req.TargetType] {
		respondError(w, http.StatusBadRequest, "Invalid target_type; allowed: directory, container_image, helm_chart")
		return
	}

	if req.TargetPath == "" {
		req.TargetPath = "."
	}

	// Path validation: resolve to absolute and ensure it doesn't escape via traversal
	if req.TargetType == "directory" || req.TargetType == "helm_chart" {
		cleaned := filepath.Clean(req.TargetPath)
		// Block obvious path traversal attempts
		if strings.Contains(cleaned, "..") {
			respondError(w, http.StatusBadRequest, "Path traversal not allowed")
			return
		}
		// Block scanning system-sensitive directories
		abs, err := filepath.Abs(cleaned)
		if err != nil {
			respondError(w, http.StatusBadRequest, "Invalid path")
			return
		}
		for _, blocked := range []string{"/etc", "/var", "/root", "/home", "/proc", "/sys", "/dev"} {
			if strings.HasPrefix(abs, blocked) {
				respondError(w, http.StatusForbidden, "Scanning system directories is not allowed")
				return
			}
		}
		req.TargetPath = cleaned
	}

	// Validate scanner names if provided
	validScanners := map[string]bool{"trivy": true, "semgrep": true, "gitleaks": true, "kubescape": true}
	for _, s := range req.Scanners {
		if !validScanners[s] {
			respondError(w, http.StatusBadRequest, "Unknown scanner: "+s)
			return
		}
	}

	run, err := h.svc.StartScan(r.Context(), req.TargetType, req.TargetPath, req.Scanners)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to start scan: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(run)
}

// ListRuns handles GET /scanner/runs — lists scan runs with pagination.
func (h *ScannerHandler) ListRuns(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseScannerPagination(r)
	runs, total, err := h.svc.ListScanRuns(r.Context(), limit, offset)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list scan runs: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"runs":  runs,
		"total": total,
	})
}

// GetRun handles GET /scanner/runs/{runId} — gets a single scan run.
func (h *ScannerHandler) GetRun(w http.ResponseWriter, r *http.Request) {
	runID := mux.Vars(r)["runId"]
	run, err := h.svc.GetScanRun(r.Context(), runID)
	if err != nil {
		respondError(w, http.StatusNotFound, "Scan run not found")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(run)
}

// ListRunFindings handles GET /scanner/runs/{runId}/findings — findings for a specific run.
func (h *ScannerHandler) ListRunFindings(w http.ResponseWriter, r *http.Request) {
	runID := mux.Vars(r)["runId"]
	severity := r.URL.Query().Get("severity")
	tool := r.URL.Query().Get("tool")
	status := r.URL.Query().Get("status")
	limit, offset := parseScannerPagination(r)

	findings, total, err := h.svc.ListFindings(r.Context(), runID, severity, tool, status, limit, offset)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list findings: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"findings": findings,
		"total":    total,
	})
}

// ListAllFindings handles GET /scanner/findings — all findings across runs.
func (h *ScannerHandler) ListAllFindings(w http.ResponseWriter, r *http.Request) {
	severity := r.URL.Query().Get("severity")
	tool := r.URL.Query().Get("tool")
	status := r.URL.Query().Get("status")
	limit, offset := parseScannerPagination(r)

	findings, total, err := h.svc.ListAllFindings(r.Context(), severity, tool, status, limit, offset)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list findings: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"findings": findings,
		"total":    total,
	})
}

// GetStats handles GET /scanner/stats — aggregated scan statistics.
func (h *ScannerHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.svc.GetStats(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to get stats: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// GetReport handles GET /scanner/runs/{runId}/report — download scan report.
func (h *ScannerHandler) GetReport(w http.ResponseWriter, r *http.Request) {
	runID := mux.Vars(r)["runId"]
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "json"
	}

	// Whitelist format to prevent header injection
	safeFormat, ok := allowedReportFormats[format]
	if !ok {
		respondError(w, http.StatusBadRequest, "Invalid format; allowed: json, html, markdown")
		return
	}

	data, contentType, err := h.svc.GetReport(r.Context(), runID, safeFormat)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to generate report: "+err.Error())
		return
	}

	ext := safeFormat
	if ext == "markdown" {
		ext = "md"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", "attachment; filename=\"scan-report-"+runID+"."+ext+"\"")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data) //nolint:errcheck // response writer; server-generated content only
}

// ListTools handles GET /scanner/tools — lists available scanner tools.
func (h *ScannerHandler) ListTools(w http.ResponseWriter, r *http.Request) {
	tools := h.svc.AvailableTools()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tools": tools,
	})
}

// parseScannerPagination extracts limit/offset from query params (scanner-specific to avoid naming conflicts).
func parseScannerPagination(r *http.Request) (limit, offset int) {
	limit = 50
	offset = 0
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 && l <= 500 {
		limit = l
	}
	if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && o >= 0 {
		offset = o
	}
	return
}
