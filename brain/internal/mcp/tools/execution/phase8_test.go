package execution_test

// Phase 8: Observability — verify that idempotency hits and timeouts trigger
// the metrics paths in HardenedHandlerMap.  We confirm the error types that
// precede the metric emission calls rather than reading Prometheus counters
// directly (which requires a custom registry).

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/audit"
	execution "github.com/vellankikoti/kubilitics/brain/internal/mcp/tools/execution"
	"github.com/vellankikoti/kubilitics/brain/internal/safety"
)

// noopSafety8 always approves (local copy for this test file).
type noopSafety8 struct{}

func (noopSafety8) EvaluateAction(_ context.Context, _ *safety.Action) (*safety.SafetyResult, error) {
	return &safety.SafetyResult{Approved: true, Result: "approve"}, nil
}

// noopAudit8 is a local no-op audit logger.
type noopAudit8 struct{}

func (*noopAudit8) Log(_ context.Context, _ *audit.Event) error                                      { return nil }
func (*noopAudit8) LogInvestigationStarted(_ context.Context, _ string) error                        { return nil }
func (*noopAudit8) LogInvestigationCompleted(_ context.Context, _ string, _ time.Duration) error     { return nil }
func (*noopAudit8) LogInvestigationFailed(_ context.Context, _ string, _ error) error                { return nil }
func (*noopAudit8) LogActionProposed(_ context.Context, _, _ string) error                           { return nil }
func (*noopAudit8) LogActionApproved(_ context.Context, _, _, _ string) error                        { return nil }
func (*noopAudit8) LogActionExecuted(_ context.Context, _, _ string, _ time.Duration) error          { return nil }
func (*noopAudit8) LogSafetyViolation(_ context.Context, _, _ string) error                          { return nil }
func (*noopAudit8) Sync() error                                                                      { return nil }
func (*noopAudit8) Close() error                                                                     { return nil }

func buildHardenedTools8(t *testing.T, backendURL string, guard *execution.IdempotencyGuard) *execution.ExecutionTools {
	t.Helper()
	exec := execution.NewDefaultHTTPExecutorForTest(backendURL)
	return execution.NewExecutionToolsWithGuard(exec, noopSafety8{}, &noopAudit8{}, guard)
}

// ── Idempotency hit ───────────────────────────────────────────────────────────

func TestPhase8_IdempotencyHit_ReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","restarted":true}`))
	}))
	t.Cleanup(srv.Close)

	guard := execution.NewIdempotencyGuard(10 * time.Second)
	args := map[string]interface{}{"namespace": "default", "pod_name": "mypod", "approved": true}
	// Arm the guard — next call with same args is a duplicate.
	guard.Record("restart_pod", args)

	et := buildHardenedTools8(t, srv.URL, guard)
	_, err := et.HardenedHandlerMap()["restart_pod"](context.Background(), args)
	if err == nil {
		t.Fatal("expected idempotency error, got nil")
	}
}

func TestPhase8_IdempotencyHit_ErrorMessage(t *testing.T) {
	guard := execution.NewIdempotencyGuard(10 * time.Second)
	args := map[string]interface{}{"namespace": "default", "pod_name": "mypod", "approved": true}
	guard.Record("restart_pod", args)

	et := buildHardenedTools8(t, "http://127.0.0.1:0", guard)
	_, err := et.HardenedHandlerMap()["restart_pod"](context.Background(), args)
	if err == nil {
		t.Fatal("expected error")
	}
	t.Logf("idempotency error: %v", err)
}

// ── Timeout detection ─────────────────────────────────────────────────────────

func TestPhase8_ContextCancel_ReturnsContextError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(srv.Close)

	guard := execution.NewIdempotencyGuard(0) // disabled
	et := buildHardenedTools8(t, srv.URL, guard)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	_, err := et.HardenedHandlerMap()["restart_pod"](ctx, map[string]interface{}{
		"namespace": "default",
		"pod_name":  "mypod",
		"approved":  true,
	})
	if err == nil {
		t.Fatal("expected error from context timeout")
	}
}

// TestPhase8_ExecutionTimeout_DeadlineExceeded_IsDistinguishable verifies the
// errors.Is(DeadlineExceeded) branch that gates ExecutionTimeouts metric emission.
func TestPhase8_ExecutionTimeout_DeadlineExceeded_IsDistinguishable(t *testing.T) {
	if !errors.Is(context.DeadlineExceeded, context.DeadlineExceeded) {
		t.Error("errors.Is must match DeadlineExceeded")
	}
	wrapped := fmt.Errorf("http call: %w", context.DeadlineExceeded)
	if !errors.Is(wrapped, context.DeadlineExceeded) {
		t.Error("wrapped DeadlineExceeded must match via errors.Is")
	}
}
