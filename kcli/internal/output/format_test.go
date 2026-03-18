package output

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"testing"
)

func TestParseFlag(t *testing.T) {
	cases := []struct {
		in   string
		want Format
		err  bool
	}{
		{"", FormatAuto, false},
		{"auto", FormatAuto, false},
		{"json", FormatJSON, false},
		{"JSON", FormatJSON, false},
		{"table", FormatTable, false},
		{"yaml", FormatYAML, false},
		{"plain", FormatPlain, false},
		{"  json  ", FormatJSON, false},
		{"xml", 0, true},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got, err := ParseFlag(tc.in)
			if tc.err && err == nil {
				t.Fatal("expected error")
			}
			if !tc.err && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestResolve_NonAuto(t *testing.T) {
	// Non-auto formats are returned unchanged regardless of writer.
	var buf bytes.Buffer
	for _, f := range []Format{FormatTable, FormatJSON, FormatYAML, FormatPlain} {
		if got := Resolve(f, &buf); got != f {
			t.Errorf("Resolve(%v) = %v, want %v", f, got, f)
		}
	}
}

func TestResolve_AutoNonTTY(t *testing.T) {
	// bytes.Buffer is not a TTY — Auto should resolve to Plain.
	var buf bytes.Buffer
	if got := Resolve(FormatAuto, &buf); got != FormatPlain {
		t.Fatalf("Resolve(Auto, non-TTY) = %v, want Plain", got)
	}
}

type sample struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

func TestRender_JSON(t *testing.T) {
	var buf bytes.Buffer
	v := sample{Name: "test", Count: 42}
	if err := Render(&buf, FormatJSON, v); err != nil {
		t.Fatal(err)
	}
	var got sample
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v\noutput: %s", err, buf.String())
	}
	if got != v {
		t.Fatalf("got %+v, want %+v", got, v)
	}
}

func TestRender_YAML(t *testing.T) {
	var buf bytes.Buffer
	v := sample{Name: "test", Count: 42}
	if err := Render(&buf, FormatYAML, v); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	// Must be real YAML, not JSON: no curly braces, no quotes around keys.
	if strings.Contains(out, "{") || strings.Contains(out, "}") {
		t.Fatalf("YAML output looks like JSON:\n%s", out)
	}
	// Should contain bare key: value pairs.
	if !strings.Contains(out, "name: test") {
		t.Fatalf("expected 'name: test' in YAML output, got:\n%s", out)
	}
	if !strings.Contains(out, "count: 42") {
		t.Fatalf("expected 'count: 42' in YAML output, got:\n%s", out)
	}
}

func TestRender_TableWithFunc(t *testing.T) {
	var buf bytes.Buffer
	v := sample{Name: "hello", Count: 7}
	tableFn := func(w io.Writer, val any) error {
		s := val.(sample)
		_, err := fmt.Fprintf(w, "NAME   COUNT\n%s   %d\n", s.Name, s.Count)
		return err
	}
	if err := Render(&buf, FormatTable, v, WithTable(tableFn)); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "hello") {
		t.Fatalf("expected table output containing 'hello', got: %s", buf.String())
	}
}

func TestRender_TableFallbackToJSON(t *testing.T) {
	// When no table func is provided, table format falls back to JSON.
	var buf bytes.Buffer
	v := sample{Name: "fallback", Count: 1}
	if err := Render(&buf, FormatTable, v); err != nil {
		t.Fatal(err)
	}
	var got sample
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("expected JSON fallback, got: %s", buf.String())
	}
}
