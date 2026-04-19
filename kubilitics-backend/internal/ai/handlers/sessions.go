package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

type createSessionReq struct {
	FocusClusterID string `json:"focus_cluster_id"`
	Title          string `json:"title"`
}

type createSessionResp struct {
	SessionID string `json:"session_id"`
	Title     string `json:"title"`
}

// PostCreateSession handles POST /api/v1/ai/sessions. It asks the
// sidecar to allocate a new chat session (server-assigned SessionId)
// that subsequent /ai/chat WebSocket streams can reference. Honors the
// ai.enabled feature flag and validates that focus_cluster_id is set.
func (h *Handlers) PostCreateSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.cfg.Enabled {
		http.Error(w, types.ErrAIDisabled.Error(), http.StatusServiceUnavailable)
		return
	}
	var req createSessionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.FocusClusterID == "" {
		http.Error(w, types.ErrMissingCluster.Error(), http.StatusBadRequest)
		return
	}
	s, err := h.pxy.CreateSession(r.Context(), req.FocusClusterID, req.Title)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(createSessionResp{SessionID: s.SessionId, Title: s.Title})
}
