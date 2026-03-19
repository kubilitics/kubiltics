package server

// handlers_backend.go — REST endpoints for backend connection status (A-CORE-008).
//
// Endpoints:
//   GET /api/v1/backend/status    — connection state + world model stats + event stats
//   GET /api/v1/backend/events    — recent events with optional filtering

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/integration/events"
)

// BackendStatusResponse is the JSON response for GET /api/v1/backend/status.
type BackendStatusResponse struct {
	Timestamp  string               `json:"timestamp"`
	Connection ConnectionStatusInfo `json:"connection"`
	WorldModel WorldModelStatusInfo `json:"world_model"`
	Events     EventStatusInfo      `json:"events"`
}

// ConnectionStatusInfo describes the gRPC/backend connection.
type ConnectionStatusInfo struct {
	State          string `json:"state"` // CONNECTED, DISCONNECTED, RECONNECTING, CONNECTING, N/A
	BackendAddress string `json:"backend_address"`
	Connected      bool   `json:"connected"`
	Message        string `json:"message,omitempty"`
}

// WorldModelStatusInfo describes the in-memory world model.
type WorldModelStatusInfo struct {
	Bootstrapped    bool           `json:"bootstrapped"`
	TotalResources  int            `json:"total_resources"`
	KindCounts      map[string]int `json:"kind_counts,omitempty"`
	NamespaceCounts map[string]int `json:"namespace_counts,omitempty"`
	LastSyncAt      string         `json:"last_sync_at,omitempty"`
}

// EventStatusInfo describes the event handler state.
type EventStatusInfo struct {
	TotalEvents     int                     `json:"total_events"`
	WarningEvents   int                     `json:"warning_events"`
	AnomalyCount    int                     `json:"anomaly_count"`
	AnomalyPatterns []events.AnomalyPattern `json:"anomaly_patterns,omitempty"`
	TopReasons      map[string]int          `json:"top_reasons,omitempty"`
	EventsByKind    map[string]int          `json:"events_by_kind,omitempty"`
}

// handleBackendStatus handles GET /api/v1/backend/status
func (s *Server) handleBackendStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	resp := BackendStatusResponse{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	// ── Connection status ──────────────────────────────────────────────────────
	if s.backendProxy != nil {
		stats := s.backendProxy.GetStats()
		state, _ := stats["state"].(string)
		if state == "" {
			state = "UNKNOWN"
		}
		addr, _ := stats["backend_address"].(string)
		connected, _ := stats["connected"].(bool)
		resp.Connection = ConnectionStatusInfo{
			State:          state,
			BackendAddress: addr,
			Connected:      connected,
		}
	} else {
		resp.Connection = ConnectionStatusInfo{
			State:   "N/A",
			Message: "Backend proxy not configured",
		}
	}

	// ── World model status ─────────────────────────────────────────────────────
	if s.backendProxy != nil {
		wmStats := s.backendProxy.GetWorldModelStats()
		wm := WorldModelStatusInfo{}
		if bootstrapped, ok := wmStats["bootstrapped"].(bool); ok {
			wm.Bootstrapped = bootstrapped
		}
		if total, ok := wmStats["total_resources"].(int); ok {
			wm.TotalResources = total
		}
		if kc, ok := wmStats["kind_counts"].(map[string]int); ok {
			wm.KindCounts = kc
		}
		if nc, ok := wmStats["namespace_counts"].(map[string]int); ok {
			wm.NamespaceCounts = nc
		}
		if ls, ok := wmStats["last_sync"].(string); ok {
			wm.LastSyncAt = ls
		}
		resp.WorldModel = wm
	}

	// ── Event stats ────────────────────────────────────────────────────────────
	if s.eventHandler != nil {
		rawStats, err := s.eventHandler.GetEventStats(r.Context())
		if err == nil {
			if es, ok := rawStats.(*events.EventStats); ok {
				resp.Events = EventStatusInfo{
					TotalEvents:     es.TotalEvents,
					WarningEvents:   es.WarningEvents,
					AnomalyCount:    es.AnomalyCount,
					AnomalyPatterns: es.AnomalyPatterns,
					TopReasons:      es.TopReasons,
					EventsByKind:    es.EventsByKind,
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleBackendEvents handles GET /api/v1/backend/events?namespace=X&kind=Y&limit=N
func (s *Server) handleBackendEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if s.eventHandler == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"events": []interface{}{},
			"count":  0,
			"note":   "event handler not configured",
		})
		return
	}

	ns := r.URL.Query().Get("namespace")
	kind := r.URL.Query().Get("kind")
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		var parsed int
		if _, err := fmt.Sscanf(l, "%d", &parsed); err == nil && parsed > 0 && parsed <= 500 {
			limit = parsed
		}
	}

	evts, err := s.eventHandler.GetRecentEvents(r.Context(), ns, kind, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"events": evts,
		"count":  len(evts),
	})
}
