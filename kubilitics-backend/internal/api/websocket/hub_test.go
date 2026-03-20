package websocket

import (
	"context"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
)

func TestNewHub(t *testing.T) {
	ctx := context.Background()
	hub := NewHub(ctx)
	
	assert.NotNil(t, hub)
	assert.NotNil(t, hub.clients)
	assert.NotNil(t, hub.broadcast)
	assert.NotNil(t, hub.register)
	assert.NotNil(t, hub.unregister)
}

func TestHubRun(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	
	hub := NewHub(ctx)
	go hub.Run()
	
	// Wait for context to expire
	<-ctx.Done()
	
	// Hub should have stopped gracefully
}

func TestHubClientRegistration(t *testing.T) {
	ctx := context.Background()
	hub := NewHub(ctx)
	go hub.Run()
	defer hub.Stop()
	
	initialCount := hub.GetClientCount()
	assert.Equal(t, 0, initialCount)
	
	// Simulate client registration
	client := &Client{
		send: make(chan []byte, 256),
	}
	
	hub.register <- client
	
	// Give it time to process
	time.Sleep(10 * time.Millisecond)
	
	count := hub.GetClientCount()
	assert.Equal(t, 1, count)
}

func TestHubClientUnregistration(t *testing.T) {
	ctx := context.Background()
	hub := NewHub(ctx)
	go hub.Run()
	defer hub.Stop()
	
	client := &Client{
		send: make(chan []byte, 256),
	}
	
	hub.register <- client
	time.Sleep(10 * time.Millisecond)
	
	assert.Equal(t, 1, hub.GetClientCount())
	
	hub.unregister <- client
	time.Sleep(10 * time.Millisecond)
	
	assert.Equal(t, 0, hub.GetClientCount())
}

func TestHubBroadcastResourceEvent(t *testing.T) {
	ctx := context.Background()
	hub := NewHub(ctx)
	go hub.Run()
	defer hub.Stop()
	
	resource := map[string]interface{}{
		"name": "nginx-pod",
		"namespace": "default",
	}
	
	err := hub.BroadcastResourceEvent("", "", "ADDED", "Pod", resource)
	assert.NoError(t, err)
}

func TestHubBroadcastTopologyUpdate(t *testing.T) {
	ctx := context.Background()
	hub := NewHub(ctx)
	go hub.Run()
	defer hub.Stop()
	
	topology := &models.TopologyGraph{
		SchemaVersion: "1.0",
		Nodes: []models.TopologyNode{
			{ID: "pod-1", Kind: "Pod", Name: "nginx", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}},
		},
		Edges: []models.TopologyEdge{},
		Metadata: models.TopologyGraphMetadata{
			ClusterId:   "test",
			GeneratedAt: "",
			LayoutSeed:  "",
			IsComplete:  true,
			NodeCount:   1,
			EdgeCount:   0,
		},
	}
	
	err := hub.BroadcastTopologyUpdate(topology)
	assert.NoError(t, err)
}

func TestHubStop(t *testing.T) {
	ctx := context.Background()
	hub := NewHub(ctx)
	go hub.Run()
	
	// Register some clients
	for i := 0; i < 3; i++ {
		client := &Client{
			send: make(chan []byte, 256),
		}
		hub.register <- client
	}
	
	time.Sleep(10 * time.Millisecond)
	assert.Equal(t, 3, hub.GetClientCount())
	
	// Stop hub
	hub.Stop()
	time.Sleep(10 * time.Millisecond)
	
	// All clients should be disconnected
	assert.Equal(t, 0, hub.GetClientCount())
}
