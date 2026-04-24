package runtime_test

import (
	"context"
	"errors"
	"io"
	"net"
	"testing"
	"time"

	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/llm/budget"
	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/router"
	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/runtime"
	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
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
	out := make(chan string, len(f.tokens))
	go func() {
		defer close(out)
		for _, t := range f.tokens {
			select {
			case out <- t:
			case <-ctx.Done():
				return
			}
		}
	}()
	return out, nil
}

func newTestServers(t *testing.T, llm runtime.LLMProvider) (kotgv1.ChatClient, kotgv1.AIControlClient, func()) {
	t.Helper()
	lis := bufconn.Listen(bufSize)
	s := grpc.NewServer()
	rt := runtime.New(runtime.Config{
		Dispatcher: router.New(
			[]router.Engine{runtime.NewLLMEngine(llm)},
			nil,
		),
		AIVersion:     "test",
		SchemaVersion: "1.0.1",
		Providers:     []string{"fake"},
		Models:        []string{"fake-model"},
	})
	kotgv1.RegisterChatServer(s, rt)
	kotgv1.RegisterAIControlServer(s, rt)
	go func() { _ = s.Serve(lis) }()

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(_ context.Context, _ string) (net.Conn, error) { return lis.Dial() }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return kotgv1.NewChatClient(conn), kotgv1.NewAIControlClient(conn), func() {
		conn.Close()
		s.Stop()
	}
}

func TestCapabilitiesReturnsConfig(t *testing.T) {
	_, ctl, cleanup := newTestServers(t, &fakeLLM{})
	defer cleanup()
	resp, err := ctl.Capabilities(context.Background(), &kotgv1.Empty{})
	if err != nil {
		t.Fatalf("Capabilities: %v", err)
	}
	if resp.SchemaVersion != "1.0.1" {
		t.Errorf("SchemaVersion = %q", resp.SchemaVersion)
	}
	if resp.AiVersion != "test" {
		t.Errorf("AiVersion = %q", resp.AiVersion)
	}
	if len(resp.Providers) != 1 || resp.Providers[0] != "fake" {
		t.Errorf("Providers = %v", resp.Providers)
	}
}

func TestHealthOK(t *testing.T) {
	_, ctl, cleanup := newTestServers(t, &fakeLLM{})
	defer cleanup()
	resp, err := ctl.Health(context.Background(), &kotgv1.Empty{})
	if err != nil {
		t.Fatalf("Health: %v", err)
	}
	if resp.State != kotgv1.HealthStatus_STATE_OK {
		t.Errorf("State = %v", resp.State)
	}
}

func TestCreateSessionRequiresCluster(t *testing.T) {
	chat, _, cleanup := newTestServers(t, &fakeLLM{})
	defer cleanup()
	_, err := chat.CreateSession(context.Background(), &kotgv1.CreateSessionRequest{})
	if err == nil {
		t.Fatalf("expected InvalidArgument when focus_cluster_id missing")
	}
}

func TestSendStreamsTextDeltaThenDone(t *testing.T) {
	chat, _, cleanup := newTestServers(t, &fakeLLM{tokens: []string{"hello ", "world"}})
	defer cleanup()

	sess, err := chat.CreateSession(context.Background(), &kotgv1.CreateSessionRequest{
		FocusClusterId: "c1", Title: "smoke",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	stream, err := chat.Send(context.Background())
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if err := stream.Send(&kotgv1.UserMessage{
		SessionId: sess.SessionId, TurnId: "t1", Text: "hi",
	}); err != nil {
		t.Fatalf("send msg: %v", err)
	}
	stream.CloseSend()

	var deltas []string
	var sawDone bool
	for {
		ev, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatalf("Recv: %v", err)
		}
		if td := ev.GetTextDelta(); td != nil {
			deltas = append(deltas, td.Text)
		}
		if d := ev.GetDone(); d != nil {
			sawDone = true
			if d.FinishReason != "stop" {
				t.Errorf("FinishReason = %q, want stop", d.FinishReason)
			}
		}
	}
	if len(deltas) != 2 || deltas[0] != "hello " || deltas[1] != "world" {
		t.Errorf("deltas = %v", deltas)
	}
	if !sawDone {
		t.Errorf("no Done event")
	}
}

func TestSendUnknownSessionReturnsNotFound(t *testing.T) {
	chat, _, cleanup := newTestServers(t, &fakeLLM{tokens: []string{"x"}})
	defer cleanup()
	stream, _ := chat.Send(context.Background())
	stream.Send(&kotgv1.UserMessage{SessionId: "missing", TurnId: "t1", Text: "hi"})
	stream.CloseSend()
	_, err := stream.Recv()
	if err == nil {
		t.Fatalf("expected NotFound, got nil")
	}
}

func TestSendLLMErrorEmitsErrorAndDone(t *testing.T) {
	chat, _, cleanup := newTestServers(t, &fakeLLM{err: errors.New("provider down")})
	defer cleanup()
	sess, _ := chat.CreateSession(context.Background(), &kotgv1.CreateSessionRequest{FocusClusterId: "c1"})

	stream, _ := chat.Send(context.Background())
	stream.Send(&kotgv1.UserMessage{SessionId: sess.SessionId, TurnId: "t1", Text: "hi"})
	stream.CloseSend()

	var sawErr, sawDone bool
	for {
		ev, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			break
		}
		if e := ev.GetError(); e != nil {
			sawErr = true
		}
		if d := ev.GetDone(); d != nil {
			sawDone = true
			if d.FinishReason != "error" || !d.Partial {
				t.Errorf("Done = %+v", d)
			}
		}
	}
	if !sawErr || !sawDone {
		t.Errorf("sawErr=%v sawDone=%v", sawErr, sawDone)
	}
}

