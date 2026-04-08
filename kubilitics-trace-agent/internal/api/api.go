// Package api provides the REST query API for the trace agent.
// It exposes trace and service-map data collected from the local SQLite store.
package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/kubilitics/kubilitics-trace-agent/internal/store"
)

// Handler holds a reference to the store and serves query endpoints.
type Handler struct {
	store *store.Store
}

// NewHandler creates a new Handler backed by the given store.
func NewHandler(s *store.Store) *Handler {
	return &Handler{store: s}
}

// SetupRoutes registers all query API routes on mux.
// Uses Go 1.22+ method+path patterns (e.g. "GET /traces").
func (h *Handler) SetupRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /traces", h.listTraces)
	mux.HandleFunc("GET /traces/since", h.getTracesSince)
	// Note: /traces/since must be registered before /traces/{traceId} so the
	// literal segment "since" is matched first by the Go 1.22 mux.
	mux.HandleFunc("GET /traces/{traceId}", h.getTrace)
	mux.HandleFunc("GET /services", h.getServiceMap)
	mux.HandleFunc("GET /health", h.getHealth)
}

// writeJSON sets Content-Type and encodes v as JSON.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError writes a JSON error response.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// listTraces handles GET /traces
// Query params: limit, from, to, service, status.
func (h *Handler) listTraces(w http.ResponseWriter, r *http.Request) {
	params := r.URL.Query()

	q := store.TraceQuery{
		Service: params.Get("service"),
		Status:  strings.ToUpper(params.Get("status")),
	}

	if v := params.Get("from"); v != "" {
		q.From, _ = strconv.ParseInt(v, 10, 64)
	}
	if v := params.Get("to"); v != "" {
		q.To, _ = strconv.ParseInt(v, 10, 64)
	}
	if v := params.Get("limit"); v != "" {
		q.Limit, _ = strconv.Atoi(v)
	}

	traces, err := h.store.QueryTraces(r.Context(), q)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query traces")
		return
	}

	writeJSON(w, http.StatusOK, traces)
}

// getTrace handles GET /traces/{traceId}
func (h *Handler) getTrace(w http.ResponseWriter, r *http.Request) {
	traceID := r.PathValue("traceId")
	if traceID == "" {
		writeError(w, http.StatusBadRequest, "missing traceId")
		return
	}

	detail, err := h.store.GetTrace(r.Context(), traceID)
	if err != nil {
		writeError(w, http.StatusNotFound, "trace not found")
		return
	}

	writeJSON(w, http.StatusOK, detail)
}

// getTracesSince handles GET /traces/since
// Query params: since (unix ns), limit.
func (h *Handler) getTracesSince(w http.ResponseWriter, r *http.Request) {
	params := r.URL.Query()

	var since int64
	if v := params.Get("since"); v != "" {
		since, _ = strconv.ParseInt(v, 10, 64)
	}

	limit := 100
	if v := params.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}

	traces, err := h.store.GetTracesSince(r.Context(), since, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query traces")
		return
	}

	writeJSON(w, http.StatusOK, traces)
}

// getServiceMap handles GET /services
// Query params: from, to (unix ns).
func (h *Handler) getServiceMap(w http.ResponseWriter, r *http.Request) {
	params := r.URL.Query()

	var from, to int64
	if v := params.Get("from"); v != "" {
		from, _ = strconv.ParseInt(v, 10, 64)
	}
	if v := params.Get("to"); v != "" {
		to, _ = strconv.ParseInt(v, 10, 64)
	}

	svcMap, err := h.store.GetServiceMap(r.Context(), from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get service map")
		return
	}

	writeJSON(w, http.StatusOK, svcMap)
}

// getHealth handles GET /health
func (h *Handler) getHealth(w http.ResponseWriter, r *http.Request) {
	info, err := h.store.GetHealth(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store health check failed")
		return
	}

	writeJSON(w, http.StatusOK, info)
}
