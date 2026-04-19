package supervisor

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

func TestStateTransitions(t *testing.T) {
	s := newStateMachine()
	if got := s.Snapshot().State; got != types.StateStopped {
		t.Fatalf("initial state = %v, want stopped", got)
	}
	if err := s.transition(types.StateStarting); err != nil {
		t.Fatalf("Stopped→Starting: %v", err)
	}
	if err := s.transition(types.StateReady); err != nil {
		t.Fatalf("Starting→Ready: %v", err)
	}
	if err := s.transition(types.StateStopping); err != nil {
		t.Fatalf("Ready→Stopping: %v", err)
	}
	if err := s.transition(types.StateStopped); err != nil {
		t.Fatalf("Stopping→Stopped: %v", err)
	}
}

func TestStateInvalidTransition(t *testing.T) {
	s := newStateMachine()
	if err := s.transition(types.StateReady); err == nil {
		t.Fatalf("expected error on Stopped→Ready")
	}
}

func TestStateSetError(t *testing.T) {
	s := newStateMachine()
	s.setLastError("boom")
	if got := s.Snapshot().LastError; got != "boom" {
		t.Errorf("LastError = %q, want boom", got)
	}
}
