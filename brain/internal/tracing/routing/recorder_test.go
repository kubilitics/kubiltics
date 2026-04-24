package routing

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFileRecorder_WritesOneLinePerStage(t *testing.T) {
	dir := t.TempDir()
	r, err := NewFileRecorder("turn-test-1", dir)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	r.Stage("user_msg", map[string]any{"bytes": 42})
	r.Stage("llm_prompt_in", map[string]any{"input_tokens": 2841, "model": "gpt-4o"})
	if err := r.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	p := filepath.Join(dir, "turn-test-1.jsonl")
	body, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(body)), "\n")
	if len(lines) != 2 {
		t.Fatalf("want 2 lines, got %d: %q", len(lines), body)
	}
	var l1 map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &l1); err != nil {
		t.Fatalf("unmarshal l1: %v", err)
	}
	if l1["stage"] != "user_msg" || int(l1["bytes"].(float64)) != 42 {
		t.Fatalf("l1 wrong: %v", l1)
	}
	if _, has := l1["ts"]; !has {
		t.Fatalf("missing ts on l1: %v", l1)
	}
	if _, has := l1["turn_id"]; !has {
		t.Fatalf("missing turn_id on l1: %v", l1)
	}
}

func TestContext_WithAndFrom(t *testing.T) {
	ctx := context.Background()
	if r := FromContext(ctx); r == nil {
		t.Fatalf("FromContext must never return nil — should be no-op recorder")
	}
	fr, _ := NewFileRecorder("turn-ctx", t.TempDir())
	ctx2 := WithRecorder(ctx, fr)
	if FromContext(ctx2) != fr {
		t.Fatalf("WithRecorder+FromContext roundtrip failed")
	}
}

func TestNoOpRecorder_ZeroAllocNoError(t *testing.T) {
	r := FromContext(context.Background())
	r.Stage("anywhere", map[string]any{"noise": 1})
	if err := r.Close(); err != nil {
		t.Fatalf("no-op Close should never err: %v", err)
	}
}
