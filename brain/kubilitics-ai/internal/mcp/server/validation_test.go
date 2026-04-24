package server

import (
	"strings"
	"testing"
)

func TestValidateToolArgs_NilAndEmpty(t *testing.T) {
	if got := validateToolArgs("anything", nil); got != nil {
		t.Fatalf("nil args must pass, got %#v", got)
	}
	if got := validateToolArgs("anything", map[string]interface{}{}); got != nil {
		t.Fatalf("empty args must pass, got %#v", got)
	}
}

func TestValidateToolArgs_HappyPath(t *testing.T) {
	args := map[string]interface{}{
		"namespace": "demo",
		"name":      "web",
		"kind":      "Deployment",
	}
	if got := validateToolArgs("inspect_deployment", args); got != nil {
		t.Fatalf("expected pass, got rejection %#v", got)
	}
}

func TestValidateToolArgs_EmptyNamespaceAllowed(t *testing.T) {
	// Empty string = cluster-wide. MUST NOT be rejected.
	args := map[string]interface{}{"namespace": ""}
	if got := validateToolArgs("observe_events", args); got != nil {
		t.Fatalf("empty namespace must pass, got %#v", got)
	}
}

func TestValidateToolArgs_RejectsWildcardName(t *testing.T) {
	for _, bad := range []string{"all", "*", "All", " * "} {
		args := map[string]interface{}{"namespace": "demo", "name": bad}
		got := validateToolArgs("inspect_deployment", args)
		if got == nil {
			t.Fatalf("expected rejection for name=%q", bad)
		}
		if got.Field != "name" {
			t.Errorf("expected field=name, got %q", got.Field)
		}
		if got.BadValue != bad {
			t.Errorf("expected bad_value=%q, got %q", bad, got.BadValue)
		}
		if !strings.Contains(got.RedirectHint, "scope") {
			t.Errorf("redirect hint should mention scope, got %q", got.RedirectHint)
		}
	}
}

func TestValidateToolArgs_RejectsWildcardNamespace(t *testing.T) {
	for _, bad := range []string{"all", "*"} {
		got := validateToolArgs("observe_events", map[string]interface{}{"namespace": bad})
		if got == nil {
			t.Fatalf("expected rejection for namespace=%q", bad)
		}
		if got.Field != "namespace" {
			t.Errorf("expected field=namespace, got %q", got.Field)
		}
		if !strings.Contains(got.RedirectHint, "empty string") {
			t.Errorf("redirect hint should mention empty string, got %q", got.RedirectHint)
		}
	}
}

func TestValidateToolArgs_RejectsWildcardKind(t *testing.T) {
	got := validateToolArgs("analyze_blast_radius", map[string]interface{}{"kind": "all", "name": "all"})
	if got == nil {
		t.Fatal("expected rejection")
	}
	// First guarded field hit is "name" — order is name, namespace, kind, pod.
	if got.Field != "name" {
		t.Errorf("expected name to be caught first, got %q", got.Field)
	}
}

func TestValidateToolArgs_RejectsWildcardKindAlone(t *testing.T) {
	got := validateToolArgs("analyze_blast_radius", map[string]interface{}{"kind": "*"})
	if got == nil || got.Field != "kind" {
		t.Fatalf("expected kind rejection, got %#v", got)
	}
	if !strings.Contains(got.RedirectHint, "scope") {
		t.Errorf("redirect hint should mention scope, got %q", got.RedirectHint)
	}
}

func TestValidateToolArgs_RejectsWildcardPod(t *testing.T) {
	got := validateToolArgs("observe_pod_logs", map[string]interface{}{"pod": "all"})
	if got == nil || got.Field != "pod" {
		t.Fatalf("expected pod rejection, got %#v", got)
	}
	if !strings.Contains(got.RedirectHint, "per pod") {
		t.Errorf("redirect hint should guide to per-pod listing, got %q", got.RedirectHint)
	}
}

func TestValidateToolArgs_NonStringIgnored(t *testing.T) {
	// A numeric or bool in a guarded field should not panic; the guard
	// only polices strings.
	args := map[string]interface{}{"name": 5, "namespace": true}
	if got := validateToolArgs("x", args); got != nil {
		t.Fatalf("non-string values must pass, got %#v", got)
	}
}

func TestValidationRejection_AsToolResult(t *testing.T) {
	v := &validationRejection{
		ToolArgsInvalid: true,
		Field:           "name",
		BadValue:        "all",
		RedirectHint:    "hint",
	}
	m := v.asToolResult()
	if m["tool_args_invalid"] != true {
		t.Error("tool_args_invalid flag missing")
	}
	if m["field"] != "name" || m["bad_value"] != "all" || m["redirect_hint"] != "hint" {
		t.Errorf("result fields mismatch: %#v", m)
	}
}
