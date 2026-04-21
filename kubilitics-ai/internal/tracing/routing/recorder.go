// Package routing records a per-chat-turn trace of every stage a message
// flows through — user input, LLM prompt, tool dispatch, backend K8s
// fetch, summarizer, LLM completion. Output is one JSON object per line,
// written to <dir>/<turnID>.jsonl, so downstream tooling (the bench
// report generator, ad-hoc jq queries, auditors) can stream-parse.
//
// The tracer is deliberately thin: it's a map-to-JSON appender, not a
// structured-logging framework. Stage names and field keys are free-form
// strings; the bench-report tool treats unknown stages as a warning but
// does not fail.
//
// FromContext never returns nil. When no recorder is attached, callers
// get a no-op that silently drops every Stage() call. This keeps hook
// sites clean — no nil-checks at every call site.
package routing

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Recorder captures per-stage events for a single chat turn.
type Recorder interface {
	Stage(name string, fields map[string]any)
	Close() error
}

type fileRecorder struct {
	turnID string
	f      *os.File
	enc    *json.Encoder
	mu     sync.Mutex
}

// NewFileRecorder opens <dir>/<turnID>.jsonl for append. Directory is
// created with mkdir -p semantics.
func NewFileRecorder(turnID, dir string) (Recorder, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, turnID+".jsonl")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, err
	}
	return &fileRecorder{turnID: turnID, f: f, enc: json.NewEncoder(f)}, nil
}

func (r *fileRecorder) Stage(name string, fields map[string]any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make(map[string]any, len(fields)+3)
	for k, v := range fields {
		out[k] = v
	}
	out["stage"] = name
	out["ts"] = time.Now().UTC().Format(time.RFC3339Nano)
	out["turn_id"] = r.turnID
	_ = r.enc.Encode(out)
}

func (r *fileRecorder) Close() error {
	return r.f.Close()
}

// noopRecorder drops every Stage call. Returned from FromContext when no
// real recorder is attached.
type noopRecorder struct{}

func (noopRecorder) Stage(string, map[string]any) {}
func (noopRecorder) Close() error                 { return nil }

type ctxKey struct{}

// WithRecorder attaches r to ctx. FromContext will return r for
// descendant ctxs.
func WithRecorder(ctx context.Context, r Recorder) context.Context {
	return context.WithValue(ctx, ctxKey{}, r)
}

// FromContext returns the recorder attached to ctx, or a no-op if none.
// Callers should never nil-check the result.
func FromContext(ctx context.Context) Recorder {
	if r, ok := ctx.Value(ctxKey{}).(Recorder); ok && r != nil {
		return r
	}
	return noopRecorder{}
}
