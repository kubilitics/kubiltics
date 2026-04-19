package supervisor

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
	"google.golang.org/grpc"
)

// Config carries the subset of ai.* config the supervisor needs.
type Config struct {
	BinaryPath         string
	IdleShutdown       time.Duration
	MaxRestartAttempts int
	RestartWindow      time.Duration

	// Provider arguments forwarded to kotg-ai-server as CLI flags.
	// APIKey is the resolved value (looked up from os.Getenv at startup);
	// it never appears in argv — only --api-key-env=<name> does.
	Provider    string
	Endpoint    string
	Model       string
	APIKeyEnv   string
}

type ReadyConn struct {
	Conn    *grpc.ClientConn
	SpawnID string
}

type Supervisor interface {
	EnsureReady(ctx context.Context) (*ReadyConn, error)
	GetCapabilities(ctx context.Context) (*types.CapabilitiesSnapshot, error)
	Refresh(ctx context.Context) error
	Status() types.SidecarStatus
	IncStreams()
	DecStreams()
	CurrentSpawnID() string
	Shutdown(ctx context.Context) error
}

type supervisorImpl struct {
	cfg Config

	mu        sync.Mutex
	state     *stateMachine
	backoff   *backoff
	idle      *idleTimer
	proc      *runningProcess
	conn      *grpc.ClientConn
	snapshot  *types.CapabilitiesSnapshot
	spawnID   string
	shutdown  bool
	parentCtx context.Context
	cancel    context.CancelFunc
}

func New(cfg Config) Supervisor {
	pctx, cancel := context.WithCancel(context.Background())
	s := &supervisorImpl{
		cfg:       cfg,
		state:     newStateMachine(),
		backoff:   newBackoff(cfg.MaxRestartAttempts, cfg.RestartWindow),
		parentCtx: pctx,
		cancel:    cancel,
	}
	s.idle = newIdleTimer(cfg.IdleShutdown, s.onIdleFire)
	s.idle.setActiveStreams(func() int { return s.state.Snapshot().ActiveStreams })
	return s
}

func (s *supervisorImpl) EnsureReady(ctx context.Context) (*ReadyConn, error) {
	s.mu.Lock()
	if s.shutdown {
		s.mu.Unlock()
		return nil, fmt.Errorf("supervisor: shut down")
	}
	if s.state.Snapshot().State == types.StateReady && s.conn != nil {
		rc := &ReadyConn{Conn: s.conn, SpawnID: s.spawnID}
		s.mu.Unlock()
		s.idle.reset()
		return rc, nil
	}
	s.mu.Unlock()
	return s.spawnLocked(ctx)
}

func (s *supervisorImpl) spawnLocked(ctx context.Context) (*ReadyConn, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Snapshot().State == types.StateReady && s.conn != nil {
		return &ReadyConn{Conn: s.conn, SpawnID: s.spawnID}, nil
	}
	if err := s.state.transition(types.StateStarting); err != nil {
		_ = s.state.transition(types.StateStopped)
		if err2 := s.state.transition(types.StateStarting); err2 != nil {
			return nil, fmt.Errorf("transition to starting: %w", err2)
		}
	}
	binPath := s.cfg.BinaryPath
	if binPath == "" {
		binPath = "kotg-ai-server"
	}
	proc, err := spawnSidecar(s.parentCtx, binPath, s.providerArgs()...)
	if err != nil {
		s.state.setLastError(err.Error())
		_ = s.state.transition(types.StateCrashed)
		return nil, err
	}
	conn, err := dialMTLS(ctx, proc.port, proc.bundle)
	if err != nil {
		proc.kill()
		s.state.setLastError(err.Error())
		_ = s.state.transition(types.StateCrashed)
		return nil, err
	}
	if err := checkHealth(ctx, conn, 2*time.Second); err != nil {
		_ = conn.Close()
		proc.kill()
		s.state.setLastError(err.Error())
		_ = s.state.transition(types.StateCrashed)
		return nil, err
	}
	caps, err := fetchCapabilities(ctx, conn)
	if err != nil {
		_ = conn.Close()
		proc.kill()
		s.state.setLastError(err.Error())
		_ = s.state.transition(types.StateCrashed)
		return nil, err
	}
	spawnID := newSpawnID()
	s.proc = proc
	s.conn = conn
	s.spawnID = spawnID
	s.snapshot = &types.CapabilitiesSnapshot{Capabilities: caps, FetchedAt: time.Now(), SpawnID: spawnID}
	s.state.setSpawnID(spawnID)
	_ = s.state.transition(types.StateReady)
	s.backoff.reset()
	s.idle.start()
	s.idle.reset()
	go s.watchExit(proc)
	return &ReadyConn{Conn: conn, SpawnID: spawnID}, nil
}

