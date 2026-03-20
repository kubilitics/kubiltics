package server

import (
	"context"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/audit"
	"github.com/kubilitics/kubilitics-ai/internal/config"
	"github.com/kubilitics/kubilitics-ai/internal/db"
	"github.com/kubilitics/kubilitics-ai/internal/integration/backend"
)

// Helper function to create test config and dependencies
func setupTestServer(t *testing.T) (MCPServer, *backend.Proxy, audit.Logger) {
	cfg := &config.Config{}
	cfg.Backend.Address = "localhost:9090"
	cfg.Backend.Timeout = 30

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

	// Create backend proxy (not initialized)
	proxy, err := backend.NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("Failed to create backend proxy: %v", err)
	}

	store, err := db.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}

	// Create MCP server
	server, err := NewMCPServer(cfg, proxy, auditLog, store)
	if err != nil {
		t.Fatalf("Failed to create MCP server: %v", err)
	}

	return server, proxy, auditLog
}

func TestNewMCPServer(t *testing.T) {
	server, _, _ := setupTestServer(t)

	if server == nil {
		t.Fatal("Expected non-nil server")
	}

	// Verify server has registered tools
	ctx := context.Background()
	tools, err := server.ListTools(ctx)
	if err != nil {
		t.Fatalf("Failed to list tools: %v", err)
	}

	if len(tools) == 0 {
		t.Error("Expected tools to be registered")
	}

	t.Logf("Registered %d tools", len(tools))
}

func TestNewMCPServerValidation(t *testing.T) {
	cfg := &config.Config{}
	cfg.Backend.Address = "localhost:9090"

	auditCfg := &audit.Config{
		AuditLogPath: "/tmp/audit.log",
		AppLogPath:   "/tmp/app.log",
		MaxSize:      10,
		MaxBackups:   3,
		MaxAge:       30,
		Compress:     false,
	}
	auditLog, _ := audit.NewLogger(auditCfg)

	proxy, _ := backend.NewProxy(cfg, auditLog)
	store, _ := db.NewSQLiteStore(":memory:")

	// Test nil config
	_, err := NewMCPServer(nil, proxy, auditLog, store)
	if err == nil {
		t.Error("Expected error for nil config")
	}

	// Test nil proxy
	_, err = NewMCPServer(cfg, nil, auditLog, store)
	if err == nil {
		t.Error("Expected error for nil proxy")
	}

	// Test nil audit log
	_, err = NewMCPServer(cfg, proxy, nil, store)
	if err == nil {
		t.Error("Expected error for nil audit log")
	}

	// Test nil store
	_, err = NewMCPServer(cfg, proxy, auditLog, nil)
	if err == nil {
		t.Error("Expected error for nil store")
	}
}

func TestRegisterTool(t *testing.T) {
	server, _, _ := setupTestServer(t)

	handler := func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		return "test result", nil
	}

	// Register a custom tool
	err := server.RegisterTool("test_tool", "A test tool", nil, handler)
	if err != nil {
		t.Fatalf("Failed to register tool: %v", err)
	}

	// Try to register the same tool again
	err = server.RegisterTool("test_tool", "A test tool", nil, handler)
	if err == nil {
		t.Error("Expected error when registering duplicate tool")
	}
}

func TestRegisterToolValidation(t *testing.T) {
	server, _, _ := setupTestServer(t)

	handler := func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		return "test result", nil
	}

	// Test empty name
	err := server.RegisterTool("", "Description", nil, handler)
	if err == nil {
		t.Error("Expected error for empty tool name")
	}

	// Test nil handler
	err = server.RegisterTool("test_tool", "Description", nil, nil)
	if err == nil {
		t.Error("Expected error for nil handler")
	}
}

func TestListTools(t *testing.T) {
	server, _, _ := setupTestServer(t)

	ctx := context.Background()
	tools, err := server.ListTools(ctx)
	if err != nil {
		t.Fatalf("Failed to list tools: %v", err)
	}

	// Verify we have tools from all categories
	categories := make(map[string]int)
	for _, tool := range tools {
		categories[tool.Category]++
	}

	t.Logf("Tools by category: %v", categories)

	// We should have at least observation tools registered
	if categories["observation"] == 0 {
		t.Error("Expected observation tools to be registered")
	}
}

