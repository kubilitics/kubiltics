package supervisor

import (
	"context"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func stubBinaryPath(t *testing.T) string {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "testdata/stubsidecar/stub")
}

func TestSpawnReachesReady(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	proc, err := spawnSidecar(ctx, stubBinaryPath(t))
	if err != nil {
		t.Fatalf("spawnSidecar: %v", err)
	}
	defer proc.kill()

	if proc.port <= 0 {
		t.Errorf("port = %d, want >0", proc.port)
	}
	if proc.bundle == nil || len(proc.bundle.CAPEM) == 0 {
		t.Errorf("bundle missing CA")
	}
}

func TestSpawnTimeoutKills(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("skip on windows")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	_, err := spawnSidecar(ctx, "/bin/sleep")
	if err == nil {
		t.Fatalf("expected timeout error")
	}
}
