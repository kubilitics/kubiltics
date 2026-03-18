package runner

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestShouldConfirm(t *testing.T) {
	cases := []struct {
		name  string
		args  []string
		force bool
		want  bool
	}{
		{name: "mutating delete", args: []string{"delete", "pod", "x"}, force: false, want: true},
		{name: "mutating with scoped flags", args: []string{"--context", "prod", "-n", "default", "delete", "pod", "x"}, force: false, want: true},
		{name: "rollout status is read-only", args: []string{"rollout", "status", "deployment/x"}, force: false, want: false},
		{name: "rollout history is read-only", args: []string{"rollout", "history", "deployment/x"}, force: false, want: false},
		{name: "rollout undo is mutating", args: []string{"rollout", "undo", "deployment/x"}, force: false, want: true},
		{name: "read only get", args: []string{"get", "pods"}, force: false, want: false},
		{name: "force bypass", args: []string{"delete", "pod", "x"}, force: true, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := shouldConfirm(tc.args, tc.force)
			if got != tc.want {
				t.Fatalf("shouldConfirm(%v, force=%v)=%v, want %v", tc.args, tc.force, got, tc.want)
			}
		})
	}
}

func TestFirstVerb(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want string
	}{
		{name: "plain", args: []string{"get", "pods"}, want: "get"},
		{name: "scoped flags", args: []string{"--context", "prod", "--namespace=default", "delete", "pod", "x"}, want: "delete"},
		{name: "kubeconfig prefix", args: []string{"--kubeconfig", "/tmp/k", "apply", "-f", "x.yaml"}, want: "apply"},
		{name: "none", args: []string{"--context", "prod"}, want: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := firstVerb(tc.args)
			if got != tc.want {
				t.Fatalf("firstVerb(%v)=%q want %q", tc.args, got, tc.want)
			}
		})
	}
}

func TestCommandWords(t *testing.T) {
	got := commandWords([]string{"--context", "prod", "-n", "default", "rollout", "status", "deployment/x", "--timeout=5s"})
	want := []string{"rollout", "status", "deployment/x"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("commandWords mismatch: got %v want %v", got, want)
	}
}

// ---------------------------------------------------------------------------
// P2-5: isMutatingVerb and AuditFn wiring
// ---------------------------------------------------------------------------

func TestIsMutatingVerb_Mutating(t *testing.T) {
	cases := [][]string{
		{"delete", "pod", "api-0"},
		{"apply", "-f", "deploy.yaml"},
		{"--context", "prod", "-n", "default", "create", "ns", "test"},
		{"scale", "deployment/api", "--replicas=3"},
		{"patch", "pod", "api-0", "-p", `{"spec":{}}`},
	}
	for _, args := range cases {
		if !isMutatingVerb(args) {
			t.Errorf("expected isMutatingVerb(%v)=true", args)
		}
	}
}

func TestIsMutatingVerb_ReadOnly(t *testing.T) {
	cases := [][]string{
		{"get", "pods"},
		{"describe", "pod", "api-0"},
		{"logs", "api-0"},
		{"version"},
		{"config", "view"},
	}
	for _, args := range cases {
		if isMutatingVerb(args) {
			t.Errorf("expected isMutatingVerb(%v)=false", args)
		}
	}
}

func TestIsMutatingVerb_CpIsMutating(t *testing.T) {
	cases := [][]string{
		{"cp", "my-pod:/tmp/data", "/local/data"},
		{"cp", "/local/data", "my-pod:/tmp/data"},
		{"--context", "prod", "cp", "my-pod:/etc/config", "/tmp/config"},
	}
	for _, args := range cases {
		if !isMutatingVerb(args) {
			t.Errorf("expected isMutatingVerb(%v)=true (cp should be mutating)", args)
		}
	}
}

// ---------------------------------------------------------------------------
// P1-ERR: KubectlError structured error
// ---------------------------------------------------------------------------

func TestKubectlError_WithStderr(t *testing.T) {
	err := &KubectlError{
		Args:     []string{"get", "pods"},
		ExitCode: 1,
		Stderr:   "error: the server doesn't have a resource type \"pods\"",
	}
	msg := err.Error()
	if msg == "" {
		t.Fatal("expected non-empty error message")
	}
	// Must contain the command, exit code, and stderr
	if !containsStr(msg, "get pods") {
		t.Errorf("expected error to contain 'get pods', got: %s", msg)
	}
	if !containsStr(msg, "exit 1") {
		t.Errorf("expected error to contain 'exit 1', got: %s", msg)
	}
	if !containsStr(msg, "server doesn't have") {
		t.Errorf("expected error to contain stderr content, got: %s", msg)
	}
}

func TestKubectlError_WithoutStderr(t *testing.T) {
	err := &KubectlError{
		Args:     []string{"get", "nodes"},
		ExitCode: 2,
		Stderr:   "",
	}
	msg := err.Error()
	if !containsStr(msg, "get nodes") {
		t.Errorf("expected error to contain 'get nodes', got: %s", msg)
	}
	if !containsStr(msg, "exit 2") {
		t.Errorf("expected error to contain 'exit 2', got: %s", msg)
	}
}

