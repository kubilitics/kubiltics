package kagent

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/router"
)

// fakeKagent serves a scripted SSE response so tests can assert the
// engine's translation logic without a live kagent install.
type fakeKagent struct {
	t        *testing.T
	frames   []string
	status   int
	delay    time.Duration // injected between frames so cancel-mid-stream tests work
	requests int
	mu       sync.Mutex
}

func (f *fakeKagent) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.requests++
		f.mu.Unlock()
		if f.status >= 400 {
			http.Error(w, "kagent failure", f.status)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		for _, frame := range f.frames {
			if _, err := fmt.Fprintf(w, "data: %s\n\n", frame); err != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
			if f.delay > 0 {
				select {
				case <-time.After(f.delay):
				case <-r.Context().Done():
					return
				}
			}
		}
	}
}

func newFake(t *testing.T, frames []string, status int) *httptest.Server {
	t.Helper()
	f := &fakeKagent{t: t, frames: frames, status: status}
	return httptest.NewServer(f.handler())
}

func collect(t *testing.T, ch <-chan router.Event) []router.Event {
	t.Helper()
	var out []router.Event
	for ev := range ch {
		out = append(out, ev)
	}
	return out
}

func TestStream_HappyPath_TextToolText(t *testing.T) {
	frames := []string{
		// Text delta — partial.
		`{"jsonrpc":"2.0","result":{"status":{"state":"working","message":{"role":"assistant","parts":[{"kind":"text","text":"Looking at the cluster... "}]}}}}`,
		// Function call.
		`{"jsonrpc":"2.0","result":{"status":{"state":"working","message":{"role":"assistant","parts":[{"kind":"data","data":{"id":"call-1","name":"list_pods","args":{"namespace":"default"}},"metadata":{"type":"function_call"}}]}}}}`,
		// Function response.
		`{"jsonrpc":"2.0","result":{"status":{"state":"working","message":{"role":"assistant","parts":[{"kind":"data","data":{"id":"call-1","name":"list_pods","response":{"items":["pod-a","pod-b"]}},"metadata":{"type":"function_response"}}]}}}}`,
		// Final text + completed state — terminal.
		`{"jsonrpc":"2.0","result":{"status":{"state":"completed","message":{"role":"assistant","parts":[{"kind":"text","text":"Found 2 pods."}]}}}}`,
	}
	srv := newFake(t, frames, 0)
	defer srv.Close()

	e := New(Config{Endpoint: srv.URL, DefaultAgentID: "k8s-agent"})
	ch, err := e.Stream(context.Background(), router.Request{Text: "hi", SessionID: "session-1"})
	if err != nil {
		t.Fatalf("Stream returned error: %v", err)
	}
	events := collect(t, ch)
	if len(events) < 5 {
		t.Fatalf("expected >=5 events, got %d: %+v", len(events), events)
	}

	// Expected order: TextDelta, ToolStart, ToolEnd, TextDelta, Done(stop).
	wantKinds := []router.EventKind{
		router.KindTextDelta,
		router.KindToolStart,
		router.KindToolEnd,
		router.KindTextDelta,
		router.KindDone,
	}
	if len(events) != len(wantKinds) {
		t.Fatalf("event kind count mismatch: got %d want %d (%+v)", len(events), len(wantKinds), events)
	}
	for i, want := range wantKinds {
		if events[i].Kind != want {
			t.Errorf("event[%d].Kind = %v, want %v", i, events[i].Kind, want)
		}
	}
	if events[1].ToolCallID != "call-1" || events[1].ToolName != "list_pods" {
		t.Errorf("ToolStart fields wrong: %+v", events[1])
	}
	if events[2].ToolCallID != "call-1" || !events[2].OK {
		t.Errorf("ToolEnd fields wrong: %+v", events[2])
	}
	if events[len(events)-1].FinishReason != "stop" {
		t.Errorf("Done.FinishReason = %q, want stop", events[len(events)-1].FinishReason)
	}
	if events[len(events)-1].Partial {
		t.Errorf("Done.Partial should be false on completed state")
	}
}

func TestStream_HTTP500EmitsErrorThenPartialDone(t *testing.T) {
	srv := newFake(t, nil, http.StatusInternalServerError)
	defer srv.Close()

	e := New(Config{Endpoint: srv.URL, DefaultAgentID: "k8s-agent"})
	ch, _ := e.Stream(context.Background(), router.Request{Text: "x", FocusClusterID: "c"})
	events := collect(t, ch)
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d: %+v", len(events), events)
	}
	if events[0].Kind != router.KindError || !strings.HasPrefix(events[0].Code, "kagent_http_5") {
		t.Errorf("first event = %+v, want HTTP error", events[0])
	}
	if events[1].Kind != router.KindDone || !events[1].Partial {
		t.Errorf("last event = %+v, want partial Done", events[1])
	}
}

