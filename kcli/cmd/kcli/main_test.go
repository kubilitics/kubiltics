package main

import (
	"reflect"
	"testing"
)

func TestFirstCommandToken(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want string
	}{
		{name: "plain command", args: []string{"cp", "a", "b"}, want: "cp"},
		{name: "with scope flags", args: []string{"--context", "prod", "-n", "default", "cp", "a", "b"}, want: "cp"},
		{name: "with inline flags", args: []string{"--context=prod", "--namespace=default", "cp", "a", "b"}, want: "cp"},
		{name: "kcli-only flags", args: []string{"--ai-timeout", "5s", "cp", "a", "b"}, want: "cp"},
		{name: "only flags", args: []string{"--force", "-n", "default"}, want: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := firstCommandToken(tc.args)
			if got != tc.want {
				t.Fatalf("firstCommandToken(%v)=%q want %q", tc.args, got, tc.want)
			}
		})
	}
}

func TestStripKCLIOnlyFlags(t *testing.T) {
	// --force is now FORWARDED to kubectl (e.g. kubectl delete --force).
	// --yes is the kcli-only bypass flag and is stripped.
	// --ai-timeout and --completion-timeout are kcli-only and are stripped.
	t.Run("--force passes through to kubectl", func(t *testing.T) {
		gotArgs, force, err := stripKCLIOnlyFlags([]string{"--force", "--ai-timeout", "5s", "--completion-timeout=200ms", "--context", "prod", "cp", "a", "b"})
		if err != nil {
			t.Fatalf("stripKCLIOnlyFlags returned error: %v", err)
		}
		// --force must be included in output (forwarded to kubectl).
		wantArgs := []string{"--force", "--context", "prod", "cp", "a", "b"}
		if !reflect.DeepEqual(gotArgs, wantArgs) {
			t.Fatalf("args mismatch: got %v want %v", gotArgs, wantArgs)
		}
		if !force {
			t.Fatal("expected force=true when --force present")
		}
	})

	t.Run("--yes is stripped and not forwarded", func(t *testing.T) {
		gotArgs, force, err := stripKCLIOnlyFlags([]string{"--yes", "--context", "prod", "cp", "a", "b"})
		if err != nil {
			t.Fatalf("stripKCLIOnlyFlags returned error: %v", err)
		}
		// --yes must NOT be in output (kcli-only, never forwarded).
		wantArgs := []string{"--context", "prod", "cp", "a", "b"}
		if !reflect.DeepEqual(gotArgs, wantArgs) {
			t.Fatalf("args mismatch: got %v want %v", gotArgs, wantArgs)
		}
		if !force {
			t.Fatal("expected force=true when --yes present")
		}
	})
}

func TestShouldFallbackToKubectl(t *testing.T) {
	// cp is a registered kcli builtin (passes through to kubectl internally)
	// so it does NOT fall back via the shouldFallbackToKubectl path.
	if shouldFallbackToKubectl([]string{"cp", "a", "b"}) {
		t.Fatal("cp is a registered builtin — should not fall back")
	}
	if shouldFallbackToKubectl([]string{"get", "pods"}) {
		t.Fatal("did not expect fallback for built-in get")
	}
	// Unknown commands should still fall back
	if !shouldFallbackToKubectl([]string{"some-unknown-command", "foo"}) {
		t.Fatal("expected fallback for unknown command")
	}
}
