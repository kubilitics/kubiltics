package execution_test

// Phase 5 tests: idempotency guard, execution envelope, per-tool timeouts,
// HardenedHandlerMap, defaultHTTPExecutor, and coverage gap fills.

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/mcp/tools/execution"
)

// ── IdempotencyGuard ──────────────────────────────────────────────────────────

func TestIdempotency_FirstCallPasses(t *testing.T) {
	g := execution.NewIdempotencyGuard(60 * time.Second)
	args := map[string]interface{}{"namespace": "default", "name": "web-0"}
	if err := g.Check("restart_pod", args); err != nil {
		t.Errorf("first call should pass: %v", err)
	}
}

func TestIdempotency_SecondCallBlocked(t *testing.T) {
	g := execution.NewIdempotencyGuard(60 * time.Second)
	args := map[string]interface{}{"namespace": "default", "name": "web-0"}
	g.Record("restart_pod", args)
	if err := g.Check("restart_pod", args); err == nil {
		t.Error("second call within window should be blocked")
	}
}

func TestIdempotency_DifferentArgs_NotBlocked(t *testing.T) {
	g := execution.NewIdempotencyGuard(60 * time.Second)
	args1 := map[string]interface{}{"namespace": "default", "name": "web-0"}
	args2 := map[string]interface{}{"namespace": "default", "name": "web-1"}
	g.Record("restart_pod", args1)
	if err := g.Check("restart_pod", args2); err != nil {
		t.Errorf("different args should not be blocked: %v", err)
	}
}

func TestIdempotency_DifferentTool_NotBlocked(t *testing.T) {
	g := execution.NewIdempotencyGuard(60 * time.Second)
	args := map[string]interface{}{"namespace": "default", "name": "web-0"}
	g.Record("restart_pod", args)
	if err := g.Check("scale_deployment", args); err != nil {
		t.Errorf("different tool should not be blocked: %v", err)
	}
}

func TestIdempotency_ExpiredEntry_Passes(t *testing.T) {
	g := execution.NewIdempotencyGuard(50 * time.Millisecond)
	args := map[string]interface{}{"namespace": "default", "name": "web-0"}
	g.Record("restart_pod", args)
	time.Sleep(80 * time.Millisecond) // wait for expiry
	if err := g.Check("restart_pod", args); err != nil {
		t.Errorf("expired entry should allow re-execution: %v", err)
	}
}

func TestIdempotency_Override_BypassesGuard(t *testing.T) {
	g := execution.NewIdempotencyGuard(60 * time.Second)
	args := map[string]interface{}{"namespace": "default", "name": "web-0"}
	g.Record("restart_pod", args)
	argsWithOverride := map[string]interface{}{
		"namespace":            "default",
		"name":                 "web-0",
		"idempotency_override": true,
	}
	if err := g.Check("restart_pod", argsWithOverride); err != nil {
		t.Errorf("idempotency_override=true should bypass guard: %v", err)
	}
}

func TestIdempotency_ZeroWindow_AlwaysPasses(t *testing.T) {
	g := execution.NewIdempotencyGuard(0) // disabled
	args := map[string]interface{}{"namespace": "default", "name": "web-0"}
	g.Record("restart_pod", args)
	if err := g.Check("restart_pod", args); err != nil {
		t.Errorf("zero-window guard should always pass: %v", err)
	}
}

func TestIdempotency_ConcurrentSafety(t *testing.T) {
	g := execution.NewIdempotencyGuard(60 * time.Second)
	args := map[string]interface{}{"namespace": "default", "name": "web-0"}
	done := make(chan struct{})
	for i := 0; i < 20; i++ {
		go func() {
			_ = g.Check("restart_pod", args)
			g.Record("restart_pod", args)
			done <- struct{}{}
		}()
	}
	for i := 0; i < 20; i++ {
		<-done
	}
}

// ── ExecutionTimeout ──────────────────────────────────────────────────────────

func TestExecutionTimeout_ByLevel(t *testing.T) {
	cases := []struct {
		level int
		want  time.Duration
	}{
		{2, 30 * time.Second},
		{3, 60 * time.Second},
		{4, 120 * time.Second},
		{5, 45 * time.Second},
		{0, 60 * time.Second}, // default
		{9, 60 * time.Second}, // unknown → default
	}
	for _, tc := range cases {
		got := execution.ExecutionTimeout(tc.level)
		if got != tc.want {
			t.Errorf("ExecutionTimeout(%d)=%s want %s", tc.level, got, tc.want)
		}
	}
}

// ── HardenedHandlerMap ────────────────────────────────────────────────────────

