package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

// activeProfileResponse — flat read-only view of the brain's currently-
// configured provider/model. Used by in-cluster web mode (no Tauri) so
// the chat panel can show "AI: openai/gpt-4o-mini" or "AI: not configured"
// without going through Tauri commands. Drives the same single-source
// gating as the desktop, just over HTTP.
type activeProfileResponse struct {
	Active   bool   `json:"active"`
	Provider string `json:"provider,omitempty"`
	Model    string `json:"model,omitempty"`
	Reason   string `json:"reason,omitempty"`
	Detail   string `json:"detail,omitempty"`
}

// GetActiveProfile serves GET /api/v1/ai/active-profile. Requires
// `?cluster_id=` (same as the underlying brain capabilities call).
//
// Replaces the old GET /api/v1/ai/config which read a stale YAML file
// from disk (~/.kubilitics/ai-overrides.yaml). The disk file is deleted
// at desktop startup by the Profile migration; the file reader is gone
// from this codebase. Web mode learns about the active config only from
// the brain's runtime state — no parallel disk persistence.
func (h *Handlers) GetActiveProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	if !h.cfg.Enabled {
		_ = json.NewEncoder(w).Encode(activeProfileResponse{
			Active: false,
			Reason: types.DisabledReasonAIDisabled,
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
		_ = json.NewEncoder(w).Encode(activeProfileResponse{
			Active: false,
			Reason: "brain_unreachable",
			Detail: err.Error(),
		})
		return
	}
	if caps == nil || len(caps.Providers) == 0 {
		_ = json.NewEncoder(w).Encode(activeProfileResponse{
			Active: false,
			Reason: "not_configured",
		})
		return
	}
	provider := ""
	if len(caps.Providers) > 0 {
		provider = caps.Providers[0]
	}
	model := ""
	if len(caps.Models) > 0 {
		model = caps.Models[0]
	}
	_ = json.NewEncoder(w).Encode(activeProfileResponse{
		Active:   true,
		Provider: provider,
		Model:    model,
	})
}
