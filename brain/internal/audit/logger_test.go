package audit

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNewLogger(t *testing.T) {
	tmpDir := t.TempDir()

	config := &Config{
		AuditLogPath: filepath.Join(tmpDir, "audit.log"),
		AppLogPath:   filepath.Join(tmpDir, "app.log"),
		MaxSize:      10,
		MaxBackups:   3,
		MaxAge:       7,
		Compress:     false,
		LogLevel:     "info",
	}

	logger, err := NewLogger(config)
	if err != nil {
		t.Fatalf("NewLogger failed: %v", err)
	}
	defer logger.Close()

	if logger == nil {
		t.Fatal("Expected logger to be non-nil")
	}
}

func TestNewLoggerWithInvalidLevel(t *testing.T) {
	tmpDir := t.TempDir()

	config := &Config{
		AuditLogPath: filepath.Join(tmpDir, "audit.log"),
		AppLogPath:   filepath.Join(tmpDir, "app.log"),
		LogLevel:     "invalid",
	}

	_, err := NewLogger(config)
	if err == nil {
		t.Fatal("Expected error for invalid log level")
	}

	if !strings.Contains(err.Error(), "invalid log level") {
		t.Errorf("Expected 'invalid log level' error, got: %v", err)
	}
}

func TestDefaultConfig(t *testing.T) {
	config := DefaultConfig()

	if config.AuditLogPath != "logs/audit.log" {
		t.Errorf("Expected audit log path 'logs/audit.log', got %s", config.AuditLogPath)
	}

	if config.AppLogPath != "logs/app.log" {
		t.Errorf("Expected app log path 'logs/app.log', got %s", config.AppLogPath)
	}

	if config.MaxSize != 100 {
		t.Errorf("Expected max size 100, got %d", config.MaxSize)
	}

	if config.MaxBackups != 10 {
		t.Errorf("Expected max backups 10, got %d", config.MaxBackups)
	}

	if config.LogLevel != "info" {
		t.Errorf("Expected log level 'info', got %s", config.LogLevel)
	}
}

func TestLogEvent(t *testing.T) {
	tmpDir := t.TempDir()

	config := &Config{
		AuditLogPath: filepath.Join(tmpDir, "audit.log"),
		AppLogPath:   filepath.Join(tmpDir, "app.log"),
		MaxSize:      10,
		MaxBackups:   3,
		LogLevel:     "info",
	}

	logger, err := NewLogger(config)
	if err != nil {
		t.Fatalf("NewLogger failed: %v", err)
	}
	defer logger.Close()

	ctx := context.Background()
	event := NewEvent(EventInvestigationStarted).
		WithCorrelationID("test-123").
		WithUser("test-user").
		WithResource("test-pod", "pod").
		WithResult(ResultSuccess)

	if err := logger.Log(ctx, event); err != nil {
		t.Fatalf("Log failed: %v", err)
	}

	// Force flush
	if err := logger.Sync(); err != nil {
		t.Fatalf("Sync failed: %v", err)
	}

	// Verify log file was created
	if _, err := os.Stat(config.AuditLogPath); os.IsNotExist(err) {
		t.Fatal("Audit log file was not created")
	}

	// Read and verify log content
	content, err := os.ReadFile(config.AuditLogPath)
	if err != nil {
		t.Fatalf("Failed to read audit log: %v", err)
	}

	logContent := string(content)
	if !strings.Contains(logContent, "test-123") {
		t.Error("Log does not contain correlation ID")
	}

	if !strings.Contains(logContent, "investigation.started") {
		t.Error("Log does not contain event type")
	}

	if !strings.Contains(logContent, "test-user") {
		t.Error("Log does not contain user")
	}
}

func TestLogInvestigationLifecycle(t *testing.T) {
	tmpDir := t.TempDir()

	config := &Config{
		AuditLogPath: filepath.Join(tmpDir, "audit.log"),
		AppLogPath:   filepath.Join(tmpDir, "app.log"),
		LogLevel:     "info",
	}

	logger, err := NewLogger(config)
	if err != nil {
		t.Fatalf("NewLogger failed: %v", err)
	}
	defer logger.Close()

	ctx := context.Background()
	investigationID := "inv-456"

	// Log started
	if err := logger.LogInvestigationStarted(ctx, investigationID); err != nil {
		t.Fatalf("LogInvestigationStarted failed: %v", err)
	}

	// Log completed
	if err := logger.LogInvestigationCompleted(ctx, investigationID, 5*time.Second); err != nil {
		t.Fatalf("LogInvestigationCompleted failed: %v", err)
	}

	// Force flush
	if err := logger.Sync(); err != nil {
		t.Fatalf("Sync failed: %v", err)
	}

	// Verify log content
	content, err := os.ReadFile(config.AuditLogPath)
	if err != nil {
		t.Fatalf("Failed to read audit log: %v", err)
	}

	logContent := string(content)
	if !strings.Contains(logContent, investigationID) {
		t.Error("Log does not contain investigation ID")
	}

	if !strings.Contains(logContent, "investigation.started") {
		t.Error("Log does not contain started event")
	}

	if !strings.Contains(logContent, "investigation.completed") {
		t.Error("Log does not contain completed event")
	}
}