func TestHardenedHandlerMap_Completeness(t *testing.T) {
	tools := newTools(newFakeHTTP().withResponse("ok"), approvedSafety())
	m := tools.HardenedHandlerMap()
	expected := []string{
		"restart_pod", "scale_deployment", "cordon_node", "drain_node",
		"apply_resource_patch", "delete_resource", "rollback_deployment",
		"update_resource_limits", "trigger_hpa_scale",
	}
	for _, name := range expected {
		if _, ok := m[name]; !ok {
			t.Errorf("HardenedHandlerMap missing %s", name)
		}
	}
	if len(m) != len(expected) {
		t.Errorf("HardenedHandlerMap len=%d want %d", len(m), len(expected))
	}
}

func TestHardenedHandlerMap_ResultHasExecutionEnvelope(t *testing.T) {
	tools := newTools(newFakeHTTP().withResponse("ok"), approvedSafety())
	m := tools.HardenedHandlerMap()
	args := map[string]interface{}{"namespace": "default", "name": "web-0"}
	result, err := m["restart_pod"](context.Background(), args)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	rm, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("result is not a map")
	}
	execMeta, ok := rm["_execution"].(map[string]interface{})
	if !ok {
		t.Fatalf("_execution block missing or wrong type")
	}
	if execMeta["tool"] != "restart_pod" {
		t.Errorf("_execution.tool=%v want restart_pod", execMeta["tool"])
	}
	if execMeta["autonomy_level"] == nil {
		t.Error("_execution.autonomy_level missing")
	}
	if execMeta["elapsed_ms"] == nil {
		t.Error("_execution.elapsed_ms missing")
	}
	if execMeta["execution_id"] == nil {
		t.Error("_execution.execution_id missing")
	}
}

func TestHardenedHandlerMap_IdempotencyBlocked(t *testing.T) {
	// Use a zero-window guard (disabled) for first tools, then a fresh one with 60s window.
	guard := execution.NewIdempotencyGuard(60 * time.Second)
	tools := execution.NewExecutionToolsWithGuard(
		newFakeHTTP().withResponse("ok"),
		approvedSafety(),
		&noopAuditLog{},
		guard,
	)
	m := tools.HardenedHandlerMap()
	args := map[string]interface{}{"namespace": "default", "name": "web-0", "dry_run": false}

	// First call succeeds.
	_, err := m["restart_pod"](context.Background(), args)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}

	// Second call with same args should be blocked by idempotency guard.
	_, err = m["restart_pod"](context.Background(), args)
	if err == nil {
		t.Error("second call should be blocked by idempotency guard")
	}
}

func TestHardenedHandlerMap_DryRun_NotRecorded(t *testing.T) {
	guard := execution.NewIdempotencyGuard(60 * time.Second)
	tools := execution.NewExecutionToolsWithGuard(
		newFakeHTTP().withResponse("ok"),
		approvedSafety(),
		&noopAuditLog{},
		guard,
	)
	m := tools.HardenedHandlerMap()
	args := map[string]interface{}{"namespace": "default", "name": "web-0", "dry_run": true}

	// dry_run=true → guard should NOT be armed, so second call passes.
	_, _ = m["restart_pod"](context.Background(), args)
	_, err := m["restart_pod"](context.Background(), args)
	if err != nil {
		t.Errorf("dry-run: second call should pass (not recorded): %v", err)
	}
}

func TestHardenedHandlerMap_HandlerError_PropagatesClean(t *testing.T) {
	tools := newTools(newFakeHTTP().withError(fmt.Errorf("network timeout")), approvedSafety())
	m := tools.HardenedHandlerMap()
	args := map[string]interface{}{"namespace": "default", "name": "web-0"}
	_, err := m["restart_pod"](context.Background(), args)
	if err == nil {
		t.Error("handler error should propagate")
	}
}

// ── defaultHTTPExecutor (real HTTP client via httptest.Server) ────────────────

func TestDefaultHTTPExecutor_PostSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"message":"restarted"}`))
	}))
	defer srv.Close()

	exec := execution.NewDefaultHTTPExecutorForTest(srv.URL)
	resp, status, err := exec.Post(context.Background(), "/test", map[string]interface{}{"key": "val"})
	if err != nil {
		t.Fatalf("Post: %v", err)
	}
	if status != 200 {
		t.Errorf("status=%d want 200", status)
	}
	if resp["message"] != "restarted" {
		t.Errorf("resp=%v want message=restarted", resp)
	}
}

func TestDefaultHTTPExecutor_PatchSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			t.Errorf("expected PATCH, got %s", r.Method)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"message":"patched"}`))
	}))
	defer srv.Close()

	exec := execution.NewDefaultHTTPExecutorForTest(srv.URL)
	resp, status, err := exec.Patch(context.Background(), "/test", map[string]interface{}{})
	if err != nil || status != 200 || resp["message"] != "patched" {
		t.Errorf("Patch: err=%v status=%d resp=%v", err, status, resp)
	}
}

