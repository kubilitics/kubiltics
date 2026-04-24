package rest

import (
	"encoding/json"
	"net/http"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
)

// DiscoveredCluster is the smallest identity record — known to exist,
// not yet touched. Source indicates which DiscoverySource produced it.
type DiscoveredCluster struct {
	Identity identity.LogicalIdentity `json:"identity"`
	Source   string                   `json:"source"` // kubeconfig | secret | manual
	// LastSeenAt records when this cluster was last observed by its source.
	LastSeenAt string `json:"last_seen_at,omitempty"`
}

// RegisteredCluster adds backend-side registration details — the backend
// has parsed/stored enough to connect on demand.
type RegisteredCluster struct {
	DiscoveredCluster
	// RegisteredAt is the ISO-8601 timestamp of first registration.
	RegisteredAt string `json:"registered_at"`
	// Reachable is the last known reachability status (from preflight or
	// any cached envelope). Frontend treats this as a hint, not truth.
	Reachable bool `json:"reachable"`
}

// ConnectedCluster is registered + has an active backend session.
type ConnectedCluster struct {
	RegisteredCluster
	// ConnectedAt is when the current session began.
	ConnectedAt string `json:"connected_at"`
}

// PresenceSnapshot is the whole-world view at one instant.
type PresenceSnapshot struct {
	Discovered []DiscoveredCluster `json:"discovered"`
	Registered []RegisteredCluster `json:"registered"`
	Connected  []ConnectedCluster  `json:"connected"`
	// LastUsed is the logical identity of the most-recently-active cluster.
	LastUsed *identity.LogicalIdentity `json:"last_used,omitempty"`
}

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
