package router

import (
	"context"
	"errors"
	"testing"
)

type fakeEngine struct {
	name   string
	tokens []string
	err    error
}

func (f *fakeEngine) Name() string { return f.name }
func (f *fakeEngine) Stream(ctx context.Context, req Request) (<-chan Event, error) {
	if f.err != nil {
		return nil, f.err
	}
	out := make(chan Event, len(f.tokens)+1)
	go func() {
		defer close(out)
		for _, t := range f.tokens {
			select {
			case out <- Event{Kind: KindTextDelta, Text: t}:
			case <-ctx.Done():
				return
			}
		}
		out <- Event{Kind: KindDone, FinishReason: "stop"}
	}()
	return out, nil
}

func TestDispatchPicksFirstEngineByDefault(t *testing.T) {
	a := &fakeEngine{name: "a", tokens: []string{"x"}}
	b := &fakeEngine{name: "b", tokens: []string{"y"}}
	r := New([]Engine{a, b}, nil)

	name, ch, err := r.Dispatch(context.Background(), Request{})
	if err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if name != "a" {
		t.Errorf("name = %q, want a", name)
	}
	first := <-ch
	if first.Text != "x" {
		t.Errorf("first.Text = %q, want x", first.Text)
	}
}

func TestDispatchRespectsCustomPicker(t *testing.T) {
	a := &fakeEngine{name: "a"}
	b := &fakeEngine{name: "b", tokens: []string{"y"}}
	pick := func(_ Request, available []Engine) (Engine, error) {
		return available[1], nil
	}
	r := New([]Engine{a, b}, pick)
	name, _, _ := r.Dispatch(context.Background(), Request{})
	if name != "b" {
		t.Errorf("name = %q, want b", name)
	}
}

func TestDispatchPropagatesPickError(t *testing.T) {
	r := New(nil, nil)
	_, _, err := r.Dispatch(context.Background(), Request{})
	if err == nil {
		t.Errorf("expected error when no engines registered")
	}
}

func TestDispatchPropagatesEngineError(t *testing.T) {
	bad := &fakeEngine{name: "bad", err: errors.New("boom")}
	r := New([]Engine{bad}, nil)
	_, _, err := r.Dispatch(context.Background(), Request{})
	if err == nil {
		t.Errorf("expected engine error to propagate")
	}
}

func TestEnginesReturnsNames(t *testing.T) {
	r := New([]Engine{&fakeEngine{name: "a"}, &fakeEngine{name: "b"}}, nil)
	names := r.Engines()
	if len(names) != 2 || names[0] != "a" || names[1] != "b" {
		t.Errorf("names = %v", names)
	}
}
