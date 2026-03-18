package filelock

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWithFileLock_BasicRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.json")

	called := false
	err := WithFileLock(path, func() error {
		called = true
		return nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !called {
		t.Fatal("fn was not called")
	}

	// Lock file should be cleaned up.
	lockPath := path + ".lock"
	if _, err := os.Stat(lockPath); !os.IsNotExist(err) {
		t.Fatalf("lock file should be removed after unlock, got err=%v", err)
	}
}

func TestWithFileLock_PropagatesError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.json")

	want := os.ErrPermission
	err := WithFileLock(path, func() error {
		return want
	})
	if err != want {
		t.Fatalf("expected %v, got %v", want, err)
	}
}

func TestWithFileLock_StaleLockRemoved(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.json")
	lockPath := path + ".lock"

	// Create a stale lock file with old modification time.
	f, err := os.Create(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	staleTime := time.Now().Add(-2 * time.Minute)
	if err := os.Chtimes(lockPath, staleTime, staleTime); err != nil {
		t.Fatal(err)
	}

	called := false
	err = WithFileLock(path, func() error {
		called = true
		return nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !called {
		t.Fatal("fn was not called despite stale lock")
	}
}

func TestWithFileLock_ActiveLockFallsBack(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.json")
	lockPath := path + ".lock"

	// Create a fresh lock file (not stale).
	f, err := os.Create(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	f.Close()

	// Should fall back to running fn without lock.
	called := false
	err = WithFileLock(path, func() error {
		called = true
		return nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !called {
		t.Fatal("fn was not called in fallback mode")
	}
}

func TestDirOf(t *testing.T) {
	tests := []struct {
		input, want string
	}{
		{"/foo/bar/baz.lock", "/foo/bar"},
		{"relative/path.lock", "relative"},
		{"nodir.lock", "."},
		{`C:\Users\test\file.lock`, `C:\Users\test`},
	}
	for _, tt := range tests {
		got := dirOf(tt.input)
		if got != tt.want {
			t.Errorf("dirOf(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}
