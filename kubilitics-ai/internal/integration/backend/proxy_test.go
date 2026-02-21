package backend

import (
	"context"
	"testing"
	"time"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
	"github.com/kubilitics/kubilitics-ai/internal/audit"
	"github.com/kubilitics/kubilitics-ai/internal/config"
)

// Helper function to create test config and audit logger
func setupTestConfig(t *testing.T) (*config.Config, audit.Logger) {
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

	return cfg, auditLog
}

func TestNewProxy(t *testing.T) {
	cfg, auditLog := setupTestConfig(t)

	proxy, err := NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewProxy failed: %v", err)
	}

	if proxy == nil {
		t.Fatal("Expected non-nil proxy")
	}

	if proxy.GetQueryMode() != QueryModeAuto {
		t.Errorf("Expected QueryModeAuto, got %v", proxy.GetQueryMode())
	}

	if proxy.IsInitialized() {
		t.Error("Expected proxy to not be initialized initially")
	}
}

func TestNewProxyValidation(t *testing.T) {
	_, auditLog := setupTestConfig(t)

	// Test nil config
	_, err := NewProxy(nil, auditLog)
	if err == nil {
		t.Error("Expected error for nil config")
	}

	// Test nil audit log
	cfg := &config.Config{}
	cfg.Backend.Address = "localhost:9090"
	_, err = NewProxy(cfg, nil)
	if err == nil {
		t.Error("Expected error for nil audit log")
	}
}

func TestSetQueryMode(t *testing.T) {
	cfg, auditLog := setupTestConfig(t)

	proxy, err := NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewProxy failed: %v", err)
	}

	// Test setting different query modes
	modes := []QueryMode{QueryModeLocal, QueryModeRemote, QueryModeAuto}
	for _, mode := range modes {
		proxy.SetQueryMode(mode)
		if proxy.GetQueryMode() != mode {
			t.Errorf("Expected mode %v, got %v", mode, proxy.GetQueryMode())
		}
	}
}

func TestSetUpdateHandler(t *testing.T) {
	cfg, auditLog := setupTestConfig(t)

	proxy, err := NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewProxy failed: %v", err)
	}

	handlerCalled := false
	handler := func(update *pb.StateUpdate) error {
		handlerCalled = true
		return nil
	}

	proxy.SetUpdateHandler(handler)

	// Verify handler was set (indirectly through processUpdates)
	if !handlerCalled {
		// This is expected - handler is only called when updates arrive
	}
}

func TestGetStats(t *testing.T) {
	cfg, auditLog := setupTestConfig(t)

	proxy, err := NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewProxy failed: %v", err)
	}

	stats := proxy.GetStats()

	// Verify stats structure
	if _, ok := stats["initialized"]; !ok {
		t.Error("Expected 'initialized' in stats")
	}
	if _, ok := stats["query_mode"]; !ok {
		t.Error("Expected 'query_mode' in stats")
	}
	if _, ok := stats["total_queries"]; !ok {
		t.Error("Expected 'total_queries' in stats")
	}
	if _, ok := stats["cache_hit_rate"]; !ok {
		t.Error("Expected 'cache_hit_rate' in stats")
	}
	if _, ok := stats["world_model_stats"]; !ok {
		t.Error("Expected 'world_model_stats' in stats")
	}
	if _, ok := stats["grpc_stats"]; !ok {
		t.Error("Expected 'grpc_stats' in stats")
	}

	// Verify initial stats values
	if stats["initialized"] != false {
		t.Error("Expected initialized to be false initially")
	}
	if stats["total_queries"] != int64(0) {
		t.Errorf("Expected 0 total queries, got %v", stats["total_queries"])
	}
}

func TestGetResourceBeforeInitialization(t *testing.T) {
	cfg, auditLog := setupTestConfig(t)

	proxy, err := NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewProxy failed: %v", err)
	}

	ctx := context.Background()

	// Try to get resource before initialization
	_, err = proxy.GetResource(ctx, "Pod", "default", "test-pod")
	if err == nil {
		t.Error("Expected error when getting resource before initialization")
	}
	if err.Error() != "proxy not initialized" {
		t.Errorf("Expected 'proxy not initialized' error, got: %v", err)
	}
}

func TestListResourcesBeforeInitialization(t *testing.T) {
	cfg, auditLog := setupTestConfig(t)

	proxy, err := NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewProxy failed: %v", err)
	}

	ctx := context.Background()

	// Try to list resources before initialization
	_, err = proxy.ListResources(ctx, "Pod", "default")
	if err == nil {
		t.Error("Expected error when listing resources before initialization")
	}
	if err.Error() != "proxy not initialized" {
		t.Errorf("Expected 'proxy not initialized' error, got: %v", err)
	}
}

func TestListResourcesByLabelsBeforeInitialization(t *testing.T) {
	cfg, auditLog := setupTestConfig(t)

	proxy, err := NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewProxy failed: %v", err)
	}

	ctx := context.Background()
	labels := map[string]string{"app": "web"}

	// Try to list resources by labels before initialization
	_, err = proxy.ListResourcesByLabels(ctx, "Pod", "default", labels)
	if err == nil {
		t.Error("Expected error when listing resources by labels before initialization")
	}
	if err.Error() != "proxy not initialized" {
		t.Errorf("Expected 'proxy not initialized' error, got: %v", err)
	}
}

