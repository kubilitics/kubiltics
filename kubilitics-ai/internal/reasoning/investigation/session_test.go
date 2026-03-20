package investigation

import (
	"context"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/audit"
)

func setupTestSession(t *testing.T) InvestigationSession {
	auditCfg := &audit.Config{
		AuditLogPath: "/tmp/investigation-audit.log",
		AppLogPath:   "/tmp/investigation-app.log",
		MaxSize:      10,
		MaxBackups:   3,
		MaxAge:       30,
		Compress:     false,
	}
	auditLog, err := audit.NewLogger(auditCfg)
	if err != nil {
		t.Fatalf("Failed to create audit logger: %v", err)
	}

	return NewInvestigationSession(auditLog)
}

func TestNewInvestigationSession(t *testing.T) {
	session := setupTestSession(t)
	if session == nil {
		t.Fatal("Expected non-nil session")
	}
}

func TestCreateInvestigation(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	inv, err := session.CreateInvestigation(ctx, TypePodCrash, "Pod test-pod is crashing", "user-123")
	if err != nil {
		t.Fatalf("Failed to create investigation: %v", err)
	}

	if inv.ID == "" {
		t.Error("Expected non-empty investigation ID")
	}
	if inv.Type != TypePodCrash {
		t.Errorf("Expected type %s, got %s", TypePodCrash, inv.Type)
	}
	if inv.State != StateCreated {
		t.Errorf("Expected state %s, got %s", StateCreated, inv.State)
	}
	if inv.Description != "Pod test-pod is crashing" {
		t.Errorf("Unexpected description: %s", inv.Description)
	}
	if inv.UserID != "user-123" {
		t.Errorf("Expected user ID user-123, got %s", inv.UserID)
	}
	if inv.CorrelationID == "" {
		t.Error("Expected non-empty correlation ID")
	}
}

func TestCreateInvestigationValidation(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	// Empty description should fail
	_, err := session.CreateInvestigation(ctx, TypePerformance, "", "user-123")
	if err == nil {
		t.Error("Expected error for empty description")
	}
}

func TestGetInvestigation(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	// Create investigation
	created, err := session.CreateInvestigation(ctx, TypeSecurity, "Security audit", "user-123")
	if err != nil {
		t.Fatalf("Failed to create investigation: %v", err)
	}

	// Retrieve it
	retrieved, err := session.GetInvestigation(ctx, created.ID)
	if err != nil {
		t.Fatalf("Failed to get investigation: %v", err)
	}

	if retrieved.ID != created.ID {
		t.Errorf("Expected ID %s, got %s", created.ID, retrieved.ID)
	}
	if retrieved.Description != "Security audit" {
		t.Errorf("Unexpected description: %s", retrieved.Description)
	}
}

func TestGetInvestigationNotFound(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	_, err := session.GetInvestigation(ctx, "nonexistent-id")
	if err == nil {
		t.Error("Expected error for nonexistent investigation")
	}
}

func TestUpdateState(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	inv, err := session.CreateInvestigation(ctx, TypeReliability, "Reliability check", "user-123")
	if err != nil {
		t.Fatalf("Failed to create investigation: %v", err)
	}

	// Valid transition: Created → Investigating
	err = session.UpdateState(ctx, inv.ID, StateInvestigating)
	if err != nil {
		t.Fatalf("Failed to update state: %v", err)
	}

	retrieved, _ := session.GetInvestigation(ctx, inv.ID)
	if retrieved.State != StateInvestigating {
		t.Errorf("Expected state %s, got %s", StateInvestigating, retrieved.State)
	}
	if retrieved.StartedAt == nil {
		t.Error("Expected StartedAt to be set when transitioning to Investigating")
	}

	// Valid transition: Investigating → Concluded
	err = session.UpdateState(ctx, inv.ID, StateConcluded)
	if err != nil {
		t.Fatalf("Failed to update state: %v", err)
	}

	retrieved, _ = session.GetInvestigation(ctx, inv.ID)
	if retrieved.State != StateConcluded {
		t.Errorf("Expected state %s, got %s", StateConcluded, retrieved.State)
	}
	if retrieved.ConcludedAt == nil {
		t.Error("Expected ConcludedAt to be set when transitioning to Concluded")
	}
}

func TestInvalidStateTransition(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	inv, err := session.CreateInvestigation(ctx, TypeCost, "Cost analysis", "user-123")
	if err != nil {
		t.Fatalf("Failed to create investigation: %v", err)
	}

	// Invalid transition: Created → Concluded (must go through Investigating)
	err = session.UpdateState(ctx, inv.ID, StateConcluded)
	if err == nil {
		t.Error("Expected error for invalid state transition")
	}

	// Invalid transition: Created → Archived (must go through Investigating/Concluded)
	err = session.UpdateState(ctx, inv.ID, StateArchived)
	if err == nil {
		t.Error("Expected error for invalid state transition")
	}
}

