package supervisor

import (
	"context"
	"testing"
	"time"
)

func TestDialAndCheckHealth(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	proc, err := spawnSidecar(ctx, stubBinaryPath(t))
	if err != nil {
		t.Fatalf("spawn: %v", err)
	}
	defer proc.kill()

	conn, err := dialMTLS(ctx, proc.port, proc.bundle)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	if err := checkHealth(ctx, conn, 2*time.Second); err != nil {
		t.Fatalf("health: %v", err)
	}

	caps, err := fetchCapabilities(ctx, conn)
	if err != nil {
		t.Fatalf("capabilities: %v", err)
	}
	if caps == nil {
		t.Fatalf("nil capabilities")
	}
	if caps.SchemaVersion == "" {
		t.Errorf("SchemaVersion empty")
	}
}
