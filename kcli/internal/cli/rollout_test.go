package cli

import (
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// rolloutTarget
// ---------------------------------------------------------------------------

func TestRolloutTarget_NameSlashType(t *testing.T) {
	got := rolloutTarget([]string{"deployment/api", "--timeout=5m"})
	if got != "deployment/api" {
		t.Errorf("expected deployment/api, got %q", got)
	}
}

func TestRolloutTarget_SkipsFlags(t *testing.T) {
	got := rolloutTarget([]string{"--watch", "deployment/api"})
	if got != "deployment/api" {
		t.Errorf("expected deployment/api after skipping flags, got %q", got)
	}
}

func TestRolloutTarget_Empty(t *testing.T) {
	got := rolloutTarget([]string{})
	if got != "resource" {
		t.Errorf("expected default 'resource', got %q", got)
	}
}

func TestRolloutTarget_OnlyFlags(t *testing.T) {
	got := rolloutTarget([]string{"--watch", "--timeout=5m"})
	if got != "resource" {
		t.Errorf("expected default 'resource' for flags-only, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// rolloutRevision
// ---------------------------------------------------------------------------

func TestRolloutRevision_EqualsForm(t *testing.T) {
	got := rolloutRevision([]string{"deployment/api", "--to-revision=3"})
	if got != "3" {
		t.Errorf("expected '3', got %q", got)
	}
}

func TestRolloutRevision_SpaceForm(t *testing.T) {
	got := rolloutRevision([]string{"deployment/api", "--to-revision", "5"})
	if got != "5" {
		t.Errorf("expected '5', got %q", got)
	}
}

func TestRolloutRevision_NotPresent(t *testing.T) {
	got := rolloutRevision([]string{"deployment/api"})
	if got != "" {
		t.Errorf("expected empty when --to-revision absent, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// stripFlag
// ---------------------------------------------------------------------------

func TestStripFlag_Found(t *testing.T) {
	found, rest := stripFlag("--ai", []string{"deployment/api", "--ai", "--timeout=5m"})
	if !found {
		t.Fatal("expected found=true")
	}
	for _, a := range rest {
		if a == "--ai" {
			t.Fatal("--ai should be stripped from rest")
		}
	}
	if len(rest) != 2 {
		t.Fatalf("expected 2 remaining args, got %v", rest)
	}
}

func TestStripFlag_NotFound(t *testing.T) {
	found, rest := stripFlag("--ai", []string{"deployment/api"})
	if found {
		t.Fatal("expected found=false")
	}
	if len(rest) != 1 {
		t.Fatalf("expected 1 remaining arg, got %v", rest)
	}
}

func TestStripFlag_Empty(t *testing.T) {
	found, rest := stripFlag("--ai", nil)
	if found || len(rest) != 0 {
		t.Fatalf("expected found=false, rest=[], got found=%v rest=%v", found, rest)
	}
}

// ---------------------------------------------------------------------------
// readYesNo
// ---------------------------------------------------------------------------

func TestReadYesNo_Yes(t *testing.T) {
	cases := []string{"y\n", "Y\n", "yes\n", "YES\n", "Yes\n"}
	for _, c := range cases {
		if !readYesNo(strings.NewReader(c)) {
			t.Errorf("expected true for %q", c)
		}
	}
}

func TestReadYesNo_No(t *testing.T) {
	cases := []string{"n\n", "N\n", "no\n", "\n", "nope\n"}
	for _, c := range cases {
		if readYesNo(strings.NewReader(c)) {
			t.Errorf("expected false for %q", c)
		}
	}
}
