package runtime_test

import (
	"context"
	"errors"
	"io"
	"net"
	"testing"
	"time"

	aiv1 "github.com/vellankikoti/kotg.ai/kubilitics-ai/api/proto/v1"
	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/runtime"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/emptypb"
)

const bufSize = 1024 * 1024

type fakeLLM struct {
	tokens []string
	err    error
}

func (f *fakeLLM) StreamCompletion(ctx context.Context, prompt string) (<-chan string, error) {
	if f.err != nil {
		return nil, f.err
	}
	ch := make(chan string, len(f.tokens))
	for _, t := range f.tokens {
		ch <- t
	}
	close(ch)
	return ch, nil
}

func newTestServer(t *testing.T, llm runtime.LLMProvider) (aiv1.AgentRuntimeServiceClient, func()) {
	t.Helper()
	lis := bufconn.Listen(bufSize)
	srv := grpc.NewServer()
	aiv1.RegisterAgentRuntimeServiceServer(srv, runtime.New(runtime.Config{
		LLM:           llm,
		AIVersion:     "test",
		SchemaVersion: "1.0.0",
		Providers:     []string{"fake"},
		Models:        []string{"fake-model"},
	}))
	go func() { _ = srv.Serve(lis) }()

	dialer := func(context.Context, string) (net.Conn, error) { return lis.Dial() }
	conn, err := grpc.NewClient("passthrough://bufnet",
		grpc.WithContextDialer(dialer),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	cleanup := func() {
		_ = conn.Close()
		srv.Stop()
	}
	return aiv1.NewAgentRuntimeServiceClient(conn), cleanup
}

func TestCapabilities(t *testing.T) {
	client, cleanup := newTestServer(t, &fakeLLM{})
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	resp, err := client.Capabilities(ctx, &emptypb.Empty{})
	if err != nil {
		t.Fatalf("Capabilities: %v", err)
	}
	if resp.AiVersion != "test" {
		t.Fatalf("ai_version mismatch: %q", resp.AiVersion)
	}
	if resp.SchemaVersion != "1.0.0" {
		t.Fatalf("schema_version mismatch: %q", resp.SchemaVersion)
	}
	if len(resp.Providers) != 1 || resp.Providers[0] != "fake" {
		t.Fatalf("providers mismatch: %v", resp.Providers)
	}
	if resp.AutonomyLevel != aiv1.AutonomyLevel_AUTONOMY_OBSERVE {
		t.Fatalf("autonomy mismatch: %v", resp.AutonomyLevel)
	}
}

func TestChatHappyPath(t *testing.T) {
	client, cleanup := newTestServer(t, &fakeLLM{tokens: []string{"hello", " ", "world"}})
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	stream, err := client.Chat(ctx)
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}

	if err := stream.Send(&aiv1.ChatRequest{Request: &aiv1.ChatRequest_Create{
		Create: &aiv1.CreateSession{FocusClusterId: "c1", UserId: "u1", Title: "t"},
	}}); err != nil {
		t.Fatalf("send create: %v", err)
	}

	first, err := stream.Recv()
	if err != nil {
		t.Fatalf("recv session_created: %v", err)
	}
	sc, ok := first.Event.(*aiv1.AIEvent_SessionCreated)
	if !ok {
		t.Fatalf("expected SessionCreated, got %T", first.Event)
	}
	if sc.SessionCreated.SessionId == "" {
		t.Fatal("empty session id")
	}

	if err := stream.Send(&aiv1.ChatRequest{Request: &aiv1.ChatRequest_Message{
		Message: &aiv1.UserMessage{
			SessionId: sc.SessionCreated.SessionId,
			TurnId:    "turn-1",
			Text:      "hi",
		},
	}}); err != nil {
		t.Fatalf("send message: %v", err)
	}
	if err := stream.CloseSend(); err != nil {
		t.Fatalf("close send: %v", err)
	}

	var got []string
	var sawDone bool
	for {
		ev, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			// Stream may end with an error if the server closed it after Done.
			// Tolerate that — what we care about is having seen Done.
			break
		}
		switch e := ev.Event.(type) {
		case *aiv1.AIEvent_TextDelta:
			got = append(got, e.TextDelta.Text)
		case *aiv1.AIEvent_Done:
			sawDone = true
		}
		if sawDone {
			break
		}
	}

	if !sawDone {
		t.Fatal("never saw Done event")
	}
	if len(got) != 3 || got[0] != "hello" || got[1] != " " || got[2] != "world" {
		t.Fatalf("text deltas mismatch: %v", got)
	}
}

func TestChatLLMError(t *testing.T) {
	client, cleanup := newTestServer(t, &fakeLLM{err: errors.New("boom")})
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	stream, err := client.Chat(ctx)
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}

	if err := stream.Send(&aiv1.ChatRequest{Request: &aiv1.ChatRequest_Create{
		Create: &aiv1.CreateSession{},
	}}); err != nil {
		t.Fatalf("send create: %v", err)
	}
	if _, err := stream.Recv(); err != nil {
		t.Fatalf("recv session_created: %v", err)
	}
	if err := stream.Send(&aiv1.ChatRequest{Request: &aiv1.ChatRequest_Message{
		Message: &aiv1.UserMessage{Text: "hi"},
	}}); err != nil {
		t.Fatalf("send message: %v", err)
	}
	if err := stream.CloseSend(); err != nil {
		t.Fatalf("close: %v", err)
	}

	var sawError bool
	for {
		ev, err := stream.Recv()
		if errors.Is(err, io.EOF) || err != nil {
			break
		}
		if e, ok := ev.Event.(*aiv1.AIEvent_ErrorEvent); ok {
			if e.ErrorEvent.Code != "llm_error" {
				t.Fatalf("error code mismatch: %q", e.ErrorEvent.Code)
			}
			sawError = true
			break
		}
	}
	if !sawError {
		t.Fatal("never saw ErrorEvent")
	}
}
