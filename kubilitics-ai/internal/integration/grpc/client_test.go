package grpc

import (
	"context"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/audit"
	"github.com/kubilitics/kubilitics-ai/internal/config"
)

func TestNewClient(t *testing.T) {
	cfg := config.DefaultConfig()
	auditLog, err := audit.NewLogger(audit.DefaultConfig())
	if err != nil {
		t.Fatalf("Failed to create audit logger: %v", err)
	}
	defer auditLog.Close()

	client, err := NewClient(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}

	if client == nil {
		t.Fatal("Expected non-nil client")
	}

	if client.GetState() != StateDisconnected {
		t.Errorf("Expected initial state DISCONNECTED, got %v", client.GetState())
	}
}

func TestNewClientWithNilConfig(t *testing.T) {
	auditLog, _ := audit.NewLogger(audit.DefaultConfig())
	defer auditLog.Close()

	_, err := NewClient(nil, auditLog)
	if err == nil {
		t.Fatal("Expected error with nil config")
	}

	if err.Error() != "config is required" {
		t.Errorf("Expected 'config is required' error, got: %v", err)
	}
}

func TestNewClientWithNilAuditLog(t *testing.T) {
	cfg := config.DefaultConfig()

	_, err := NewClient(cfg, nil)
	if err == nil {
		t.Fatal("Expected error with nil audit logger")
	}

	if err.Error() != "audit logger is required" {
		t.Errorf("Expected 'audit logger is required' error, got: %v", err)
	}
}

func TestClientIsConnected(t *testing.T) {
	cfg := config.DefaultConfig()
	auditLog, _ := audit.NewLogger(audit.DefaultConfig())
	defer auditLog.Close()

	client, _ := NewClient(cfg, auditLog)

	if client.IsConnected() {
		t.Error("Expected client to not be connected initially")
	}

	// Manually set state to connected for testing
	client.mu.Lock()
	client.state = StateConnected
	client.mu.Unlock()

	if !client.IsConnected() {
		t.Error("Expected client to be connected after state change")
	}
}

func TestClientGetState(t *testing.T) {
	cfg := config.DefaultConfig()
	auditLog, _ := audit.NewLogger(audit.DefaultConfig())
	defer auditLog.Close()

	client, _ := NewClient(cfg, auditLog)

	states := []ConnectionState{
		StateDisconnected,
		StateConnecting,
		StateConnected,
		StateReconnecting,
	}

	for _, expectedState := range states {
		client.mu.Lock()
		client.state = expectedState
		client.mu.Unlock()

		if client.GetState() != expectedState {
			t.Errorf("Expected state %v, got %v", expectedState, client.GetState())
		}
	}
}

func TestClientGetStats(t *testing.T) {
	cfg := config.DefaultConfig()
	auditLog, _ := audit.NewLogger(audit.DefaultConfig())
	defer auditLog.Close()

	client, _ := NewClient(cfg, auditLog)

	stats := client.GetStats()

	if stats == nil {
		t.Fatal("Expected non-nil stats")
	}

	// Check required fields
	requiredFields := []string{
		"state",
		"connected_at",
		"connected_duration",
		"last_update",
		"total_updates",
		"reconnect_count",
		"dropped_updates",
		"backlog_size",
	}

	for _, field := range requiredFields {
		if _, ok := stats[field]; !ok {
			t.Errorf("Missing required field in stats: %s", field)
		}
	}

	// Verify initial values
	if stats["state"] != StateDisconnected {
		t.Errorf("Expected initial state DISCONNECTED, got %v", stats["state"])
	}

	if stats["total_updates"].(int64) != 0 {
		t.Errorf("Expected total_updates 0, got %v", stats["total_updates"])
	}

	if stats["reconnect_count"].(int) != 0 {
		t.Errorf("Expected reconnect_count 0, got %v", stats["reconnect_count"])
	}
}

func TestClientSetBackpressureHandler(t *testing.T) {
	cfg := config.DefaultConfig()
	auditLog, _ := audit.NewLogger(audit.DefaultConfig())
	defer auditLog.Close()

	client, _ := NewClient(cfg, auditLog)

	handlerCalled := false
	var receivedQueueSize, receivedDroppedCount int

	handler := func(queueSize int, droppedCount int) {
		handlerCalled = true
		receivedQueueSize = queueSize
		receivedDroppedCount = droppedCount
	}

	client.SetBackpressureHandler(handler)

	// Verify handler is set
	if client.backpressureHandler == nil {
		t.Fatal("Backpressure handler not set")
	}

	// Simulate backpressure
	client.backpressureHandler(100, 5)

	if !handlerCalled {
		t.Error("Backpressure handler was not called")
	}

	if receivedQueueSize != 100 {
		t.Errorf("Expected queue size 100, got %d", receivedQueueSize)
	}

	if receivedDroppedCount != 5 {
		t.Errorf("Expected dropped count 5, got %d", receivedDroppedCount)
	}
}

