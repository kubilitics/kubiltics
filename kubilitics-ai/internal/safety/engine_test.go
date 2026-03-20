package safety

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/db"
)

func TestNewEngine_AllComponentsInitialized(t *testing.T) {
	store, _ := db.NewSQLiteStore(":memory:")
	engine, err := NewEngine(store)
	if err != nil {
		t.Fatalf("NewEngine() error: %v", err)
	}
	if engine.policyEngine == nil {
		t.Error("policyEngine should be initialized")
	}
	if engine.blastCalculator == nil {
		t.Error("blastCalculator should be initialized")
	}
	if engine.autonomyController == nil {
		t.Error("autonomyController should be initialized")
	}
	if engine.rollbackManager == nil {
		t.Error("rollbackManager should be initialized")
	}
}

func TestEvaluateAction_DenyKubeSystemDelete(t *testing.T) {
	store, _ := db.NewSQLiteStore(":memory:")
	engine, _ := NewEngine(store)
	action := &Action{
		ID:           "test-001",
		Operation:    "delete",
		ResourceType: "Pod",
		ResourceName: "coredns",
		Namespace:    "kube-system",
		UserID:       "user-1",
		Timestamp:    time.Now(),
		TargetState:  map[string]interface{}{},
		Metadata:     map[string]interface{}{},
	}
	result, err := engine.EvaluateAction(context.Background(), action)
	if err != nil {
		t.Fatalf("EvaluateAction error: %v", err)
	}
	if result.Approved {
		t.Error("Expected Approved=false for kube-system delete")
	}
	if result.Result != "deny" {
		t.Errorf("Expected result=deny, got %s", result.Result)
	}
}

func TestEvaluateAction_DenyProductionScaleToZero(t *testing.T) {
	store, _ := db.NewSQLiteStore(":memory:")
	engine, _ := NewEngine(store)
	action := &Action{
		ID:           "test-002",
		Operation:    "scale",
		ResourceType: "Deployment",
		ResourceName: "payment-service",
		Namespace:    "production",
		UserID:       "user-1",
		Timestamp:    time.Now(),
		TargetState:  map[string]interface{}{"replicas": 0},
		Metadata:     map[string]interface{}{},
	}
	result, err := engine.EvaluateAction(context.Background(), action)
	if err != nil {
		t.Fatalf("EvaluateAction error: %v", err)
	}
	if result.Approved {
		t.Error("Expected Approved=false for scale-to-zero in production")
	}
	if result.Result != "deny" {
		t.Errorf("Expected result=deny, got %s", result.Result)
	}
}

func TestEvaluateAction_SafeRestartApproved(t *testing.T) {
	store, _ := db.NewSQLiteStore(":memory:")
	engine, _ := NewEngine(store)
	// Set high autonomy level so restart is auto-approved
	_ = engine.SetAutonomyLevel(context.Background(), "user-1", 4) // LevelActWithGuard
	action := &Action{
		ID:           "test-003",
		Operation:    "restart",
		ResourceType: "Pod",
		ResourceName: "app-pod",
		Namespace:    "default",
		UserID:       "user-1",
		Timestamp:    time.Now(),
		TargetState:  map[string]interface{}{},
		Metadata:     map[string]interface{}{},
	}
	result, err := engine.EvaluateAction(context.Background(), action)
	if err != nil {
		t.Fatalf("EvaluateAction error: %v", err)
	}
	if !result.Approved {
		t.Errorf("Expected Approved=true for safe restart: result=%s reason=%s", result.Result, result.Reason)
	}
}

