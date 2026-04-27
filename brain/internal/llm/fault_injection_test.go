package llm

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/vellankikoti/kubilitics/brain/internal/derived"
	"github.com/vellankikoti/kubilitics/brain/internal/llm/summary"
	"github.com/vellankikoti/kubilitics/brain/internal/llm/types"
)

func TestDeterministicFailurePath_ZeroLLMCalls(t *testing.T) {
	cases := []struct {
		name string
		out  string
	}{
		{"malformed_json", `{not json`},
		{"empty_input", ``},
		{"oversized_output", strings.Repeat("A", 2_000_000)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Swap summary.llmCompleter for a counting fake. Because
			// llmCompleter is a package-level var in package summary,
			// we do this through a package-private setter (added below).
			var llmCalls int32
			restore := summary.SwapLLMCompleterForTest(func(_ context.Context, _ derived.DerivedSummary) (string, error) {
				atomic.AddInt32(&llmCalls, 1)
				return "", nil
			})
			defer restore()

			inner := &fakeExec{out: tc.out}
			ch := make(chan types.AgentStreamEvent, 4)
			wrapped := WrapExecutorForRender(inner, ch, "x")

			_, _ = wrapped.Execute(context.Background(), "list_pods", nil)
			close(ch)

			renderErrors := 0
			for ev := range ch {
				if ev.RenderBlock != nil && ev.RenderBlock.Type == "render_error" {
					renderErrors++
				}
			}
			if renderErrors != 1 {
				t.Errorf("expected exactly 1 render_error event, got %d", renderErrors)
			}
			if got := atomic.LoadInt32(&llmCalls); got != 0 {
				t.Errorf("LLM called %d times on failure path (want 0)", got)
			}
		})
	}
}
