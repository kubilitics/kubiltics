package gate

import (
	"context"
	"testing"

	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
)

func TestNoOpGateChatPassesThrough(t *testing.T) {
	g := NoOpGate{}
	called := false
	next := func(ctx context.Context) (kotgv1.Chat_SendClient, error) {
		called = true
		return nil, nil
	}
	_, err := g.WrapChat(context.Background(), next)
	if err != nil {
		t.Fatalf("WrapChat: %v", err)
	}
	if !called {
		t.Fatalf("next not invoked by NoOpGate")
	}
}

func TestNoOpGateActionPassesThrough(t *testing.T) {
	g := NoOpGate{}
	called := false
	next := func(ctx context.Context, req *kotgv1.ActionRequest) (*kotgv1.ActionResult, error) {
		called = true
		return &kotgv1.ActionResult{}, nil
	}
	res, err := g.WrapAction(context.Background(), &kotgv1.ActionRequest{}, next)
	if err != nil {
		t.Fatalf("WrapAction: %v", err)
	}
	if !called {
		t.Fatalf("next not invoked by NoOpGate")
	}
	if res == nil {
		t.Fatalf("expected non-nil result")
	}
}