func TestStateTransitionFromArchived(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	inv, _ := session.CreateInvestigation(ctx, TypeAnomalies, "Anomaly detection", "user-123")
	session.UpdateState(ctx, inv.ID, StateInvestigating)
	session.UpdateState(ctx, inv.ID, StateConcluded)
	session.UpdateState(ctx, inv.ID, StateArchived)

	// Archived is terminal state
	err := session.UpdateState(ctx, inv.ID, StateCreated)
	if err == nil {
		t.Error("Expected error when transitioning from Archived state")
	}
}

func TestAddHypothesis(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	inv, _ := session.CreateInvestigation(ctx, TypePerformance, "Slow response times", "user-123")

	hypothesis := Hypothesis{
		Statement:  "High CPU usage is causing latency",
		Confidence: 75,
		Rationale:  "CPU metrics show 95% utilization during slow periods",
		Timestamp:  time.Now(),
	}

	err := session.AddHypothesis(ctx, inv.ID, hypothesis)
	if err != nil {
		t.Fatalf("Failed to add hypothesis: %v", err)
	}

	retrieved, _ := session.GetInvestigation(ctx, inv.ID)
	if retrieved.Hypothesis == nil {
		t.Error("Expected hypothesis to be set")
	}
}

func TestAddToolCall(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	inv, _ := session.CreateInvestigation(ctx, TypePodCrash, "Pod crashing", "user-123")

	args := map[string]interface{}{
		"kind":      "Pod",
		"namespace": "default",
		"name":      "test-pod",
	}
	result := map[string]interface{}{
		"status": "CrashLoopBackOff",
		"reason": "OOMKilled",
	}

	err := session.AddToolCall(ctx, inv.ID, "observe_resource", args, result)
	if err != nil {
		t.Fatalf("Failed to add tool call: %v", err)
	}

	retrieved, _ := session.GetInvestigation(ctx, inv.ID)
	if len(retrieved.ToolCalls) != 1 {
		t.Errorf("Expected 1 tool call, got %d", len(retrieved.ToolCalls))
	}
}

func TestAddFinding(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	inv, _ := session.CreateInvestigation(ctx, TypeSecurity, "Security scan", "user-123")

	evidence := map[string]interface{}{
		"service": "test-service",
		"port":    80,
	}

	err := session.AddFinding(ctx, inv.ID, "Service exposed without TLS", evidence, 85)
	if err != nil {
		t.Fatalf("Failed to add finding: %v", err)
	}

	retrieved, _ := session.GetInvestigation(ctx, inv.ID)
	if len(retrieved.Findings) != 1 {
		t.Errorf("Expected 1 finding, got %d", len(retrieved.Findings))
	}
}

func TestAddFindingValidation(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	inv, _ := session.CreateInvestigation(ctx, TypeConfigCheck, "Config validation", "user-123")

	// Confidence too low
	err := session.AddFinding(ctx, inv.ID, "Invalid config", nil, -1)
	if err == nil {
		t.Error("Expected error for negative confidence")
	}

	// Confidence too high
	err = session.AddFinding(ctx, inv.ID, "Invalid config", nil, 101)
	if err == nil {
		t.Error("Expected error for confidence > 100")
	}
}

func TestSetConclusion(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	inv, _ := session.CreateInvestigation(ctx, TypePodCrash, "Pod crash investigation", "user-123")

	conclusion := Conclusion{
		RootCause:  "Out of memory",
		Impact:     "Service degraded, pods restarting every 2 minutes",
		Evidence:   []Finding{},
		Confidence: 90,
		Timestamp:  time.Now(),
	}

	err := session.SetConclusion(ctx, inv.ID, conclusion, 90)
	if err != nil {
		t.Fatalf("Failed to set conclusion: %v", err)
	}

	retrieved, _ := session.GetInvestigation(ctx, inv.ID)
	if retrieved.Conclusion == nil {
		t.Error("Expected conclusion to be set")
	}
	if retrieved.Confidence != 90 {
		t.Errorf("Expected confidence 90, got %d", retrieved.Confidence)
	}
}

func TestSetConclusionValidation(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	inv, _ := session.CreateInvestigation(ctx, TypeReliability, "Reliability test", "user-123")

	// Invalid confidence
	err := session.SetConclusion(ctx, inv.ID, "conclusion", 150)
	if err == nil {
		t.Error("Expected error for invalid confidence")
	}
}

func TestAddAction(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	inv, _ := session.CreateInvestigation(ctx, TypeCost, "Cost optimization", "user-123")

	err := session.AddAction(ctx, inv.ID, "action-scale-down-deployment")
	if err != nil {
		t.Fatalf("Failed to add action: %v", err)
	}

	retrieved, _ := session.GetInvestigation(ctx, inv.ID)
	if len(retrieved.Actions) != 1 {
		t.Errorf("Expected 1 action, got %d", len(retrieved.Actions))
	}
}