func TestLogActionLifecycle(t *testing.T) {
	tmpDir := t.TempDir()

	config := &Config{
		AuditLogPath: filepath.Join(tmpDir, "audit.log"),
		AppLogPath:   filepath.Join(tmpDir, "app.log"),
		LogLevel:     "info",
	}

	logger, err := NewLogger(config)
	if err != nil {
		t.Fatalf("NewLogger failed: %v", err)
	}
	defer logger.Close()

	ctx := context.Background()

	// Log action proposed
	if err := logger.LogActionProposed(ctx, "restart", "pod/nginx"); err != nil {
		t.Fatalf("LogActionProposed failed: %v", err)
	}

	// Log action approved
	if err := logger.LogActionApproved(ctx, "restart", "pod/nginx", "admin"); err != nil {
		t.Fatalf("LogActionApproved failed: %v", err)
	}

	// Log action executed
	if err := logger.LogActionExecuted(ctx, "restart", "pod/nginx", 2*time.Second); err != nil {
		t.Fatalf("LogActionExecuted failed: %v", err)
	}

	// Force flush
	if err := logger.Sync(); err != nil {
		t.Fatalf("Sync failed: %v", err)
	}

	// Verify log content
	content, err := os.ReadFile(config.AuditLogPath)
	if err != nil {
		t.Fatalf("Failed to read audit log: %v", err)
	}

	logContent := string(content)
	if !strings.Contains(logContent, "action.proposed") {
		t.Error("Log does not contain proposed event")
	}

	if !strings.Contains(logContent, "action.approved") {
		t.Error("Log does not contain approved event")
	}

	if !strings.Contains(logContent, "action.executed") {
		t.Error("Log does not contain executed event")
	}

	if !strings.Contains(logContent, "admin") {
		t.Error("Log does not contain approver")
	}
}

func TestLogSafetyViolation(t *testing.T) {
	tmpDir := t.TempDir()

	config := &Config{
		AuditLogPath: filepath.Join(tmpDir, "audit.log"),
		AppLogPath:   filepath.Join(tmpDir, "app.log"),
		LogLevel:     "info",
	}

	logger, err := NewLogger(config)
	if err != nil {
		t.Fatalf("NewLogger failed: %v", err)
	}
	defer logger.Close()

	ctx := context.Background()

	if err := logger.LogSafetyViolation(ctx, "immutable_rule_1", "deployment/critical"); err != nil {
		t.Fatalf("LogSafetyViolation failed: %v", err)
	}

	// Force flush
	if err := logger.Sync(); err != nil {
		t.Fatalf("Sync failed: %v", err)
	}

	// Verify log content
	content, err := os.ReadFile(config.AuditLogPath)
	if err != nil {
		t.Fatalf("Failed to read audit log: %v", err)
	}

	logContent := string(content)
	if !strings.Contains(logContent, "safety.policy_violation") {
		t.Error("Log does not contain safety violation event")
	}

	if !strings.Contains(logContent, "immutable_rule_1") {
		t.Error("Log does not contain rule name")
	}

	if !strings.Contains(logContent, "denied") {
		t.Error("Log does not contain denied result")
	}
}

func TestBufferAutoFlush(t *testing.T) {
	tmpDir := t.TempDir()

	config := &Config{
		AuditLogPath: filepath.Join(tmpDir, "audit.log"),
		AppLogPath:   filepath.Join(tmpDir, "app.log"),
		LogLevel:     "info",
	}

	logger, err := NewLogger(config)
	if err != nil {
		t.Fatalf("NewLogger failed: %v", err)
	}
	defer logger.Close()

	ctx := context.Background()

	// Log multiple events
	for i := 0; i < 5; i++ {
		event := NewEvent(EventHealthCheck).
			WithCorrelationID("test").
			WithResult(ResultSuccess)

		if err := logger.Log(ctx, event); err != nil {
			t.Fatalf("Log failed: %v", err)
		}
	}

	// Wait for auto-flush (1 second ticker)
	time.Sleep(1500 * time.Millisecond)

	// Verify log file was created and has content
	content, err := os.ReadFile(config.AuditLogPath)
	if err != nil {
		t.Fatalf("Failed to read audit log: %v", err)
	}

	if len(content) == 0 {
		t.Error("Audit log is empty after auto-flush")
	}
}

