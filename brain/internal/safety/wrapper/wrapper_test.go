package wrapper

import (
	"context"
	"errors"
	"testing"

	"github.com/vellankikoti/kubilitics/brain/internal/router"
)

type stubEngine struct {
	name   string
	events []router.Event
	err    error
}

func (s *stubEngine) Name() string { return s.name }
func (s *stubEngine) Stream(ctx context.Context, _ router.Request) (<-chan router.Event, error) {
	if s.err != nil {
		return nil, s.err
	}
	out := make(chan router.Event, len(s.events))
	go func() {
		defer close(out)
		for _, e := range s.events {
			select {
			case out <- e:
			case <-ctx.Done():
				return
			}
		}
	}()
	return out, nil
}

func TestPreflightRejectsMissingClusterID(t *testing.T) {
	r := router.New([]router.Engine{&stubEngine{name: "x"}}, nil)
	w := New(r, Config{RequireClusterID: true})
	_, _, err := w.Dispatch(context.Background(), router.Request{TurnID: "t1"})
	if err == nil {
		t.Fatalf("expected preflight error for missing FocusClusterID")
	}
}

func TestActionPendingBlockedWhenNotAllowed(t *testing.T) {
	stub := &stubEngine{
		name: "x",
		events: []router.Event{
			{Kind: router.KindTextDelta, Text: "thinking..."},
			{Kind: router.KindActionPending, ActionType: "delete_namespace", ProposalID: "p1"},
			{Kind: router.KindDone, FinishReason: "stop"},
		},
	}
	sink := &CollectingSink{}
	r := router.New([]router.Engine{stub}, nil)
	w := New(r, Config{
		AllowedActions:   []string{"scale", "rollout_restart"},
		Audit:            sink,
		RequireClusterID: false,
	})

	_, ch, err := w.Dispatch(context.Background(), router.Request{FocusClusterID: "c1"})
	if err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	var got []router.Event
	for ev := range ch {
		got = append(got, ev)
	}
	if len(got) != 3 {
		t.Fatalf("got %d events, want 3", len(got))
	}
	if got[0].Kind != router.KindTextDelta {
		t.Errorf("got[0] = %v, want TextDelta", got[0])
	}
	if got[1].Kind != router.KindError || got[1].Code != "policy_denied" {
		t.Errorf("got[1] = %v, want policy_denied Error", got[1])
	}
	if got[2].Kind != router.KindDone {
		t.Errorf("got[2] = %v, want Done", got[2])
	}
	// Audit entries: PhaseStart, PhaseBlock, PhaseEnd
	entries := sink.Entries()
	if len(entries) != 3 {
		t.Fatalf("audit entries = %d, want 3 (start, block, end)", len(entries))
	}
	if entries[0].Phase != PhaseStart || entries[1].Phase != PhaseBlock || entries[2].Phase != PhaseEnd {
		t.Errorf("audit phases = %v %v %v", entries[0].Phase, entries[1].Phase, entries[2].Phase)
	}
	if entries[2].EventCount != 2 || entries[2].BlockedCount != 1 {
		t.Errorf("audit end counts = emit=%d blocked=%d, want 2/1", entries[2].EventCount, entries[2].BlockedCount)
	}
}

func TestActionPendingPassesWhenAllowed(t *testing.T) {
	stub := &stubEngine{
		name: "x",
		events: []router.Event{
			{Kind: router.KindActionPending, ActionType: "scale", ProposalID: "p1"},
			{Kind: router.KindDone, FinishReason: "stop"},
		},
	}
	r := router.New([]router.Engine{stub}, nil)
	w := New(r, Config{AllowedActions: []string{"scale"}})
	_, ch, _ := w.Dispatch(context.Background(), router.Request{FocusClusterID: "c1"})
	var got []router.Event
	for ev := range ch {
		got = append(got, ev)
	}
	if got[0].Kind != router.KindActionPending {
		t.Errorf("expected ActionPending to pass through, got %v", got[0])
	}
}

func TestAllowAllPassesEverything(t *testing.T) {
	stub := &stubEngine{
		name: "x",
		events: []router.Event{
			{Kind: router.KindActionPending, ActionType: "anything_goes"},
			{Kind: router.KindDone, FinishReason: "stop"},
		},
	}
	r := router.New([]router.Engine{stub}, nil)
	w := New(r, Config{AllowedActions: []string{"*"}})
	_, ch, _ := w.Dispatch(context.Background(), router.Request{FocusClusterID: "c1"})
	var got []router.Event
	for ev := range ch {
		got = append(got, ev)
	}
	if got[0].ActionType != "anything_goes" {
		t.Errorf("expected wildcard to pass; got %v", got[0])
	}
}

func TestEmptyAllowListBlocksAllActions(t *testing.T) {
	stub := &stubEngine{
		name: "x",
		events: []router.Event{
			{Kind: router.KindActionPending, ActionType: "scale"},
			{Kind: router.KindDone, FinishReason: "stop"},
		},
	}
	sink := &CollectingSink{}
	r := router.New([]router.Engine{stub}, nil)
	w := New(r, Config{Audit: sink}) // empty AllowedActions
	_, ch, _ := w.Dispatch(context.Background(), router.Request{FocusClusterID: "c1"})
	var got []router.Event
	for ev := range ch {
		got = append(got, ev)
	}
	if got[0].Kind != router.KindError {
		t.Errorf("expected policy_denied with empty allow-list; got %v", got[0])
	}
}

func TestInnerDispatchErrorAuditedAndPropagated(t *testing.T) {
	stub := &stubEngine{name: "x", err: errors.New("engine bust")}
	sink := &CollectingSink{}
	r := router.New([]router.Engine{stub}, nil)
	w := New(r, Config{Audit: sink})
	_, _, err := w.Dispatch(context.Background(), router.Request{FocusClusterID: "c1"})
	if err == nil {
		t.Fatalf("expected error from inner Dispatch to propagate")
	}
	entries := sink.Entries()
	if len(entries) != 1 || entries[0].Phase != PhaseError {
		t.Errorf("expected single PhaseError audit; got %v", entries)
	}
}

func TestNoActionEventsArePassedThroughCleanly(t *testing.T) {
	// Common case: only TextDelta + Done. Wrapper should be a no-op in
	// terms of event content; only audit Start + End records appear.
	stub := &stubEngine{
		name: "x",
		events: []router.Event{
			{Kind: router.KindTextDelta, Text: "hi "},
			{Kind: router.KindTextDelta, Text: "world"},
			{Kind: router.KindDone, FinishReason: "stop"},
		},
	}
	sink := &CollectingSink{}
	r := router.New([]router.Engine{stub}, nil)
	w := New(r, Config{Audit: sink})
	_, ch, _ := w.Dispatch(context.Background(), router.Request{FocusClusterID: "c1"})
	count := 0
	for ev := range ch {
		_ = ev
		count++
	}
	if count != 3 {
		t.Errorf("event count = %d, want 3", count)
	}
	entries := sink.Entries()
	if len(entries) != 2 {
		t.Errorf("audit entries = %d, want 2 (start + end)", len(entries))
	}
	if entries[1].EventCount != 3 || entries[1].BlockedCount != 0 {
		t.Errorf("end audit = emit=%d blocked=%d, want 3/0", entries[1].EventCount, entries[1].BlockedCount)
	}
}
