package cli

import (
	"reflect"
	"testing"
)

func TestScopeArgsFor(t *testing.T) {
	a := &app{context: "prod", namespace: "ns-a", kubeconfig: "/tmp/kubeconfig"}

	t.Run("injects context and namespace", func(t *testing.T) {
		got := a.scopeArgsFor([]string{"get", "pods"})
		want := []string{"--context", "prod", "-n", "ns-a", "--kubeconfig", "/tmp/kubeconfig", "get", "pods"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("scopeArgsFor mismatch: got %v want %v", got, want)
		}
	})

	t.Run("skips namespace when all namespaces requested", func(t *testing.T) {
		got := a.scopeArgsFor([]string{"get", "pods", "-A"})
		want := []string{"--context", "prod", "--kubeconfig", "/tmp/kubeconfig", "get", "pods", "-A"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("scopeArgsFor mismatch: got %v want %v", got, want)
		}
	})

	t.Run("skips duplicates when explicit flags present", func(t *testing.T) {
		got := a.scopeArgsFor([]string{"--context", "dev", "--namespace", "ns-b", "--kubeconfig", "/tmp/other", "get", "pods"})
		want := []string{"--context", "dev", "--namespace", "ns-b", "--kubeconfig", "/tmp/other", "get", "pods"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("scopeArgsFor mismatch: got %v want %v", got, want)
		}
	})
}

func TestHasKubeconfigFlag(t *testing.T) {
	if !hasKubeconfigFlag([]string{"get", "pods", "--kubeconfig", "/tmp/k"}) {
		t.Fatalf("expected kubeconfig flag to be detected")
	}
	if !hasKubeconfigFlag([]string{"get", "pods", "--kubeconfig=/tmp/k"}) {
		t.Fatalf("expected kubeconfig equals flag to be detected")
	}
	if hasKubeconfigFlag([]string{"get", "pods"}) {
		t.Fatalf("expected no kubeconfig flag")
	}
}

func TestApplyInlineGlobalFlags(t *testing.T) {
	t.Run("--yes is consumed and sets force=true (not forwarded to kubectl)", func(t *testing.T) {
		a := &app{context: "base", namespace: "ns0", kubeconfig: "/tmp/base", force: false}
		args := []string{"--context", "prod", "--namespace=blue", "--kubeconfig", "/tmp/custom", "--yes", "pods", "-A", "-o", "wide"}
		clean, restore, err := a.applyInlineGlobalFlags(args)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !a.force || a.context != "prod" || a.namespace != "blue" || a.kubeconfig != "/tmp/custom" {
			t.Fatalf("global overrides not applied correctly: %+v", a)
		}
		// --yes must NOT appear in clean args (it is kcli-only, never forwarded).
		wantClean := []string{"pods", "-A", "-o", "wide"}
		if !reflect.DeepEqual(clean, wantClean) {
			t.Fatalf("clean args mismatch: got %v want %v", clean, wantClean)
		}
		restore()
		if a.force || a.context != "base" || a.namespace != "ns0" || a.kubeconfig != "/tmp/base" {
			t.Fatalf("restore failed: %+v", a)
		}
	})

	t.Run("--force sets force=true AND is forwarded to kubectl", func(t *testing.T) {
		a := &app{context: "base", namespace: "ns0", force: false}
		args := []string{"--force", "pods", "-A"}
		clean, restore, err := a.applyInlineGlobalFlags(args)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !a.force {
			t.Fatal("expected force=true when --force is passed")
		}
		// --force MUST appear in clean args (forwarded to kubectl for kubectl --force semantics).
		wantClean := []string{"--force", "pods", "-A"}
		if !reflect.DeepEqual(clean, wantClean) {
			t.Fatalf("clean args mismatch: got %v want %v", clean, wantClean)
		}
		restore()
		if a.force {
			t.Fatal("restore failed: force should be false after restore")
		}
	})
}
