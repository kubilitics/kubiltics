package rest

import (
	"log"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// streamUpgrader is no longer used — replaced by h.newWSUpgrader() for proper origin validation.

// GetClusterOverviewStream upgrades to WebSocket and streams real-time overview updates.
// GET /api/v1/clusters/{clusterId}/overview/stream
func (h *Handler) GetClusterOverviewStream(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	// Enforce per-cluster per-user WebSocket connection limit.
	wsRelease, wsErr := h.wsAcquire(r, clusterID)
	if wsErr != nil {
		respondError(w, http.StatusTooManyRequests, wsErr.Error())
		return
	}
	defer wsRelease()

	upgrader := h.newWSUpgrader(4096, 4096)
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("overview stream: upgrade failed: %v", err)
		return
	}
	defer func() { _ = conn.Close() }()

	ctx := r.Context()
	log.Printf("overview stream: connected cluster=%s", clusterID)

	updateChan, unsubscribe, subErr := h.clusterService.Subscribe(clusterID)
	if subErr != nil {
		log.Printf("overview stream: subscribe failed cluster=%s: %v", clusterID, subErr)
		_ = conn.WriteJSON(map[string]string{"error": subErr.Error()})
		return
	}
	defer unsubscribe()

	// Pong handler: extend read deadline on pong receipt to detect dead clients
	const overviewPongWait = 75 * time.Second
	_ = conn.SetReadDeadline(time.Now().Add(overviewPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(overviewPongWait))
	})

	// Read goroutine: processes pong control frames; exits on connection close
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	// Keep-alive ticker
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-readDone:
			return
		case <-ticker.C:
			_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case overview, ok := <-updateChan:
			if !ok {
				return
			}
			_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteJSON(overview); err != nil {
				log.Printf("overview stream: write failed: %v", err)
				return
			}
		}
	}
}
