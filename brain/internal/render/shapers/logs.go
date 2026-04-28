// logs.go — shaper for get_logs (Phase 2 #4).
//
// Architectural rules carried forward from Phase 1:
//
//   1. The shaper is deterministic. No LLM is involved between the raw
//      tool result and the shaped wire data.
//   2. The shaped output is owned by the brain; the WS layer forwards
//      the bytes verbatim. The frontend's LogBlock renders strictly
//      what the shaper emitted.
//   3. Failure modes (malformed input, oversized payload) are handled
//      by the chokepoint that calls this shaper — the shaper itself
//      either returns valid JSON or an error.
//
// Wire shape produced by ShapeGetLogs:
//
//   {
//     "pod":       "<pod name>",
//     "container": "<container name or empty>",
//     "namespace": "<namespace>",
//     "lines":     ["...", "...", ...],
//     "truncated": <bool>,    // true if MaxLogLines elided lines from the source
//     "total":     <int>      // original line count BEFORE truncation
//   }
//
// Truncation is bounded HERE so the frontend can show a clear "showing
// last N of M lines" indicator without having to count itself, and so
// that very-large pod log dumps can't blow the render_data budget.

package shapers

import (
	"encoding/json"
	"fmt"
	"strings"
)

// MaxLogLines caps the number of lines the shaper emits. Picked to
// balance "tail -n 100 is the kubectl default" against "long incidents
// need ~5x the default". Tunable by future operators via env vars if
// real-world use shows it's the wrong knob.
const MaxLogLines = 500

// ShapeGetLogs turns the get_logs MCP tool result into a LogBlock
// payload for the frontend's <LogBlock> renderer. Tolerant of:
//
//   - missing fields (pod / container / namespace / logs)
//   - empty logs string (yields an empty lines array, NOT an error)
//   - trailing newlines (collapsed; we don't emit ghost empty lines)
//   - line counts above MaxLogLines (last MaxLogLines kept; truncated=true)
func ShapeGetLogs(raw json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Pod       string `json:"pod"`
		Container string `json:"container"`
		Namespace string `json:"namespace"`
		Logs      string `json:"logs"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, fmt.Errorf("get_logs shaper: %w", err)
	}

	lines := splitLogLines(in.Logs)
	total := len(lines)
	truncated := false
	if total > MaxLogLines {
		// Keep the last MaxLogLines — that's the SRE-relevant tail.
		// Surface truncation explicitly so the frontend can render
		// "(earlier lines elided — showing last N of M)".
		lines = lines[total-MaxLogLines:]
		truncated = true
	}

	return json.Marshal(struct {
		Pod       string   `json:"pod"`
		Container string   `json:"container"`
		Namespace string   `json:"namespace"`
		Lines     []string `json:"lines"`
		Truncated bool     `json:"truncated"`
		Total     int      `json:"total"`
	}{
		Pod:       in.Pod,
		Container: in.Container,
		Namespace: in.Namespace,
		Lines:     lines,
		Truncated: truncated,
		Total:     total,
	})
}

// splitLogLines splits a multi-line log blob into individual lines
// without producing trailing-empty-line ghosts. Logs from kubectl /
// the K8s API typically end with a single trailing \n; we don't want
// that to render as an extra blank row in the UI.
func splitLogLines(s string) []string {
	if s == "" {
		return []string{}
	}
	// Strip a single trailing newline so "a\nb\n" → ["a","b"], not
	// ["a","b",""]. Lines internal to the blob keep their structure.
	s = strings.TrimRight(s, "\n")
	if s == "" {
		return []string{}
	}
	return strings.Split(s, "\n")
}