func TestClientReceiveUpdates(t *testing.T) {
	cfg := config.DefaultConfig()
	auditLog, _ := audit.NewLogger(audit.DefaultConfig())
	defer auditLog.Close()

	client, _ := NewClient(cfg, auditLog)

	updatesChan := client.ReceiveUpdates()
	if updatesChan == nil {
		t.Fatal("Expected non-nil updates channel")
	}

	// Verify channel is the same instance
	if updatesChan != client.updatesChan {
		t.Error("Returned channel is not the same as internal channel")
	}
}

func TestClientStateChanges(t *testing.T) {
	cfg := config.DefaultConfig()
	auditLog, _ := audit.NewLogger(audit.DefaultConfig())
	defer auditLog.Close()

	client, _ := NewClient(cfg, auditLog)

	stateChan := client.StateChanges()
	if stateChan == nil {
		t.Fatal("Expected non-nil state channel")
	}

	// Test state change notification
	go func() {
		time.Sleep(100 * time.Millisecond)
		client.mu.Lock()
		client.setState(StateConnecting)
		client.mu.Unlock()
	}()

	select {
	case state := <-stateChan:
		if state != StateConnecting {
			t.Errorf("Expected state CONNECTING, got %v", state)
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("Timeout waiting for state change notification")
	}
}

func TestConnectionStateValues(t *testing.T) {
	states := map[ConnectionState]string{
		StateDisconnected: "DISCONNECTED",
		StateConnecting:   "CONNECTING",
		StateConnected:    "CONNECTED",
		StateReconnecting: "RECONNECTING",
	}

	for state, expected := range states {
		if string(state) != expected {
			t.Errorf("Expected state value %s, got %s", expected, string(state))
		}
	}
}

func TestClientDisconnectWhenNotConnected(t *testing.T) {
	cfg := config.DefaultConfig()
	auditLog, _ := audit.NewLogger(audit.DefaultConfig())
	defer auditLog.Close()

	client, _ := NewClient(cfg, auditLog)

	ctx := context.Background()
	err := client.Disconnect(ctx)
	if err != nil {
		t.Errorf("Disconnect when not connected should not error, got: %v", err)
	}

	if client.GetState() != StateDisconnected {
		t.Errorf("Expected state DISCONNECTED after disconnect, got %v", client.GetState())
	}
}

func TestClientMethodsRequireConnection(t *testing.T) {
	cfg := config.DefaultConfig()
	auditLog, _ := audit.NewLogger(audit.DefaultConfig())
	defer auditLog.Close()

	client, _ := NewClient(cfg, auditLog)
	ctx := context.Background()

	// Test GetResource
	_, err := client.GetResource(ctx, "Pod", "default", "test")
	if err == nil || err.Error() != "not connected" {
		t.Errorf("Expected 'not connected' error, got: %v", err)
	}

	// Test ListResources
	_, err = client.ListResources(ctx, "Pod", "default", nil)
	if err == nil || err.Error() != "not connected" {
		t.Errorf("Expected 'not connected' error, got: %v", err)
	}

	// Test ExecuteCommand
	_, err = client.ExecuteCommand(ctx, "restart", nil, nil, false)
	if err == nil || err.Error() != "not connected" {
		t.Errorf("Expected 'not connected' error, got: %v", err)
	}

	// Test GetTopologyGraph
	_, err = client.GetTopologyGraph(ctx, "default", 0)
	if err == nil || err.Error() != "not connected" {
		t.Errorf("Expected 'not connected' error, got: %v", err)
	}

	// Test GetClusterHealth
	_, err = client.GetClusterHealth(ctx)
	if err == nil || err.Error() != "not connected" {
		t.Errorf("Expected 'not connected' error, got: %v", err)
	}

	// Test StreamClusterState
	err = client.StreamClusterState(ctx, nil, nil)
	if err == nil || err.Error() != "not connected" {
		t.Errorf("Expected 'not connected' error, got: %v", err)
	}
}

func TestClientStatsAfterUpdates(t *testing.T) {
	cfg := config.DefaultConfig()
	auditLog, _ := audit.NewLogger(audit.DefaultConfig())
	defer auditLog.Close()

	client, _ := NewClient(cfg, auditLog)

	// Simulate some updates
	client.mu.Lock()
	client.totalUpdates = 42
	client.droppedUpdates = 3
	client.reconnectCount = 2
	client.lastUpdate = time.Now()
	client.mu.Unlock()

	stats := client.GetStats()

	if stats["total_updates"].(int64) != 42 {
		t.Errorf("Expected total_updates 42, got %v", stats["total_updates"])
	}

	if stats["dropped_updates"].(int64) != 3 {
		t.Errorf("Expected dropped_updates 3, got %v", stats["dropped_updates"])
	}

	if stats["reconnect_count"].(int) != 2 {
		t.Errorf("Expected reconnect_count 2, got %v", stats["reconnect_count"])
	}
}
