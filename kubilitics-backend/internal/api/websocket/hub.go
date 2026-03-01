package websocket

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	_ "github.com/gorilla/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
)

const (
	// broadcastSendTimeout is the per-client grace period before disconnecting
	// a client whose send buffer is full during broadcast.
	broadcastSendTimeout = 5 * time.Second
)

// broadcastMessage wraps the raw message bytes with optional cluster scope for filtering.
type broadcastMessage struct {
	data      []byte
	clusterID string // empty = send to all clients (unscoped)
}

// Hub maintains active WebSocket connections and broadcasts messages
type Hub struct {
	// Registered clients
	clients map[*Client]bool

	// Inbound messages from clients
	broadcast chan broadcastMessage

	// Register requests from clients
	register chan *Client

	// Unregister requests from clients
	unregister chan *Client

	// Mutex for thread-safe operations
	mu sync.RWMutex

	// Context for cancellation
	ctx    context.Context
	cancel context.CancelFunc

	// Optional: invalidate topology cache when resource events are broadcast (C1.3)
	invalidateTopology func(clusterID, namespace string)
}

// NewHub creates a new WebSocket hub
func NewHub(ctx context.Context) *Hub {
	hubCtx, cancel := context.WithCancel(ctx)
	return &Hub{
		broadcast:  make(chan broadcastMessage, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[*Client]bool),
		ctx:        hubCtx,
		cancel:     cancel,
	}
}

// Run starts the hub
func (h *Hub) Run() {
	for {
		select {
		case <-h.ctx.Done():
			return

		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			metrics.WebSocketConnectionsActive.Set(float64(len(h.clients)))
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			metrics.WebSocketConnectionsActive.Set(float64(len(h.clients)))
			h.mu.Unlock()

		case msg := <-h.broadcast:
			h.mu.RLock()
			messageSize := float64(len(msg.data))
			var deadClients []*Client
			sentCount := 0
			for client := range h.clients {
				// Cluster-scoped filtering: if the message has a clusterID and the
				// client has subscribed to specific clusters, only send if matched.
				if msg.clusterID != "" && !client.AcceptsCluster(msg.clusterID) {
					continue
				}
				select {
				case client.send <- msg.data:
					metrics.WebSocketMessageSizeBytes.WithLabelValues("sent").Observe(messageSize)
					sentCount++
				default:
					// Buffer full — give client a grace period before disconnecting
					select {
					case client.send <- msg.data:
						metrics.WebSocketMessageSizeBytes.WithLabelValues("sent").Observe(messageSize)
						sentCount++
					case <-time.After(broadcastSendTimeout):
						log.Printf("ws hub: client %s send timeout after %v, disconnecting", client.id, broadcastSendTimeout)
						deadClients = append(deadClients, client)
					}
				}
			}
			h.mu.RUnlock()

			// Remove dead clients under write lock (fixes RLock mutation bug)
			if len(deadClients) > 0 {
				h.mu.Lock()
				for _, client := range deadClients {
					if _, ok := h.clients[client]; ok {
						close(client.send)
						delete(h.clients, client)
					}
				}
				metrics.WebSocketConnectionsActive.Set(float64(len(h.clients)))
				h.mu.Unlock()
			}

			if sentCount > 0 {
				metrics.WebSocketMessagesSentTotal.Add(float64(sentCount))
			}
		}
	}
}

// Stop stops the hub
func (h *Hub) Stop() {
	h.cancel()
	h.mu.Lock()
	defer h.mu.Unlock()

	// Close all client connections
	for client := range h.clients {
		close(client.send)
		delete(h.clients, client)
	}
}

// SetTopologyInvalidator sets the callback invoked when a resource event is broadcast with a cluster scope (C1.3).
// When BroadcastResourceEvent is called with non-empty clusterID, this is called so topology cache can be invalidated.
func (h *Hub) SetTopologyInvalidator(fn func(clusterID, namespace string)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.invalidateTopology = fn
}

// BroadcastResourceEvent broadcasts a resource event to all clients. If clusterID is non-empty and a topology
// invalidator is set, the cache for that scope is invalidated (C1.3).
func (h *Hub) BroadcastResourceEvent(clusterID, namespace, eventType string, resourceType string, obj interface{}) error {
	h.mu.RLock()
	inv := h.invalidateTopology
	h.mu.RUnlock()
	if inv != nil && clusterID != "" {
		inv(clusterID, namespace)
	}

	wsMsg := models.WebSocketMessage{
		Type:      "resource_update",
		Event:     eventType,
		ClusterID: clusterID,
		Resource:  map[string]interface{}{"type": resourceType, "data": obj},
		Timestamp: time.Now(),
	}

	data, err := json.Marshal(wsMsg)
	if err != nil {
		return err
	}

	select {
	case h.broadcast <- broadcastMessage{data: data, clusterID: clusterID}:
		return nil
	case <-h.ctx.Done():
		return h.ctx.Err()
	}
}

// BroadcastTopologyUpdate broadcasts a topology update
func (h *Hub) BroadcastTopologyUpdate(topology *models.TopologyGraph) error {
	wsMsg := models.WebSocketMessage{
		Type:      "topology_update",
		Event:     "updated",
		Resource:  map[string]interface{}{"topology": topology},
		Timestamp: time.Now(),
	}

	data, err := json.Marshal(wsMsg)
	if err != nil {
		return err
	}

	select {
	case h.broadcast <- broadcastMessage{data: data}:
		return nil
	case <-h.ctx.Done():
		return h.ctx.Err()
	}
}

// GetClientCount returns the number of connected clients
func (h *Hub) GetClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
