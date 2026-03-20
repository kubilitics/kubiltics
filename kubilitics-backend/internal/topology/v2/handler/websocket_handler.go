package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	"github.com/kubilitics/kubilitics-backend/internal/topology/v2/builder"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// WSMessage represents a message sent over the WebSocket connection.
type WSMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload,omitempty"`
}

// TopologyWSHandler manages WebSocket connections for real-time topology updates.
type TopologyWSHandler struct {
	cache     *v2.Cache
	collector v2.Collector
	mu        sync.RWMutex
	conns     map[*websocket.Conn]wsClient
}

type wsClient struct {
	clusterID string
	opts      v2.Options
	cancel    context.CancelFunc
}

// NewTopologyWSHandler creates a new WebSocket handler.
func NewTopologyWSHandler(cache *v2.Cache, collector v2.Collector) *TopologyWSHandler {
	if cache == nil {
		cache = v2.NewCache()
	}
	return &TopologyWSHandler{
		cache:     cache,
		collector: collector,
		conns:     make(map[*websocket.Conn]wsClient),
	}
}

// HandleWebSocket upgrades HTTP connections to WebSocket and streams topology updates.
func (h *TopologyWSHandler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	clusterID := r.PathValue("id")
	if clusterID == "" {
		http.Error(w, "missing cluster ID", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "error", err)
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	opts := v2.Options{
		ClusterID:     clusterID,
		Mode:          v2.ViewModeNamespace,
		IncludeHealth: true,
	}

	h.mu.Lock()
	h.conns[conn] = wsClient{clusterID: clusterID, opts: opts, cancel: cancel}
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		delete(h.conns, conn)
		h.mu.Unlock()
	}()

	// Send initial topology
	h.sendTopology(ctx, conn, opts)

	// Read messages from client (view mode changes, etc.)
	go h.readPump(ctx, conn, &opts)

	// Push updates at regular intervals
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.sendTopology(ctx, conn, opts)
		}
	}
}

func (h *TopologyWSHandler) readPump(ctx context.Context, conn *websocket.Conn, opts *v2.Options) {
	defer func() {
		h.mu.Lock()
		if client, ok := h.conns[conn]; ok {
			client.cancel()
		}
		h.mu.Unlock()
	}()

	for {
		select {
		case <-ctx.Done():
			return
		default:
			_, message, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
					slog.Warn("websocket read error", "error", err)
				}
				return
			}

			var msg WSMessage
			if err := json.Unmarshal(message, &msg); err != nil {
				continue
			}

			switch msg.Type {
			case "change_view":
				if payload, ok := msg.Payload.(map[string]interface{}); ok {
					if mode, ok := payload["mode"].(string); ok {
						opts.Mode = v2.ViewMode(mode)
					}
					if ns, ok := payload["namespace"].(string); ok {
						opts.Namespace = ns
					}
					if resource, ok := payload["resource"].(string); ok {
						opts.Resource = resource
					}
				}
				h.sendTopology(ctx, conn, *opts)
			case "ping":
				conn.WriteJSON(WSMessage{Type: "pong"})
			}
		}
	}
}

func (h *TopologyWSHandler) sendTopology(ctx context.Context, conn *websocket.Conn, opts v2.Options) {
	var bundle *v2.ResourceBundle
	if h.collector != nil {
		var err error
		bundle, err = h.collector.Collect(ctx, opts.ClusterID, opts.Namespace)
		if err != nil {
			conn.WriteJSON(WSMessage{Type: "error", Payload: map[string]string{"message": err.Error()}})
			return
		}
	}

	resp, err := builder.BuildGraph(ctx, opts, bundle)
	if err != nil {
		conn.WriteJSON(WSMessage{Type: "error", Payload: map[string]string{"message": err.Error()}})
		return
	}

	filter := &v2.ViewFilter{}
	resp = filter.Filter(resp, opts)

	if opts.IncludeHealth && bundle != nil {
		enricher := &v2.HealthEnricher{}
		enricher.EnrichNodes(resp.Nodes, bundle)
	}

	resp.Metadata.ResourceCount = len(resp.Nodes)
	resp.Metadata.EdgeCount = len(resp.Edges)

	conn.WriteJSON(WSMessage{Type: "topology", Payload: resp})
}

// BroadcastInvalidation notifies all connected clients for a cluster to refresh.
func (h *TopologyWSHandler) BroadcastInvalidation(clusterID string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for conn, client := range h.conns {
		if client.clusterID == clusterID {
			conn.WriteJSON(WSMessage{Type: "invalidate"})
		}
	}
}

// ConnectionCount returns the number of active WebSocket connections.
func (h *TopologyWSHandler) ConnectionCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.conns)
}
