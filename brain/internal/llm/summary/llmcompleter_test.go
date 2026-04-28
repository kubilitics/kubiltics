package summary

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/derived"
)

// fakeSummaryLLM is a controllable stand-in for production LLM clients.
// Tests assemble one with the behaviour they want to provoke.
type fakeSummaryLLM struct {
	output     string
	err        error
	delay      time.Duration
	calls      int32
	lastPrompt string
}

func (f *fakeSummaryLLM) Complete(ctx context.Context, prompt string) (string, error) {
	atomic.AddInt32(&f.calls, 1)
	f.lastPrompt = prompt
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	return f.output, f.err
}

// ── Happy path ──────────────────────────────────────────────────────────────

func TestNewLLMCompleter_HappyPath(t *testing.T) {
	llm := &fakeSummaryLLM{output: "13 pods running in kube-system"}
	c := NewLLMCompleter(llm)
	d := derived.DerivedSummary{ToolName: "list_resources", Namespace: "kube-system",
		RowCount: 13, StatusBreakdown: map[string]int{"Running": 13}}
	got, err := c(context.Background(), d)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got != "13 pods running in kube-system" {
		t.Errorf("got %q", got)
	}
	if atomic.LoadInt32(&llm.calls) != 1 {
		t.Errorf("expected 1 LLM call, got %d", llm.calls)
	}
}

// ── Failure modes — every failure falls back to the deterministic formatter
//    silently, never surfacing an error to the render path. ────────────────

func TestNewLLMCompleter_AdapterError_FallsBack(t *testing.T) {
	llm := &fakeSummaryLLM{err: errors.New("provider 503")}
	c := NewLLMCompleter(llm)
	d := derived.DerivedSummary{ToolName: "list_pods", Namespace: "x", RowCount: 5}
	got, err := c(context.Background(), d)
	if err != nil {
		t.Fatalf("must not surface error to caller: %v", err)
	}
	if !strings.Contains(got, "5") || !strings.Contains(got, "x") {
		t.Errorf("fallback should produce deterministic output, got %q", got)
	}
}

func TestNewLLMCompleter_EmptyOutput_FallsBack(t *testing.T) {
	llm := &fakeSummaryLLM{output: ""}
	c := NewLLMCompleter(llm)
	d := derived.DerivedSummary{ToolName: "list_pods", RowCount: 1}
	got, _ := c(context.Background(), d)
	if got == "" {
		t.Errorf("empty LLM output must fall back to non-empty deterministic summary")
	}
}

func TestNewLLMCompleter_Timeout_FallsBack(t *testing.T) {
	// Force a delay longer than LLMCompleterTimeout. The completer must
	// bail and fall back rather than block the render path.
	llm := &fakeSummaryLLM{output: "too late", delay: LLMCompleterTimeout + 500*time.Millisecond}
	c := NewLLMCompleter(llm)
	d := derived.DerivedSummary{ToolName: "list_pods", RowCount: 7}

	start := time.Now()
	got, _ := c(context.Background(), d)
	elapsed := time.Since(start)

	// Allow some scheduling slack but assert we did NOT wait the full
	// fake delay (which would mean the timeout didn't fire).
	if elapsed > LLMCompleterTimeout+200*time.Millisecond {
		t.Errorf("blocked too long (%v) — timeout not honoured", elapsed)
	}
	if got == "too late" {
		t.Errorf("must NOT return delayed LLM output past timeout")
	}
	if !strings.Contains(got, "7") {
		t.Errorf("fallback summary should include count, got %q", got)
	}
}

func TestNewLLMCompleter_NilLLM_UsesDeterministicFormatter(t *testing.T) {
	c := NewLLMCompleter(nil)
	d := derived.DerivedSummary{ToolName: "list_pods", RowCount: 3}
	got, err := c(context.Background(), d)
	if err != nil {
		t.Fatalf("nil llm must not error: %v", err)
	}
	if !strings.Contains(got, "3") {
		t.Errorf("nil-llm path should produce deterministic summary, got %q", got)
	}
}

// ── Type-fence guarantees ───────────────────────────────────────────────────

func TestBuildSummaryPrompt_OnlyDerivedFields(t *testing.T) {
	// Adversarial DerivedSummary: confirm the prompt contains only the
	// values from those four fields. If a future edit smuggles new
	// data into the prompt, this test catches it.
	d := derived.DerivedSummary{
		ToolName:        "list_resources",
		Namespace:       "MAGIC_NS",
		RowCount:        42,
		StatusBreakdown: map[string]int{"MAGIC_STATUS": 3},
	}
	prompt := buildSummaryPrompt(d)

	mustContain(t, prompt, "MAGIC_NS")
	mustContain(t, prompt, "42")
	mustContain(t, prompt, "MAGIC_STATUS")

	// Tool name must NOT leak into the prompt — the contract is
	// "human-readable summary, not tool-name dependent".
	if strings.Contains(prompt, "list_resources") {
		t.Errorf("prompt leaks tool name: %q", prompt)
	}
}

// ── End-to-end Generate() sees the new completer when wired ─────────────────

func TestSetCompleter_WiresLLMCompleter(t *testing.T) {
	llm := &fakeSummaryLLM{output: "wired output"}
	restore := SwapLLMCompleterForTest(NewLLMCompleter(llm))
	defer restore()

	got, err := Generate(context.Background(), derived.DerivedSummary{
		ToolName: "list_pods", RowCount: 1,
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if got != "wired output" {
		t.Errorf("Generate did not pick up wired completer, got %q", got)
	}
}

func TestSetCompleter_NilNoOp(t *testing.T) {
	llm := &fakeSummaryLLM{output: "should still apply"}
	restore := SwapLLMCompleterForTest(NewLLMCompleter(llm))
	defer restore()

	SetCompleter(nil)
	got, _ := Generate(context.Background(), derived.DerivedSummary{
		ToolName: "list_pods", RowCount: 1,
	})
	if got != "should still apply" {
		t.Errorf("SetCompleter(nil) must not clobber the existing completer, got %q", got)
	}
}

// ── 80-char enforcement still applies on top of LLM output ─────────────────

func mustContain(t *testing.T, s, sub string) {
	t.Helper()
	if !strings.Contains(s, sub) {
		t.Errorf("expected %q in %q", sub, s)
	}
}

func TestNewLLMCompleter_OutputCappedAt80(t *testing.T) {
	long := strings.Repeat("A", 200)
	llm := &fakeSummaryLLM{output: long}

	// Wire through Generate so enforceOneLine runs on the result.
	restore := SwapLLMCompleterForTest(NewLLMCompleter(llm))
	defer restore()

	got, _ := Generate(context.Background(), derived.DerivedSummary{
		ToolName: "list_pods", RowCount: 1,
	})
	if len(got) > 80 {
		t.Errorf("output exceeded 80 chars: %d", len(got))
	}
}
