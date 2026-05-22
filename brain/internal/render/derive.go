package render

import (
	"encoding/json"
	"strings"

	"github.com/vellankikoti/kubilitics/brain/internal/derived"
)

// derive computes a DerivedSummary from a shaped tool result. It
// reads only counts and statuses — never names or arbitrary fields.
// The resulting struct is the ONLY thing summary.Generate may see.
//
// Tool-name dispatch:
//   list_pods, list_resources    → row decoder (counts + status histogram)
//   get_pod_yaml, get_resource   → single document (RowCount=1)
//   inspect_*                    → single document (RowCount=1)
//   default                      → unreachable; safe RowCount=0
func derive(toolName, namespace string, shaped json.RawMessage) (derived.DerivedSummary, error) {
	d := derived.DerivedSummary{ToolName: toolName, Namespace: namespace}
	switch {
	case toolName == "list_pods" || toolName == "list_resources":
		// Both shapers produce the same {columns, rows[{STATUS,...}], single_namespace}
		// shape. Derive namespace from actual data — not from the LLM's tool args —
		// so "15 pods across all namespaces" is never mislabelled as "in default".
		var t struct {
			Rows []struct {
				Status string `json:"STATUS"`
			} `json:"rows"`
			SingleNamespace string `json:"single_namespace"`
			TotalCount      int    `json:"total_count"`
		}
		if err := json.Unmarshal(shaped, &t); err != nil {
			return d, err
		}
		d.RowCount = len(t.Rows)
		// When capListOutput trimmed the items array, TotalCount holds the
		// real cluster-wide count. Use it so the summary reports the truth
		// ("32 resources") rather than the visible subset ("16").
		if t.TotalCount > d.RowCount {
			d.RowCount = t.TotalCount
		}
		// Override: use the namespace observed in the rendered data, not the
		// namespace the LLM requested. SingleNamespace is "" when rows span
		// multiple namespaces or are cluster-scoped — no qualifier in summary.
		d.Namespace = t.SingleNamespace
		if len(t.Rows) > 0 {
			d.StatusBreakdown = map[string]int{}
			for _, r := range t.Rows {
				d.StatusBreakdown[r.Status]++
			}
		}
	case toolName == "get_pod_yaml" ||
		toolName == "get_resource" ||
		strings.HasPrefix(toolName, "inspect_"):
		// All single-document detail tools — one resource per call.
		// inspect_<kind> is rolled in via the prefix so future
		// inspect_* additions don't need to touch derive().
		d.RowCount = 1
	case toolName == "get_logs":
		// Counts the lines in the shaped log payload. The shaper
		// caps at MaxLogLines and exposes "total" too; we count the
		// emitted lines slice for the summary number ("X lines from
		// pod ..."). RowCount stays a single int as per type fence.
		var t struct {
			Lines []string `json:"lines"`
		}
		if err := json.Unmarshal(shaped, &t); err != nil {
			return d, err
		}
		d.RowCount = len(t.Lines)
	default:
		// Should be unreachable — only deterministic tools call derive.
		d.RowCount = 0
	}
	return d, nil
}
