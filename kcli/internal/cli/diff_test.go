package cli

import (
	"fmt"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// parseDiffFlags
// ---------------------------------------------------------------------------

func TestParseDiffFlags_NoFlags(t *testing.T) {
	summary, ai, noColor, against, rest := parseDiffFlags([]string{"-f", "deploy.yaml"})
	if summary || ai || noColor || against != "" {
		t.Fatal("expected all flags false")
	}
	if len(rest) != 2 || rest[0] != "-f" || rest[1] != "deploy.yaml" {
		t.Fatalf("expected rest=[-f deploy.yaml], got %v", rest)
	}
}

func TestParseDiffFlags_Summary(t *testing.T) {
	summary, ai, noColor, against, rest := parseDiffFlags([]string{"--summary", "-f", "x.yaml"})
	if !summary {
		t.Fatal("expected summary=true")
	}
	if ai || noColor || against != "" {
		t.Fatal("expected ai, noColor, against false/empty")
	}
	if len(rest) != 2 {
		t.Fatalf("expected 2 remaining args, got %v", rest)
	}
}

func TestParseDiffFlags_AI(t *testing.T) {
	_, ai, _, _, _ := parseDiffFlags([]string{"--ai"})
	if !ai {
		t.Fatal("expected ai=true")
	}
}

func TestParseDiffFlags_NoColor(t *testing.T) {
	_, _, noColor, _, _ := parseDiffFlags([]string{"--no-color"})
	if !noColor {
		t.Fatal("expected noColor=true")
	}
	_, _, noColor2, _, _ := parseDiffFlags([]string{"--no-colour"})
	if !noColor2 {
		t.Fatal("expected noColor=true for --no-colour alias")
	}
}

func TestParseDiffFlags_Against(t *testing.T) {
	_, _, _, against, rest := parseDiffFlags([]string{"--against", "staging", "deployment/foo"})
	if against != "staging" {
		t.Fatalf("expected against=staging, got %q", against)
	}
	if len(rest) != 1 || rest[0] != "deployment/foo" {
		t.Fatalf("expected rest=[deployment/foo], got %v", rest)
	}
	_, _, _, against2, _ := parseDiffFlags([]string{"--against=prod"})
	if against2 != "prod" {
		t.Fatalf("expected against=prod, got %q", against2)
	}
}

func TestParseDiffFlags_Combined(t *testing.T) {
	summary, ai, noColor, against, rest := parseDiffFlags([]string{"--summary", "--ai", "--no-color", "-f", "f.yaml", "-R"})
	if !summary || !ai || !noColor {
		t.Fatalf("expected all custom flags true, got summary=%v ai=%v noColor=%v", summary, ai, noColor)
	}
	if against != "" {
		t.Fatalf("expected against empty, got %q", against)
	}
	if len(rest) != 3 {
		t.Fatalf("expected 3 forwarded args, got %v", rest)
	}
}

func TestParseDiffFlags_EmptyArgs(t *testing.T) {
	summary, ai, noColor, against, rest := parseDiffFlags(nil)
	if summary || ai || noColor || against != "" {
		t.Fatal("expected all flags false for nil input")
	}
	if len(rest) != 0 {
		t.Fatalf("expected empty rest, got %v", rest)
	}
}

// ---------------------------------------------------------------------------
// colorizeDiff
// ---------------------------------------------------------------------------

var sampleDiff = strings.Join([]string{
	`diff -u -N /tmp/LIVE/apps.v1.Deployment.default.myapp /tmp/MERGED/apps.v1.Deployment.default.myapp`,
	`--- /tmp/LIVE/apps.v1.Deployment.default.myapp  2026-01-01`,
	`+++ /tmp/MERGED/apps.v1.Deployment.default.myapp  2026-01-01`,
	`@@ -1,4 +1,4 @@`,
	` apiVersion: apps/v1`,
	`-  replicas: 1`,
	`+  replicas: 3`,
	` kind: Deployment`,
}, "\n")

func TestColorizeDiff_AddLineIsGreen(t *testing.T) {
	out := colorizeDiff(sampleDiff)
	// Lines starting with "+" (not "+++") must contain green ANSI.
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, "  replicas: 3") {
			if !strings.Contains(line, ansiGreen) {
				t.Fatalf("expected green on added line, got: %q", line)
			}
			return
		}
	}
	t.Fatal("added line '+  replicas: 3' not found in output")
}

