package main

import (
	"context"
	"net"
	"time"

	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

const mockBufSize = 1 << 20

// mockChat emits 5 fake TextDelta events with a small delay then Done.
type mockChat struct {
	kotgv1.UnimplementedChatServer
}

func (m *mockChat) CreateSession(_ context.Context, req *kotgv1.CreateSessionRequest) (*kotgv1.Session, error) {
	return &kotgv1.Session{
		SessionId:      "mock-sess",
		FocusClusterId: req.FocusClusterId,
		Title:          req.Title,
	}, nil
}

func (m *mockChat) Send(stream grpc.BidiStreamingServer[kotgv1.UserMessage, kotgv1.AssistantEvent]) error {
	msg, err := stream.Recv()
	if err != nil {
		return err
	}
	chunks := []string{"Hello ", "from ", "the ", "mock ", "engine."}
	for _, c := range chunks {
		time.Sleep(7 * time.Millisecond)
		if err := stream.Send(&kotgv1.AssistantEvent{
			AnchorId: msg.TurnId + "-d",
			Event: &kotgv1.AssistantEvent_TextDelta{
				TextDelta: &kotgv1.TextDelta{Text: c},
			},
		}); err != nil {
			return err
		}
	}
	return stream.Send(&kotgv1.AssistantEvent{
		AnchorId: msg.TurnId + "-done",
		Event: &kotgv1.AssistantEvent_Done{
			Done: &kotgv1.Done{FinishReason: "stop"},
		},
	})
}

// startMock spins up an in-process bufconn gRPC server with mockChat.
// Returns a dialer the bench can use, default capabilities, and a stop fn.
func startMock() (dialer, capabilities, func(), error) {
	lis := bufconn.Listen(mockBufSize)
	srv := grpc.NewServer()
	kotgv1.RegisterChatServer(srv, &mockChat{})
	go func() { _ = srv.Serve(lis) }()

	d := func(ctx context.Context) (*grpc.ClientConn, error) {
		return grpc.NewClient(
			"passthrough://bufnet",
			grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
				return lis.DialContext(ctx)
			}),
			grpc.WithTransportCredentials(insecure.NewCredentials()),
		)
	}
	stop := func() {
		srv.Stop()
		_ = lis.Close()
	}
	caps := capabilities{Provider: "mock", Model: "mock-llm", AIVersion: "0.0.0-mock"}
	return d, caps, stop, nil
}
