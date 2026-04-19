package kagent

import (
	"context"
	"testing"

	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/router"
)

func TestNameIsKagent(t *testing.T) {
	if e := New(Config{}); e.Name() != "kagent" {
		t.Errorf("Name = %q, want kagent", e.Name())
	}
}

func TestConfiguredReflectsEndpoint(t *testing.T) {
	if New(Config{}).Configured() {
		t.Errorf("expected !Configured when Endpoint empty")
	}
	if !New(Config{Endpoint: "http://example.com"}).Configured() {
		t.Errorf("expected Configured when Endpoint set")
	}
}

func TestStreamUnconfiguredEmitsErrorThenDone(t *testing.T) {
	e := New(Config{})
	ch, err := e.Stream(context.Background(), router.Request{})
	if err != nil {
		t.Fatalf("Stream returned error %v; expected channel-only error path", err)
	}
	first, ok := <-ch
	if !ok || first.Kind != router.KindError || first.Code != "kagent_unconfigured" {
		t.Errorf("first event = %+v, want unconfigured error", first)
	}
	last, ok := <-ch
	if !ok || last.Kind != router.KindDone || !last.Partial {
		t.Errorf("last event = %+v, want partial Done", last)
	}
	_, more := <-ch
	if more {
		t.Errorf("channel should be closed after Done")
	}
}

func TestStreamConfiguredReturnsUnimplemented(t *testing.T) {
	e := New(Config{Endpoint: "http://kagent.test:8080"})
	ch, _ := e.Stream(context.Background(), router.Request{})
	first := <-ch
	if first.Code != "kagent_unimplemented" {
		t.Errorf("first.Code = %q, want kagent_unimplemented", first.Code)
	}
	_ = <-ch // Done
}

// Sanity: Engine satisfies router.Engine.
var _ router.Engine = (*Engine)(nil)
