package wrapper

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/audit"
)

// fakeLogger captures audit.Events for assertions. Implements audit.Logger.
type fakeLogger struct {
	mu     sync.Mutex
	events []*audit.Event
}

func (f *fakeLogger) Log(_ context.Context, e *audit.Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, e)
	return nil
}
func (f *fakeLogger) LogInvestigationStarted(_ context.Context, _ string) error { return nil }
func (f *fakeLogger) LogInvestigationCompleted(_ context.Context, _ string, _ time.Duration) error {
	return nil
}
func (f *fakeLogger) LogInvestigationFailed(_ context.Context, _ string, _ error) error { return nil }
func (f *fakeLogger) LogActionProposed(_ context.Context, _, _ string) error             { return nil }
func (f *fakeLogger) LogActionApproved(_ context.Context, _, _, _ string) error          { return nil }
func (f *fakeLogger) LogActionExecuted(_ context.Context, _, _ string, _ time.Duration) error {
	return nil
}
func (f *fakeLogger) LogSafetyViolation(_ context.Context, _, _ string) error { return nil }
func (f *fakeLogger) Sync() error                                              { return nil }
func (f *fakeLogger) Close() error                                             { return nil }

func (f *fakeLogger) snapshot() []*audit.Event {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]*audit.Event, len(f.events))
	copy(out, f.events)
	return out
}

func TestLoggerSink_FansOutAllPhases(t *testing.T) {
	fl := &fakeLogger{}
	sink := LoggerSink{L: fl}

	now := time.Now()
	sink.Record(AuditEntry{
		Phase: PhaseStart, SessionID: "s1", TurnID: "t1", FocusClusterID: "c1",
		UserID: "u1", EngineName: "kagent", StartedAt: now,
	})
	sink.Record(AuditEntry{
		Phase: PhaseBlock, SessionID: "s1", TurnID: "t1", EngineName: "kagent",
		Decision: DecisionBlock, BlockedReason: "denied", BlockedKind: "action_pending:scale",
	})
	sink.Record(AuditEntry{
		Phase: PhaseEnd, SessionID: "s1", TurnID: "t1", EngineName: "kagent",
		EventCount: 7, BlockedCount: 1, StartedAt: now, FinishedAt: now.Add(50 * time.Millisecond),
	})
	sink.Record(AuditEntry{
		Phase: PhaseError, SessionID: "s1", TurnID: "t1", Error: "preflight failed",
	})

	got := fl.snapshot()
	if len(got) != 4 {
		t.Fatalf("expected 4 events, got %d", len(got))
	}
	wantTypes := []audit.EventType{
		"safety.wrapper.dispatch_start",
		"safety.wrapper.blocked",
		"safety.wrapper.dispatch_end",
		"safety.wrapper.error",
	}
	for i, want := range wantTypes {
		if got[i].EventType != want {
			t.Errorf("event[%d].EventType = %q, want %q", i, got[i].EventType, want)
		}
		if got[i].CorrelationID != "t1" {
			t.Errorf("event[%d].CorrelationID = %q, want t1", i, got[i].CorrelationID)
		}
	}
	// PhaseEnd carries duration.
	if got[2].DurationMs <= 0 {
		t.Errorf("PhaseEnd event missing duration: %+v", got[2])
	}
	// PhaseBlock carries reason metadata.
	if got[1].Metadata["blocked_reason"] != "denied" {
		t.Errorf("PhaseBlock missing blocked_reason: %+v", got[1].Metadata)
	}
	if got[1].Result != audit.ResultDenied {
		t.Errorf("PhaseBlock result = %q, want denied", got[1].Result)
	}
}

func TestLoggerSink_NilLoggerIsSafe(t *testing.T) {
	sink := LoggerSink{L: nil}
	// Must not panic.
	sink.Record(AuditEntry{Phase: PhaseStart})
}
