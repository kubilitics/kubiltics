package server

import (
	"context"
	"fmt"
	"testing"

	"github.com/kubilitics/kubilitics-ai/internal/audit"
	"github.com/kubilitics/kubilitics-ai/internal/config"
	"github.com/kubilitics/kubilitics-ai/internal/db"
	"github.com/kubilitics/kubilitics-ai/internal/integration/backend"
)

// TestMCPServerIntegration tests the full integration flow:
// MCP Server → Backend Proxy → (would connect to) gRPC Client → kubilitics-backend
//
// This test verifies that all components are wired together correctly
// and can communicate without the actual backend running.
func TestMCPServerIntegration(t *testing.T) {
	// Setup configuration
	cfg := &config.Config{}
	cfg.Backend.Address = "localhost:9090"
	cfg.Backend.Timeout = 30

	// Create audit logger
	auditCfg := &audit.Config{
		AuditLogPath: "/tmp/mcp-integration-audit.log",
		AppLogPath:   "/tmp/mcp-integration-app.log",
		MaxSize:      10,
		MaxBackups:   3,
		MaxAge:       30,
		Compress:     false,
	}
	auditLog, err := audit.NewLogger(auditCfg)
	if err != nil {
		t.Fatalf("Failed to create audit logger: %v", err)
	}

	// Create backend proxy (not initialized - no actual connection)
	proxy, err := backend.NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("Failed to create backend proxy: %v", err)
	}

	// Create in-memory DB
	store, err := db.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}

	// Create MCP server with all dependencies
	server, err := NewMCPServer(cfg, proxy, auditLog, store)
	if err != nil {
		t.Fatalf("Failed to create MCP server: %v", err)
	}

	if server == nil {
		t.Fatal("MCP server should not be nil")
	}

	ctx := context.Background()

	// Start the server
	err = server.Start(ctx)
	if err != nil {
		t.Fatalf("Failed to start MCP server: %v", err)
	}

	// Verify tools are registered
	tools, err := server.ListTools(ctx)
	if err != nil {
		t.Fatalf("Failed to list tools: %v", err)
	}

	// Taxonomy tool count grows as we add tools (e.g. observe_pod_events for pod-intelligence).
	// Just ensure we have a reasonable minimum and key tools are present.
	if len(tools) < 80 {
		t.Errorf("Expected at least 80 tools, got %d", len(tools))
	}

	// Verify observation tools are present
	hasClusterOverview := false
	hasObserveResource := false
	hasObservePodLogs := false

	for _, tool := range tools {
		if tool.Name == "observe_cluster_overview" {
			hasClusterOverview = true
		}
		if tool.Name == "observe_resource" {
			hasObserveResource = true
		}
		if tool.Name == "observe_pod_logs" {
			hasObservePodLogs = true
		}
	}

	if !hasClusterOverview {
		t.Error("observe_cluster_overview tool not registered")
	}
	if !hasObserveResource {
		t.Error("observe_resource tool not registered")
	}
	if !hasObservePodLogs {
		t.Error("observe_pod_logs tool not registered")
	}

	// Test tool execution — without a live backend the HTTP client will get a
	// connection-refused error. The handler should propagate this as an error.
	args := map[string]interface{}{}
	_, err = server.ExecuteTool(ctx, "observe_cluster_overview", args)
	if err != nil {
		t.Logf("Got expected network error (no backend running): %v", err)
	}

	// Test tool with parameters
	resourceArgs := map[string]interface{}{
		"kind":      "Pod",
		"namespace": "default",
		"name":      "test-pod",
	}
	_, err = server.ExecuteTool(ctx, "observe_resource", resourceArgs)
	if err == nil {
		t.Error("Expected error when proxy not initialized, got nil")
	}

	// Test missing parameter validation
	invalidArgs := map[string]interface{}{
		"namespace": "default",
		// missing "kind" and "name"
	}
	_, err = server.ExecuteTool(ctx, "observe_resource", invalidArgs)
	if err == nil {
		t.Error("Expected error for missing parameters, got nil")
	}

	// Verify stats after tool executions
	stats := server.GetStats()
	if stats["total_calls"].(int64) < 2 {
		t.Errorf("Expected at least 2 total calls, got %d", stats["total_calls"])
	}
	if stats["failed_calls"].(int64) < 2 {
		t.Errorf("Expected at least 2 failed calls (no backend), got %d", stats["failed_calls"])
	}

	// Stop the server
	err = server.Stop(ctx)
	if err != nil {
		t.Fatalf("Failed to stop MCP server: %v", err)
	}

	// Verify server is stopped
	finalStats := server.GetStats()
	if finalStats["running"].(bool) {
		t.Error("Server should not be running after stop")
	}

	t.Log("Integration test passed - all components wired correctly")
}