func TestDefaultHTTPExecutor_DeleteSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE, got %s", r.Method)
		}
		if r.Header.Get("X-Confirm-Destructive") != "true" {
			t.Error("X-Confirm-Destructive header missing")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"message":"deleted"}`))
	}))
	defer srv.Close()

	exec := execution.NewDefaultHTTPExecutorForTest(srv.URL)
	resp, status, err := exec.Delete(context.Background(), "/test",
		map[string]string{"X-Confirm-Destructive": "true"})
	if err != nil || status != 200 || resp["message"] != "deleted" {
		t.Errorf("Delete: err=%v status=%d resp=%v", err, status, resp)
	}
}

func TestDefaultHTTPExecutor_HTTP4xxReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"not found"}`))
	}))
	defer srv.Close()

	exec := execution.NewDefaultHTTPExecutorForTest(srv.URL)
	_, _, err := exec.Post(context.Background(), "/not-found", nil)
	if err == nil {
		t.Error("expected error for HTTP 404")
	}
}

func TestDefaultHTTPExecutor_HTTP5xxReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"server error"}`))
	}))
	defer srv.Close()

	exec := execution.NewDefaultHTTPExecutorForTest(srv.URL)
	_, _, err := exec.Post(context.Background(), "/error", nil)
	if err == nil {
		t.Error("expected error for HTTP 500")
	}
}

func TestDefaultHTTPExecutor_EmptyBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		// Return empty body.
	}))
	defer srv.Close()

	exec := execution.NewDefaultHTTPExecutorForTest(srv.URL)
	resp, _, err := exec.Post(context.Background(), "/empty", nil)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if resp == nil {
		t.Error("resp should be non-nil even with empty body")
	}
}

func TestDefaultHTTPExecutor_ContextCancelled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(500 * time.Millisecond) // simulate slow response
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	exec := execution.NewDefaultHTTPExecutorForTest(srv.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, _, err := exec.Post(ctx, "/slow", nil)
	if err == nil {
		t.Error("expected context deadline error")
	}
}

func TestDefaultHTTPExecutor_InvalidURL(t *testing.T) {
	exec := execution.NewDefaultHTTPExecutorForTest("http://127.0.0.1:1") // port 1 = no server
	_, _, err := exec.Post(context.Background(), "/test", nil)
	if err == nil {
		t.Error("expected connection refused error")
	}
}

// ── buildResourceLimitsPatch coverage ────────────────────────────────────────

func TestUpdateResourceLimits_AllLimits(t *testing.T) {
	tools := newTools(newFakeHTTP().withResponse("ok"), approvedSafety())
	args := map[string]interface{}{
		"cluster_id":     "c1",
		"namespace":      "default",
		"kind":           "Deployment",
		"name":           "api",
		"container_name": "app",
		"cpu_request":    "100m",
		"cpu_limit":      "500m",
		"memory_request": "128Mi",
		"memory_limit":   "512Mi",
	}
	result, err := tools.UpdateResourceLimits(context.Background(), args)
	if err != nil {
		t.Fatalf("UpdateResourceLimits: %v", err)
	}
	m, _ := result.(map[string]interface{})
	if approved, _ := m["approved"].(bool); !approved {
		t.Error("expected approved=true")
	}
}

func TestUpdateResourceLimits_OnlyCPU(t *testing.T) {
	tools := newTools(newFakeHTTP().withResponse("ok"), approvedSafety())
	args := map[string]interface{}{
		"cluster_id":     "c1",
		"namespace":      "default",
		"kind":           "Deployment",
		"name":           "api",
		"container_name": "app",
		"cpu_request":    "100m",
		"cpu_limit":      "500m",
	}
	_, err := tools.UpdateResourceLimits(context.Background(), args)
	if err != nil {
		t.Fatalf("UpdateResourceLimits (CPU only): %v", err)
	}
}

func TestUpdateResourceLimits_OnlyMemory(t *testing.T) {
	tools := newTools(newFakeHTTP().withResponse("ok"), approvedSafety())
	args := map[string]interface{}{
		"cluster_id":     "c1",
		"namespace":      "default",
		"kind":           "Deployment",
		"name":           "api",
		"container_name": "app",
		"memory_request": "128Mi",
		"memory_limit":   "512Mi",
	}
	_, err := tools.UpdateResourceLimits(context.Background(), args)
	if err != nil {
		t.Fatalf("UpdateResourceLimits (memory only): %v", err)
	}
}

// ── responseMessage / truncateExec gap fills ─────────────────────────────────

func TestRestartPod_NonOKStatus_MessageExtracted(t *testing.T) {
	// Backend returns HTTP 200 with no message field → fallback "ok".
	http := newFakeHTTP()
	http.resp = map[string]interface{}{} // no "message" key
	tools := newTools(http, approvedSafety())
	result, err := tools.RestartPod(context.Background(), map[string]interface{}{
		"namespace": "default", "name": "web-0",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, _ := result.(map[string]interface{})
	if m["message"] != "ok" {
		t.Errorf("message=%v want ok (fallback)", m["message"])
	}
}

func TestScaleDeployment_ZeroReplicas(t *testing.T) {
	// replicas=0 is valid (scale to zero).
	tools := newTools(newFakeHTTP().withResponse("scaled"), approvedSafety())
	result, err := tools.ScaleDeployment(context.Background(), map[string]interface{}{
		"namespace": "default", "name": "api", "replicas": float64(0),
	})
	if err != nil {
		t.Fatalf("ScaleDeployment(0): %v", err)
	}
	m, _ := result.(map[string]interface{})
	if approved, _ := m["approved"].(bool); !approved {
		t.Error("expected approved=true for scale-to-zero")
	}
}

func TestDeleteResource_WithGracePeriod(t *testing.T) {
	tools := newTools(newFakeHTTP().withResponse("deleted"), approvedSafety())
	result, err := tools.DeleteResource(context.Background(), map[string]interface{}{
		"cluster_id": "c1", "namespace": "default",
		"kind": "Pod", "name": "web-0",
		"grace_period_seconds": float64(5),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, _ := result.(map[string]interface{})
	if approved, _ := m["approved"].(bool); !approved {
		t.Error("expected approved=true")
	}
}

func TestApplyResourcePatch_DefaultsMergePatchType(t *testing.T) {
	tools := newTools(newFakeHTTP().withResponse("patched"), approvedSafety())
	result, err := tools.ApplyResourcePatch(context.Background(), map[string]interface{}{
		"cluster_id": "c1", "namespace": "default",
		"kind": "Deployment", "name": "api",
		"patch": map[string]interface{}{"spec": map[string]interface{}{"replicas": 3}},
		// no patch_type → defaults to "merge"
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, _ := result.(map[string]interface{})
	if approved, _ := m["approved"].(bool); !approved {
		t.Error("expected approved=true")
	}
}

func TestCordonNode_WithClusterID(t *testing.T) {
	h := newFakeHTTP().withResponse("cordoned")
	tools := newTools(h, approvedSafety())
	_, err := tools.CordonNode(context.Background(), map[string]interface{}{
		"cluster_id": "my-cluster", "name": "node-1",
	})
	if err != nil {
		t.Fatalf("CordonNode with cluster_id: %v", err)
	}
	if len(h.calls) == 0 {
		t.Error("expected HTTP call")
	}
}

func TestDrainNode_ExplicitGracePeriod(t *testing.T) {
	tools := newTools(newFakeHTTP().withResponse("drained"), approvedSafety())
	result, err := tools.DrainNode(context.Background(), map[string]interface{}{
		"cluster_id": "c1", "name": "node-1",
		"grace_period_seconds":  float64(60),
		"ignore_daemon_sets":    true,
		"delete_emptydir_data":  true,
	})
	if err != nil {
		t.Fatalf("DrainNode: %v", err)
	}
	m, _ := result.(map[string]interface{})
	if approved, _ := m["approved"].(bool); !approved {
		t.Error("expected approved=true")
	}
}

func TestTriggerHPAScale_WithClusterID(t *testing.T) {
	h := newFakeHTTP().withResponse("scaled")
	tools := newTools(h, approvedSafety())
	result, err := tools.TriggerHPAScale(context.Background(), map[string]interface{}{
		"cluster_id": "c1", "namespace": "default",
		"name": "api-hpa", "target_replicas": float64(5),
	})
	if err != nil {
		t.Fatalf("TriggerHPAScale: %v", err)
	}
	m, _ := result.(map[string]interface{})
	if approved, _ := m["approved"].(bool); !approved {
		t.Error("expected approved=true")
	}
}
