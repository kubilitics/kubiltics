package cli

import (
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// isCrashHintEligible
// ---------------------------------------------------------------------------

func TestIsCrashHintEligible_Pods(t *testing.T) {
	for _, target := range []string{"pods", "pod", "po"} {
		if !isCrashHintEligible([]string{target}) {
			t.Errorf("expected eligible for target %q", target)
		}
	}
}

func TestIsCrashHintEligible_PodSlash(t *testing.T) {
	if !isCrashHintEligible([]string{"pods/my-pod"}) {
		t.Error("expected eligible for pods/my-pod")
	}
}

func TestIsCrashHintEligible_NotPods(t *testing.T) {
	for _, target := range []string{"deployments", "services", "nodes", "configmaps"} {
		if isCrashHintEligible([]string{target}) {
			t.Errorf("should NOT be eligible for target %q", target)
		}
	}
}

func TestIsCrashHintEligible_WideOutputIsOK(t *testing.T) {
	// -o wide is still a table, so hints should still show.
	if !isCrashHintEligible([]string{"pods", "-o", "wide"}) {
		t.Error("expected eligible for pods -o wide")
	}
}

func TestIsCrashHintEligible_JSONOutput(t *testing.T) {
	if isCrashHintEligible([]string{"pods", "-o", "json"}) {
		t.Error("should NOT be eligible for -o json")
	}
}

func TestIsCrashHintEligible_YAMLOutput(t *testing.T) {
	if isCrashHintEligible([]string{"pods", "-o", "yaml"}) {
		t.Error("should NOT be eligible for -o yaml")
	}
}

func TestIsCrashHintEligible_JSONPathOutput(t *testing.T) {
	if isCrashHintEligible([]string{"pods", "-o", "jsonpath={.items}"}) {
		t.Error("should NOT be eligible for -o jsonpath")
	}
}

func TestIsCrashHintEligible_OutputEqualForm(t *testing.T) {
	if isCrashHintEligible([]string{"pods", "--output=json"}) {
		t.Error("should NOT be eligible for --output=json")
	}
}

func TestIsCrashHintEligible_OutputEqualFormJSON_MinusoShort(t *testing.T) {
	if isCrashHintEligible([]string{"pods", "-o=json"}) {
		t.Error("should NOT be eligible for -o=json")
	}
}

func TestIsCrashHintEligible_Watch(t *testing.T) {
	if isCrashHintEligible([]string{"pods", "--watch"}) {
		t.Error("should NOT be eligible for --watch")
	}
	if isCrashHintEligible([]string{"pods", "-w"}) {
		t.Error("should NOT be eligible for -w")
	}
}

func TestIsCrashHintEligible_EmptyArgs(t *testing.T) {
	if isCrashHintEligible([]string{}) {
		t.Error("empty args should not be eligible")
	}
}

func TestIsCrashHintEligible_WithNamespace(t *testing.T) {
	// -n flag should not affect eligibility.
	if !isCrashHintEligible([]string{"pods", "-n", "production"}) {
		t.Error("expected eligible for pods -n production")
	}
}

func TestIsCrashHintEligible_AllNamespaces(t *testing.T) {
	// -A flag should not affect eligibility (still table output).
	if !isCrashHintEligible([]string{"pods", "-A"}) {
		t.Error("expected eligible for pods -A")
	}
}

// ---------------------------------------------------------------------------
// parsePodCrashHints
// ---------------------------------------------------------------------------

const sampleKubectlPodsOutput = `NAME                          READY   STATUS             RESTARTS   AGE
api-7f9d-abc123               1/1     Running            0          2d
worker-crash-5f8b7           0/1     CrashLoopBackOff   12         5m
db-pod-xyz                   1/1     Running            0          1h
oom-pod-aaa                  0/1     OOMKilled           3          10m
error-pod-bbb                0/1     Error               1          2m
pending-pod-ccc              0/1     Pending             0          30s`

func TestParsePodCrashHints_Basic(t *testing.T) {
	hints := parsePodCrashHints(sampleKubectlPodsOutput)
	if len(hints) != 4 {
		t.Fatalf("expected 4 hints (CrashLoopBackOff, OOMKilled, Error, Pending), got %d: %+v", len(hints), hints)
	}
	// Check that Running pods are not included.
	for _, h := range hints {
		if h.PodName == "api-7f9d-abc123" || h.PodName == "db-pod-xyz" {
			t.Errorf("Running pod %q should not appear in hints", h.PodName)
		}
	}
}

func TestParsePodCrashHints_CrashLoop(t *testing.T) {
	hints := parsePodCrashHints(sampleKubectlPodsOutput)
	found := false
	for _, h := range hints {
		if h.PodName == "worker-crash-5f8b7" && strings.EqualFold(h.Status, "CrashLoopBackOff") {
			found = true
		}
	}
	if !found {
		t.Error("expected CrashLoopBackOff pod in hints")
	}
}

func TestParsePodCrashHints_OOMKilled(t *testing.T) {
	output := `NAME          READY   STATUS     RESTARTS   AGE
nginx-abc     1/1     OOMKilled  3          10m`
	hints := parsePodCrashHints(output)
	if len(hints) != 1 || !strings.EqualFold(hints[0].Status, "OOMKilled") {
		t.Fatalf("expected 1 OOMKilled hint, got %+v", hints)
	}
}

func TestParsePodCrashHints_ImagePullBackOff(t *testing.T) {
	output := `NAME          READY   STATUS             RESTARTS   AGE
pull-fail     0/1     ImagePullBackOff   0          2m`
	hints := parsePodCrashHints(output)
	if len(hints) != 1 || !strings.EqualFold(hints[0].Status, "ImagePullBackOff") {
		t.Fatalf("expected 1 ImagePullBackOff hint, got %+v", hints)
	}
}

func TestParsePodCrashHints_AllRunning(t *testing.T) {
	output := `NAME          READY   STATUS    RESTARTS   AGE
nginx-abc     1/1     Running   0          2d
redis-xyz     1/1     Running   0          1h`
	hints := parsePodCrashHints(output)
	if len(hints) != 0 {
		t.Errorf("expected no hints for all-running pods, got %+v", hints)
	}
}

func TestParsePodCrashHints_EmptyOutput(t *testing.T) {
	hints := parsePodCrashHints("")
	if len(hints) != 0 {
		t.Errorf("expected no hints for empty output, got %+v", hints)
	}
}

func TestParsePodCrashHints_OnlyHeader(t *testing.T) {
	output := "NAME          READY   STATUS    RESTARTS   AGE"
	hints := parsePodCrashHints(output)
	if len(hints) != 0 {
		t.Errorf("expected no hints for header-only, got %+v", hints)
	}
}

func TestParsePodCrashHints_Deduplication(t *testing.T) {
	// The same pod appearing twice in output should only produce one hint.
	output := `NAME          READY   STATUS             RESTARTS   AGE
crash-pod     0/1     CrashLoopBackOff   5          5m
crash-pod     0/1     CrashLoopBackOff   5          5m`
	hints := parsePodCrashHints(output)
	if len(hints) != 1 {
		t.Errorf("expected 1 deduplicated hint, got %d: %+v", len(hints), hints)
	}
}

func TestParsePodCrashHints_Evicted(t *testing.T) {
	output := `NAME          READY   STATUS    RESTARTS   AGE
evicted-pod   0/1     Evicted   0          1h`
	hints := parsePodCrashHints(output)
	if len(hints) != 1 || !strings.EqualFold(hints[0].Status, "Evicted") {
		t.Fatalf("expected 1 Evicted hint, got %+v", hints)
	}
}

func TestParsePodCrashHints_WideOutputFormat(t *testing.T) {
	// -o wide adds extra columns but STATUS is still in the same position.
	output := `NAME          READY   STATUS    RESTARTS   AGE   IP           NODE
crash-pod     0/1     CrashLoopBackOff   3   5m    10.0.0.1   node-1`
	hints := parsePodCrashHints(output)
	if len(hints) != 1 {
		t.Fatalf("expected 1 hint for wide output, got %d: %+v", len(hints), hints)
	}
}

func TestParsePodCrashHints_NoHeader(t *testing.T) {
	// If there's no NAME header, we should return no hints (not panic).
	output := "some random text without a header"
	hints := parsePodCrashHints(output)
	if len(hints) != 0 {
		t.Errorf("expected no hints without header, got %+v", hints)
	}
}

// ---------------------------------------------------------------------------
// newGetCmd — structural tests
// ---------------------------------------------------------------------------

func TestNewGetCmd_Exists(t *testing.T) {
	cmd := newGetCmd(&app{})
	if cmd.Use == "" {
		t.Fatal("get command has empty Use string")
	}
	if cmd.Short == "" {
		t.Fatal("get command has empty Short string")
	}
}

func TestNewGetCmd_HasGAlias(t *testing.T) {
	cmd := newGetCmd(&app{})
	for _, alias := range cmd.Aliases {
		if alias == "g" {
			return
		}
	}
	t.Fatal("get command missing 'g' alias")
}
