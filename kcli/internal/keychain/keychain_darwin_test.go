//go:build darwin

package keychain

import (
	"os/exec"
	"testing"
)

func TestSetDoesNotInfinitelyRecurse(t *testing.T) {
	// Verify that the security binary exists; skip if not (e.g. CI containers).
	if _, err := exec.LookPath("security"); err != nil {
		t.Skip("security(1) not found, skipping macOS keychain test")
	}

	const (
		svc = "kcli-test-recursion"
		acc = "test-account"
		val = "test-value"
	)

	// Clean up before and after.
	_ = delete(svc, acc)
	t.Cleanup(func() { _ = delete(svc, acc) })

	// First set should succeed (fresh entry).
	if err := set(svc, acc, val); err != nil {
		t.Fatalf("set (fresh) failed: %v", err)
	}

	// Second set should succeed (update path).
	if err := set(svc, acc, "updated-value"); err != nil {
		t.Fatalf("set (update) failed: %v", err)
	}

	// Verify the stored value.
	got, err := get(svc, acc)
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if got != "updated-value" {
		t.Errorf("expected %q, got %q", "updated-value", got)
	}
}

func TestAddDirectReturnsErrorOnDuplicate(t *testing.T) {
	if _, err := exec.LookPath("security"); err != nil {
		t.Skip("security(1) not found, skipping macOS keychain test")
	}

	const (
		svc = "kcli-test-adddirect"
		acc = "test-dup"
		val = "v1"
	)

	_ = delete(svc, acc)
	t.Cleanup(func() { _ = delete(svc, acc) })

	// First add should succeed.
	if err := addDirect(svc, acc, val); err != nil {
		t.Fatalf("addDirect (first) failed: %v", err)
	}

	// Second add (without -U) should fail because the entry already exists.
	if err := addDirect(svc, acc, val); err == nil {
		t.Error("expected addDirect to fail on duplicate entry, but got nil")
	}
}
