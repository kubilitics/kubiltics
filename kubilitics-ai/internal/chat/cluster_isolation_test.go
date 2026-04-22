package chat

import (
	"context"
	"path/filepath"
	"testing"
)

// TestDeriveSessionID_StableAndUnique asserts the same (cluster, user)
// pair always yields the same ID, and any distinct pair diverges.
func TestDeriveSessionID_StableAndUnique(t *testing.T) {
	a1 := DeriveSessionID("cluster-A", "alice")
	a2 := DeriveSessionID("cluster-A", "alice")
	b := DeriveSessionID("cluster-B", "alice")
	c := DeriveSessionID("cluster-A", "bob")

	if a1 != a2 {
		t.Fatalf("stability broken: %q != %q", a1, a2)
	}
	if a1 == b {
		t.Fatalf("cluster change must diverge: %q == %q", a1, b)
	}
	if a1 == c {
		t.Fatalf("user change must diverge: %q == %q", a1, c)
	}
	if a1 == "" {
		t.Fatal("empty session ID")
	}
}

// TestClusterSwitch_FreshSession — switching cluster yields a brand-new
// session with empty history. Switching back to the original resumes.
func TestClusterSwitch_FreshSession(t *testing.T) {
	dir := t.TempDir()
	store, err := NewSQLiteSessionStore(filepath.Join(dir, "chat.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	userID := "alice"
	sidA := DeriveSessionID("cluster-A", userID)
	sidB := DeriveSessionID("cluster-B", userID)

	// Ask something in cluster A.
	if err := store.Append(ctx, sidA, Message{Role: "user", Content: "what pods are crashing in A?"}); err != nil {
		t.Fatalf("append A: %v", err)
	}
	if err := store.Append(ctx, sidA, Message{Role: "assistant", Content: "pod-a-123 is CrashLoopBackOff"}); err != nil {
		t.Fatalf("append A2: %v", err)
	}

	// Switch to cluster B — must see no messages.
	bMsgs, err := store.Load(ctx, sidB)
	if err != nil {
		t.Fatalf("load B: %v", err)
	}
	if len(bMsgs) != 0 {
		t.Fatalf("cluster B leaked %d messages from cluster A", len(bMsgs))
	}

	// Record something in B.
	if err := store.Append(ctx, sidB, Message{Role: "user", Content: "what about B?"}); err != nil {
		t.Fatalf("append B: %v", err)
	}

	// Switch back to A — must resume the original 2-message conversation.
	aMsgs, err := store.Load(ctx, sidA)
	if err != nil {
		t.Fatalf("load A: %v", err)
	}
	if len(aMsgs) != 2 {
		t.Fatalf("cluster A lost history: got %d msgs, want 2", len(aMsgs))
	}
	for _, m := range aMsgs {
		if m.Content == "what about B?" {
			t.Fatal("cluster A saw a cluster-B message")
		}
	}
}