func TestKubectlError_Unwrap(t *testing.T) {
	err := &KubectlError{Args: []string{"get"}, ExitCode: 1, Stderr: "err"}
	unwrapped := err.Unwrap()
	if unwrapped == nil {
		t.Fatal("Unwrap should return non-nil error")
	}
	if !containsStr(unwrapped.Error(), "exit status 1") {
		t.Errorf("expected unwrapped error to mention exit status, got: %s", unwrapped.Error())
	}
}

func containsStr(s, sub string) bool {
	return len(s) >= len(sub) && strings.Contains(s, sub)
}

// ---------------------------------------------------------------------------
// P1-1: Retry/backoff classification logic
// ---------------------------------------------------------------------------

func TestIsRetryableError_TransientErrors(t *testing.T) {
	cases := []struct {
		name   string
		output string
		err    error
	}{
		{"connection refused", "dial tcp 10.0.0.1:6443: connect: connection refused", fmt.Errorf("exit status 1")},
		{"connection reset", "read tcp: connection reset by peer", fmt.Errorf("exit status 1")},
		{"tls timeout", "net/http: TLS handshake timeout", fmt.Errorf("exit status 1")},
		{"io timeout", "dial tcp 10.0.0.1:6443: i/o timeout", fmt.Errorf("exit status 1")},
		{"429 rate limit", "Error from server (429 Too Many Requests): ...", fmt.Errorf("exit status 1")},
		{"503 unavailable", "Error from server (503 Service Unavailable): ...", fmt.Errorf("exit status 1")},
		{"504 gateway timeout", "Error from server (504 Gateway Timeout): ...", fmt.Errorf("exit status 1")},
		{"deadline in output", "context deadline exceeded", fmt.Errorf("exit status 1")},
		{"dial tcp in error", "", fmt.Errorf("dial tcp 10.0.0.1:6443: connect: connection refused")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if !isRetryableError(tc.output, tc.err) {
				t.Errorf("expected isRetryableError(%q, %v) = true", tc.output, tc.err)
			}
		})
	}
}

func TestIsRetryableError_NonRetryableErrors(t *testing.T) {
	cases := []struct {
		name   string
		output string
		err    error
	}{
		{"nil error", "some output", nil},
		{"auth 401", "error: You must be logged in to the server (401 Unauthorized)", fmt.Errorf("exit status 1")},
		{"forbidden 403", "Error from server (403 Forbidden): ...", fmt.Errorf("exit status 1")},
		{"not found 404", "Error from server (404 Not Found): ...", fmt.Errorf("exit status 1")},
		{"no resource type", "error: the server doesn't have a resource type \"foobar\"", fmt.Errorf("exit status 1")},
		{"validation error", "error: validation error: ...", fmt.Errorf("exit status 1")},
		{"unknown flag", "Error: unknown flag: --bogus", fmt.Errorf("exit status 1")},
		{"generic exit", "some random error", fmt.Errorf("exit status 1")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if isRetryableError(tc.output, tc.err) {
				t.Errorf("expected isRetryableError(%q, %v) = false", tc.output, tc.err)
			}
		})
	}
}

func TestIsRetryableError_NonRetryableTakesPrecedence(t *testing.T) {
	// If output contains both a transient AND a non-retryable pattern,
	// the non-retryable pattern should win (no retry).
	output := "connection refused\n401 Unauthorized"
	err := fmt.Errorf("exit status 1")
	if isRetryableError(output, err) {
		t.Error("non-retryable pattern (401) should take precedence over transient (connection refused)")
	}
}

func TestIsSensitiveEnv(t *testing.T) {
	sensitive := []string{
		"AWS_SECRET_ACCESS_KEY=AKIA123456",
		"AWS_SESSION_TOKEN=FwoG123",
		"GOOGLE_APPLICATION_CREDENTIALS=/home/.gcp/creds.json",
		"AZURE_CLIENT_SECRET=secret123",
		"GITHUB_TOKEN=ghp_abc123",
		"GH_TOKEN=ghp_abc123",
		"DOCKER_PASSWORD=dckr_pat_123",
	}
	for _, e := range sensitive {
		if !isSensitiveEnv(e) {
			t.Errorf("expected isSensitiveEnv(%q)=true", e)
		}
	}

	safe := []string{
		"KUBECONFIG=/home/.kube/config",
		"HOME=/home/user",
		"PATH=/usr/bin",
		"TERM=xterm-256color",
		"AWS_REGION=us-east-1",
		"AWS_PROFILE=staging",
	}
	for _, e := range safe {
		if isSensitiveEnv(e) {
			t.Errorf("expected isSensitiveEnv(%q)=false", e)
		}
	}
}
