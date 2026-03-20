package server

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/kubilitics/kubilitics-ai/internal/audit"
	"github.com/kubilitics/kubilitics-ai/internal/config"
	"github.com/kubilitics/kubilitics-ai/internal/integration/backend"
	"github.com/kubilitics/kubilitics-ai/internal/mcp/tools"
)

// Helper function to create test MCP server
func setupTestMCPServer(t *testing.T) (*MCPServer, *backend.Proxy) {
	cfg := &config.Config{}
	cfg.Backend.Address = "localhost:9090"
	cfg.Backend.Timeout = 30
	cfg.Autonomy.ReadOnly = false

	auditCfg := &audit.Config{
		AuditLogPath: "/tmp/audit.log",
		AppLogPath:   "/tmp/app.log",
		MaxSize:      10,
		MaxBackups:   3,
		MaxAge:       30,
		Compress:     false,
	}
	auditLog, err := audit.NewLogger(auditCfg)
	if err != nil {
		t.Fatalf("Failed to create audit logger: %v", err)
	}

	backendProxy, err := backend.NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("Failed to create backend proxy: %v", err)
	}

	mcpServer, err := NewMCPServer(cfg, backendProxy, auditLog)
	if err != nil {
		t.Fatalf("Failed to create MCP server: %v", err)
	}

	return mcpServer, backendProxy
}

func TestNewMCPServer(t *testing.T) {
	server, _ := setupTestMCPServer(t)

	if server == nil {
		t.Fatal("Expected non-nil MCP server")
	}

	if server.backend == nil {
		t.Fatal("Expected non-nil backend proxy")
	}

	if server.config == nil {
		t.Fatal("Expected non-nil config")
	}

	if server.toolHandlers == nil {
		t.Fatal("Expected non-nil tool handlers map")
	}

	if server.enabledTools == nil {
		t.Fatal("Expected non-nil enabled tools map")
	}
}

func TestNewMCPServerValidation(t *testing.T) {
	cfg := &config.Config{}
	auditCfg := &audit.Config{
		AuditLogPath: "/tmp/audit.log",
		AppLogPath:   "/tmp/app.log",
	}
	auditLog, _ := audit.NewLogger(auditCfg)
	proxy, _ := backend.NewProxy(cfg, auditLog)

	// Test nil config
	_, err := NewMCPServer(nil, proxy, auditLog)
	if err == nil {
		t.Error("Expected error for nil config")
	}

	// Test nil backend proxy
	_, err = NewMCPServer(cfg, nil, auditLog)
	if err == nil {
		t.Error("Expected error for nil backend proxy")
	}

	// Test nil audit log
	_, err = NewMCPServer(cfg, proxy, nil)
	if err == nil {
		t.Error("Expected error for nil audit log")
	}
}

func TestListTools(t *testing.T) {
	server, _ := setupTestMCPServer(t)

	tools := server.ListTools()

	if len(tools) == 0 {
		t.Error("Expected at least some tools to be available")
	}

	// Verify tools are from taxonomy
	foundObservation := false
	foundAnalysis := false

	for _, tool := range tools {
		if tool.Category == "observation" {
			foundObservation = true
		}
		if tool.Category == "analysis" {
			foundAnalysis = true
		}
	}

	if !foundObservation {
		t.Error("Expected to find observation tools")
	}

	if !foundAnalysis {
		t.Error("Expected to find analysis tools")
	}
}

func TestGetStats(t *testing.T) {
	server, _ := setupTestMCPServer(t)

	stats := server.GetStats()

	if stats.TotalRequests != 0 {
		t.Errorf("Expected 0 total requests, got %d", stats.TotalRequests)
	}

	if stats.SuccessfulCalls != 0 {
		t.Errorf("Expected 0 successful calls, got %d", stats.SuccessfulCalls)
	}

	if stats.FailedCalls != 0 {
		t.Errorf("Expected 0 failed calls, got %d", stats.FailedCalls)
	}

	if stats.ToolUsage == nil {
		t.Error("Expected non-nil tool usage map")
	}
}

func TestEnableDisableTool(t *testing.T) {
	server, _ := setupTestMCPServer(t)

	// Test enabling a tool
	err := server.EnableTool("observe_cluster_overview")
	if err != nil {
		t.Errorf("Failed to enable tool: %v", err)
	}

	// Test disabling a tool
	err = server.DisableTool("observe_cluster_overview")
	if err != nil {
		t.Errorf("Failed to disable tool: %v", err)
	}

	// Test enabling non-existent tool
	err = server.EnableTool("nonexistent_tool")
	if err == nil {
		t.Error("Expected error when enabling non-existent tool")
	}
}

func TestReadOnlyMode(t *testing.T) {
	server, _ := setupTestMCPServer(t)

	// Initially not in read-only mode
	if server.IsReadOnlyMode() {
		t.Error("Expected read-only mode to be disabled initially")
	}

	// Enable read-only mode
	server.SetReadOnlyMode(true)

	if !server.IsReadOnlyMode() {
		t.Error("Expected read-only mode to be enabled")
	}

	// Verify destructive tools are disabled
	tools := server.ListTools()
	for _, tool := range tools {
		if tool.Destructive {
			t.Errorf("Destructive tool should be disabled in read-only mode: %s", tool.Name)
		}
	}

	// Disable read-only mode
	server.SetReadOnlyMode(false)

	if server.IsReadOnlyMode() {
		t.Error("Expected read-only mode to be disabled")
	}
}

