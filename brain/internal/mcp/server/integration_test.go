package server

import (
	"context"
	"fmt"
	"testing"

	"github.com/vellankikoti/kubilitics/brain/internal/audit"
	"github.com/vellankikoti/kubilitics/brain/internal/config"
	"github.com/vellankikoti/kubilitics/brain/internal/db"
	"github.com/vellankikoti/kubilitics/brain/internal/integration/backend"
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

	// Verify Week-1 composites that replaced the retired observe_* tools are
	// present. observe_cluster_overview → triage_cluster, observe_resource →
	// inspect_pod (representative per-kind composite), observe_pod_logs →
	// search_logs.
	hasTriageCluster := false
	hasInspectPod := false
	hasSearchLogs := false

	for _, tool := range tools {
		if tool.Name == "triage_cluster" {
			hasTriageCluster = true
		}
		if tool.Name == "inspect_pod" {
			hasInspectPod = true
		}
		if tool.Name == "search_logs" {
			hasSearchLogs = true
		}
	}

	if !hasTriageCluster {
		t.Error("triage_cluster tool not registered")
	}
	if !hasInspectPod {
		t.Error("inspect_pod tool not registered")
	}
	if !hasSearchLogs {
		t.Error("search_logs tool not registered")
	}

	// Test tool execution — without a live backend the HTTP client will get a
	// connection-refused error. triage_cluster is a composite that captures
	// per-subcall errors inside its response, so whether ExecuteTool returns
	// a top-level error depends on how many subcalls degrade; either is fine
	// here (we just want the dispatch path exercised).
	args := map[string]interface{}{}
	_, err = server.ExecuteTool(ctx, "triage_cluster", args)
	if err != nil {
		t.Logf("Got expected network error (no backend running): %v", err)
	}

	// Test tool with parameters — search_logs does an HTTP list-pods call
	// up front (via observe_resources_by_query), which errors with no backend
	// and surfaces as a non-nil top-level error because no pods are found
	// and subsequent log fan-out never runs. Representative of the wiring.
	searchArgs := map[string]interface{}{
		"namespace":  "default",
		"regex":      "error",
		"cluster_id": "test-cluster",
	}
	_, err = server.ExecuteTool(ctx, "search_logs", searchArgs)
	if err != nil {
		t.Logf("search_logs returned expected error (no backend): %v", err)
	}

	// Test missing parameter validation — inspect_pod requires namespace + name
	// and rejects with a top-level error before any HTTP call.
	invalidArgs := map[string]interface{}{
		"namespace": "default",
		// missing "name"
	}
	_, err = server.ExecuteTool(ctx, "inspect_pod", invalidArgs)
	if err == nil {
		t.Error("Expected error for missing parameters, got nil")
	}

	// Verify stats after tool executions — three ExecuteTool calls above.
	stats := server.GetStats()
	if stats["total_calls"].(int64) < 3 {
		t.Errorf("Expected at least 3 total calls, got %d", stats["total_calls"])
	}
	// At minimum inspect_pod's validation error counts as a failure; other
	// composites may or may not return a top-level error depending on how
	// they aggregate partial failures, so we don't over-constrain here.
	if stats["failed_calls"].(int64) < 1 {
		t.Errorf("Expected at least 1 failed call (inspect_pod validation), got %d", stats["failed_calls"])
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
	// NOTE: "action" category is intentionally absent — action_* tools are not registered in
	// the LLM tool list (they always errored). Use execution tools (restart_pod etc.) instead.
	expectedMin := map[string]int{
		"observation":     17,
		"analysis":        24,
		"recommendation":  8,
		"troubleshooting": 7,
		"security":        5,
		"cost":            4,
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

	// Test each Week-1 observation composite. After the 2026-04-23 retirement
	// of 25 observe_* leaf tools, these composites are the public surface:
	//   observe_cluster_overview → triage_cluster
	//   observe_resource         → inspect_pod (representative per-kind)
	//   observe_pod_logs         → search_logs
	//   observe_events           → folded into triage_cluster
	//   observe_metrics          → no Wk-1 successor (Prometheus adapter is Wk-4),
	//                              subtest removed.
	observationTools := []struct {
		name string
		args map[string]interface{}
	}{
		{
			name: "triage_cluster",
			args: map[string]interface{}{},
		},
		{
			name: "inspect_pod",
			args: map[string]interface{}{
				"namespace": "default",
				"name":      "test-pod",
			},
		},
		{
			name: "search_logs",
			args: map[string]interface{}{
				"namespace": "default",
				"regex":     "error",
			},
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