func (s *supervisorImpl) watchExit(proc *runningProcess) {
	err := <-proc.done
	s.mu.Lock()
	if s.proc != proc {
		s.mu.Unlock()
		return
	}
	if s.conn != nil {
		_ = s.conn.Close()
		s.conn = nil
	}
	s.proc = nil
	if err != nil {
		s.state.setLastError(err.Error())
	}
	if s.state.Snapshot().State == types.StateStopping {
		_ = s.state.transition(types.StateStopped)
		s.mu.Unlock()
		return
	}
	_ = s.state.transition(types.StateCrashed)
	s.mu.Unlock()
}

func (s *supervisorImpl) GetCapabilities(ctx context.Context) (*types.CapabilitiesSnapshot, error) {
	s.mu.Lock()
	snap := s.snapshot
	s.mu.Unlock()
	if snap != nil {
		return snap, nil
	}
	if _, err := s.EnsureReady(ctx); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshot, nil
}

func (s *supervisorImpl) Refresh(ctx context.Context) error {
	s.mu.Lock()
	if s.proc == nil {
		s.mu.Unlock()
		return nil
	}
	proc := s.proc
	_ = s.state.transition(types.StateStopping)
	s.mu.Unlock()

	proc.kill()
	select {
	case <-proc.done:
	case <-time.After(5 * time.Second):
		proc.kill()
	}

	s.mu.Lock()
	s.proc = nil
	if s.conn != nil {
		_ = s.conn.Close()
		s.conn = nil
	}
	s.snapshot = nil
	s.backoff.reset()
	if s.state.Snapshot().State != types.StateStopped {
		_ = s.state.transition(types.StateStopped)
	}
	s.mu.Unlock()
	return nil
}

func (s *supervisorImpl) Status() types.SidecarStatus { return s.state.Snapshot() }
func (s *supervisorImpl) IncStreams()                 { s.state.incStreams() }
func (s *supervisorImpl) DecStreams()                 { s.state.decStreams(); s.idle.reset() }
func (s *supervisorImpl) CurrentSpawnID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.spawnID
}

func (s *supervisorImpl) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	s.shutdown = true
	s.mu.Unlock()
	s.idle.stop()
	return s.Refresh(ctx)
}

// providerArgs builds the CLI flags forwarded to kotg-ai-server. Empty
// fields are simply omitted, letting the binary's own defaults apply.
// API keys are NEVER placed in argv — only --api-key-env=<name> is.
func (s *supervisorImpl) providerArgs() []string {
	args := []string{}
	if s.cfg.Provider != "" {
		args = append(args, "--provider="+s.cfg.Provider)
	}
	if s.cfg.Endpoint != "" {
		args = append(args, "--endpoint="+s.cfg.Endpoint)
	}
	if s.cfg.Model != "" {
		args = append(args, "--model="+s.cfg.Model)
	}
	if s.cfg.APIKeyEnv != "" {
		args = append(args, "--api-key-env="+s.cfg.APIKeyEnv)
	}
	return args
}

func (s *supervisorImpl) onIdleFire() {
	s.mu.Lock()
	if s.state.Snapshot().State != types.StateReady || s.proc == nil {
		s.mu.Unlock()
		return
	}
	proc := s.proc
	_ = s.state.transition(types.StateStopping)
	s.mu.Unlock()

	proc.kill()
	select {
	case <-proc.done:
	case <-time.After(5 * time.Second):
	}
}

func newSpawnID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
