// Package summary — LLM-backed completer (Phase 2 #5).
//
// Architectural rules preserved from Phase 1:
//
//   1. The completer's input is the strict DerivedSummary type
//      (counts/namespace/status breakdown). It NEVER receives raw rows,
//      entity names, YAML, or log content. The hallucination invariant
//      holds because the model physically cannot leak data it never saw.
//
//   2. internal/llm/summary does NOT import internal/llm. The
//      `SummaryLLM` interface defined here is a narrow surface anything
//      can satisfy — the wiring in cmd/server/main.go bridges the real
//      LLM adapter into this interface.
//
//   3. Every failure mode (transport error, timeout, empty output)
//      falls back to the deterministic formatter so the render path is
//      never broken by a flaky LLM. The user always sees SOMETHING; the
//      LLM is a quality enhancement, not a load-bearing dependency.

package summary

import (
	"context"
	"fmt"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/derived"
)

// SummaryLLM is the minimal LLM surface this package needs. Any client
// implementing Complete(ctx, prompt) can power the LLM completer.
//
// The signature is intentionally trivial — no streaming, no tools, no
// system prompts — to keep the contract testable and the import surface
// of this package tiny (no leak of provider-specific types).
type SummaryLLM interface {
	Complete(ctx context.Context, prompt string) (string, error)
}

// LLMCompleterTimeout caps how long the wrapper waits for the LLM
// before falling back to the deterministic formatter. The render path
// blocks on Generate, so this cap directly bounds perceived render
// latency. 1.5s leaves room for normal API latency without being
// noticeably slow on a healthy provider.
const LLMCompleterTimeout = 1500 * time.Millisecond

// NewLLMCompleter returns a completer function that asks the supplied
// SummaryLLM for a one-line summary. Failures, timeouts, and empty
// outputs all fall back to defaultDeterministicFormatter so the
// render path stays robust.
//
// Pass the result to summary.SetCompleter() during cmd/server startup.
func NewLLMCompleter(llm SummaryLLM) func(context.Context, derived.DerivedSummary) (string, error) {
	if llm == nil {
		// Defensive: nil llm → keep the deterministic formatter.
		// Production wiring should never hit this; tests + dev paths
		// might. Returning the formatter directly avoids a runtime nil
		// panic on every call.
		return defaultDeterministicFormatter
	}
	return func(ctx context.Context, d derived.DerivedSummary) (string, error) {
		// Strict per-call timeout — the LLM is best-effort, not a
		// dependency. If it's slow or sick, the user gets a working
		// (if mechanical) summary instead of a stalled render.
		llmCtx, cancel := context.WithTimeout(ctx, LLMCompleterTimeout)
		defer cancel()

		prompt := buildSummaryPrompt(d)
		out, err := llm.Complete(llmCtx, prompt)
		if err != nil || out == "" {
			// Fallback path. We do NOT surface the error: the contract
			// of Generate is "return a one-line string"; surfacing an
			// error would propagate up to BuildDeterministicResponse
			// and could break the render. Best-effort behaviour.
			return defaultDeterministicFormatter(ctx, d)
		}
		return out, nil
	}
}

// buildSummaryPrompt is the single source of truth for what the
// summary LLM sees. It is built ENTIRELY from DerivedSummary fields —
// no raw tool data crosses this boundary. Test
// TestBuildSummaryPrompt_OnlyDerivedFields pins the format so future
// edits cannot silently widen the input surface.
//
// Style rationale:
//   - Constraints listed FIRST so the model commits to brevity before
//     producing tokens (better adherence than trailing constraints).
//   - Explicit "do NOT invent" + "do NOT include the tool name" — the
//     two failure modes worth pre-empting at the prompt layer.
//   - Examples grounded in the actual DerivedSummary fields so the
//     model learns the wanted format from one shot, not from intuition.
func buildSummaryPrompt(d derived.DerivedSummary) string {
	breakdown := ""
	if len(d.StatusBreakdown) > 0 {
		breakdown = fmt.Sprintf(" Status breakdown: %v.", d.StatusBreakdown)
	}
	ns := ""
	if d.Namespace != "" {
		ns = fmt.Sprintf(" Namespace: %s.", d.Namespace)
	}
	return fmt.Sprintf(
		"Write ONE short sentence (max 80 characters) summarizing this Kubernetes "+
			"resource result for an SRE. Do not exceed 80 characters. Do not invent "+
			"details. Do not include the tool name. Just the human-readable summary.\n"+
			"\n"+
			"Resource counts: %d total.%s%s\n"+
			"\n"+
			"Examples of good summaries:\n"+
			"  - 13 pods running in kube-system\n"+
			"  - No resources found in namespace empty-ns\n"+
			"  - 1 service in default, healthy\n"+
			"\n"+
			"Your one-line summary:",
		d.RowCount, ns, breakdown,
	)
}

// SetCompleter swaps the package-level completer for production wiring.
// Distinct from SwapLLMCompleterForTest in name + intent: this is the
// ONE call cmd/server/main.go makes to install the LLM-backed summary;
// tests should keep using SwapLLMCompleterForTest (which returns a
// restore func).
//
// Calling this with nil is a no-op (keeps the current completer).
func SetCompleter(c func(context.Context, derived.DerivedSummary) (string, error)) {
	if c == nil {
		return
	}
	llmCompleter = c
}
