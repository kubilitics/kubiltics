package shapers

import (
	"encoding/json"
	"strings"
	"testing"
)

// shapedLogs is the wire shape ShapeGetLogs produces.
// Mirrored here so tests can decode without coupling to internal types.
type shapedLogs struct {
	Pod       string   `json:"pod"`
	Container string   `json:"container"`
	Namespace string   `json:"namespace"`
	Lines     []string `json:"lines"`
	Truncated bool     `json:"truncated"`
	Total     int      `json:"total"`
}

func decodeShapedLogs(t *testing.T, b []byte) shapedLogs {
	t.Helper()
	var s shapedLogs
	if err := json.Unmarshal(b, &s); err != nil {
		t.Fatalf("unmarshal shaped: %v", err)
	}
	return s
}

func TestShapeGetLogs_HappyPath(t *testing.T) {
	raw := []byte(`{"pod":"app-1","container":"main","namespace":"prod","logs":"line one\nline two\nline three"}`)
	out, err := ShapeGetLogs(raw)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	s := decodeShapedLogs(t, out)
	if s.Pod != "app-1" || s.Container != "main" || s.Namespace != "prod" {
		t.Errorf("metadata: got %+v", s)
	}
	if len(s.Lines) != 3 {
		t.Errorf("lines: got %d want 3", len(s.Lines))
	}
	if s.Lines[0] != "line one" || s.Lines[2] != "line three" {
		t.Errorf("line content: got %v", s.Lines)
	}
	if s.Truncated || s.Total != 3 {
		t.Errorf("truncation: got truncated=%v total=%d", s.Truncated, s.Total)
	}
}

func TestShapeGetLogs_TrailingNewline(t *testing.T) {
	// Pod logs from the K8s API typically end with a single \n. We MUST
	// NOT emit a ghost trailing empty line in the rendered output.
	raw := []byte(`{"pod":"p","logs":"a\nb\n"}`)
	out, _ := ShapeGetLogs(raw)
	s := decodeShapedLogs(t, out)
	if len(s.Lines) != 2 {
		t.Errorf("trailing newline produced ghost row: got %d lines (%v) want 2", len(s.Lines), s.Lines)
	}
}

func TestShapeGetLogs_EmptyLogs(t *testing.T) {
	raw := []byte(`{"pod":"p","logs":""}`)
	out, err := ShapeGetLogs(raw)
	if err != nil {
		t.Fatalf("empty logs must not error: %v", err)
	}
	s := decodeShapedLogs(t, out)
	if len(s.Lines) != 0 {
		t.Errorf("empty input should produce 0 lines, got %d", len(s.Lines))
	}
	if s.Truncated {
		t.Errorf("empty input must not be marked truncated")
	}
	if s.Total != 0 {
		t.Errorf("total: got %d want 0", s.Total)
	}
}

func TestShapeGetLogs_OnlyNewlines(t *testing.T) {
	// Pathological: a log string of just newlines. Treat as empty —
	// the user has nothing useful to read.
	raw := []byte(`{"pod":"p","logs":"\n\n\n"}`)
	out, _ := ShapeGetLogs(raw)
	s := decodeShapedLogs(t, out)
	if len(s.Lines) != 0 {
		t.Errorf("only-newlines input should collapse to 0, got %v", s.Lines)
	}
}

func TestShapeGetLogs_TruncatesAboveMaxLogLines(t *testing.T) {
	// Build a log blob with MaxLogLines + 50 lines. Confirm the shaper
	// keeps the LAST MaxLogLines (the SRE-relevant tail) and reports
	// total as the original count.
	overflow := MaxLogLines + 50
	parts := make([]string, overflow)
	for i := 0; i < overflow; i++ {
		parts[i] = "line-" + itoa(i)
	}
	raw, _ := json.Marshal(map[string]string{"pod": "verbose", "logs": strings.Join(parts, "\n")})
	out, _ := ShapeGetLogs(raw)
	s := decodeShapedLogs(t, out)

	if !s.Truncated {
		t.Errorf("must mark truncated=true above MaxLogLines")
	}
	if s.Total != overflow {
		t.Errorf("total: got %d want %d", s.Total, overflow)
	}
	if len(s.Lines) != MaxLogLines {
		t.Errorf("lines: got %d want %d", len(s.Lines), MaxLogLines)
	}
	// Last line in the shaped output must equal the LAST line of the
	// original blob — proves we kept the tail, not the head.
	wantLast := "line-" + itoa(overflow-1)
	if s.Lines[len(s.Lines)-1] != wantLast {
		t.Errorf("last line mismatch: got %q want %q", s.Lines[len(s.Lines)-1], wantLast)
	}
}

func TestShapeGetLogs_ExactlyAtCapNotMarkedTruncated(t *testing.T) {
	// Boundary: exactly MaxLogLines lines should NOT be marked
	// truncated (we kept everything).
	parts := make([]string, MaxLogLines)
	for i := range parts {
		parts[i] = "x"
	}
	raw, _ := json.Marshal(map[string]string{"pod": "p", "logs": strings.Join(parts, "\n")})
	out, _ := ShapeGetLogs(raw)
	s := decodeShapedLogs(t, out)
	if s.Truncated {
		t.Errorf("at-cap must not be marked truncated")
	}
	if len(s.Lines) != MaxLogLines || s.Total != MaxLogLines {
		t.Errorf("at-cap counts: got lines=%d total=%d want %d/%d", len(s.Lines), s.Total, MaxLogLines, MaxLogLines)
	}
}

func TestShapeGetLogs_MalformedJSON(t *testing.T) {
	_, err := ShapeGetLogs([]byte(`{not json`))
	if err == nil {
		t.Fatalf("expected error on malformed JSON")
	}
	if !strings.Contains(err.Error(), "get_logs shaper") {
		t.Errorf("error should mention shaper context, got %q", err)
	}
}

func TestShapeGetLogs_MissingFields(t *testing.T) {
	// Pod / namespace / container all missing, only logs present.
	// Shaper must not crash; emits empty strings + the lines.
	raw := []byte(`{"logs":"hello\nworld"}`)
	out, err := ShapeGetLogs(raw)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	s := decodeShapedLogs(t, out)
	if s.Pod != "" || s.Container != "" || s.Namespace != "" {
		t.Errorf("missing-fields must produce empty strings, got %+v", s)
	}
	if len(s.Lines) != 2 {
		t.Errorf("lines: got %d want 2", len(s.Lines))
	}
}

// itoa avoids importing strconv at top of file; tiny helper is clearer
// than a second import for two test sites.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
