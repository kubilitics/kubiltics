package kagent

import (
	"context"
	"testing"

	"github.com/vellankikoti/kubilitics/brain/internal/router"
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

// v1.5: configured engines now make real HTTP calls — see
// engine_integration_test.go for the wire-level coverage. The old
// "unimplemented" path is gone; the unconfigured path above is the
// only short-circuit that remains in this file.

// Sanity: Engine satisfies router.Engine.
var _ router.Engine = (*Engine)(nil)
