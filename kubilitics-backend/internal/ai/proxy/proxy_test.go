package proxy

import (
	"context"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/ai/gate"
	"github.com/kubilitics/kubilitics-backend/internal/ai/supervisor"
	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

func stubBinaryPath(t *testing.T) string {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	return filepath.Clean(filepath.Join(filepath.Dir(file), "../supervisor/testdata/stubsidecar/stub"))
}

func newTestProxy(t *testing.T) (*Proxy, supervisor.Supervisor) {
	sup := supervisor.New(supervisor.Config{
		BinaryPath:         stubBinaryPath(t),
		IdleShutdown:       30 * time.Second,
		MaxRestartAttempts: 3,
		RestartWindow:      5 * time.Second,
	})
	return New(sup, gate.NoOpGate{}, 60), sup
}

func TestProxyMissingClusterRejects(t *testing.T) {
	p, sup := newTestProxy(t)
	defer sup.Shutdown(context.Background())

	_, err := p.GetCapabilities(WithUser(context.Background(), "u1"), "")
	if err != types.ErrMissingCluster {
		t.Fatalf("err = %v, want ErrMissingCluster", err)
	}
}

func TestProxyGetCapabilitiesHappy(t *testing.T) {
	p, sup := newTestProxy(t)
	defer sup.Shutdown(context.Background())

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	snap, err := p.GetCapabilities(WithUser(ctx, "u1"), "cluster-a")
	if err != nil {
		t.Fatalf("GetCapabilities: %v", err)
	}
	if snap == nil || snap.Capabilities == nil {
		t.Fatalf("nil snapshot")
	}
}

func TestProxyRateLimit(t *testing.T) {
	sup := supervisor.New(supervisor.Config{
		BinaryPath:         stubBinaryPath(t),
		IdleShutdown:       30 * time.Second,
		MaxRestartAttempts: 3,
		RestartWindow:      5 * time.Second,
	})
	defer sup.Shutdown(context.Background())
	p := New(sup, gate.NoOpGate{}, 1)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := p.GetCapabilities(WithUser(ctx, "u1"), "cluster-a"); err != nil {
		t.Fatalf("first call: %v", err)
	}
	if _, err := p.GetCapabilities(WithUser(ctx, "u1"), "cluster-a"); err != types.ErrRateLimited {
		t.Fatalf("second call err = %v, want ErrRateLimited", err)
	}
}