func TestBufferFullFlush(t *testing.T) {
	tmpDir := t.TempDir()

	config := &Config{
		AuditLogPath: filepath.Join(tmpDir, "audit.log"),
		AppLogPath:   filepath.Join(tmpDir, "app.log"),
		LogLevel:     "info",
	}

	logger, err := NewLogger(config)
	if err != nil {
		t.Fatalf("NewLogger failed: %v", err)
	}
	defer logger.Close()

	ctx := context.Background()

	// Log 100+ events to trigger buffer flush
	for i := 0; i < 105; i++ {
		event := NewEvent(EventHealthCheck).
			WithCorrelationID("test").
			WithResult(ResultSuccess)

		if err := logger.Log(ctx, event); err != nil {
			t.Fatalf("Log failed: %v", err)
		}
	}

	// Sync to ensure flush
	if err := logger.Sync(); err != nil {
		t.Fatalf("Sync failed: %v", err)
	}

	// Verify log file has all events
	content, err := os.ReadFile(config.AuditLogPath)
	if err != nil {
		t.Fatalf("Failed to read audit log: %v", err)
	}

	// Count number of events (each event is a JSON line)
	lines := strings.Split(string(content), "\n")
	eventCount := 0
	for _, line := range lines {
		if strings.TrimSpace(line) != "" {
			eventCount++
		}
	}

	if eventCount < 105 {
		t.Errorf("Expected at least 105 events, got %d", eventCount)
	}
}

func TestCorrelationID(t *testing.T) {
	// Test GenerateCorrelationID
	id1 := GenerateCorrelationID()
	id2 := GenerateCorrelationID()

	if id1 == id2 {
		t.Error("Generated correlation IDs should be unique")
	}

	// Test context functions
	ctx := context.Background()

	// Without correlation ID
	if id := GetCorrelationID(ctx); id != "" {
		t.Errorf("Expected empty correlation ID, got %s", id)
	}

	// With correlation ID
	ctx = WithCorrelationID(ctx, "test-correlation-id")
	if id := GetCorrelationID(ctx); id != "test-correlation-id" {
		t.Errorf("Expected 'test-correlation-id', got %s", id)
	}
}

func TestEventBuilderChain(t *testing.T) {
	event := NewEvent(EventActionExecuted).
		WithCorrelationID("corr-123").
		WithUser("admin").
		WithResource("pod/nginx", "pod").
		WithAction("restart").
		WithDescription("Restarting nginx pod").
		WithResult(ResultSuccess).
		WithDuration(3*time.Second).
		WithMetadata("reason", "high memory usage")

	if event.CorrelationID != "corr-123" {
		t.Errorf("Expected correlation ID 'corr-123', got %s", event.CorrelationID)
	}

	if event.User != "admin" {
		t.Errorf("Expected user 'admin', got %s", event.User)
	}

	if event.Resource != "pod/nginx" {
		t.Errorf("Expected resource 'pod/nginx', got %s", event.Resource)
	}

	if event.ResourceType != "pod" {
		t.Errorf("Expected resource type 'pod', got %s", event.ResourceType)
	}

	if event.Action != "restart" {
		t.Errorf("Expected action 'restart', got %s", event.Action)
	}

	if event.Result != ResultSuccess {
		t.Errorf("Expected result 'success', got %s", event.Result)
	}

	if event.DurationMs != 3000 {
		t.Errorf("Expected duration 3000ms, got %d", event.DurationMs)
	}

	if reason, ok := event.Metadata["reason"].(string); !ok || reason != "high memory usage" {
		t.Errorf("Expected metadata reason 'high memory usage', got %v", event.Metadata["reason"])
	}
}

func TestEventJSONSerialization(t *testing.T) {
	event := NewEvent(EventInvestigationStarted).
		WithCorrelationID("inv-789").
		WithUser("system").
		WithResult(ResultSuccess)

	// Serialize to JSON
	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("Failed to marshal event: %v", err)
	}

	// Deserialize from JSON
	var decoded Event
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal event: %v", err)
	}

	// Verify fields
	if decoded.CorrelationID != "inv-789" {
		t.Errorf("Expected correlation ID 'inv-789', got %s", decoded.CorrelationID)
	}

	if decoded.User != "system" {
		t.Errorf("Expected user 'system', got %s", decoded.User)
	}

	if decoded.EventType != EventInvestigationStarted {
		t.Errorf("Expected event type 'investigation.started', got %s", decoded.EventType)
	}

	if decoded.Result != ResultSuccess {
		t.Errorf("Expected result 'success', got %s", decoded.Result)
	}
}
