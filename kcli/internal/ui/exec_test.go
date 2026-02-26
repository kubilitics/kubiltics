package ui

import (
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// pickContainerFromReader
// ---------------------------------------------------------------------------

func TestPickContainer_SingleValidNumeric(t *testing.T) {
	containers := []string{"nginx", "sidecar"}
	r := strings.NewReader("1\n")
	got, err := pickContainerFromReader(r, &strings.Builder{}, containers, "mypod")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "nginx" {
		t.Errorf("expected 'nginx', got %q", got)
	}
}

func TestPickContainer_SecondContainer(t *testing.T) {
	containers := []string{"nginx", "sidecar"}
	r := strings.NewReader("2\n")
	got, err := pickContainerFromReader(r, &strings.Builder{}, containers, "mypod")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "sidecar" {
		t.Errorf("expected 'sidecar', got %q", got)
	}
}

func TestPickContainer_EmptyInputDefaultsToFirst(t *testing.T) {
	containers := []string{"main", "proxy"}
	r := strings.NewReader("\n")
	got, err := pickContainerFromReader(r, &strings.Builder{}, containers, "mypod")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "main" {
		t.Errorf("expected first container 'main' on empty input, got %q", got)
	}
}

func TestPickContainer_EOFDefaultsToFirst(t *testing.T) {
	containers := []string{"app", "logshipper"}
	r := strings.NewReader("") // EOF immediately
	got, err := pickContainerFromReader(r, &strings.Builder{}, containers, "mypod")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "app" {
		t.Errorf("expected first container 'app' on EOF, got %q", got)
	}
}

func TestPickContainer_RawContainerName(t *testing.T) {
	// Non-numeric input is treated as a raw container name passthrough.
	containers := []string{"main", "debug"}
	r := strings.NewReader("debug\n")
	got, err := pickContainerFromReader(r, &strings.Builder{}, containers, "mypod")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "debug" {
		t.Errorf("expected 'debug' as raw passthrough, got %q", got)
	}
}

func TestPickContainer_OutOfRangeDefaultsToFirst(t *testing.T) {
	containers := []string{"app"}
	r := strings.NewReader("99\n")
	got, err := pickContainerFromReader(r, &strings.Builder{}, containers, "mypod")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "app" {
		t.Errorf("expected first container 'app' on out-of-range, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// buildShellExecArgs
// ---------------------------------------------------------------------------

func TestBuildShellExecArgs_BasicPod(t *testing.T) {
	opts := Options{}
	row := resourceRow{Name: "nginx-abc", Namespace: "default"}
	args := buildShellExecArgs(opts, row, "nginx")
	// Must contain: exec, -it, pod-name, -n, ns, -c, container, --, /bin/sh
	contains := func(needle string) bool {
		for _, a := range args {
			if a == needle {
				return true
			}
		}
		return false
	}
	for _, want := range []string{"exec", "-it", "nginx-abc", "-n", "default", "-c", "nginx", "--", "/bin/sh"} {
		if !contains(want) {
			t.Errorf("expected %q in args %v", want, args)
		}
	}
}

func TestBuildShellExecArgs_WithContext(t *testing.T) {
	opts := Options{Context: "prod-east", Kubeconfig: "/home/user/.kube/prod"}
	row := resourceRow{Name: "api-pod", Namespace: "api"}
	args := buildShellExecArgs(opts, row, "api")
	contains := func(needle string) bool {
		for _, a := range args {
			if a == needle {
				return true
			}
		}
		return false
	}
	if !contains("--context") || !contains("prod-east") {
		t.Errorf("expected --context prod-east in args: %v", args)
	}
	if !contains("--kubeconfig") || !contains("/home/user/.kube/prod") {
		t.Errorf("expected --kubeconfig in args: %v", args)
	}
}

func TestBuildShellExecArgs_NoNamespace(t *testing.T) {
	opts := Options{}
	// Namespace "-" should not be forwarded.
	row := resourceRow{Name: "mypod", Namespace: "-"}
	args := buildShellExecArgs(opts, row, "app")
	for _, a := range args {
		if a == "-n" {
			t.Errorf("expected -n to be omitted when namespace is '-', got %v", args)
		}
	}
}

func TestBuildShellExecArgs_NoContainer(t *testing.T) {
	opts := Options{}
	row := resourceRow{Name: "mypod", Namespace: "default"}
	args := buildShellExecArgs(opts, row, "") // empty container → no -c flag
	for i, a := range args {
		if a == "-c" {
			t.Errorf("expected no -c flag when container is empty, found at index %d in %v", i, args)
		}
	}
}

func TestBuildShellExecArgs_EndsWithShell(t *testing.T) {
	opts := Options{}
	row := resourceRow{Name: "pod", Namespace: "default"}
	args := buildShellExecArgs(opts, row, "app")
	if len(args) == 0 || args[len(args)-1] != "/bin/sh" {
		t.Errorf("expected last arg to be /bin/sh, got %v", args)
	}
}

func TestBuildShellExecArgs_DoubleDashBeforeShell(t *testing.T) {
	opts := Options{}
	row := resourceRow{Name: "pod", Namespace: "default"}
	args := buildShellExecArgs(opts, row, "app")
	hasSep := false
	for i, a := range args {
		if a == "--" && i < len(args)-1 && args[i+1] == "/bin/sh" {
			hasSep = true
		}
	}
	if !hasSep {
		t.Errorf("expected -- before /bin/sh in %v", args)
	}
}