func TestStream_ContextCancelMidStream(t *testing.T) {
	frames := []string{
		`{"jsonrpc":"2.0","result":{"status":{"state":"working","message":{"role":"assistant","parts":[{"kind":"text","text":"chunk-1"}]}}}}`,
		`{"jsonrpc":"2.0","result":{"status":{"state":"working","message":{"role":"assistant","parts":[{"kind":"text","text":"chunk-2"}]}}}}`,
		`{"jsonrpc":"2.0","result":{"status":{"state":"working","message":{"role":"assistant","parts":[{"kind":"text","text":"chunk-3"}]}}}}`,
		`{"jsonrpc":"2.0","result":{"status":{"state":"completed","message":{"role":"assistant","parts":[{"kind":"text","text":"done"}]}}}}`,
	}
	f := &fakeKagent{t: t, frames: frames, delay: 200 * time.Millisecond}
	srv := httptest.NewServer(f.handler())
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	e := New(Config{Endpoint: srv.URL, DefaultAgentID: "k8s-agent"})
	ch, _ := e.Stream(ctx, router.Request{Text: "hi"})

	// Cancel after the first chunk arrives.
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	events := collect(t, ch)
	if len(events) == 0 {
		t.Fatalf("expected at least one event")
	}
	last := events[len(events)-1]
	if last.Kind != router.KindDone || !last.Partial || !last.Cancelled || last.FinishReason != "cancel" {
		t.Errorf("last event = %+v, want partial cancelled Done", last)
	}
}

func TestStream_UnconfiguredPreserved(t *testing.T) {
	e := New(Config{}) // no Endpoint
	ch, _ := e.Stream(context.Background(), router.Request{})
	events := collect(t, ch)
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(events))
	}
	if events[0].Code != "kagent_unconfigured" {
		t.Errorf("first.Code = %q, want kagent_unconfigured", events[0].Code)
	}
	if events[1].Kind != router.KindDone || !events[1].Partial {
		t.Errorf("last event = %+v, want partial Done", events[1])
	}
}

func TestStream_MultipleToolCallsPair(t *testing.T) {
	frames := []string{
		// Two function calls in a row.
		`{"jsonrpc":"2.0","result":{"status":{"state":"working","message":{"role":"assistant","parts":[{"kind":"data","data":{"id":"c-A","name":"tool_a","args":{}},"metadata":{"type":"function_call"}}]}}}}`,
		`{"jsonrpc":"2.0","result":{"status":{"state":"working","message":{"role":"assistant","parts":[{"kind":"data","data":{"id":"c-B","name":"tool_b","args":{}},"metadata":{"type":"function_call"}}]}}}}`,
		// Responses arrive out of order to verify ID-based pairing.
		`{"jsonrpc":"2.0","result":{"status":{"state":"working","message":{"role":"assistant","parts":[{"kind":"data","data":{"id":"c-B","name":"tool_b","response":{"ok":1}},"metadata":{"type":"function_response"}}]}}}}`,
		`{"jsonrpc":"2.0","result":{"status":{"state":"completed","message":{"role":"assistant","parts":[{"kind":"data","data":{"id":"c-A","name":"tool_a","response":{"ok":2}},"metadata":{"type":"function_response"}}]}}}}`,
	}
	srv := newFake(t, frames, 0)
	defer srv.Close()

	e := New(Config{Endpoint: srv.URL, DefaultAgentID: "k8s-agent"})
	ch, _ := e.Stream(context.Background(), router.Request{Text: "x"})
	events := collect(t, ch)

	var starts, ends []router.Event
	for _, ev := range events {
		switch ev.Kind {
		case router.KindToolStart:
			starts = append(starts, ev)
		case router.KindToolEnd:
			ends = append(ends, ev)
		}
	}
	if len(starts) != 2 || len(ends) != 2 {
		t.Fatalf("expected 2 starts + 2 ends, got %d / %d", len(starts), len(ends))
	}
	// Pairing: end[0].ToolCallID should be c-B, end[1] should be c-A.
	if ends[0].ToolCallID != "c-B" || ends[1].ToolCallID != "c-A" {
		t.Errorf("ToolEnd pairing wrong: %+v / %+v", ends[0], ends[1])
	}
	if ends[0].ToolName != "tool_b" || ends[1].ToolName != "tool_a" {
		t.Errorf("ToolEnd names wrong: %+v / %+v", ends[0], ends[1])
	}
}
