package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

// GetStatus serves /api/v1/ai/status. When ai.enabled=false the snapshot's
// DisabledReason is overridden with ai_disabled so the UI can render the
// correct gating message even before any spawn attempt.
func (h *Handlers) GetStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	st := h.sup.Status()
	if !h.cfg.Enabled {
		st.DisabledReason = types.DisabledReasonAIDisabled
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(st)
}