func TestColorizeDiff_RemoveLineIsRed(t *testing.T) {
	out := colorizeDiff(sampleDiff)
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, "  replicas: 1") {
			if !strings.Contains(line, ansiRed) {
				t.Fatalf("expected red on removed line, got: %q", line)
			}
			return
		}
	}
	t.Fatal("removed line '-  replicas: 1' not found in output")
}

func TestColorizeDiff_DiffHeaderIsBoldYellow(t *testing.T) {
	out := colorizeDiff(sampleDiff)
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(strings.TrimLeft(line, "\033[0123456789m"), "diff ") ||
			strings.HasPrefix(line, ansiBold+ansiYellow) {
			// Found the diff header line.
			if !strings.Contains(line, ansiBold) || !strings.Contains(line, ansiYellow) {
				t.Fatalf("expected bold+yellow on diff header line, got: %q", line)
			}
			return
		}
	}
	t.Fatal("diff header line not found in colorized output")
}

func TestColorizeDiff_HunkHeaderIsCyan(t *testing.T) {
	out := colorizeDiff(sampleDiff)
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, "@@ -1,4") {
			if !strings.Contains(line, ansiCyan) {
				t.Fatalf("expected cyan on hunk header, got: %q", line)
			}
			return
		}
	}
	t.Fatal("hunk header line not found in colorized output")
}

func TestColorizeDiff_ContextLineUnchanged(t *testing.T) {
	out := colorizeDiff(sampleDiff)
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, "apiVersion: apps/v1") {
			// Context lines must not have any color code.
			if strings.Contains(line, "\033[") {
				t.Fatalf("expected no ANSI on context line, got: %q", line)
			}
			return
		}
	}
	t.Fatal("context line 'apiVersion: apps/v1' not found")
}

func TestColorizeDiff_FileHeaderIsBold(t *testing.T) {
	out := colorizeDiff(sampleDiff)
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, "/tmp/LIVE/apps.v1.Deployment") && strings.Contains(line, "2026-01-01") {
			if !strings.Contains(line, ansiBold) {
				t.Fatalf("expected bold on --- header line, got: %q", line)
			}
			return
		}
	}
	t.Fatal("--- header line not found in colorized output")
}

// ---------------------------------------------------------------------------
// diffResourceLabel
// ---------------------------------------------------------------------------

func TestDiffResourceLabel_StandardResource(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"apps.v1.Deployment.default.myapp", "Deployment/myapp"},
		{".v1.Pod.kube-system.coredns-xyz", "Pod/coredns-xyz"},
		{"v1.ConfigMap.default.my-config", "ConfigMap/my-config"},
	}
	for _, c := range cases {
		got := diffResourceLabel(c.input)
		if got != c.want {
			t.Errorf("diffResourceLabel(%q) = %q, want %q", c.input, got, c.want)
		}
	}
}

