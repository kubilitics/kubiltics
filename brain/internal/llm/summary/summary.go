// Package summary is the narrow LLM-call surface available to the
// deterministic render path. By type, Generate physically cannot
// receive raw rows, YAML, or entity names — only the precomputed
// DerivedSummary.
//
// In Phase 1 the default llmCompleter is a deterministic formatter,
// so no actual LLM call happens. A later PR may swap in a real LLM
// call; the narrow signature keeps the type-fence intact.
package summary

import (
	"context"
	"fmt"
	"strings"

	"github.com/vellankikoti/kubilitics/brain/internal/derived"
)

// Generate produces a ≤80-char, single-line summary from the strict
// DerivedSummary fields.
func Generate(ctx context.Context, d derived.DerivedSummary) (string, error) {
	out, err := llmCompleter(ctx, d)
	if err != nil {
		return "", err
	}
	return enforceOneLine(out, 80), nil
}

// llmCompleter is a package-level seam. Default = deterministic
// formatter (no LLM call). Tests may swap it; production wiring may
// replace with a narrow LLM call behind the same signature.
var llmCompleter = defaultDeterministicFormatter

func defaultDeterministicFormatter(_ context.Context, d derived.DerivedSummary) (string, error) {
	parts := []string{fmt.Sprintf("%d %s", d.RowCount, pluralize(d.ToolName, d.RowCount))}
	if d.Namespace != "" {
		parts = append(parts, "in "+d.Namespace)
	}
	if len(d.StatusBreakdown) > 0 {
		breakdown := []string{}
		for k, v := range d.StatusBreakdown {
			breakdown = append(breakdown, fmt.Sprintf("%d %s", v, k))
		}
		parts = append(parts, "("+strings.Join(breakdown, ", ")+")")
	}
	return strings.Join(parts, " "), nil
}

func pluralize(toolName string, n int) string {
	switch toolName {
	case "list_pods":
		if n == 1 {
			return "pod"
		}
		return "pods"
	case "get_pod_yaml":
		return "YAML document"
	}
	return "result"
}

func enforceOneLine(s string, max int) string {
	if i := strings.Index(s, "\n"); i >= 0 {
		s = s[:i]
	}
	if len(s) > max {
		s = s[:max]
	}
	return strings.TrimSpace(s)
}

// SwapLLMCompleterForTest swaps the package-level llmCompleter for a
// test fake. Returns a restore function. Test-only; do not call from
// production code (and yes, we considered making this _test.go-only,
// but it's needed by tests in OTHER packages too — specifically the
// fault-injection test in internal/llm).
func SwapLLMCompleterForTest(fake func(context.Context, derived.DerivedSummary) (string, error)) (restore func()) {
	prev := llmCompleter
	llmCompleter = fake
	return func() { llmCompleter = prev }
}
