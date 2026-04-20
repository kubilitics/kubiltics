package runtime

import (
	"strings"
	"testing"
)

func TestBuildSystemPrompt_EmptyClusterID(t *testing.T) {
	if got := BuildSystemPrompt(""); got != "" {
		t.Fatalf("empty cluster id → empty prompt, got %q", got)
	}
}

func TestBuildSystemPrompt_PinsClusterID(t *testing.T) {
	p := BuildSystemPrompt("cluster-abc")
	if !strings.Contains(p, "cluster-abc") {
		t.Fatalf("prompt must reference the focus cluster id, got: %s", p)
	}
}

func TestBuildSystemPrompt_ForbidsKubectlHedge(t *testing.T) {
	p := BuildSystemPrompt("c")
	lower := strings.ToLower(p)
	if !strings.Contains(lower, "do not tell the user to run kubectl") &&
		!strings.Contains(lower, "never tell the user to run kubectl") {
		t.Fatalf("prompt must forbid the kubectl hedge, got: %s", p)
	}
}

func TestBuildSystemPrompt_MandatesSummarization(t *testing.T) {
	p := BuildSystemPrompt("c")
	lower := strings.ToLower(p)
	if !strings.Contains(lower, "summarize") && !strings.Contains(lower, "summarise") {
		t.Fatalf("prompt must mandate natural-language summarization, got: %s", p)
	}
}

func TestBuildSystemPrompt_ListsCommonResourceKinds(t *testing.T) {
	p := BuildSystemPrompt("c")
	for _, kind := range []string{"Namespace", "Pod", "Deployment", "Service", "Node"} {
		if !strings.Contains(p, kind) {
			t.Fatalf("prompt must mention %s as a common resource kind, got: %s", kind, p)
		}
	}
}

func TestBuildSystemPrompt_MandatesClusterIDArg(t *testing.T) {
	p := BuildSystemPrompt("cluster-xyz")
	if !strings.Contains(strings.ToLower(p), "cluster_id") {
		t.Fatalf("prompt must instruct the LLM to pass cluster_id in tool args, got: %s", p)
	}
}
