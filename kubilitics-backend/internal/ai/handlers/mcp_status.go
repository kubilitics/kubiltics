package handlers

// Phase 7: MCP status proxy handlers.
//
// These handlers forward requests from the frontend to the brain's
// /api/v1/mcp/* endpoints, keeping the frontend decoupled from the
// brain's direct HTTP address.
//
// Routes (registered in Register):
//   GET /api/v1/ai/mcp/stats         → brain /api/v1/mcp/stats
//   GET /api/v1/ai/mcp/certification → brain /api/v1/mcp/certification
//   GET /api/v1/ai/mcp/guardrails   → brain /api/v1/mcp/guardrails

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

// jsonError writes a properly encoded JSON error body so error strings
// containing quotes or backslashes don't produce invalid JSON.
func jsonError(w http.ResponseWriter, msg string, code int) {
	body, _ := json.Marshal(map[string]string{"error": msg})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = w.Write(body)
}

// HandleMCPStatus proxies /api/v1/ai/mcp/* to the brain's /api/v1/mcp/* endpoints.
func (h *Handlers) HandleMCPStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.cfg.Enabled {
		jsonError(w, types.DisabledReasonAIDisabled, http.StatusServiceUnavailable)
		return
	}

	// Map /api/v1/ai/mcp/X → /api/v1/mcp/X on the brain.
	suffix := strings.TrimPrefix(r.URL.Path, "/api/v1/ai/mcp")
	if suffix == "" {
		suffix = "/stats"
	}
	brainPath := "/api/v1/mcp" + suffix

	data, err := h.pxy.GetMCPEndpoint(r.Context(), brainPath)
	if err != nil {
		jsonError(w, "brain unavailable: "+err.Error(), http.StatusBadGateway)
		return
	}
	_ = json.NewEncoder(w).Encode(data)
}
