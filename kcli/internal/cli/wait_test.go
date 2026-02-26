package cli

import (
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// parseWaitFlags
// ---------------------------------------------------------------------------

func TestParseWaitFlags_NoFlags(t *testing.T) {
	watchEvents, rest := parseWaitFlags([]string{"deployment/api", "--for=condition=Available", "--timeout=5m"})
	if watchEvents {
		t.Fatal("expected watchEvents=false")
	}
	if len(rest) != 3 {
		t.Fatalf("expected 3 remaining args, got %v", rest)
	}
}

func TestParseWaitFlags_WatchEvents(t *testing.T) {
	watchEvents, rest := parseWaitFlags([]string{"--watch-events", "pod/mypod", "--for=condition=Ready"})
	if !watchEvents {
		t.Fatal("expected watchEvents=true")
	}
	// --watch-events must be stripped from rest
	for _, a := range rest {
		if a == "--watch-events" {
			t.Fatal("--watch-events should have been stripped from rest args")
		}
	}
	if len(rest) != 2 {
		t.Fatalf("expected 2 remaining args, got %v", rest)
	}
}

func TestParseWaitFlags_Empty(t *testing.T) {
	watchEvents, rest := parseWaitFlags(nil)
	if watchEvents {
		t.Fatal("expected false for nil")
	}
	if len(rest) != 0 {
		t.Fatalf("expected empty rest, got %v", rest)
	}
}

// ---------------------------------------------------------------------------
// extractWaitDisplay
// ---------------------------------------------------------------------------

func TestExtractWaitDisplay_FullArgs(t *testing.T) {
	resource, condition, timeout := extractWaitDisplay([]string{
		"deployment/myapp", "--for=condition=Available", "--timeout=5m",
	})
	if resource != "deployment/myapp" {
		t.Errorf("resource: want %q, got %q", "deployment/myapp", resource)
	}
	if condition != "condition=Available" {
		t.Errorf("condition: want %q, got %q", "condition=Available", condition)
	}
	if timeout != "5m" {
		t.Errorf("timeout: want %q, got %q", "5m", timeout)
	}
}

func TestExtractWaitDisplay_SpaceDelimitedFor(t *testing.T) {
	resource, condition, timeout := extractWaitDisplay([]string{
		"pod/nginx", "--for", "condition=Ready", "--timeout", "2m30s",
	})
	if resource != "pod/nginx" {
		t.Errorf("resource: want %q, got %q", "pod/nginx", resource)
	}
	if condition != "condition=Ready" {
		t.Errorf("condition: want %q, got %q", "condition=Ready", condition)
	}
	if timeout != "2m30s" {
		t.Errorf("timeout: want %q, got %q", "2m30s", timeout)
	}
}

func TestExtractWaitDisplay_NoResourceOrCondition(t *testing.T) {
	resource, condition, timeout := extractWaitDisplay([]string{})
	if resource != "resource" {
		t.Errorf("expected default resource placeholder, got %q", resource)
	}
	if condition != "unknown" {
		t.Errorf("expected default condition placeholder, got %q", condition)
	}
	if timeout != "" {
		t.Errorf("expected empty timeout, got %q", timeout)
	}
}

func TestExtractWaitDisplay_ForDelete(t *testing.T) {
	_, condition, _ := extractWaitDisplay([]string{"pod/old", "--for=delete"})
	if condition != "delete" {
		t.Errorf("expected condition=delete, got %q", condition)
	}
}

func TestExtractWaitDisplay_LabelSelector(t *testing.T) {
	// -l skips its value; the next positional arg is not mistaken for a resource
	resource, condition, _ := extractWaitDisplay([]string{
		"pod", "-l", "app=nginx", "--for=condition=Ready",
	})
	if resource != "pod" {
		t.Errorf("expected resource=pod, got %q", resource)
	}
	if condition != "condition=Ready" {
		t.Errorf("expected condition=condition=Ready, got %q", condition)
	}
}

// ---------------------------------------------------------------------------
// buildWaitDisplay
// ---------------------------------------------------------------------------

func TestBuildWaitDisplay_WithTimeout(t *testing.T) {
	msg := buildWaitDisplay("deployment/myapp", "condition=Available", "5m")
	if msg == "" {
		t.Fatal("expected non-empty display string")
	}
	expected := "Waiting for deployment/myapp: condition=Available... (timeout: 5m)"
	if msg != expected {
		t.Errorf("want %q, got %q", expected, msg)
	}
}

func TestBuildWaitDisplay_WithoutTimeout(t *testing.T) {
	msg := buildWaitDisplay("pod/nginx", "condition=Ready", "")
	expected := "Waiting for pod/nginx: condition=Ready..."
	if msg != expected {
		t.Errorf("want %q, got %q", expected, msg)
	}
}

// ---------------------------------------------------------------------------
// formatElapsed
// ---------------------------------------------------------------------------

func TestFormatElapsed_Seconds(t *testing.T) {
	got := formatElapsed(37 * time.Second)
	if got != "00:37" {
		t.Errorf("want 00:37, got %q", got)
	}
}

func TestFormatElapsed_Minutes(t *testing.T) {
	got := formatElapsed(3*time.Minute + 5*time.Second)
	if got != "03:05" {
		t.Errorf("want 03:05, got %q", got)
	}
}

func TestFormatElapsed_Hours(t *testing.T) {
	got := formatElapsed(1*time.Hour + 2*time.Minute + 3*time.Second)
	if got != "01:02:03" {
		t.Errorf("want 01:02:03, got %q", got)
	}
}

func TestFormatElapsed_Zero(t *testing.T) {
	got := formatElapsed(0)
	if got != "00:00" {
		t.Errorf("want 00:00, got %q", got)
	}
}