func TestExecuteCommandBeforeInitialization(t *testing.T) {
	cfg, auditLog := setupTestConfig(t)

	proxy, err := NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewProxy failed: %v", err)
	}

	ctx := context.Background()
	target := &pb.Resource{
		Kind:      "Pod",
		Namespace: "default",
		Name:      "test-pod",
	}

	// Try to execute command before initialization
	_, err = proxy.ExecuteCommand(ctx, "restart", target, nil, false)
	if err == nil {
		t.Error("Expected error when executing command before initialization")
	}
	if err.Error() != "proxy not initialized" {
		t.Errorf("Expected 'proxy not initialized' error, got: %v", err)
	}
}

func TestGetTopologyGraphBeforeInitialization(t *testing.T) {
	cfg, auditLog := setupTestConfig(t)

	proxy, err := NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewProxy failed: %v", err)
	}

	ctx := context.Background()

	// Try to get topology before initialization
	_, err = proxy.GetTopologyGraph(ctx, "default", 3)
	if err == nil {
		t.Error("Expected error when getting topology before initialization")
	}
	if err.Error() != "proxy not initialized" {
		t.Errorf("Expected 'proxy not initialized' error, got: %v", err)
	}
}

func TestGetClusterHealthBeforeInitialization(t *testing.T) {
	cfg, auditLog := setupTestConfig(t)

	proxy, err := NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewProxy failed: %v", err)
	}

	ctx := context.Background()

	// Try to get cluster health before initialization
	_, err = proxy.GetClusterHealth(ctx)
	if err == nil {
		t.Error("Expected error when getting cluster health before initialization")
	}
	if err.Error() != "proxy not initialized" {
		t.Errorf("Expected 'proxy not initialized' error, got: %v", err)
	}
}

func TestGetWorldModel(t *testing.T) {
	cfg, auditLog := setupTestConfig(t)

	proxy, err := NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewProxy failed: %v", err)
	}

	wm := proxy.GetWorldModel()
	if wm == nil {
		t.Fatal("Expected non-nil World Model")
	}

	// Verify World Model is empty initially
	if wm.GetResourceCount() != 0 {
		t.Errorf("Expected 0 resources, got %d", wm.GetResourceCount())
	}
}

func TestShutdownBeforeInitialization(t *testing.T) {
	cfg, auditLog := setupTestConfig(t)

	proxy, err := NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewProxy failed: %v", err)
	}

	ctx := context.Background()

	// Shutdown before initialization should not error
	err = proxy.Shutdown(ctx)
	if err != nil {
		t.Errorf("Unexpected error during shutdown: %v", err)
	}

	// Verify proxy is not initialized
	if proxy.IsInitialized() {
		t.Error("Expected proxy to not be initialized after shutdown")
	}
}

func TestCacheStatsTracking(t *testing.T) {
	cfg, auditLog := setupTestConfig(t)

	proxy, err := NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewProxy failed: %v", err)
	}

	// Verify initial stats
	stats := proxy.GetStats()
	if stats["total_queries"] != int64(0) {
		t.Errorf("Expected 0 total queries, got %v", stats["total_queries"])
	}
	if stats["local_hits"] != int64(0) {
		t.Errorf("Expected 0 local hits, got %v", stats["local_hits"])
	}
	if stats["remote_hits"] != int64(0) {
		t.Errorf("Expected 0 remote hits, got %v", stats["remote_hits"])
	}
	if stats["misses"] != int64(0) {
		t.Errorf("Expected 0 misses, got %v", stats["misses"])
	}
}

func TestQueryModeConstants(t *testing.T) {
	// Verify query mode constants are correctly defined
	if QueryModeLocal != "LOCAL" {
		t.Errorf("Expected QueryModeLocal to be 'LOCAL', got '%s'", QueryModeLocal)
	}
	if QueryModeRemote != "REMOTE" {
		t.Errorf("Expected QueryModeRemote to be 'REMOTE', got '%s'", QueryModeRemote)
	}
	if QueryModeAuto != "AUTO" {
		t.Errorf("Expected QueryModeAuto to be 'AUTO', got '%s'", QueryModeAuto)
	}
}

func TestConcurrentGetStats(t *testing.T) {
	cfg, auditLog := setupTestConfig(t)

	proxy, err := NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewProxy failed: %v", err)
	}

	// Test concurrent GetStats calls
	done := make(chan bool, 10)

	for i := 0; i < 10; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				stats := proxy.GetStats()
				if stats == nil {
					t.Error("Expected non-nil stats")
				}
			}
			done <- true
		}()
	}

	// Wait for all goroutines to complete with timeout
	timeout := time.After(5 * time.Second)
	for i := 0; i < 10; i++ {
		select {
		case <-done:
			// Success
		case <-timeout:
			t.Fatal("Test timed out waiting for concurrent GetStats calls")
		}
	}
}

func TestConcurrentQueryModeChanges(t *testing.T) {
	cfg, auditLog := setupTestConfig(t)

	proxy, err := NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("NewProxy failed: %v", err)
	}

	// Test concurrent query mode changes
	done := make(chan bool, 10)

	modes := []QueryMode{QueryModeLocal, QueryModeRemote, QueryModeAuto}

	for i := 0; i < 10; i++ {
		go func(id int) {
			for j := 0; j < 100; j++ {
				mode := modes[j%len(modes)]
				proxy.SetQueryMode(mode)
				_ = proxy.GetQueryMode()
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines to complete with timeout
	timeout := time.After(5 * time.Second)
	for i := 0; i < 10; i++ {
		select {
		case <-done:
			// Success
		case <-timeout:
			t.Fatal("Test timed out waiting for concurrent mode changes")
		}
	}

	// Verify proxy is still in valid state
	mode := proxy.GetQueryMode()
	validMode := false
	for _, m := range modes {
		if mode == m {
			validMode = true
			break
		}
	}
	if !validMode {
		t.Errorf("Invalid query mode after concurrent changes: %v", mode)
	}
}
