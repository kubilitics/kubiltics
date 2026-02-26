package runner

import (
	"reflect"
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