func TestEvaluateAction_RequiresApproval_LowAutonomy(t *testing.T) {
	store, _ := db.NewSQLiteStore(":memory:")
	engine, _ := NewEngine(store)
	// Level 0 (below LevelObserve=1) — requires approval for everything
	_ = engine.SetAutonomyLevel(context.Background(), "user-2", 0)
	action := &Action{
		ID:           "test-004",
		Operation:    "scale",
		ResourceType: "Deployment",
		ResourceName: "app",
		Namespace:    "staging",
		UserID:       "user-2",
		Timestamp:    time.Now(),
		TargetState:  map[string]interface{}{"replicas": 5},
		Metadata:     map[string]interface{}{},
	}
	result, err := engine.EvaluateAction(context.Background(), action)
	if err != nil {
		t.Fatalf("EvaluateAction error: %v", err)
	}
	if result.Result != "request_approval" {
		t.Errorf("Expected request_approval for low autonomy scale, got: %s", result.Result)
	}
	if !result.RequiresHuman {
		t.Error("Expected RequiresHuman=true")
	}
}

func TestEvaluateAction_PolicyChecksPopulated(t *testing.T) {
	store, _ := db.NewSQLiteStore(":memory:")
	engine, _ := NewEngine(store)
	action := &Action{
		ID:           "test-005",
		Operation:    "restart",
		ResourceType: "Pod",
		ResourceName: "app",
		Namespace:    "default",
		UserID:       "user-1",
		Timestamp:    time.Now(),
		TargetState:  map[string]interface{}{},
		Metadata:     map[string]interface{}{},
	}
	result, err := engine.EvaluateAction(context.Background(), action)
	if err != nil {
		t.Fatalf("EvaluateAction error: %v", err)
	}
	if len(result.PolicyChecks) == 0 {
		t.Error("Expected at least 1 PolicyCheck in result")
	}
}

func TestEvaluateAction_RiskLevelSet(t *testing.T) {
	store, _ := db.NewSQLiteStore(":memory:")
	engine, _ := NewEngine(store)
	action := &Action{
		ID:           "test-006",
		Operation:    "delete",
		ResourceType: "Deployment",
		ResourceName: "app",
		Namespace:    "default",
		UserID:       "user-1",
		Timestamp:    time.Now(),
		TargetState:  map[string]interface{}{},
		Metadata:     map[string]interface{}{},
	}
	result, err := engine.EvaluateAction(context.Background(), action)
	if err != nil {
		t.Fatalf("EvaluateAction error: %v", err)
	}
	if result.RiskLevel == "" {
		t.Error("Expected RiskLevel to be set")
	}
}

func TestSetAndGetAutonomyLevel(t *testing.T) {
	store, _ := db.NewSQLiteStore(":memory:")
	engine, _ := NewEngine(store)
	ctx := context.Background()

	tests := []struct {
		userID string
		level  int
	}{
		{"user-a", 0},
		{"user-b", 2},
		{"user-c", 4},
	}
	for _, tc := range tests {
		if err := engine.SetAutonomyLevel(ctx, tc.userID, tc.level); err != nil {
			t.Errorf("SetAutonomyLevel(%d) error: %v", tc.level, err)
		}
		got, err := engine.GetAutonomyLevel(ctx, tc.userID)
		if err != nil {
			t.Errorf("GetAutonomyLevel error: %v", err)
		}
		if got != tc.level {
			t.Errorf("Expected level %d, got %d", tc.level, got)
		}
	}
}

func TestGetImmutableRules_NonEmpty(t *testing.T) {
	store, _ := db.NewSQLiteStore(":memory:")
	engine, _ := NewEngine(store)
	rules, err := engine.GetImmutableRules(context.Background())
	if err != nil {
		t.Fatalf("GetImmutableRules error: %v", err)
	}
	if len(rules) == 0 {
		t.Error("Expected at least 1 immutable rule")
	}
	for _, r := range rules {
		if r == "" {
			t.Error("Rule name should not be empty")
		}
	}
}

