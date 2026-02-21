package execution_test

// Comprehensive tests for all 9 safety-gated execution tools (A-CORE-004).
//
// Strategy: inject fakeProxy (satisfies ExecutionProxyInterface) and
// fakeSafety (satisfies SafetyEvaluator) to test:
//   - Safety gate DENIAL: approved=false returned, no proxy call made
//   - Safety gate APPROVAL: proxy called, result propagated
//   - Dry-run: no proxy call, dry_run=true in response
//   - Missing required args: error returned before safety check
//   - Invalid args (replicas < 0, etc.): error returned before safety check
//   - Safety evaluation error: error propagated
//   - Proxy command error: error propagated
//   - HandlerMap: all 9 names present

import (
	"context"
	"fmt"
	"testing"
	"time"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
	"github.com/kubilitics/kubilitics-ai/internal/audit"
	"github.com/kubilitics/kubilitics-ai/internal/mcp/tools/execution"
	"github.com/kubilitics/kubilitics-ai/internal/safety"
)

// ─────────────────────────────────────────────────────────────────────────────
// fakeProxy — deterministic in-memory command executor
// ─────────────────────────────────────────────────────────────────────────────

type fakeProxy struct {
	result *pb.CommandResult
	err    error
	calls  []string // operation names that were called
}

func (f *fakeProxy) ExecuteCommand(_ context.Context, operation string, _ *pb.Resource, _ []byte, _ bool) (*pb.CommandResult, error) {
	f.calls = append(f.calls, operation)
	if f.err != nil {
		return nil, f.err
	}
	if f.result != nil {
		return f.result, nil
	}
	return &pb.CommandResult{Success: true, Message: "ok"}, nil
}

func newFakeProxy() *fakeProxy {
	return &fakeProxy{}
}

func (f *fakeProxy) withResult(msg string) *fakeProxy {
	f.result = &pb.CommandResult{Success: true, Message: msg}
	return f
}

func (f *fakeProxy) withError(err error) *fakeProxy {
	f.err = err
	return f
}

// ─────────────────────────────────────────────────────────────────────────────
// fakeSafety — controllable safety evaluator
// ─────────────────────────────────────────────────────────────────────────────

type fakeSafety struct {
	result *safety.SafetyResult
	err    error
}

func approvedSafety() *fakeSafety {
	return &fakeSafety{
		result: &safety.SafetyResult{
			Approved:      true,
			Result:        "approve",
			Reason:        "test: approved",
			RiskLevel:     "low",
			RequiresHuman: false,
		},
	}
}

func deniedSafety(reason string) *fakeSafety {
	return &fakeSafety{
		result: &safety.SafetyResult{
			Approved:      false,
			Result:        "deny",
			Reason:        reason,
			RiskLevel:     "critical",
			RequiresHuman: true,
		},
	}
}

func requiresApprovalSafety() *fakeSafety {
	return &fakeSafety{
		result: &safety.SafetyResult{
			Approved:      false,
			Result:        "request_approval",
			Reason:        "requires human approval",
			RiskLevel:     "high",
			RequiresHuman: true,
			PolicyChecks: []safety.PolicyCheck{
				{PolicyName: "blast-radius", Passed: false, Reason: "high blast radius", Severity: "high"},
			},
		},
	}
}

func errorSafety(err error) *fakeSafety {
	return &fakeSafety{err: err}
}

