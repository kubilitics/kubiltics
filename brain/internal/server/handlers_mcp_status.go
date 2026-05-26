package server

// Phase 7: MCP status endpoints exposing certification grades and guardrail state.
//
// Routes:
//   GET /api/v1/mcp/stats         → MCP runtime stats + certification + budget state
//   GET /api/v1/mcp/certification → certification summary (grade counts + blocked list)
//   GET /api/v1/mcp/guardrails   → guardrail config + budget snapshot

import (
	"net/http"
	"strings"
)

// handleMCPDispatch routes /api/v1/mcp/* requests.
func (s *Server) handleMCPDispatch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	mcp := s.GetMCPServer()
	if mcp == nil {
		http.Error(w, `{"error":"MCP server not available"}`, http.StatusServiceUnavailable)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/v1/mcp")
	path = strings.TrimPrefix(path, "/")

	switch path {
	case "", "stats":
		stats := mcp.GetStats()
		stats["certification"] = mcp.GetCertificationSummary()
		stats["budget"] = mcp.GetBudgetStats()
		writeJSON(w, http.StatusOK, stats)
	case "certification":
		writeJSON(w, http.StatusOK, mcp.GetCertificationSummary())
	case "guardrails":
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"guardrails": mcp.GetGuardrailsConfig(),
			"budget":     mcp.GetBudgetStats(),
		})
	default:
		http.Error(w, `{"error":"unknown mcp endpoint"}`, http.StatusNotFound)
	}
}
