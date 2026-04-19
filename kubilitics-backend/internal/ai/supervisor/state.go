package supervisor

import (
	"fmt"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

// stateMachine is goroutine-safe wrapper around SidecarStatus + transition rules.
type stateMachine struct {
	mu     sync.Mutex
	status types.SidecarStatus
}

func newStateMachine() *stateMachine {
	return &stateMachine{status: types.SidecarStatus{State: types.StateStopped}}
}

// allowed returns true if from→to is a legal edge in the state machine.
//
//	stopped  → starting
//	starting → ready, crashed, stopped (immediate failure)
//	ready    → stopping, crashed
//	stopping → stopped
//	crashed  → starting (retry), stopped (cap exhausted)
func allowed(from, to types.SidecarState) bool {
	switch from {
	case types.StateStopped:
		return to == types.StateStarting
	case types.StateStarting:
		return to == types.StateReady || to == types.StateCrashed || to == types.StateStopped
	case types.StateReady:
		return to == types.StateStopping || to == types.StateCrashed
	case types.StateStopping:
		return to == types.StateStopped
	case types.StateCrashed:
		return to == types.StateStarting || to == types.StateStopped
	}
	return false
}

func (s *stateMachine) transition(to types.SidecarState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !allowed(s.status.State, to) {
		return fmt.Errorf("invalid transition %s→%s", s.status.State, to)
	}
	s.status.State = to
	return nil
}

func (s *stateMachine) Snapshot() types.SidecarStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.status
	return out
}

func (s *stateMachine) setLastError(msg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status.LastError = msg
}

func (s *stateMachine) setSpawnID(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status.CurrentSpawnID = id
}

func (s *stateMachine) setDisabledReason(r string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status.DisabledReason = r
}

func (s *stateMachine) setRestartAttempts(n int, nextRetry time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status.RestartAttempts = n
	s.status.NextRetryAt = nextRetry
}

func (s *stateMachine) incStreams() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status.ActiveStreams++
}

func (s *stateMachine) decStreams() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status.ActiveStreams > 0 {
		s.status.ActiveStreams--
	}
}
