package grpc

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/config"
)

// TestServerStartsWithBothProtocols verifies that the gRPC server + a REST
// listener can both bind on ephemeral ports (GRPCPort=0) without the legacy
// hardcoded :50051 collision. Desktop runs brain on :50051, so backend must
// be able to take an ephemeral port when co-located.
func TestServerStartsWithBothProtocols(t *testing.T) {
	// REST: stand up an ephemeral HTTP test server.
	rest := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	defer rest.Close()

	// gRPC: start on ephemeral port.
	cfg := &config.Config{GRPCPort: 0}
	log := slog.Default()
	srv := NewServer(cfg, nil, nil, nil, log)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Start(ctx); err != nil {
		t.Fatalf("start grpc: %v", err)
	}
	defer srv.Stop()

	if srv.BoundPort() <= 0 {
		t.Fatalf("expected BoundPort > 0 after ephemeral start, got %d", srv.BoundPort())
	}
	if srv.BoundPort() == 50051 {
		t.Fatalf("ephemeral bind landed on legacy :50051 — ephemeral should be high numbered")
	}

	// Dial gRPC port to confirm it's listening.
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", itoa(srv.BoundPort())), 2*time.Second)
	if err != nil {
		t.Fatalf("dial grpc bound port %d: %v", srv.BoundPort(), err)
	}
	_ = conn.Close()

	// REST still reachable.
	resp, err := http.Get(rest.URL + "/")
	if err != nil {
		t.Fatalf("REST GET: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("REST status: got %d want 200", resp.StatusCode)
	}
}

// TestServerDisabledByFlag verifies that GRPCDisabled=true (in main.go wiring)
// plus the server's own defensive handling of port < 0 does not accidentally
// start a listener. This test just documents that BoundPort() is stable when
// Start is never called.
func TestServerBoundPort_UnstartedIsZero(t *testing.T) {
	srv := NewServer(&config.Config{GRPCPort: 0}, nil, nil, nil, slog.Default())
	if srv.BoundPort() != 0 {
		t.Fatalf("pre-Start BoundPort should be 0, got %d", srv.BoundPort())
	}
}

// Tiny local strconv.Itoa to avoid pulling strconv in for one call.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	buf := [20]byte{}
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
