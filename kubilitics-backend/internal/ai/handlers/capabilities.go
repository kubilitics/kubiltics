package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

// capsResponse is the JSON shape returned by GetCapabilities.
type capsResponse struct {
	Ready          bool   `json:"ready"`
	Capabilities   any    `json:"capabilities,omitempty"`
	DisabledReason string `json:"disabled_reason,omitempty"`
	State          string `json:"state"`
}

// GetCapabilities serves /api/v1/ai/capabilities. Returns the kubilitics-ai
// runtime capabilities snapshot (schema_version, providers, models, ...)
// for the requested cluster.
func (h *Handlers) GetCapabilities(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	if !h.cfg.Enabled {
		_ = json.NewEncoder(w).Encode(capsResponse{
			Ready:          false,
			DisabledReason: types.DisabledReasonAIDisabled,
			State:          "stopped",
		})
		return
	}

	clusterID := r.URL.Query().Get("cluster_id")
	if clusterID == "" {
		http.Error(w, types.ErrMissingCluster.Error(), http.StatusBadRequest)
		return
	}

	caps, err := h.pxy.Capabilities(r.Context(), clusterID)
	if err != nil {
		_ = json.NewEncoder(w).Encode(capsResponse{
			Ready:          false,
			DisabledReason: err.Error(),
			State:          "error",
		})
		return
	}
	// Honest readiness: brain process up + gRPC reachable is NOT the
	// same as "AI can answer a turn". The brain reports an empty
	// Providers list when its adapter probe says no working adapter is
	// wired (no saved config, bad creds, unreachable Ollama). Downgrade
	// ready to false so the chat status pill matches reality.
	if caps == nil || len(caps.Providers) == 0 {
		_ = json.NewEncoder(w).Encode(capsResponse{
			Ready:          false,
			Capabilities:   caps,
			DisabledReason: "no_provider_configured",
			State:          "unavailable",
		})
		return
	}
	_ = json.NewEncoder(w).Encode(capsResponse{
		Ready:        true,
		Capabilities: caps,
		State:        "ready",
	})
}
