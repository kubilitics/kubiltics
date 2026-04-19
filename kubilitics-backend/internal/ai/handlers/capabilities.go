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
	_ = json.NewEncoder(w).Encode(capsResponse{
		Ready:        true,
		Capabilities: caps,
		State:        "ready",
	})
}