func TestCancelInvestigation(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	inv, _ := session.CreateInvestigation(ctx, TypeProactive, "Proactive check", "user-123")
	session.UpdateState(ctx, inv.ID, StateInvestigating)

	err := session.CancelInvestigation(ctx, inv.ID)
	if err != nil {
		t.Fatalf("Failed to cancel investigation: %v", err)
	}

	retrieved, _ := session.GetInvestigation(ctx, inv.ID)
	if retrieved.State != StateCancelled {
		t.Errorf("Expected state %s, got %s", StateCancelled, retrieved.State)
	}
	if retrieved.ConcludedAt == nil {
		t.Error("Expected ConcludedAt to be set when cancelled")
	}
}

func TestArchiveInvestigation(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	inv, _ := session.CreateInvestigation(ctx, TypeAnomalies, "Anomaly test", "user-123")
	session.UpdateState(ctx, inv.ID, StateInvestigating)
	session.UpdateState(ctx, inv.ID, StateConcluded)

	err := session.ArchiveInvestigation(ctx, inv.ID)
	if err != nil {
		t.Fatalf("Failed to archive investigation: %v", err)
	}

	retrieved, _ := session.GetInvestigation(ctx, inv.ID)
	if retrieved.State != StateArchived {
		t.Errorf("Expected state %s, got %s", StateArchived, retrieved.State)
	}
}

func TestListInvestigations(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	// Create multiple investigations
	session.CreateInvestigation(ctx, TypePodCrash, "Investigation 1", "user-123")
	session.CreateInvestigation(ctx, TypePerformance, "Investigation 2", "user-123")
	session.CreateInvestigation(ctx, TypeSecurity, "Investigation 3", "user-456")

	list, err := session.ListInvestigations(ctx, nil)
	if err != nil {
		t.Fatalf("Failed to list investigations: %v", err)
	}

	if len(list) != 3 {
		t.Errorf("Expected 3 investigations, got %d", len(list))
	}
}

func TestCompleteinvestigationLifecycle(t *testing.T) {
	session := setupTestSession(t)
	ctx := context.Background()

	// Create
	inv, err := session.CreateInvestigation(ctx, TypePodCrash, "Complete lifecycle test", "user-123")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if inv.State != StateCreated {
		t.Errorf("Expected initial state %s, got %s", StateCreated, inv.State)
	}

	// Add hypothesis
	hypothesis := Hypothesis{Statement: "Memory leak", Confidence: 70}
	session.AddHypothesis(ctx, inv.ID, hypothesis)

	// Start investigating
	session.UpdateState(ctx, inv.ID, StateInvestigating)

	// Add tool calls
	session.AddToolCall(ctx, inv.ID, "observe_resource", map[string]interface{}{"kind": "Pod"}, map[string]interface{}{"status": "Running"})
	session.AddToolCall(ctx, inv.ID, "observe_pod_logs", map[string]interface{}{"pod_name": "test"}, map[string]interface{}{"logs": "OOM killed"})

	// Add findings
	session.AddFinding(ctx, inv.ID, "Pod memory usage exceeded limit", map[string]interface{}{"memory": "512Mi"}, 85)
	session.AddFinding(ctx, inv.ID, "Memory limit too low for workload", map[string]interface{}{"recommended": "1Gi"}, 90)

	// Set conclusion
	conclusion := Conclusion{RootCause: "Insufficient memory allocation"}
	session.SetConclusion(ctx, inv.ID, conclusion, 90)

	// Add proposed action
	session.AddAction(ctx, inv.ID, "increase-memory-limit")

	// Conclude
	session.UpdateState(ctx, inv.ID, StateConcluded)

	// Verify final state
	final, _ := session.GetInvestigation(ctx, inv.ID)
	if final.State != StateConcluded {
		t.Errorf("Expected final state %s, got %s", StateConcluded, final.State)
	}
	if len(final.ToolCalls) != 2 {
		t.Errorf("Expected 2 tool calls, got %d", len(final.ToolCalls))
	}
	if len(final.Findings) != 2 {
		t.Errorf("Expected 2 findings, got %d", len(final.Findings))
	}
	if len(final.Actions) != 1 {
		t.Errorf("Expected 1 action, got %d", len(final.Actions))
	}
	if final.Confidence != 90 {
		t.Errorf("Expected confidence 90, got %d", final.Confidence)
	}

	// Archive
	session.ArchiveInvestigation(ctx, inv.ID)
	archived, _ := session.GetInvestigation(ctx, inv.ID)
	if archived.State != StateArchived {
		t.Errorf("Expected archived state, got %s", archived.State)
	}

	t.Log("Complete lifecycle test passed")
}
