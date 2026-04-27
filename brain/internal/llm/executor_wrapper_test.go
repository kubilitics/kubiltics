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

	if !strings.Contains(out, "rendered to user") {
		t.Errorf("stub string not returned to LLM, got %q", out)
	}
	if strings.Contains(out, "Running") || strings.Contains(out, "p1") {
		t.Errorf("data leaked into LLM-bound stub: %q", out)
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
