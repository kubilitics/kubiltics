package cli

import (
	"testing"
)

// ---------------------------------------------------------------------------
// injectApplyDefaults
// ---------------------------------------------------------------------------

func TestInjectApplyDefaults_NoServerSide(t *testing.T) {
	args := []string{"-f", "deploy.yaml"}
	got := injectApplyDefaults(args)
	// No --server-side → no injection.
	for _, a := range got {
		if a == "--field-manager=kcli" {
			t.Fatal("should not inject --field-manager when --server-side is absent")
		}
	}
	if len(got) != len(args) {
		t.Fatalf("expected unchanged args, got %v", got)
	}
}

func TestInjectApplyDefaults_ServerSideNoFieldManager(t *testing.T) {
	args := []string{"--server-side", "-f", "deploy.yaml"}
	got := injectApplyDefaults(args)
	hasFieldManager := false
	for _, a := range got {
		if a == "--field-manager=kcli" {
			hasFieldManager = true
		}
	}
	if !hasFieldManager {
		t.Fatalf("expected --field-manager=kcli to be injected, got %v", got)
	}
}

func TestInjectApplyDefaults_ServerSideWithExplicitFieldManager(t *testing.T) {
	args := []string{"--server-side", "--field-manager=my-controller", "-f", "f.yaml"}
	got := injectApplyDefaults(args)
	// Explicit field manager present → do NOT override with kcli.
	for _, a := range got {
		if a == "--field-manager=kcli" {
			t.Fatal("should not inject --field-manager=kcli when user already set one")
		}
	}
	// User's field manager must be preserved.
	found := false
	for _, a := range got {
		if a == "--field-manager=my-controller" {
			found = true
		}
	}
	if !found {
		t.Fatalf("user field manager was lost: %v", got)
	}
}

func TestInjectApplyDefaults_ServerSideWithEqualsFieldManager(t *testing.T) {
	// --field-manager=anything — any prefix match stops injection.
	args := []string{"--server-side", "--field-manager=argocd"}
	got := injectApplyDefaults(args)
	for _, a := range got {
		if a == "--field-manager=kcli" {
			t.Fatal("should not inject --field-manager=kcli when user set --field-manager=argocd")
		}
	}
}

func TestInjectApplyDefaults_InjectedFirst(t *testing.T) {
	// Injected flag must be first so kubectl processes it before -f.
	args := []string{"--server-side", "-f", "x.yaml"}
	got := injectApplyDefaults(args)
	if len(got) == 0 || got[0] != "--field-manager=kcli" {
		t.Fatalf("expected --field-manager=kcli as first arg, got %v", got)
	}
}

func TestInjectApplyDefaults_NoServerSideFieldManagerNotInjected(t *testing.T) {
	// --field-manager alone (no --server-side) → no injection, no change.
	args := []string{"-f", "file.yaml", "--dry-run=client"}
	got := injectApplyDefaults(args)
	if len(got) != 3 {
		t.Fatalf("expected unchanged args (len=3), got %v", got)
	}
}

// ---------------------------------------------------------------------------
// applyFieldManagerDefault
// ---------------------------------------------------------------------------

func TestApplyFieldManagerDefault_ServerSide(t *testing.T) {
	got := applyFieldManagerDefault([]string{"--server-side", "-f", "x.yaml"})
	if got != "kcli" {
		t.Errorf("expected field-manager=kcli, got %q", got)
	}
}

func TestApplyFieldManagerDefault_NoServerSide(t *testing.T) {
	got := applyFieldManagerDefault([]string{"-f", "x.yaml"})
	if got != "" {
		t.Errorf("expected empty (no injection) when no --server-side, got %q", got)
	}
}

func TestApplyFieldManagerDefault_UserOverride(t *testing.T) {
	got := applyFieldManagerDefault([]string{"--server-side", "--field-manager=flux"})
	if got != "flux" {
		t.Errorf("expected user override 'flux', got %q", got)
	}
}