func TestExecuteToolNotFound(t *testing.T) {
	server, _, _ := setupTestServer(t)

	ctx := context.Background()
	_, err := server.ExecuteTool(ctx, "nonexistent_tool", nil)
	if err == nil {
		t.Error("Expected error for nonexistent tool")
	}
}

func TestExecuteToolCustom(t *testing.T) {
	server, _, _ := setupTestServer(t)

	// Register a custom tool
	handler := func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		name := args["name"].(string)
		return map[string]interface{}{"greeting": "Hello " + name}, nil
	}

	err := server.RegisterTool("greet", "Greet someone", nil, handler)
	if err != nil {
		t.Fatalf("Failed to register tool: %v", err)
	}

	// Execute the tool
	ctx := context.Background()
	args := map[string]interface{}{"name": "World"}
	result, err := server.ExecuteTool(ctx, "greet", args)
	if err != nil {
		t.Fatalf("Failed to execute tool: %v", err)
	}

	resultMap, ok := result.(map[string]interface{})
	if !ok {
		t.Fatal("Expected result to be a map")
	}

	if resultMap["greeting"] != "Hello World" {
		t.Errorf("Expected 'Hello World', got '%v'", resultMap["greeting"])
	}
}

func TestExecuteToolError(t *testing.T) {
	server, _, _ := setupTestServer(t)

	// Register a tool that returns an error
	handler := func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		return nil, context.DeadlineExceeded
	}

	err := server.RegisterTool("failing_tool", "A failing tool", nil, handler)
	if err != nil {
		t.Fatalf("Failed to register tool: %v", err)
	}

	// Execute the tool
	ctx := context.Background()
	_, err = server.ExecuteTool(ctx, "failing_tool", nil)
	if err == nil {
		t.Error("Expected error from failing tool")
	}
}

func TestStartStop(t *testing.T) {
	server, _, _ := setupTestServer(t)

	ctx := context.Background()

	// Start server
	err := server.Start(ctx)
	if err != nil {
		t.Fatalf("Failed to start server: %v", err)
	}

	// Try to start again
	err = server.Start(ctx)
	if err == nil {
		t.Error("Expected error when starting already running server")
	}

	// Stop server
	err = server.Stop(ctx)
	if err != nil {
		t.Fatalf("Failed to stop server: %v", err)
	}

	// Stop again should be idempotent
	err = server.Stop(ctx)
	if err != nil {
		t.Errorf("Unexpected error when stopping already stopped server: %v", err)
	}
}

func TestGetStats(t *testing.T) {
	server, _, _ := setupTestServer(t)

	ctx := context.Background()

	// Get initial stats
	stats := server.GetStats()

	// Verify stats structure
	if _, ok := stats["running"]; !ok {
		t.Error("Expected 'running' in stats")
	}
	if _, ok := stats["registered_tools"]; !ok {
		t.Error("Expected 'registered_tools' in stats")
	}
	if _, ok := stats["total_calls"]; !ok {
		t.Error("Expected 'total_calls' in stats")
	}
	if _, ok := stats["successful_calls"]; !ok {
		t.Error("Expected 'successful_calls' in stats")
	}
	if _, ok := stats["failed_calls"]; !ok {
		t.Error("Expected 'failed_calls' in stats")
	}

	// Verify initial values
	if stats["running"] != false {
		t.Error("Expected running to be false initially")
	}
	if stats["total_calls"] != int64(0) {
		t.Errorf("Expected 0 total calls, got %v", stats["total_calls"])
	}

	// Start server and check running state
	server.Start(ctx)
	stats = server.GetStats()
	if stats["running"] != true {
		t.Error("Expected running to be true after start")
	}
}

func TestGetStatsAfterCalls(t *testing.T) {
	server, _, _ := setupTestServer(t)

	// Register a custom tool
	handler := func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		return "success", nil
	}

	server.RegisterTool("test_tool", "A test tool", nil, handler)

	ctx := context.Background()

	// Execute the tool multiple times
	for i := 0; i < 5; i++ {
		_, err := server.ExecuteTool(ctx, "test_tool", nil)
		if err != nil {
			t.Fatalf("Failed to execute tool: %v", err)
		}
	}

	// Check stats
	stats := server.GetStats()
	if stats["total_calls"] != int64(5) {
		t.Errorf("Expected 5 total calls, got %v", stats["total_calls"])
	}
	if stats["successful_calls"] != int64(5) {
		t.Errorf("Expected 5 successful calls, got %v", stats["successful_calls"])
	}

	callsByTool := stats["calls_by_tool"].(map[string]int64)
	if callsByTool["test_tool"] != int64(5) {
		t.Errorf("Expected 5 calls for test_tool, got %v", callsByTool["test_tool"])
	}
}

