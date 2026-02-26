package ui

import (
	"os"
	"testing"
)

// ---------------------------------------------------------------------------
// resolveEditor
// ---------------------------------------------------------------------------

func TestResolveEditor_VISUAL(t *testing.T) {
	orig := os.Getenv("VISUAL")
	defer os.Setenv("VISUAL", orig)
	os.Setenv("VISUAL", "nano")
	os.Unsetenv("EDITOR")

	got := resolveEditor()
	if got != "nano" {
		t.Errorf("expected VISUAL='nano', got %q", got)
	}
}

func TestResolveEditor_EDITORFallback(t *testing.T) {
	orig := os.Getenv("VISUAL")
	origE := os.Getenv("EDITOR")
	defer func() {
		os.Setenv("VISUAL", orig)
		os.Setenv("EDITOR", origE)
	}()
	os.Unsetenv("VISUAL")
	os.Setenv("EDITOR", "emacs")

	got := resolveEditor()
	if got != "emacs" {
		t.Errorf("expected EDITOR='emacs', got %q", got)
	}
}

func TestResolveEditor_DefaultVI(t *testing.T) {
	orig := os.Getenv("VISUAL")
	origE := os.Getenv("EDITOR")
	defer func() {
		os.Setenv("VISUAL", orig)
		os.Setenv("EDITOR", origE)
	}()
	os.Unsetenv("VISUAL")
	os.Unsetenv("EDITOR")

	got := resolveEditor()
	if got != "vi" {
		t.Errorf("expected default 'vi', got %q", got)
	}
}

func TestResolveEditor_VISUALTakesPriorityOverEDITOR(t *testing.T) {
	orig := os.Getenv("VISUAL")
	origE := os.Getenv("EDITOR")
	defer func() {
		os.Setenv("VISUAL", orig)
		os.Setenv("EDITOR", origE)
	}()
	os.Setenv("VISUAL", "code")
	os.Setenv("EDITOR", "vim")

	got := resolveEditor()
	if got != "code" {
		t.Errorf("expected VISUAL='code' over EDITOR='vim', got %q", got)
	}
}

// ---------------------------------------------------------------------------
// buildScopedArgs
// ---------------------------------------------------------------------------

func TestBuildScopedArgs_BasicArgs(t *testing.T) {
	opts := Options{}
	args := buildScopedArgs(opts, []string{"get", "pod", "nginx"})
	if len(args) != 3 || args[0] != "get" || args[1] != "pod" || args[2] != "nginx" {
		t.Errorf("expected [get pod nginx], got %v", args)
	}
}

func TestBuildScopedArgs_WithContext(t *testing.T) {
	opts := Options{Context: "prod"}
	args := buildScopedArgs(opts, []string{"get", "pod"})
	contains := func(s string) bool {
		for _, a := range args {
			if a == s {
				return true
			}
		}
		return false
	}
	if !contains("--context") || !contains("prod") {
		t.Errorf("expected --context prod in %v", args)
	}
}

func TestBuildScopedArgs_WithKubeconfig(t *testing.T) {
	opts := Options{Kubeconfig: "/etc/kube/config"}
	args := buildScopedArgs(opts, []string{"apply", "-f", "file.yaml"})
	contains := func(s string) bool {
		for _, a := range args {
			if a == s {
				return true
			}
		}
		return false
	}
	if !contains("--kubeconfig") || !contains("/etc/kube/config") {
		t.Errorf("expected --kubeconfig in %v", args)
	}
}

func TestBuildScopedArgs_BothFlags(t *testing.T) {
	opts := Options{Context: "staging", Kubeconfig: "/kube/staging"}
	args := buildScopedArgs(opts, []string{"get", "deployment"})
	if len(args) != 6 { // --kubeconfig /kube/staging --context staging get deployment
		t.Errorf("expected 6 args, got %d: %v", len(args), args)
	}
}

// ---------------------------------------------------------------------------
// insertNamespace
// ---------------------------------------------------------------------------

func TestInsertNamespace_AppendsFlag(t *testing.T) {
	args := insertNamespace([]string{"get", "pod", "nginx"}, "myns")
	// Must end with -n myns
	if len(args) < 2 || args[len(args)-2] != "-n" || args[len(args)-1] != "myns" {
		t.Errorf("expected -n myns at end, got %v", args)
	}
}

func TestInsertNamespace_EmptyNamespace(t *testing.T) {
	args := insertNamespace([]string{"get", "pod"}, "")
	// Empty namespace is still appended (caller should check before calling)
	if len(args) != 4 {
		t.Errorf("expected 4 args, got %d: %v", len(args), args)
	}
}
