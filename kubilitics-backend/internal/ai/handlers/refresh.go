package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

// PostRefresh serves /api/v1/ai/refresh. Triggers a supervisor recycle and
// returns the new spawn ID. Returns 503 when ai.enabled=false.
func (h *Handlers) PostRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.cfg.Enabled {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": types.ErrAIDisabled.Error()})
		return
	}
	if err := h.pxy.Refresh(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"spawn_id": h.sup.CurrentSpawnID(),
	})
}
