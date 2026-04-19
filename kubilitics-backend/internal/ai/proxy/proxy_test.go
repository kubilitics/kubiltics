package proxy

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/ai/aiclient"
	"github.com/kubilitics/kubilitics-backend/internal/ai/types"

	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

type stubProxySrv struct {
	kotgv1.UnimplementedChatServer
	kotgv1.UnimplementedAIControlServer
}

func (s *stubProxySrv) Capabilities(_ context.Context, _ *kotgv1.Empty) (*kotgv1.AICapabilities, error) {
	return &kotgv1.AICapabilities{SchemaVersion: "1.0.1", AiVersion: "test"}, nil
}

func (s *stubProxySrv) CreateSession(_ context.Context, req *kotgv1.CreateSessionRequest) (*kotgv1.Session, error) {
	return &kotgv1.Session{SessionId: "s-1", Title: req.GetTitle(), FocusClusterId: req.GetFocusClusterId()}, nil
}

func newTestProxy(t *testing.T, perMin int) (*Proxy, func()) {
	t.Helper()
	lis := bufconn.Listen(1 << 20)
	srv := grpc.NewServer()
	stub := &stubProxySrv{}
	kotgv1.RegisterChatServer(srv, stub)
	kotgv1.RegisterAIControlServer(srv, stub)
	go func() { _ = srv.Serve(lis) }()
	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(_ context.Context, _ string) (net.Conn, error) {
			return lis.Dial()
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	gc := aiclient.NewGRPCClientFromConn(conn)
	hc := aiclient.NewHTTPClient("http://127.0.0.1:0", aiclient.DefaultOpts())
	p := New(gc, hc, perMin)
	return p, func() {
		_ = gc.Close()
		srv.Stop()
		_ = lis.Close()
	}
}

func TestProxyMissingClusterRejects(t *testing.T) {
	p, cleanup := newTestProxy(t, 60)
	defer cleanup()
	_, err := p.Capabilities(WithUser(context.Background(), "u1"), "")
	if err != types.ErrMissingCluster {
		t.Fatalf("err = %v, want ErrMissingCluster", err)
	}
}

func TestProxyCapabilitiesHappy(t *testing.T) {
	p, cleanup := newTestProxy(t, 60)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	caps, err := p.Capabilities(WithUser(ctx, "u1"), "cluster-a")
	if err != nil {
		t.Fatalf("Capabilities: %v", err)
	}
	if caps == nil || caps.SchemaVersion != "1.0.1" {
		t.Fatalf("unexpected caps: %+v", caps)
	}
}

func TestProxyRateLimit(t *testing.T) {
	p, cleanup := newTestProxy(t, 1)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := p.Capabilities(WithUser(ctx, "u1"), "cluster-a"); err != nil {
		t.Fatalf("first call: %v", err)
	}
	if _, err := p.Capabilities(WithUser(ctx, "u1"), "cluster-a"); err != types.ErrRateLimited {
		t.Fatalf("second call err = %v, want ErrRateLimited", err)
	}
}

func TestProxyCreateSession(t *testing.T) {
	p, cleanup := newTestProxy(t, 60)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	sess, err := p.CreateSession(WithUser(ctx, "u1"), "c1", "hello")
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if sess.GetSessionId() != "s-1" {
		t.Fatalf("session = %+v", sess)
	}
}
