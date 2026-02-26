package cli

import (
	"testing"
)

// ---------------------------------------------------------------------------
// parseExplainFlags
// ---------------------------------------------------------------------------

func TestParseExplainFlags_NoFlags(t *testing.T) {
	ai, rest := parseExplainFlags([]string{"pod.spec.containers"})
	if ai {
		t.Fatal("expected ai=false when --ai is absent")
	}
	if len(rest) != 1 || rest[0] != "pod.spec.containers" {
		t.Fatalf("expected rest=[pod.spec.containers], got %v", rest)
	}
}

func TestParseExplainFlags_AIOnly(t *testing.T) {
	ai, rest := parseExplainFlags([]string{"--ai"})
	if !ai {
		t.Fatal("expected ai=true when --ai is present")
	}
	if len(rest) != 0 {
		t.Fatalf("expected empty rest after stripping --ai, got %v", rest)
	}
}

func TestParseExplainFlags_AIWithResource(t *testing.T) {
	ai, rest := parseExplainFlags([]string{"--ai", "deployment.spec.replicas"})
	if !ai {
		t.Fatal("expected ai=true")
	}
	if len(rest) != 1 || rest[0] != "deployment.spec.replicas" {
		t.Fatalf("expected rest=[deployment.spec.replicas], got %v", rest)
	}
}

func TestParseExplainFlags_AIAmongOtherFlags(t *testing.T) {
	ai, rest := parseExplainFlags([]string{"pod.spec", "--recursive", "--ai", "--api-version=v1"})
	if !ai {
		t.Fatal("expected ai=true")
	}
	// All non-ai flags must be preserved in original order.
	if len(rest) != 3 {
		t.Fatalf("expected 3 remaining args, got %v", rest)
	}
	if rest[0] != "pod.spec" || rest[1] != "--recursive" || rest[2] != "--api-version=v1" {
		t.Fatalf("unexpected rest order: %v", rest)
	}
}

func TestParseExplainFlags_NilInput(t *testing.T) {
	ai, rest := parseExplainFlags(nil)
	if ai {
		t.Fatal("expected ai=false for nil input")
	}
	if len(rest) != 0 {
		t.Fatalf("expected empty rest for nil input, got %v", rest)
	}
}

func TestParseExplainFlags_EmptyInput(t *testing.T) {
	ai, rest := parseExplainFlags([]string{})
	if ai {
		t.Fatal("expected ai=false for empty input")
	}
	if len(rest) != 0 {
		t.Fatalf("expected empty rest for empty input, got %v", rest)
	}
}

func TestParseExplainFlags_NoAIFlagPreservesAll(t *testing.T) {
	args := []string{"deployment.spec", "--recursive", "--output=plaintext-openapiv2"}
	ai, rest := parseExplainFlags(args)
	if ai {
		t.Fatal("expected ai=false")
	}
	if len(rest) != len(args) {
		t.Fatalf("expected all args preserved, got %v", rest)
	}
}

// ---------------------------------------------------------------------------
// explainTarget
// ---------------------------------------------------------------------------

func TestExplainTarget_FirstPositional(t *testing.T) {
	got := explainTarget([]string{"pod.spec.containers", "--recursive"})
	if got != "pod.spec.containers" {
		t.Errorf("expected 'pod.spec.containers', got %q", got)
	}
}

func TestExplainTarget_SkipsFlags(t *testing.T) {
	got := explainTarget([]string{"--recursive", "--api-version=v1", "deployment.spec"})
	if got != "deployment.spec" {
		t.Errorf("expected 'deployment.spec', got %q", got)
	}
}

func TestExplainTarget_OnlyFlags(t *testing.T) {
	got := explainTarget([]string{"--recursive"})
	if got != "resource" {
		t.Errorf("expected fallback 'resource', got %q", got)
	}
}

func TestExplainTarget_Empty(t *testing.T) {
	got := explainTarget([]string{})
	if got != "resource" {
		t.Errorf("expected fallback 'resource' for empty args, got %q", got)
	}
}

func TestExplainTarget_Nil(t *testing.T) {
	got := explainTarget(nil)
	if got != "resource" {
		t.Errorf("expected fallback 'resource' for nil args, got %q", got)
	}
}