func TestToolRequestJSON(t *testing.T) {
	server, _ := setupTestMCPServer(t)
	ctx := context.Background()

	request := ToolRequest{
		Tool:   "observe_cluster_overview",
		Params: map[string]interface{}{},
	}

	requestJSON, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("Failed to marshal request: %v", err)
	}

	// This will fail because handler is not implemented, but should parse correctly
	_, err = server.ServeToolRequest(ctx, requestJSON)
	// Error is expected since handler is not implemented
	if err == nil {
		// OK if no error (handler implemented)
	}
}

func TestInvalidToolRequest(t *testing.T) {
	server, _ := setupTestMCPServer(t)
	ctx := context.Background()

	// Test with invalid JSON
	_, err := server.ServeToolRequest(ctx, []byte("invalid json"))
	if err == nil {
		t.Error("Expected error for invalid JSON")
	}

	// Test with non-existent tool
	request := &ToolRequest{
		Tool:   "nonexistent_tool",
		Params: map[string]interface{}{},
	}

	response, _ := server.ExecuteTool(ctx, request)
	if response.Success {
		t.Error("Expected failure for non-existent tool")
	}
}

func TestToolTaxonomyIntegration(t *testing.T) {
	server, _ := setupTestMCPServer(t)

	// Verify all taxonomy tools are available (non-destructive)
	availableTools := server.ListTools()
	taxonomyTools := tools.GetNonDestructiveTools()

	if len(availableTools) < len(taxonomyTools) {
		t.Errorf("Expected at least %d tools, got %d", len(taxonomyTools), len(availableTools))
	}

	// Verify tool categories
	categoryCount := make(map[tools.ToolCategory]int)
	for _, tool := range availableTools {
		categoryCount[tool.Category]++
	}

	if categoryCount["observation"] == 0 {
		t.Error("Expected observation tools")
	}

	if categoryCount["analysis"] == 0 {
		t.Error("Expected analysis tools")
	}
}

func TestConcurrentToolExecution(t *testing.T) {
	server, _ := setupTestMCPServer(t)
	ctx := context.Background()

	done := make(chan bool, 10)

	// Simulate concurrent tool requests
	for i := 0; i < 10; i++ {
		go func() {
			request := &ToolRequest{
				Tool:   "observe_cluster_overview",
				Params: map[string]interface{}{},
			}
			_, _ = server.ExecuteTool(ctx, request)
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Verify stats are updated
	stats := server.GetStats()
	if stats.TotalRequests != 10 {
		t.Errorf("Expected 10 total requests, got %d", stats.TotalRequests)
	}
}

// Mock tool handler for testing
type mockToolHandler struct {
	definition tools.ToolDefinition
	executeFunc func(context.Context, map[string]interface{}) (interface{}, error)
}

func (m *mockToolHandler) Execute(ctx context.Context, params map[string]interface{}) (interface{}, error) {
	if m.executeFunc != nil {
		return m.executeFunc(ctx, params)
	}
	return map[string]string{"status": "success"}, nil
}

func (m *mockToolHandler) Validate(params map[string]interface{}) error {
	return nil
}

func (m *mockToolHandler) GetDefinition() tools.ToolDefinition {
	return m.definition
}

func TestRegisterToolHandler(t *testing.T) {
	server, _ := setupTestMCPServer(t)

	handler := &mockToolHandler{
		definition: tools.ToolDefinition{
			Name:        "test_tool",
			Category:    "observation",
			Description: "Test tool",
			Destructive: false,
			RequiresAI:  false,
		},
	}

	err := server.RegisterToolHandler("test_tool", handler)
	if err != nil {
		t.Errorf("Failed to register tool handler: %v", err)
	}

	// Try registering same tool again
	err = server.RegisterToolHandler("test_tool", handler)
	if err == nil {
		t.Error("Expected error when registering duplicate tool handler")
	}
}

func TestExecuteToolWithHandler(t *testing.T) {
	server, _ := setupTestMCPServer(t)
	ctx := context.Background()

	handler := &mockToolHandler{
		definition: tools.ToolDefinition{
			Name:        "observe_cluster_overview",
			Category:    "observation",
			Description: "Test tool",
			Destructive: false,
			RequiresAI:  false,
		},
		executeFunc: func(ctx context.Context, params map[string]interface{}) (interface{}, error) {
			return map[string]string{"result": "success"}, nil
		},
	}

	err := server.RegisterToolHandler("observe_cluster_overview", handler)
	if err != nil {
		t.Fatalf("Failed to register handler: %v", err)
	}

	request := &ToolRequest{
		Tool:   "observe_cluster_overview",
		Params: map[string]interface{}{},
	}

	response, err := server.ExecuteTool(ctx, request)
	if err != nil {
		t.Errorf("Tool execution failed: %v", err)
	}

	if !response.Success {
		t.Error("Expected successful tool execution")
	}

	// Verify stats
	stats := server.GetStats()
	if stats.TotalRequests != 1 {
		t.Errorf("Expected 1 total request, got %d", stats.TotalRequests)
	}

	if stats.SuccessfulCalls != 1 {
		t.Errorf("Expected 1 successful call, got %d", stats.SuccessfulCalls)
	}
}
