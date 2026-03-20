package rest

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// HealthzHandler handles health check endpoints
type HealthzHandler struct {
	repo *repository.SQLiteRepository
}

// NewHealthzHandler creates a new healthz handler
func NewHealthzHandler(repo *repository.SQLiteRepository) *HealthzHandler {
	return &HealthzHandler{repo: repo}
}

// Live handles GET /healthz/live - liveness probe (process is alive)
func (h *HealthzHandler) Live(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status": "ok",
	})
}

// Ready handles GET /healthz/ready - readiness probe (dependencies are healthy)
func (h *HealthzHandler) Ready(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	// Check database connectivity
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	
	if h.repo != nil {
		if err := h.repo.Ping(ctx); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status": "unhealthy",
				"reason": "database_unavailable",
				"error":  err.Error(),
			})
			return
		}
	}
	
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status": "ok",
	})
}
