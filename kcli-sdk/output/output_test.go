package output_test

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/kubilitics/kcli-sdk/output"
)

func TestPrinter_Println(t *testing.T) {
	var buf bytes.Buffer
	p := output.NewPrinter(&buf, false)
	p.Println("hello world")
	if !strings.Contains(buf.String(), "hello world") {
		t.Fatalf("expected 'hello world' in output, got: %q", buf.String())
	}
}

func TestPrinter_Table_Text(t *testing.T) {
	var buf bytes.Buffer
	p := output.NewPrinter(&buf, false)
	p.Table(
		[]string{"NAME", "STATUS"},
		[][]string{
			{"pod-a", "Running"},
			{"pod-b", "Pending"},
		},
	)
	out := buf.String()
	if !strings.Contains(out, "NAME") || !strings.Contains(out, "STATUS") {
		t.Fatalf("expected headers in output: %q", out)
	}
	if !strings.Contains(out, "pod-a") || !strings.Contains(out, "Running") {
		t.Fatalf("expected row data in output: %q", out)
	}
}

func TestPrinter_Table_JSON(t *testing.T) {
	var buf bytes.Buffer
	p := output.NewPrinter(&buf, true)
	p.Table(
		[]string{"name", "status"},
		[][]string{{"pod-a", "Running"}},
	)
	out := buf.String()
	if !strings.Contains(out, `"name"`) || !strings.Contains(out, `"pod-a"`) {
		t.Fatalf("expected JSON output with name field: %q", out)
	}
}

func TestPrinter_JSON(t *testing.T) {
	var buf bytes.Buffer
	p := output.NewPrinter(&buf, false)
	if err := p.JSON(map[string]string{"key": "value"}); err != nil {
		t.Fatalf("JSON: %v", err)
	}
	if !strings.Contains(buf.String(), `"key"`) {
		t.Fatalf("expected JSON output: %q", buf.String())
	}
}

func TestPrinter_Success_ContainsCheckmark(t *testing.T) {
	var buf bytes.Buffer
	p := output.NewPrinter(&buf, false)
	p.Success("deployed %s", "v1.2.3")
	if !strings.Contains(buf.String(), "✓") {
		t.Fatalf("expected checkmark in success output: %q", buf.String())
	}
	if !strings.Contains(buf.String(), "v1.2.3") {
		t.Fatalf("expected version in success output: %q", buf.String())
	}
}

func TestPrinter_Header_SkippedInJSON(t *testing.T) {
	var buf bytes.Buffer
	p := output.NewPrinter(&buf, true)
	p.Header("Resources")
	if buf.Len() != 0 {
		t.Fatalf("expected no header output in JSON mode, got: %q", buf.String())
	}
}

func TestPrinter_Error(t *testing.T) {
	var buf bytes.Buffer
	p := output.NewPrinter(&buf, false)
	p.Error(fmt.Errorf("connection refused"))
	if !strings.Contains(buf.String(), "error:") {
		t.Fatalf("expected 'error:' prefix: %q", buf.String())
	}
}