func TestCreatePolicy_And_Evaluate(t *testing.T) {
	store, _ := db.NewSQLiteStore(":memory:")
	sStore := store.(db.SafetyPolicyStore)
	_ = sStore.CreatePolicy(context.Background(), &db.SafetyPolicyRecord{Name: "init_schema_hack"}) // Hack to ensure table created? No, migration runs on NewSQLiteStore

	engine, _ := NewEngine(store)
	ctx := context.Background()

	// Create a policy that denies actions in namespace "blocked"
	err := engine.CreatePolicy(ctx, "block-namespace", map[string]interface{}{
		"condition": "namespace=blocked",
		"effect":    "deny",
		"reason":    "Namespace 'blocked' is restricted",
	})
	if err != nil {
		t.Fatalf("CreatePolicy error: %v", err)
	}

	action := &Action{
		ID:           "test-policy-001",
		Operation:    "scale",
		ResourceType: "Deployment",
		ResourceName: "app",
		Namespace:    "blocked",
		UserID:       "user-1",
		Timestamp:    time.Now(),
		TargetState:  map[string]interface{}{},
		Metadata:     map[string]interface{}{},
	}
	result, err := engine.EvaluateAction(ctx, action)
	if err != nil {
		t.Fatalf("EvaluateAction error: %v", err)
	}
	if result.Approved {
		t.Error("Expected Approved=false for blocked namespace")
	}
	if result.Result != "deny" {
		t.Errorf("Expected deny for blocked namespace, got: %s reason: %s", result.Result, result.Reason)
	}
	if !strings.Contains(result.Reason, "blocked") {
		t.Errorf("Expected reason to mention 'blocked', got: %s", result.Reason)
	}
}

func TestDeletePolicy(t *testing.T) {
	store, _ := db.NewSQLiteStore(":memory:")
	engine, _ := NewEngine(store)
	ctx := context.Background()

	_ = engine.CreatePolicy(ctx, "temp-policy", map[string]interface{}{
		"condition": "namespace=temp",
		"effect":    "deny",
		"reason":    "Temporary restriction",
	})

	if err := engine.DeletePolicy(ctx, "temp-policy"); err != nil {
		t.Fatalf("DeletePolicy error: %v", err)
	}

	// After delete, actions in "temp" namespace should not be denied by this policy
	action := &Action{
		ID:           "test-delete-policy",
		Operation:    "restart",
		ResourceType: "Pod",
		ResourceName: "app",
		Namespace:    "temp",
		UserID:       "user-1",
		Timestamp:    time.Now(),
		TargetState:  map[string]interface{}{},
		Metadata:     map[string]interface{}{},
	}
	_ = engine.SetAutonomyLevel(ctx, "user-1", 4)
	result, err := engine.EvaluateAction(ctx, action)
	if err != nil {
		t.Fatalf("EvaluateAction error: %v", err)
	}
	if result.Result == "deny" {
		t.Error("Expected policy to be deleted and not deny anymore")
	}
}

func TestCreateRollbackCheckpoint(t *testing.T) {
	store, _ := db.NewSQLiteStore(":memory:")
	engine, _ := NewEngine(store)
	action := &Action{
		ID:           "test-rollback",
		Operation:    "scale",
		ResourceType: "Deployment",
		ResourceName: "app",
		Namespace:    "default",
		UserID:       "user-1",
		Timestamp:    time.Now(),
		TargetState:  map[string]interface{}{},
		Metadata:     map[string]interface{}{},
	}
	checkpointID, err := engine.CreateRollbackCheckpoint(context.Background(), action)
	if err != nil {
		t.Fatalf("CreateRollbackCheckpoint error: %v", err)
	}
	if checkpointID == "" {
		t.Error("Expected non-empty checkpoint ID")
	}
}

func TestEstimateDowntime(t *testing.T) {
	store, _ := db.NewSQLiteStore(":memory:")
	engine, _ := NewEngine(store)
	action := &Action{
		ID:           "test-downtime",
		Operation:    "drain",
		ResourceType: "Node",
		ResourceName: "node-1",
		Namespace:    "",
		UserID:       "user-1",
		Timestamp:    time.Now(),
		TargetState:  map[string]interface{}{},
		Metadata:     map[string]interface{}{},
	}
	minDown, maxDown, err := engine.EstimateDowntime(context.Background(), action)
	if err != nil {
		t.Fatalf("EstimateDowntime error: %v", err)
	}
	// drain is high-risk — should have some downtime estimate
	_ = minDown
	_ = maxDown
	t.Logf("Estimated downtime: %d-%d seconds", minDown, maxDown)
}
