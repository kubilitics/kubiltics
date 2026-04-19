package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

type statusResponse struct {
	State          string   `json:"state"`
	Version        string   `json:"version,omitempty"`
	Engines        []string `json:"engines,omitempty"`
	DisabledReason string   `json:"disabled_reason,omitempty"`
	LastError      string   `json:"last_error,omitempty"`
}

// GetStatus serves /api/v1/ai/status. When ai.enabled=false it returns
// disabled_reason=ai_disabled without contacting the runtime.
func (h *Handlers) GetStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if !h.cfg.Enabled {
		_ = json.NewEncoder(w).Encode(statusResponse{
			State:          "stopped",
			DisabledReason: types.DisabledReasonAIDisabled,
		})
		return
	}
	st, err := h.pxy.Status(r.Context())
	if err != nil {
		_ = json.NewEncoder(w).Encode(statusResponse{
			State:     "error",
			LastError: err.Error(),
		})
		return
	}
	_ = json.NewEncoder(w).Encode(statusResponse{
		State:   st.State,
		Version: st.Version,
		Engines: st.Engines,
	})
}
