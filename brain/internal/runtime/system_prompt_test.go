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

func TestBuildSystemPrompt_DescribeUsesInspectTools(t *testing.T) {
	p := BuildSystemPrompt("c")
	// "describe <resource>" must route to inspect_<kind>, not list_resources.
	if !strings.Contains(p, "inspect_") {
		t.Fatalf("prompt must mention inspect_<kind> tools for describe/show specific resource, got: %s", p)
	}
	if !strings.Contains(p, "NEVER call list_resources when the user mentions a specific resource name") {
		t.Fatalf("prompt must forbid list_resources for specific-name queries, got: %s", p)
	}
}

func TestBuildSystemPrompt_NamespaceUnknownUsesResolveResource(t *testing.T) {
	p := BuildSystemPrompt("c")
	if !strings.Contains(p, "resolve_resource") {
		t.Fatalf("prompt must mention resolve_resource for namespace-unknown flows, got: %s", p)
	}
	lower := strings.ToLower(p)
	if !strings.Contains(lower, "namespace unknown") {
		t.Fatalf("prompt must have a NAMESPACE UNKNOWN section explaining resolve_resource flow, got: %s", p)
	}
}

func TestBuildSystemPrompt_ObserveToolsNotForListing(t *testing.T) {
	p := BuildSystemPrompt("c")
	if !strings.Contains(p, "observe_* tools are for analytical health questions only") {
		t.Fatalf("prompt must restrict observe_* tools from list/show queries, got: %s", p)
	}
}

func TestBuildSystemPrompt_ProblemPodsHeuristic(t *testing.T) {
	p := BuildSystemPrompt("c")
	if !strings.Contains(p, "observe_problem_pods") {
		t.Fatalf("prompt must route crashlooping/pending/oom queries to observe_problem_pods, got: %s", p)
	}
}

func TestBuildSystemPrompt_ExplainRoutesToInspect(t *testing.T) {
	p := BuildSystemPrompt("c")
	// "explain <kind> <name>" must route to inspect_<kind>, not get_resource.
	lower := strings.ToLower(p)
	if !strings.Contains(lower, "explain") {
		t.Fatalf("prompt must include 'explain' in the describe/inspect routing pattern, got: %s", p)
	}
	if !strings.Contains(p, "NEVER call get_resource for user-facing describe/explain/inspect queries") {
		t.Fatalf("prompt must forbid get_resource for user-facing queries, got: %s", p)
	}
}
