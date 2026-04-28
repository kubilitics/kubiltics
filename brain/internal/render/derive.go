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
		// Both shapers produce the same {columns, rows[{STATUS,...}]}
		// shape, so a single row+status decoder works for both.
		var t struct {
			Rows []struct {
				Status string `json:"STATUS"`
			} `json:"rows"`
		}
		if err := json.Unmarshal(shaped, &t); err != nil {
			return d, err
		}
		d.RowCount = len(t.Rows)
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
	default:
		// Should be unreachable — only deterministic tools call derive.
		d.RowCount = 0
	}
	return d, nil
}