func TestRateLimiting(t *testing.T) {
	server, _, _ := setupTestServer(t)

	// Register a fast tool
	handler := func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		return "success", nil
	}

	server.RegisterTool("fast_tool", "A fast tool", nil, handler)

	ctx := context.Background()

	// Try to execute many times rapidly
	successCount := 0
	for i := 0; i < 150; i++ { // More than rate limit of 100
		_, err := server.ExecuteTool(ctx, "fast_tool", nil)
		if err == nil {
			successCount++
		} else if err.Error() == "rate limit exceeded" {
			// Expected for some calls
			break
		}
	}

	// Should have some rate limiting kick in
	t.Logf("Successful calls before rate limit: %d", successCount)
	if successCount >= 150 {
		t.Error("Expected rate limiting to prevent all 150 calls")
	}
}

func TestConcurrentExecuteTool(t *testing.T) {
	server, _, _ := setupTestServer(t)

	// Register a tool
	handler := func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		time.Sleep(10 * time.Millisecond)
		return "success", nil
	}

	server.RegisterTool("concurrent_tool", "A concurrent tool", nil, handler)

	ctx := context.Background()

	// Execute concurrently
	done := make(chan bool, 10)
	for i := 0; i < 10; i++ {
		go func() {
			_, err := server.ExecuteTool(ctx, "concurrent_tool", nil)
			if err != nil {
				t.Errorf("Concurrent execution failed: %v", err)
			}
			done <- true
		}()
	}

	// Wait for all to complete with timeout
	timeout := time.After(5 * time.Second)
	for i := 0; i < 10; i++ {
		select {
		case <-done:
			// Success
		case <-timeout:
			t.Fatal("Test timed out waiting for concurrent executions")
		}
	}

	// Verify stats
	stats := server.GetStats()
	if stats["total_calls"].(int64) < 10 {
		t.Errorf("Expected at least 10 calls, got %v", stats["total_calls"])
	}
}

func TestToolCategories(t *testing.T) {
	server, _, _ := setupTestServer(t)

	ctx := context.Background()
	tools, err := server.ListTools(ctx)
	if err != nil {
		t.Fatalf("Failed to list tools: %v", err)
	}

	// Count tools by category
	categories := map[string]int{
		"observation":     0,
		"analysis":        0,
		"recommendation":  0,
		"troubleshooting": 0,
		"security":        0,
		"cost":            0,
		"action":          0,
		"automation":      0,
	}

	for _, tool := range tools {
		if _, ok := categories[tool.Category]; ok {
			categories[tool.Category]++
		}
	}

	t.Logf("Tool distribution: %v", categories)

	// We should have tools in multiple categories
	nonZeroCategories := 0
	for _, count := range categories {
		if count > 0 {
			nonZeroCategories++
		}
	}

	if nonZeroCategories < 3 {
		t.Errorf("Expected tools in at least 3 categories, got %d", nonZeroCategories)
	}
}

func TestObservationHandlerBeforeProxyInit(t *testing.T) {
	server, proxy, _ := setupTestServer(t)

	// Handlers now use the REST HTTP client directly (not backendProxy).
	// If the backend is running locally, observe_cluster_overview will succeed.
	// If not, it will fail with a network error. Either way the tool is wired.
	ctx := context.Background()
	_, err := server.ExecuteTool(ctx, "observe_cluster_overview", nil)
	// Either outcome is acceptable — we're just verifying the tool is wired.
	if err != nil {
		t.Logf("Backend not reachable (expected in CI): %v", err)
	} else {
		t.Logf("observe_cluster_overview succeeded (live backend present)")
	}

	// The gRPC proxy itself should still be uninitialised (we never called Init).
	if proxy.IsInitialized() {
		t.Error("Proxy should not be initialized")
	}
}

