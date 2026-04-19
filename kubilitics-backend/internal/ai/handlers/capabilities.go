package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

// capsResponse is the JSON shape returned by GetCapabilities.
type capsResponse struct {
	Ready          bool   `json:"ready"`
	Capabilities   any    `json:"capabilities"`
	DisabledReason string `json:"disabled_reason,omitempty"`
	State          string `json:"state"`
}

// GetCapabilities serves /api/v1/ai/capabilities. Read-only by default — it
// returns the cached capabilities snapshot if the sidecar is already in
// StateReady, otherwise reports never_started without spawning. Pass
// ?warm=true to force a spawn on miss.
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

	warm := r.URL.Query().Get("warm") == "true"
	st := h.sup.Status()

	if warm {
		snap, err := h.pxy.GetCapabilities(r.Context(), clusterID)
		if err != nil {
			_ = json.NewEncoder(w).Encode(capsResponse{
				Ready:          false,
				DisabledReason: err.Error(),
				State:          h.sup.Status().State.String(),
			})
			return
		}
		_ = json.NewEncoder(w).Encode(capsResponse{
			Ready:        true,
			Capabilities: snap.Capabilities,
			State:        h.sup.Status().State.String(),
		})
		return
	}

	if st.State != types.StateReady {
		_ = json.NewEncoder(w).Encode(capsResponse{
			Ready:          false,
			DisabledReason: types.DisabledReasonNeverStarted,
			State:          st.State.String(),
		})
		return
	}
	snap, err := h.pxy.GetCapabilities(r.Context(), clusterID)
	if err != nil {
		_ = json.NewEncoder(w).Encode(capsResponse{
			Ready:          false,
			DisabledReason: err.Error(),
			State:          st.State.String(),
		})
		return
	}
	_ = json.NewEncoder(w).Encode(capsResponse{
		Ready:        true,
		Capabilities: snap.Capabilities,
		State:        st.State.String(),
	})
}