func TestDiffResourceLabel_Fallback(t *testing.T) {
	// When we can't parse, return the raw basename.
	got := diffResourceLabel("somethingweird")
	if got != "somethingweird" {
		t.Errorf("expected raw fallback, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// parseDiffResources
// ---------------------------------------------------------------------------

func TestParseDiffResources_ExtractsResources(t *testing.T) {
	diff := strings.Join([]string{
		`diff -u -N /tmp/kubectl-diff-1/LIVE-1/apps.v1.Deployment.default.nginx /tmp/kubectl-diff-1/MERGED-1/apps.v1.Deployment.default.nginx`,
		`--- ...`,
		`diff -u -N /tmp/kubectl-diff-1/LIVE-1/.v1.ConfigMap.default.env /tmp/kubectl-diff-1/MERGED-1/.v1.ConfigMap.default.env`,
	}, "\n")
	resources := parseDiffResources(diff)
	if len(resources) != 2 {
		t.Fatalf("expected 2 resources, got %d: %v", len(resources), resources)
	}
}

func TestParseDiffResources_DeduplicatesResources(t *testing.T) {
	// Same LIVE path appearing twice should only produce one resource.
	diff := strings.Join([]string{
		`diff -u -N /tmp/LIVE-1/apps.v1.Deployment.default.nginx /tmp/MERGED-1/apps.v1.Deployment.default.nginx`,
		`diff -u -N /tmp/LIVE-1/apps.v1.Deployment.default.nginx /tmp/MERGED-1/apps.v1.Deployment.default.nginx`,
	}, "\n")
	resources := parseDiffResources(diff)
	if len(resources) != 1 {
		t.Fatalf("expected 1 resource (deduped), got %d: %v", len(resources), resources)
	}
}

func TestParseDiffResources_EmptyForNoDiffHeaders(t *testing.T) {
	diff := "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n"
	resources := parseDiffResources(diff)
	if len(resources) != 0 {
		t.Fatalf("expected 0 resources, got %d: %v", len(resources), resources)
	}
}

// ---------------------------------------------------------------------------
// printDiffSummary
// ---------------------------------------------------------------------------

func TestPrintDiffSummary_SingleResource(t *testing.T) {
	diff := `diff -u -N /tmp/LIVE-1/apps.v1.Deployment.default.myapp /tmp/MERGED-1/apps.v1.Deployment.default.myapp` + "\n"
	var sb strings.Builder
	if err := printDiffSummary(&sb, diff); err != nil {
		t.Fatalf("printDiffSummary: %v", err)
	}
	out := sb.String()
	if !strings.Contains(out, "1 resource") {
		t.Fatalf("expected '1 resource' in output, got %q", out)
	}
}

func TestPrintDiffSummary_MultipleResources(t *testing.T) {
	diff := strings.Join([]string{
		`diff -u -N /tmp/LIVE-1/apps.v1.Deployment.default.nginx /tmp/MERGED-1/apps.v1.Deployment.default.nginx`,
		`diff -u -N /tmp/LIVE-1/.v1.ConfigMap.default.env /tmp/MERGED-1/.v1.ConfigMap.default.env`,
		`diff -u -N /tmp/LIVE-1/.v1.Service.default.web /tmp/MERGED-1/.v1.Service.default.web`,
	}, "\n")
	var sb strings.Builder
	if err := printDiffSummary(&sb, diff); err != nil {
		t.Fatalf("printDiffSummary: %v", err)
	}
	out := sb.String()
	if !strings.Contains(out, "3 resources") {
		t.Fatalf("expected '3 resources' in output, got %q", out)
	}
}

func TestPrintDiffSummary_FallbackToHunkCount(t *testing.T) {
	// Diff with hunk headers but no recognizable "diff -u" lines.
	diff := "@@ -1,3 +1,3 @@\n-old\n+new\n@@ -5 +5 @@\n-x\n+y\n"
	var sb strings.Builder
	if err := printDiffSummary(&sb, diff); err != nil {
		t.Fatalf("printDiffSummary: %v", err)
	}
	out := sb.String()
	if !strings.Contains(out, "2 hunk") {
		t.Fatalf("expected '2 hunk' fallback in output, got %q", out)
	}
}

// ---------------------------------------------------------------------------
// exitCodeOf
// ---------------------------------------------------------------------------

func TestExitCodeOf_Nil(t *testing.T) {
	if got := exitCodeOf(nil); got != 0 {
		t.Fatalf("expected 0 for nil error, got %d", got)
	}
}

func TestExitCodeOf_NonExitError(t *testing.T) {
	err := fmt.Errorf("some error")
	if got := exitCodeOf(err); got != 1 {
		t.Fatalf("expected 1 for non-ExitError, got %d", got)
	}
}