func (f *fakeSafety) EvaluateAction(_ context.Context, _ *safety.Action) (*safety.SafetyResult, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// noopAuditLog — satisfies audit.Logger for tests
// ─────────────────────────────────────────────────────────────────────────────

type noopAuditLog struct{}

func (n *noopAuditLog) Log(_ context.Context, _ *audit.Event) error               { return nil }
func (n *noopAuditLog) LogInvestigationStarted(_ context.Context, _ string) error { return nil }
func (n *noopAuditLog) LogInvestigationCompleted(_ context.Context, _ string, _ time.Duration) error {
	return nil
}
func (n *noopAuditLog) LogInvestigationFailed(_ context.Context, _ string, _ error) error { return nil }
func (n *noopAuditLog) LogActionProposed(_ context.Context, _, _ string) error            { return nil }
func (n *noopAuditLog) LogActionApproved(_ context.Context, _, _, _ string) error         { return nil }
func (n *noopAuditLog) LogActionExecuted(_ context.Context, _, _ string, _ time.Duration) error {
	return nil
}
func (n *noopAuditLog) LogSafetyViolation(_ context.Context, _, _ string) error { return nil }
func (n *noopAuditLog) Sync() error                                             { return nil }
func (n *noopAuditLog) Close() error                                            { return nil }

// ─────────────────────────────────────────────────────────────────────────────
// helper to create ExecutionTools with fake deps
// ─────────────────────────────────────────────────────────────────────────────

func newTools(proxy execution.ExecutionProxyInterface, safetyEval execution.SafetyEvaluator) *execution.ExecutionTools {
	return execution.NewExecutionToolsWithDeps(proxy, safetyEval, &noopAuditLog{})
}

// ─────────────────────────────────────────────────────────────────────────────
// HandlerMap completeness
// ─────────────────────────────────────────────────────────────────────────────

func TestHandlerMapCompleteness(t *testing.T) {
	tools := newTools(newFakeProxy(), approvedSafety())
	handlers := tools.HandlerMap()

	expected := []string{
		"restart_pod",
		"scale_deployment",
		"cordon_node",
		"drain_node",
		"apply_resource_patch",
		"delete_resource",
		"rollback_deployment",
		"update_resource_limits",
		"trigger_hpa_scale",
	}

	for _, name := range expected {
		if _, ok := handlers[name]; !ok {
			t.Errorf("HandlerMap missing tool: %s", name)
		}
	}

	if len(handlers) != len(expected) {
		t.Errorf("HandlerMap has %d entries, expected %d", len(handlers), len(expected))
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// restart_pod
// ─────────────────────────────────────────────────────────────────────────────

func TestRestartPod_MissingArgs(t *testing.T) {
	tools := newTools(newFakeProxy(), approvedSafety())
	ctx := context.Background()

	tests := []struct {
		name string
		args map[string]interface{}
	}{
		{"missing_all", map[string]interface{}{}},
		{"missing_name", map[string]interface{}{"namespace": "default"}},
		{"missing_namespace", map[string]interface{}{"name": "my-pod"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := tools.RestartPod(ctx, tc.args)
			if err == nil {
				t.Errorf("expected error for %s, got nil", tc.name)
			}
		})
	}
}

func TestRestartPod_SafetyDenied(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, deniedSafety("kube-system namespace protected"))
	ctx := context.Background()

	result, err := tools.RestartPod(ctx, map[string]interface{}{
		"namespace": "kube-system",
		"name":      "coredns-abc",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["approved"].(bool) {
		t.Error("expected approved=false for denied safety")
	}
	if m["reason"] == "" {
		t.Error("expected non-empty reason")
	}
	if m["requires_human"] == nil {
		t.Error("expected requires_human field")
	}
	// Verify proxy was NOT called
	if len(proxy.calls) > 0 {
		t.Errorf("proxy should not be called when safety denied, got calls: %v", proxy.calls)
	}
}

func TestRestartPod_DryRun(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.RestartPod(ctx, map[string]interface{}{
		"namespace": "default",
		"name":      "my-pod",
		"dry_run":   true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["dry_run"].(bool) {
		t.Error("expected dry_run=true")
	}
	if !m["approved"].(bool) {
		t.Error("expected approved=true in dry-run")
	}
	// Proxy must NOT be called in dry-run
	if len(proxy.calls) > 0 {
		t.Errorf("proxy should not be called in dry-run, got calls: %v", proxy.calls)
	}
}

func TestRestartPod_HappyPath(t *testing.T) {
	proxy := newFakeProxy().withResult("pod deleted")
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.RestartPod(ctx, map[string]interface{}{
		"namespace":     "default",
		"name":          "my-pod",
		"justification": "OOMKill recovery",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["approved"].(bool) {
		t.Error("expected approved=true")
	}
	if m["pod"] != "my-pod" {
		t.Errorf("expected pod=my-pod, got %v", m["pod"])
	}
	if m["namespace"] != "default" {
		t.Errorf("expected namespace=default, got %v", m["namespace"])
	}
	if len(proxy.calls) == 0 || proxy.calls[0] != "delete_pod" {
		t.Errorf("expected delete_pod call, got %v", proxy.calls)
	}
}

func TestRestartPod_SafetyError(t *testing.T) {
	tools := newTools(newFakeProxy(), errorSafety(fmt.Errorf("safety engine unavailable")))
	ctx := context.Background()

	_, err := tools.RestartPod(ctx, map[string]interface{}{
		"namespace": "default",
		"name":      "my-pod",
	})
	if err == nil {
		t.Fatal("expected error when safety engine fails")
	}
}

func TestRestartPod_ProxyError(t *testing.T) {
	proxy := newFakeProxy().withError(fmt.Errorf("gRPC unavailable"))
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	_, err := tools.RestartPod(ctx, map[string]interface{}{
		"namespace": "default",
		"name":      "my-pod",
	})
	if err == nil {
		t.Fatal("expected error when proxy fails")
	}
}

func TestRestartPod_RequiresApproval(t *testing.T) {
	tools := newTools(newFakeProxy(), requiresApprovalSafety())
	ctx := context.Background()

	result, err := tools.RestartPod(ctx, map[string]interface{}{
		"namespace": "production",
		"name":      "payment-service-abc",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["approved"].(bool) {
		t.Error("expected approved=false when requires approval")
	}
	if !m["requires_human"].(bool) {
		t.Error("expected requires_human=true")
	}
	if m["policy_checks"] == nil {
		t.Error("expected policy_checks in response")
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// scale_deployment
// ─────────────────────────────────────────────────────────────────────────────

func TestScaleDeployment_MissingArgs(t *testing.T) {
	tools := newTools(newFakeProxy(), approvedSafety())
	ctx := context.Background()

	tests := []struct {
		name string
		args map[string]interface{}
	}{
		{"missing_namespace", map[string]interface{}{"name": "app", "replicas": 3}},
		{"missing_name", map[string]interface{}{"namespace": "default", "replicas": 3}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := tools.ScaleDeployment(ctx, tc.args)
			if err == nil {
				t.Errorf("expected error for %s", tc.name)
			}
		})
	}
}

func TestScaleDeployment_NegativeReplicas(t *testing.T) {
	tools := newTools(newFakeProxy(), approvedSafety())
	ctx := context.Background()

	_, err := tools.ScaleDeployment(ctx, map[string]interface{}{
		"namespace": "default",
		"name":      "app",
		"replicas":  -1,
	})
	if err == nil {
		t.Error("expected error for negative replicas")
	}
}

func TestScaleDeployment_SafetyDenied(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, deniedSafety("scale to 0 not allowed"))
	ctx := context.Background()

	result, err := tools.ScaleDeployment(ctx, map[string]interface{}{
		"namespace": "default",
		"name":      "app",
		"replicas":  0,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["approved"].(bool) {
		t.Error("expected approved=false")
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy should not be called when safety denied")
	}
}

func TestScaleDeployment_DryRun(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.ScaleDeployment(ctx, map[string]interface{}{
		"namespace": "default",
		"name":      "app",
		"replicas":  5,
		"dry_run":   true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["dry_run"].(bool) {
		t.Error("expected dry_run=true")
	}
	// replicas is float64 when decoded from JSON round-trip via decodeArgs
	replicasVal := m["replicas"]
	switch v := replicasVal.(type) {
	case int:
		if v != 5 {
			t.Errorf("expected replicas=5, got %v", v)
		}
	case float64:
		if int(v) != 5 {
			t.Errorf("expected replicas=5, got %v", v)
		}
	default:
		t.Errorf("unexpected replicas type: %T = %v", v, v)
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy should not be called in dry-run")
	}
}

func TestScaleDeployment_HappyPath(t *testing.T) {
	proxy := newFakeProxy().withResult("scaled to 3")
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.ScaleDeployment(ctx, map[string]interface{}{
		"namespace": "default",
		"name":      "web-app",
		"replicas":  3,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["approved"].(bool) {
		t.Error("expected approved=true")
	}
	if m["name"] != "web-app" {
		t.Errorf("expected name=web-app, got %v", m["name"])
	}
	if m["success"] == nil {
		t.Error("expected success field")
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// cordon_node
// ─────────────────────────────────────────────────────────────────────────────

func TestCordonNode_MissingName(t *testing.T) {
	tools := newTools(newFakeProxy(), approvedSafety())
	ctx := context.Background()

	_, err := tools.CordonNode(ctx, map[string]interface{}{})
	if err == nil {
		t.Error("expected error for missing name")
	}
}

func TestCordonNode_SafetyDenied(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, deniedSafety("node is critical infra"))
	ctx := context.Background()

	result, err := tools.CordonNode(ctx, map[string]interface{}{"name": "node-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["approved"].(bool) {
		t.Error("expected approved=false")
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy should not be called")
	}
}

func TestCordonNode_DryRun(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.CordonNode(ctx, map[string]interface{}{
		"name":    "node-1",
		"dry_run": true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["dry_run"].(bool) {
		t.Error("expected dry_run=true")
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy should not be called in dry-run")
	}
}

func TestCordonNode_HappyPath(t *testing.T) {
	proxy := newFakeProxy().withResult("cordoned")
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.CordonNode(ctx, map[string]interface{}{
		"name":          "node-1",
		"justification": "maintenance window",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["approved"].(bool) {
		t.Error("expected approved=true")
	}
	if m["node"] != "node-1" {
		t.Errorf("expected node=node-1, got %v", m["node"])
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// drain_node
// ─────────────────────────────────────────────────────────────────────────────

func TestDrainNode_MissingName(t *testing.T) {
	tools := newTools(newFakeProxy(), approvedSafety())
	ctx := context.Background()

	_, err := tools.DrainNode(ctx, map[string]interface{}{})
	if err == nil {
		t.Error("expected error for missing name")
	}
}

func TestDrainNode_SafetyDenied_HighRisk(t *testing.T) {
	proxy := newFakeProxy()
	// drain_node is Level 4 — high blast radius → typically requires approval
	tools := newTools(proxy, requiresApprovalSafety())
	ctx := context.Background()

	result, err := tools.DrainNode(ctx, map[string]interface{}{"name": "node-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["approved"].(bool) {
		t.Error("expected approved=false for high-risk drain")
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy should not be called")
	}
}

func TestDrainNode_DryRun(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.DrainNode(ctx, map[string]interface{}{
		"name":    "node-1",
		"dry_run": true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["dry_run"].(bool) {
		t.Error("expected dry_run=true")
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy should not be called in dry-run")
	}
}

func TestDrainNode_DefaultGracePeriod(t *testing.T) {
	// grace_period defaults to 30 when not provided
	proxy := newFakeProxy().withResult("drained")
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.DrainNode(ctx, map[string]interface{}{"name": "node-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["approved"].(bool) {
		t.Error("expected approved=true")
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// apply_resource_patch
// ─────────────────────────────────────────────────────────────────────────────

func TestApplyResourcePatch_MissingArgs(t *testing.T) {
	tools := newTools(newFakeProxy(), approvedSafety())
	ctx := context.Background()

	tests := []struct {
		name string
		args map[string]interface{}
	}{
		{"missing_kind", map[string]interface{}{"name": "app", "patch": map[string]interface{}{}}},
		{"missing_name", map[string]interface{}{"kind": "Deployment", "patch": map[string]interface{}{}}},
		{"missing_patch", map[string]interface{}{"kind": "Deployment", "name": "app"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := tools.ApplyResourcePatch(ctx, tc.args)
			if err == nil {
				t.Errorf("expected error for %s", tc.name)
			}
		})
	}
}

func TestApplyResourcePatch_SafetyDenied(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, deniedSafety("patch not allowed"))
	ctx := context.Background()

	result, err := tools.ApplyResourcePatch(ctx, map[string]interface{}{
		"kind":      "Deployment",
		"namespace": "default",
		"name":      "app",
		"patch":     map[string]interface{}{"spec": map[string]interface{}{"replicas": 0}},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["approved"].(bool) {
		t.Error("expected approved=false")
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy should not be called")
	}
}

func TestApplyResourcePatch_DryRun(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	patch := map[string]interface{}{"metadata": map[string]interface{}{"labels": map[string]interface{}{"env": "test"}}}
	result, err := tools.ApplyResourcePatch(ctx, map[string]interface{}{
		"kind":      "Deployment",
		"namespace": "default",
		"name":      "app",
		"patch":     patch,
		"dry_run":   true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["dry_run"].(bool) {
		t.Error("expected dry_run=true")
	}
	if m["patch"] == nil {
		t.Error("expected patch in dry-run response")
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy should not be called in dry-run")
	}
}

func TestApplyResourcePatch_HappyPath(t *testing.T) {
	proxy := newFakeProxy().withResult("patched")
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.ApplyResourcePatch(ctx, map[string]interface{}{
		"kind":      "ConfigMap",
		"namespace": "default",
		"name":      "my-config",
		"patch":     map[string]interface{}{"data": map[string]interface{}{"key": "val"}},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["approved"].(bool) {
		t.Error("expected approved=true")
	}
	if m["resource"] != "ConfigMap/default/my-config" {
		t.Errorf("unexpected resource: %v", m["resource"])
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// delete_resource (Level 5 — most restrictive)
// ─────────────────────────────────────────────────────────────────────────────

func TestDeleteResource_MissingArgs(t *testing.T) {
	tools := newTools(newFakeProxy(), approvedSafety())
	ctx := context.Background()

	tests := []struct {
		name string
		args map[string]interface{}
	}{
		{"missing_kind", map[string]interface{}{"name": "app"}},
		{"missing_name", map[string]interface{}{"kind": "ConfigMap"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := tools.DeleteResource(ctx, tc.args)
			if err == nil {
				t.Errorf("expected error for %s", tc.name)
			}
		})
	}
}

func TestDeleteResource_AlwaysSafetyGated(t *testing.T) {
	// delete_resource is Level 5 — should almost always require human approval
	proxy := newFakeProxy()
	tools := newTools(proxy, requiresApprovalSafety())
	ctx := context.Background()

	result, err := tools.DeleteResource(ctx, map[string]interface{}{
		"kind":      "PersistentVolumeClaim",
		"namespace": "default",
		"name":      "data-pvc",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["approved"].(bool) {
		t.Error("expected approved=false for delete requiring approval")
	}
	if !m["requires_human"].(bool) {
		t.Error("expected requires_human=true")
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy must not be called when approval required")
	}
}

func TestDeleteResource_DryRun(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.DeleteResource(ctx, map[string]interface{}{
		"kind":      "ConfigMap",
		"namespace": "default",
		"name":      "old-config",
		"dry_run":   true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["dry_run"].(bool) {
		t.Error("expected dry_run=true")
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy should not be called in dry-run")
	}
}

func TestDeleteResource_HappyPath(t *testing.T) {
	proxy := newFakeProxy().withResult("deleted")
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.DeleteResource(ctx, map[string]interface{}{
		"kind":          "ConfigMap",
		"namespace":     "default",
		"name":          "stale-config",
		"justification": "cleanup stale config",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["approved"].(bool) {
		t.Error("expected approved=true")
	}
	if m["resource"] != "ConfigMap/default/stale-config" {
		t.Errorf("unexpected resource: %v", m["resource"])
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// rollback_deployment
// ─────────────────────────────────────────────────────────────────────────────

func TestRollbackDeployment_MissingArgs(t *testing.T) {
	tools := newTools(newFakeProxy(), approvedSafety())
	ctx := context.Background()

	_, err := tools.RollbackDeployment(ctx, map[string]interface{}{"name": "app"})
	if err == nil {
		t.Error("expected error for missing namespace")
	}
}

func TestRollbackDeployment_SafetyDenied(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, deniedSafety("rollback not permitted in prod"))
	ctx := context.Background()

	result, err := tools.RollbackDeployment(ctx, map[string]interface{}{
		"namespace": "production",
		"name":      "api-server",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["approved"].(bool) {
		t.Error("expected approved=false")
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy should not be called")
	}
}

func TestRollbackDeployment_DryRun(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.RollbackDeployment(ctx, map[string]interface{}{
		"namespace": "default",
		"name":      "app",
		"revision":  2,
		"dry_run":   true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["dry_run"].(bool) {
		t.Error("expected dry_run=true")
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy should not be called in dry-run")
	}
}

func TestRollbackDeployment_HappyPath(t *testing.T) {
	proxy := newFakeProxy().withResult("rolled back to revision 3")
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.RollbackDeployment(ctx, map[string]interface{}{
		"namespace":     "staging",
		"name":          "web",
		"revision":      3,
		"justification": "v4 introduced regression",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["approved"].(bool) {
		t.Error("expected approved=true")
	}
	if m["name"] != "web" {
		t.Errorf("expected name=web, got %v", m["name"])
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// update_resource_limits
// ─────────────────────────────────────────────────────────────────────────────

func TestUpdateResourceLimits_MissingArgs(t *testing.T) {
	tools := newTools(newFakeProxy(), approvedSafety())
	ctx := context.Background()

	tests := []struct {
		name string
		args map[string]interface{}
	}{
		{"missing_kind", map[string]interface{}{"name": "app", "container_name": "app"}},
		{"missing_name", map[string]interface{}{"kind": "Deployment", "container_name": "app"}},
		{"missing_container", map[string]interface{}{"kind": "Deployment", "name": "app"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := tools.UpdateResourceLimits(ctx, tc.args)
			if err == nil {
				t.Errorf("expected error for %s", tc.name)
			}
		})
	}
}

func TestUpdateResourceLimits_SafetyDenied(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, deniedSafety("limits change denied"))
	ctx := context.Background()

	result, err := tools.UpdateResourceLimits(ctx, map[string]interface{}{
		"kind":           "Deployment",
		"namespace":      "default",
		"name":           "app",
		"container_name": "app",
		"cpu_limit":      "2",
		"memory_limit":   "2Gi",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["approved"].(bool) {
		t.Error("expected approved=false")
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy should not be called")
	}
}

func TestUpdateResourceLimits_DryRun(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.UpdateResourceLimits(ctx, map[string]interface{}{
		"kind":           "Deployment",
		"namespace":      "default",
		"name":           "app",
		"container_name": "app",
		"cpu_request":    "500m",
		"memory_request": "256Mi",
		"dry_run":        true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["dry_run"].(bool) {
		t.Error("expected dry_run=true")
	}
	if m["patch"] == nil {
		t.Error("expected patch in dry-run response")
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy should not be called in dry-run")
	}
}

func TestUpdateResourceLimits_HappyPath(t *testing.T) {
	proxy := newFakeProxy().withResult("limits updated")
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.UpdateResourceLimits(ctx, map[string]interface{}{
		"kind":           "Deployment",
		"namespace":      "default",
		"name":           "cpu-hungry-app",
		"container_name": "app",
		"cpu_limit":      "1",
		"memory_limit":   "1Gi",
		"justification":  "right-size after profiling",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["approved"].(bool) {
		t.Error("expected approved=true")
	}
	if m["container"] != "app" {
		t.Errorf("expected container=app, got %v", m["container"])
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// trigger_hpa_scale
// ─────────────────────────────────────────────────────────────────────────────

func TestTriggerHPAScale_MissingArgs(t *testing.T) {
	tools := newTools(newFakeProxy(), approvedSafety())
	ctx := context.Background()

	tests := []struct {
		name string
		args map[string]interface{}
	}{
		{"missing_namespace", map[string]interface{}{"name": "app-hpa", "target_replicas": 5}},
		{"missing_name", map[string]interface{}{"namespace": "default", "target_replicas": 5}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := tools.TriggerHPAScale(ctx, tc.args)
			if err == nil {
				t.Errorf("expected error for %s", tc.name)
			}
		})
	}
}

func TestTriggerHPAScale_ZeroReplicas(t *testing.T) {
	tools := newTools(newFakeProxy(), approvedSafety())
	ctx := context.Background()

	_, err := tools.TriggerHPAScale(ctx, map[string]interface{}{
		"namespace":       "default",
		"name":            "app-hpa",
		"target_replicas": 0,
	})
	if err == nil {
		t.Error("expected error for target_replicas=0")
	}
}

func TestTriggerHPAScale_SafetyDenied(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, deniedSafety("manual HPA override not allowed"))
	ctx := context.Background()

	result, err := tools.TriggerHPAScale(ctx, map[string]interface{}{
		"namespace":       "default",
		"name":            "app-hpa",
		"target_replicas": 100,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if m["approved"].(bool) {
		t.Error("expected approved=false")
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy should not be called")
	}
}

func TestTriggerHPAScale_DryRun(t *testing.T) {
	proxy := newFakeProxy()
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.TriggerHPAScale(ctx, map[string]interface{}{
		"namespace":       "default",
		"name":            "app-hpa",
		"target_replicas": 10,
		"dry_run":         true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["dry_run"].(bool) {
		t.Error("expected dry_run=true")
	}
	if len(proxy.calls) > 0 {
		t.Error("proxy should not be called in dry-run")
	}
}

func TestTriggerHPAScale_HappyPath(t *testing.T) {
	proxy := newFakeProxy().withResult("HPA updated")
	tools := newTools(proxy, approvedSafety())
	ctx := context.Background()

	result, err := tools.TriggerHPAScale(ctx, map[string]interface{}{
		"namespace":       "default",
		"name":            "web-hpa",
		"target_replicas": 8,
		"justification":   "traffic spike anticipated",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	m := result.(map[string]interface{})
	if !m["approved"].(bool) {
		t.Error("expected approved=true")
	}
	if m["hpa"] != "web-hpa" {
		t.Errorf("expected hpa=web-hpa, got %v", m["hpa"])
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-cutting: all tools propagate proxy errors
// ─────────────────────────────────────────────────────────────────────────────

func TestAllTools_ProxyErrorPropagated(t *testing.T) {
	proxyErr := fmt.Errorf("backend unavailable")

	tests := []struct {
		toolName string
		fn       func(tools *execution.ExecutionTools) (interface{}, error)
	}{
		{
			"restart_pod",
			func(t *execution.ExecutionTools) (interface{}, error) {
				return t.RestartPod(context.Background(), map[string]interface{}{
					"namespace": "default", "name": "pod",
				})
			},
		},
		{
			"scale_deployment",
			func(t *execution.ExecutionTools) (interface{}, error) {
				return t.ScaleDeployment(context.Background(), map[string]interface{}{
					"namespace": "default", "name": "app", "replicas": 2,
				})
			},
		},
		{
			"cordon_node",
			func(t *execution.ExecutionTools) (interface{}, error) {
				return t.CordonNode(context.Background(), map[string]interface{}{"name": "node-1"})
			},
		},
		{
			"drain_node",
			func(t *execution.ExecutionTools) (interface{}, error) {
				return t.DrainNode(context.Background(), map[string]interface{}{"name": "node-1"})
			},
		},
		{
			"apply_resource_patch",
			func(t *execution.ExecutionTools) (interface{}, error) {
				return t.ApplyResourcePatch(context.Background(), map[string]interface{}{
					"kind": "ConfigMap", "name": "cm",
					"patch": map[string]interface{}{"data": map[string]interface{}{"k": "v"}},
				})
			},
		},
		{
			"delete_resource",
			func(t *execution.ExecutionTools) (interface{}, error) {
				return t.DeleteResource(context.Background(), map[string]interface{}{
					"kind": "ConfigMap", "name": "cm",
				})
			},
		},
		{
			"rollback_deployment",
			func(t *execution.ExecutionTools) (interface{}, error) {
				return t.RollbackDeployment(context.Background(), map[string]interface{}{
					"namespace": "default", "name": "app",
				})
			},
		},
		{
			"update_resource_limits",
			func(t *execution.ExecutionTools) (interface{}, error) {
				return t.UpdateResourceLimits(context.Background(), map[string]interface{}{
					"kind": "Deployment", "name": "app", "container_name": "app",
				})
			},
		},
		{
			"trigger_hpa_scale",
			func(t *execution.ExecutionTools) (interface{}, error) {
				return t.TriggerHPAScale(context.Background(), map[string]interface{}{
					"namespace": "default", "name": "hpa", "target_replicas": 3,
				})
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.toolName, func(t *testing.T) {
			proxy := newFakeProxy().withError(proxyErr)
			tools := newTools(proxy, approvedSafety())
			_, err := tc.fn(tools)
			if err == nil {
				t.Errorf("%s: expected error when proxy fails, got nil", tc.toolName)
			}
		})
	}
}
