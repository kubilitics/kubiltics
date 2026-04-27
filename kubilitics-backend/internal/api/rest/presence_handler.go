package rest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/discovery"
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
// Phase 2.7 extends it with Events to power SSE.
type DiscoveryManager interface {
	Snapshot() PresenceSnapshot
	Events(ctx context.Context) <-chan discovery.DiscoveryEvent
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

// StreamEvents serves Server-Sent Events for presence updates.
// The response is kept open for the lifetime of the request; each
// DiscoveryEvent from the manager is written as a `data: {...}\n\n` frame.
func (h *PresenceHandler) StreamEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}
	// Flush headers early so clients see the content-type immediately —
	// well-behaved SSE consumers should not have to wait for the first
	// event to confirm the stream is open.
	flusher.Flush()

	ctx := r.Context()
	ch := h.mgr.Events(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case evt, ok := <-ch:
			if !ok {
				return
			}
			b, _ := json.Marshal(evt)
			_, _ = fmt.Fprintf(w, "data: %s\n\n", b)
			flusher.Flush()
		}
	}
}
