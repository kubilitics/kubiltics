package rest

import (
	"encoding/json"
	"net/http"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/presence"
)

// Type aliases so existing callers keep using rest.PresenceSnapshot etc.
// even after the shared types were extracted to internal/cluster/presence
// (to break the rest ↔ discovery import cycle that Task 2.7 would
// otherwise have created).
type (
	DiscoveredCluster = presence.DiscoveredCluster
	RegisteredCluster = presence.RegisteredCluster
	ConnectedCluster  = presence.ConnectedCluster
	PresenceSnapshot  = presence.Snapshot
)

// DiscoveryManager is the interface the presence handler talks to.
// Phase 1 uses a null stub; Phase 2 wires the real composer.
type DiscoveryManager interface {
	Snapshot() PresenceSnapshot
}

// PresenceHandler serves GET /api/v1/presence.
type PresenceHandler struct {
	mgr DiscoveryManager
}

func NewPresenceHandler(mgr DiscoveryManager) *PresenceHandler {
	return &PresenceHandler{mgr: mgr}
}

// GetSnapshot returns the current presence snapshot as JSON.
func (h *PresenceHandler) GetSnapshot(w http.ResponseWriter, r *http.Request) {
	snap := h.mgr.Snapshot()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(snap)
}
