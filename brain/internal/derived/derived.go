// Package derived defines the strict, exhaustive schema that the
// summary-generating LLM call may see for tools on the deterministic
// path. Lives in its own package (no imports) to break the cycle
// between internal/render and internal/llm/summary.
package derived

// DerivedSummary describes the SHAPE of a tool result, never its
// IDENTITY. Adding a field is a deliberate review point — see
// derived_test.go.
type DerivedSummary struct {
	ToolName        string         `json:"tool_name"`
	Namespace       string         `json:"namespace,omitempty"`
	RowCount        int            `json:"row_count"`
	StatusBreakdown map[string]int `json:"status_breakdown,omitempty"`
}
