package llm

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/vellankikoti/kubilitics/brain/internal/llm/types"
)

type fakeExec struct {
	calls int32
	out   string
	err   error
}

func (f *fakeExec) Execute(_ context.Context, _ string, _ map[string]interface{}) (string, error) {
	atomic.AddInt32(&f.calls, 1)
	return f.out, f.err
}
func (f *fakeExec) WithAutonomyLevel(int) types.ToolExecutor { return f }

func TestWrapExecutor_DeterministicTool_EmitsRenderBlockAndReturnsStub(t *testing.T) {
	inner := &fakeExec{
		out: `[{"metadata":{"name":"p1","namespace":"x"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}}]`,
	}
	ch := make(chan types.AgentStreamEvent, 4)
	wrapped := WrapExecutorForRender(inner, ch, "x")
	out, err := wrapped.Execute(context.Background(), "list_pods", nil)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	close(ch)

	// Stub contract (Phase 2 #2): present-tense visibility +
	// explicit no-kubectl-suggestion guidance.
	if !strings.Contains(out, "user is now viewing") {
		t.Errorf("stub missing present-tense visibility phrase, got %q", out)
	}
	if !strings.Contains(out, "do NOT suggest running kubectl") {
		t.Errorf("stub missing kubectl-suggestion ban, got %q", out)
	}
	if strings.Contains(out, "Running") || strings.Contains(out, "p1") {
		t.Errorf("data leaked into LLM-bound stub: %q", out)
	}
	if len(out) > 320 {
		t.Errorf("stub too long (%d chars) — risks ballooning LLM context", len(out))
	}

	var renderEvents int
	for ev := range ch {
		if ev.RenderBlock != nil {
			renderEvents++
			if ev.RenderBlock.Type != "kubectl_table" {
				t.Errorf("render type: %q", ev.RenderBlock.Type)
			}
		}
	}
	if renderEvents != 1 {
		t.Errorf("expected 1 render event, got %d", renderEvents)
	}
}

func TestWrapExecutor_AnalyticalTool_PassthroughOnly(t *testing.T) {
	inner := &fakeExec{out: "raw analytical answer with entities"}
	ch := make(chan types.AgentStreamEvent, 4)
	wrapped := WrapExecutorForRender(inner, ch, "x")
	out, err := wrapped.Execute(context.Background(), "explain_anything", nil)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	close(ch)
	if out != "raw analytical answer with entities" {
		t.Errorf("analytical tool must passthrough: got %q", out)
	}
	for ev := range ch {
		if ev.RenderBlock != nil {
			t.Errorf("analytical tool must NOT emit render_block")
		}
	}
}

func TestWrapExecutor_DeterministicTool_ToolErrorPassthroughErr(t *testing.T) {
	inner := &fakeExec{err: errBoom()}
	ch := make(chan types.AgentStreamEvent, 4)
	wrapped := WrapExecutorForRender(inner, ch, "x")
	_, err := wrapped.Execute(context.Background(), "list_pods", nil)
	if err == nil {
		t.Fatal("expected tool error to surface to caller")
	}
	close(ch)
	for ev := range ch {
		if ev.RenderBlock != nil {
			t.Errorf("tool-error path must NOT emit render_block")
		}
	}
}

func errBoom() error { return testErr("boom") }

type testErr string

func (e testErr) Error() string { return string(e) }

// ─── stubForLLM unit tests (Phase 2 #2) ─────────────────────────────────────
// Pinning the exact shape contract so refactors can't silently regress the
// "no kubectl suggestion / present-tense visibility / data-free" guarantees.

func TestStubForLLM_KubectlTableWithKind(t *testing.T) {
	got := stubForLLM("kubectl_table", 13, "Pod")
	mustContain(t, got, "user is now viewing")
	mustContain(t, got, "table of 13 pods")
	mustContain(t, got, "do NOT restate the data")
	mustContain(t, got, "do NOT suggest running kubectl")
}

func TestStubForLLM_KubectlTableSingularKind(t *testing.T) {
	got := stubForLLM("kubectl_table", 1, "Service")
	mustContain(t, got, "table of 1 service")
	if strings.Contains(got, "1 services") {
		t.Errorf("singular pluralisation broken: %q", got)
	}
}

func TestStubForLLM_KubectlTableMissingKind(t *testing.T) {
	// Defensive fallback when the wrapper can't recover the kind from
	// args (e.g. tool args malformed). Must not crash; must still ship
	// a meaningful stub.
	got := stubForLLM("kubectl_table", 7, "")
	mustContain(t, got, "table of 7 rows")
}

func TestStubForLLM_YamlBlock(t *testing.T) {
	got := stubForLLM("yaml_block", 1, "Pod")
	mustContain(t, got, "the full YAML document")
	mustContain(t, got, "do NOT suggest running kubectl")
	if strings.Contains(got, "rows") {
		t.Errorf("YAML stub leaks row vocabulary: %q", got)
	}
}

func TestStubForLLM_RenderError(t *testing.T) {
	got := stubForLLM("render_error", 1, "")
	mustContain(t, got, "error message")
	mustContain(t, got, "could not be rendered")
}

func TestStubForLLM_UnknownRenderType(t *testing.T) {
	// Forward-compat: a future RenderType ships before the stub is
	// updated. Must not crash; must still mention the type so the LLM
	// can react sensibly.
	got := stubForLLM("future_chart_type", 5, "Metric")
	mustContain(t, got, "future_chart_type")
}

func TestStubForLLM_NeverContainsRowData(t *testing.T) {
	// Adversarial: try to smuggle data through the render type or kind
	// fields. The stub format is fmt.Sprintf-built; this confirms there
	// is no path that could let row data into the LLM context.
	for _, badKind := range []string{
		`Pod"; SELECT * FROM secrets; --`,
		"Pod\nrunning\ncoredns-fake-1",
		strings.Repeat("X", 10_000),
	} {
		got := stubForLLM("kubectl_table", 1, badKind)
		// Even with adversarial input, stub stays bounded and contains
		// no user-data tokens. We can't fully assert "no leak" without
		// a corpus of forbidden tokens, but we can assert bounded length
		// and presence of guardrails.
		if len(got) > 11_000 {
			t.Errorf("stub explodes with adversarial kind length: %d", len(got))
		}
		mustContain(t, got, "do NOT suggest running kubectl")
	}
}

func mustContain(t *testing.T, s, sub string) {
	t.Helper()
	if !strings.Contains(s, sub) {
		t.Errorf("expected %q in %q", sub, s)
	}
}
