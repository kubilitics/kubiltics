package aiclient

import (
	"context"
	"errors"
	"io"
	"net"
	"testing"
	"time"

	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

type stubServer struct {
	kotgv1.UnimplementedChatServer
	kotgv1.UnimplementedAIControlServer
	createdTitle string
	recvCount    int
}

func (s *stubServer) Capabilities(_ context.Context, _ *kotgv1.Empty) (*kotgv1.AICapabilities, error) {
	return &kotgv1.AICapabilities{
		SchemaVersion: "1.0.1",
		AiVersion:     "test-1",
		Providers:     []string{"echo"},
		Models:        []string{"echo-1"},
	}, nil
}

func (s *stubServer) Health(_ context.Context, _ *kotgv1.Empty) (*kotgv1.HealthStatus, error) {
	return &kotgv1.HealthStatus{State: kotgv1.HealthStatus_STATE_OK, Detail: "ok"}, nil
}

func (s *stubServer) CreateSession(_ context.Context, req *kotgv1.CreateSessionRequest) (*kotgv1.Session, error) {
	s.createdTitle = req.GetTitle()
	return &kotgv1.Session{
		SessionId:      "sess-1",
		Title:          req.GetTitle(),
		FocusClusterId: req.GetFocusClusterId(),
	}, nil
}

func (s *stubServer) Send(stream kotgv1.Chat_SendServer) error {
	for {
		msg, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		s.recvCount++
		_ = stream.Send(&kotgv1.AssistantEvent{
			AnchorId: msg.GetTurnId(),
			Event:    &kotgv1.AssistantEvent_TextDelta{TextDelta: &kotgv1.TextDelta{Text: "hello "}},
		})
		_ = stream.Send(&kotgv1.AssistantEvent{
			AnchorId: msg.GetTurnId(),
			Event:    &kotgv1.AssistantEvent_Done{Done: &kotgv1.Done{FinishReason: "stop"}},
		})
		return nil
	}
}

func (s *stubServer) CancelTurn(_ context.Context, _ *kotgv1.CancelTurnRequest) (*kotgv1.Empty, error) {
	return &kotgv1.Empty{}, nil
}

// newBufClient spins up an in-memory gRPC server with the stub and returns
// a GRPCClient wired to it via bufconn.
func newBufClient(t *testing.T) (*GRPCClient, *stubServer, func()) {
	t.Helper()
	lis := bufconn.Listen(1 << 20)
	srv := grpc.NewServer()
	stub := &stubServer{}
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
	c := NewGRPCClientFromConn(conn)
	return c, stub, func() {
		_ = c.Close()
		srv.Stop()
		_ = lis.Close()
	}
}

func TestCapabilities(t *testing.T) {
	c, _, cleanup := newBufClient(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	caps, err := c.Capabilities(ctx)
	if err != nil {
		t.Fatalf("capabilities: %v", err)
	}
	if caps.GetSchemaVersion() != "1.0.1" {
		t.Errorf("schema version = %q", caps.GetSchemaVersion())
	}
}

func TestCreateSession(t *testing.T) {
	c, stub, cleanup := newBufClient(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	sess, err := c.CreateSession(ctx, &kotgv1.CreateSessionRequest{
		FocusClusterId: "c1",
		Title:          "my session",
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	if sess.GetSessionId() != "sess-1" {
		t.Errorf("session id = %q", sess.GetSessionId())
	}
	if stub.createdTitle != "my session" {
		t.Errorf("title not propagated: %q", stub.createdTitle)
	}
}

func TestSendStream(t *testing.T) {
	c, _, cleanup := newBufClient(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stream, err := c.Send(ctx)
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	if err := stream.Send(&kotgv1.UserMessage{
		SessionId: "sess-1",
		TurnId:    "t1",
		Text:      "hi",
	}); err != nil {
		t.Fatalf("stream send: %v", err)
	}
	_ = stream.CloseSend()

	var sawDelta, sawDone bool
	for {
		ev, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("recv: %v", err)
		}
		switch ev.GetEvent().(type) {
		case *kotgv1.AssistantEvent_TextDelta:
			sawDelta = true
		case *kotgv1.AssistantEvent_Done:
			sawDone = true
		}
	}
	if !sawDelta || !sawDone {
		t.Errorf("missing events: delta=%v done=%v", sawDelta, sawDone)
	}
}