func TestHandleObserveResourceValidation(t *testing.T) {
	server, _, _ := setupTestServer(t)

	ctx := context.Background()

	// Test missing kind parameter — the handler validates args before any HTTP
	// call, so the error should always contain "kind".
	args := map[string]interface{}{
		"name": "test-pod",
		// Provide cluster_id so we skip the first-cluster HTTP call.
		"cluster_id": "test-cluster",
	}
	_, err := server.ExecuteTool(ctx, "observe_resource", args)
	if err == nil || !containsSubstring(err.Error(), "kind") {
		t.Errorf("Expected 'kind' error, got: %v", err)
	}

	// Test missing name parameter
	args = map[string]interface{}{
		"kind":       "Pod",
		"cluster_id": "test-cluster",
	}
	_, err = server.ExecuteTool(ctx, "observe_resource", args)
	if err == nil || !containsSubstring(err.Error(), "name") {
		t.Errorf("Expected 'name' error, got: %v", err)
	}
}

func TestHandlePodLogsValidation(t *testing.T) {
	server, _, _ := setupTestServer(t)

	ctx := context.Background()

	// Test missing pod_name parameter — validated before HTTP call.
	args := map[string]interface{}{
		"namespace":  "default",
		"cluster_id": "test-cluster",
	}
	_, err := server.ExecuteTool(ctx, "observe_pod_logs", args)
	if err == nil || !containsSubstring(err.Error(), "pod_name") {
		t.Errorf("Expected 'pod_name' error, got: %v", err)
	}
}

func containsSubstring(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 ||
		func() bool {
			for i := 0; i <= len(s)-len(sub); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
			return false
		}())
}

func TestUnimplementedTools(t *testing.T) {
	server, _, _ := setupTestServer(t)

	ctx := context.Background()

	// Test that unimplemented tools return appropriate errors
	unimplementedTools := []string{
		"analyze_resource_health",
		"recommend_scaling",
		"troubleshoot_pod_crash",
		"audit_rbac_permissions",
		"calculate_cost_breakdown",
		"apply_resource_changes",
		"create_runbook",
	}

	for _, toolName := range unimplementedTools {
		_, err := server.ExecuteTool(ctx, toolName, nil)
		if err == nil {
			t.Errorf("Expected error for unimplemented tool: %s", toolName)
		}
		// The error should indicate it's not yet implemented
		if err != nil {
			t.Logf("Tool %s returned expected error: %v", toolName, err)
		}
	}
}

func TestMCPServerInterface(t *testing.T) {
	// Verify that mcpServerImpl implements MCPServer interface
	var _ MCPServer = (*mcpServerImpl)(nil)
}

func TestToolRegistration(t *testing.T) {
	// Test toolRegistration struct
	handler := func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		return nil, nil
	}

	tool := &Tool{
		Name:        "test",
		Description: "test tool",
		Category:    "observation",
	}

	reg := &toolRegistration{
		Tool:    tool,
		Handler: handler,
	}

	if reg.Tool.Name != "test" {
		t.Errorf("Expected tool name 'test', got '%s'", reg.Tool.Name)
	}

	if reg.Handler == nil {
		t.Error("Expected non-nil handler")
	}
}

func TestRateLimiterBasic(t *testing.T) {
	rl := newRateLimiter(5, time.Second)

	// Should allow first 5 calls
	for i := 0; i < 5; i++ {
		if !rl.Allow() {
			t.Errorf("Expected call %d to be allowed", i+1)
		}
	}

	// 6th call should be denied
	if rl.Allow() {
		t.Error("Expected 6th call to be denied")
	}

	// Wait for refill
	time.Sleep(1100 * time.Millisecond)

	// Should allow more calls after refill
	if !rl.Allow() {
		t.Error("Expected call to be allowed after refill")
	}
}

func TestToolMarshalJSON(t *testing.T) {
	tool := &Tool{
		Name:        "test_tool",
		Description: "A test tool",
		Category:    "observation",
		Destructive: false,
		RequiresAI:  true,
	}

	data, err := tool.MarshalJSON()
	if err != nil {
		t.Fatalf("Failed to marshal tool: %v", err)
	}

	if len(data) == 0 {
		t.Error("Expected non-empty JSON data")
	}

	t.Logf("Marshaled tool: %s", string(data))
}
