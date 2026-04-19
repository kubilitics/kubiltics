package supervisor

import (
	"context"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

func newTestSupervisor(t *testing.T) Supervisor {
	t.Helper()
	return New(Config{
		BinaryPath:         stubBinaryPath(t),
		IdleShutdown:       200 * time.Millisecond,
		MaxRestartAttempts: 3,
		RestartWindow:      5 * time.Second,
	})
}

func TestSupervisorEnsureReady(t *testing.T) {
	s := newTestSupervisor(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	defer s.Shutdown(context.Background())

	rc, err := s.EnsureReady(ctx)
	if err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	if rc.Conn == nil {
		t.Fatalf("nil conn")
	}
	if rc.SpawnID == "" {
		t.Fatalf("empty spawn id")
	}
	if got := s.Status().State; got != types.StateReady {
		t.Errorf("state = %v, want ready", got)
	}
}

func TestSupervisorIdleShutdown(t *testing.T) {
	s := newTestSupervisor(t)
	defer s.Shutdown(context.Background())

	ctx := context.Background()
	if _, err := s.EnsureReady(ctx); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}

	time.Sleep(1000 * time.Millisecond)
	if got := s.Status().State; got != types.StateStopped {
		t.Errorf("state after idle = %v, want stopped", got)
	}
}

func TestSupervisorRefresh(t *testing.T) {
	s := newTestSupervisor(t)
	defer s.Shutdown(context.Background())
	ctx := context.Background()

	rc1, err := s.EnsureReady(ctx)
	if err != nil {
		t.Fatalf("EnsureReady #1: %v", err)
	}
	if err := s.Refresh(ctx); err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	rc2, err := s.EnsureReady(ctx)
	if err != nil {
		t.Fatalf("EnsureReady #2: %v", err)
	}
	if rc1.SpawnID == rc2.SpawnID {
		t.Errorf("SpawnID did not change after Refresh")
	}
}

func TestSupervisorGetCapabilities(t *testing.T) {
	s := newTestSupervisor(t)
	defer s.Shutdown(context.Background())
	ctx := context.Background()
	if _, err := s.EnsureReady(ctx); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	snap, err := s.GetCapabilities(ctx)
	if err != nil {
		t.Fatalf("GetCapabilities: %v", err)
	}
	if snap == nil || snap.Capabilities == nil {
		t.Fatalf("nil snapshot or capabilities")
	}
}
