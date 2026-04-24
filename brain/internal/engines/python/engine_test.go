package python

import (
	"context"
	"testing"

	"github.com/vellankikoti/kubilitics/brain/internal/router"
)

func TestNameIsPython(t *testing.T) {
	if e := New(Config{}); e.Name() != "python" {
		t.Errorf("Name = %q, want python", e.Name())
	}
}

func TestConfiguredReflectsEndpoint(t *testing.T) {
	if New(Config{}).Configured() {
		t.Errorf("expected !Configured when Endpoint empty")
	}
	if !New(Config{Endpoint: "http://py.test:9000"}).Configured() {
		t.Errorf("expected Configured when Endpoint set")
	}
}

func TestStreamUnconfiguredEmitsErrorThenDone(t *testing.T) {
	e := New(Config{})
	ch, _ := e.Stream(context.Background(), router.Request{})
	first := <-ch
	if first.Code != "python_unconfigured" {
		t.Errorf("first.Code = %q, want python_unconfigured", first.Code)
	}
	last := <-ch
	if last.Kind != router.KindDone || !last.Partial {
		t.Errorf("last event = %+v, want partial Done", last)
	}
	_, more := <-ch
	if more {
		t.Errorf("channel should be closed after Done")
	}
}

func TestStreamConfiguredReturnsUnimplemented(t *testing.T) {
	e := New(Config{Endpoint: "http://py.test:9000"})
	ch, _ := e.Stream(context.Background(), router.Request{})
	first := <-ch
	if first.Code != "python_unimplemented" {
		t.Errorf("first.Code = %q, want python_unimplemented", first.Code)
	}
	_ = <-ch
}

var _ router.Engine = (*Engine)(nil)
