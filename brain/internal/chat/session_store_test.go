package chat

import (
	"context"
	"path/filepath"
	"testing"
)

// TestSessionStore_RoundTripsMessages asserts Append + Load preserves
// message order and fields.
func TestSessionStore_RoundTripsMessages(t *testing.T) {
	dir := t.TempDir()
	store, err := NewSQLiteSessionStore(filepath.Join(dir, "chat.db"))
	if err != nil {
		t.Fatalf("NewSQLiteSessionStore: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	sid := "sess-1"
	if err := store.Append(ctx, sid, Message{Role: "user", Content: "hi"}); err != nil {
		t.Fatalf("append 1: %v", err)
	}
	if err := store.Append(ctx, sid, Message{Role: "assistant", Content: "hello"}); err != nil {
		t.Fatalf("append 2: %v", err)
	}
	msgs, err := store.Load(ctx, sid)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(msgs) != 2 {
		t.Fatalf("want 2 messages, got %d", len(msgs))
	}
	if msgs[0].Role != "user" || msgs[0].Content != "hi" {
		t.Fatalf("msg[0] = %+v, want user/hi", msgs[0])
	}
	if msgs[1].Role != "assistant" || msgs[1].Content != "hello" {
		t.Fatalf("msg[1] = %+v, want assistant/hello", msgs[1])
	}
}

// TestSessionStore_IsolatesSessions asserts messages in session A are
// invisible to session B.
func TestSessionStore_IsolatesSessions(t *testing.T) {
	dir := t.TempDir()
	store, err := NewSQLiteSessionStore(filepath.Join(dir, "chat.db"))
	if err != nil {
		t.Fatalf("NewSQLiteSessionStore: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	if err := store.Append(ctx, "A", Message{Role: "user", Content: "cluster-A-secret"}); err != nil {
		t.Fatalf("append A: %v", err)
	}
	if err := store.Append(ctx, "B", Message{Role: "user", Content: "cluster-B-public"}); err != nil {
		t.Fatalf("append B: %v", err)
	}

	a, _ := store.Load(ctx, "A")
	b, _ := store.Load(ctx, "B")
	if len(a) != 1 || a[0].Content != "cluster-A-secret" {
		t.Fatalf("A load = %+v", a)
	}
	if len(b) != 1 || b[0].Content != "cluster-B-public" {
		t.Fatalf("B load = %+v", b)
	}
	for _, m := range b {
		if m.Content == "cluster-A-secret" {
			t.Fatal("session B must not see A's messages")
		}
	}
}

// TestSessionStore_PersistsAcrossInstances asserts the on-disk SQLite
// survives reopen — the "survives restart" guarantee Plan B.3 demands.
func TestSessionStore_PersistsAcrossInstances(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "chat.db")
	ctx := context.Background()

	s1, err := NewSQLiteSessionStore(path)
	if err != nil {
		t.Fatalf("open 1: %v", err)
	}
	if err := s1.Append(ctx, "persist-sid", Message{Role: "user", Content: "before-restart"}); err != nil {
		t.Fatalf("append: %v", err)
	}
	_ = s1.Close()

	s2, err := NewSQLiteSessionStore(path)
	if err != nil {
		t.Fatalf("open 2: %v", err)
	}
	defer s2.Close()
	msgs, err := s2.Load(ctx, "persist-sid")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(msgs) != 1 || msgs[0].Content != "before-restart" {
		t.Fatalf("after reopen: got %+v", msgs)
	}
}

// TestSessionStore_AppendEmptySessionLoadsEmpty — Load on an unknown sid
// returns an empty slice without error.
func TestSessionStore_UnknownSessionLoadsEmpty(t *testing.T) {
	dir := t.TempDir()
	store, err := NewSQLiteSessionStore(filepath.Join(dir, "chat.db"))
	if err != nil {
		t.Fatalf("NewSQLiteSessionStore: %v", err)
	}
	defer store.Close()

	msgs, err := store.Load(context.Background(), "nope")
	if err != nil {
		t.Fatalf("load unknown: %v", err)
	}
	if len(msgs) != 0 {
		t.Fatalf("want empty, got %d", len(msgs))
	}
}