// Phase 2 / Gap 3. Wire a Gate with a $0.001 cap and a $1 estimated cost.
// The first Send turn must short-circuit with an Error{Code:"budget_exceeded"}
// followed by Done{Partial:true, FinishReason:"budget"}, without calling
// into the (here unused) LLM stream.
func TestSendBudgetExceededEmitsErrorAndBudgetDone(t *testing.T) {
	// Build a server by hand so we can attach the gate before serving.
	lis := bufconn.Listen(bufSize)
	s := grpc.NewServer()
	rt := runtime.New(runtime.Config{
		Dispatcher: router.New(
			[]router.Engine{runtime.NewLLMEngine(&fakeLLM{tokens: []string{"should-not-be-streamed"}})},
			nil,
		),
		AIVersion:     "test",
		SchemaVersion: "1.0.1",
		Providers:     []string{"fake"},
		Models:        []string{"fake-model"},
	})
	// $0.001 cap + $1 per-turn estimate = first turn always over budget.
	rt.SetBudgetGate(budget.NewMemoryGate(0.001), 1.00)
	kotgv1.RegisterChatServer(s, rt)
	kotgv1.RegisterAIControlServer(s, rt)
	go func() { _ = s.Serve(lis) }()
	defer s.Stop()

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(_ context.Context, _ string) (net.Conn, error) { return lis.Dial() }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	chat := kotgv1.NewChatClient(conn)

	sess, err := chat.CreateSession(context.Background(), &kotgv1.CreateSessionRequest{FocusClusterId: "c1"})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	stream, err := chat.Send(context.Background())
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if err := stream.Send(&kotgv1.UserMessage{SessionId: sess.SessionId, TurnId: "t1", Text: "hi"}); err != nil {
		t.Fatalf("send msg: %v", err)
	}
	stream.CloseSend()

	var sawBudgetErr bool
	var sawBudgetDone bool
	var sawAnyTextDelta bool
	for {
		ev, recvErr := stream.Recv()
		if errors.Is(recvErr, io.EOF) {
			break
		}
		if recvErr != nil {
			break
		}
		if e := ev.GetError(); e != nil && e.Code == "budget_exceeded" {
			sawBudgetErr = true
		}
		if d := ev.GetDone(); d != nil {
			if d.FinishReason == "budget" && d.Partial {
				sawBudgetDone = true
			}
		}
		if ev.GetTextDelta() != nil {
			sawAnyTextDelta = true
		}
	}
	if !sawBudgetErr {
		t.Errorf("expected Error{Code:\"budget_exceeded\"}")
	}
	if !sawBudgetDone {
		t.Errorf("expected Done{Partial,FinishReason:\"budget\"}")
	}
	if sawAnyTextDelta {
		t.Errorf("LLM stream should NOT have fired once the gate denied the turn")
	}
}

// Sanity: server starts and shuts down within a reasonable window.
func TestServerLifecycle(t *testing.T) {
	_, _, cleanup := newTestServers(t, &fakeLLM{})
	done := make(chan struct{})
	go func() { cleanup(); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatalf("cleanup hung")
	}
}