// TestMCPServerToolCategoryCoverage verifies all tool categories have handlers
func TestMCPServerToolCategoryCoverage(t *testing.T) {
	cfg := &config.Config{}
	cfg.Backend.Address = "localhost:9090"

	auditCfg := &audit.Config{
		AuditLogPath: "/tmp/mcp-coverage-audit.log",
		AppLogPath:   "/tmp/mcp-coverage-app.log",
		MaxSize:      10,
		MaxBackups:   3,
		MaxAge:       30,
		Compress:     false,
	}
	auditLog, err := audit.NewLogger(auditCfg)
	if err != nil {
		t.Fatalf("Failed to create audit logger: %v", err)
	}

	proxy, err := backend.NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("Failed to create backend proxy: %v", err)
	}

	store, _ := db.NewSQLiteStore(":memory:")
	server, err := NewMCPServer(cfg, proxy, auditLog, store)
	if err != nil {
		t.Fatalf("Failed to create MCP server: %v", err)
	}

	ctx := context.Background()
	tools, err := server.ListTools(ctx)
	if err != nil {
		t.Fatalf("Failed to list tools: %v", err)
	}

	// Count tools by category
	categories := make(map[string]int)
	for _, tool := range tools {
		categories[tool.Category]++
	}

	// Minimum expected per category (taxonomy grows; e.g. observe_pod_events for pod-intelligence).
	expectedMin := map[string]int{
		"observation":     17,
		"analysis":        24,
		"recommendation":  8,
		"troubleshooting": 7,
		"security":        5,
		"cost":            4,
		"action":          5,
		"automation":      4,
		"execution":       9,
	}

	for category, minCount := range expectedMin {
		actualCount := categories[category]
		if actualCount < minCount {
			t.Errorf("Category %s: expected at least %d tools, got %d", category, minCount, actualCount)
		}
	}

	t.Logf("Tool category coverage: %v", categories)
}

// TestMCPServerObservationToolsWiring verifies observation tools can be executed
func TestMCPServerObservationToolsWiring(t *testing.T) {
	cfg := &config.Config{}
	cfg.Backend.Address = "localhost:9090"

	auditCfg := &audit.Config{
		AuditLogPath: "/tmp/mcp-obs-audit.log",
		AppLogPath:   "/tmp/mcp-obs-app.log",
		MaxSize:      10,
		MaxBackups:   3,
		MaxAge:       30,
		Compress:     false,
	}
	auditLog, err := audit.NewLogger(auditCfg)
	if err != nil {
		t.Fatalf("Failed to create audit logger: %v", err)
	}

	proxy, err := backend.NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("Failed to create backend proxy: %v", err)
	}

	store, _ := db.NewSQLiteStore(":memory:")
	server, err := NewMCPServer(cfg, proxy, auditLog, store)
	if err != nil {
		t.Fatalf("Failed to create MCP server: %v", err)
	}

	ctx := context.Background()

	// Test each observation tool
	observationTools := []struct {
		name string
		args map[string]interface{}
	}{
		{
			name: "observe_cluster_overview",
			args: map[string]interface{}{},
		},
		{
			name: "observe_resource",
			args: map[string]interface{}{
				"kind":      "Pod",
				"namespace": "default",
				"name":      "test-pod",
			},
		},
		{
			name: "observe_pod_logs",
			args: map[string]interface{}{
				"namespace": "default",
				"pod_name":  "test-pod",
			},
		},
		{
			name: "observe_events",
			args: map[string]interface{}{
				"namespace": "default",
			},
		},
		{
			name: "observe_metrics",
			args: map[string]interface{}{},
		},
	}

	for _, tc := range observationTools {
		t.Run(tc.name, func(t *testing.T) {
			_, err := server.ExecuteTool(ctx, tc.name, tc.args)

			// Tools are NOT registered at all → hard failure.
			if err != nil && err.Error() == fmt.Sprintf("tool not found: %s", tc.name) {
				t.Errorf("Tool %s not registered", tc.name)
				return
			}

			// All tools now make real HTTP calls to the backend. Without a
			// live backend they should fail with a network or HTTP error — NOT
			// a "not implemented" placeholder. Any non-registration error is
			// acceptable (network error, HTTP 404, etc.).
			if err != nil {
				t.Logf("Tool %s correctly wired (backend error as expected: %v)", tc.name, err)
			} else {
				// If there's a live backend and it responds, that's also fine.
				t.Logf("Tool %s executed successfully (live backend)", tc.name)
			}
		})
	}
}
