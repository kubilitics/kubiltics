package main

import (
	"strings"
	"testing"
)

func TestSVG_FlowDiagram_ContainsBoxes(t *testing.T) {
	stages := []stage{
		{Stage: "user_msg", Fields: map[string]any{"bytes": 42.0}},
		{Stage: "llm_prompt_in", Fields: map[string]any{"bytes": 2800.0}},
		{Stage: "tool_dispatch", Fields: map[string]any{"tool_name": "list_resources"}},
		{Stage: "backend_k8s_fetch", Fields: map[string]any{"resp_bytes": 148000.0}},
		{Stage: "tool_result_summarized", Fields: map[string]any{"bytes_in": 148000.0, "bytes_out": 4800.0}},
		{Stage: "llm_text_out", Fields: map[string]any{"bytes": 820.0}},
	}
	svg := flowSVG(stages, "list namespaces")
	for _, want := range []string{"user", "LLM", "backend", "K8s", "42", "148", "4.8"} {
		if !strings.Contains(svg, want) {
			t.Errorf("flowSVG missing %q in output", want)
		}
	}
	if !strings.Contains(svg, "<svg") || !strings.Contains(svg, "</svg>") {
		t.Errorf("flowSVG must emit a complete <svg>...</svg> element")
	}
}

func TestHistogramSVG_Percentiles(t *testing.T) {
	latencies := []int{100, 200, 300, 400, 500, 1000, 2000, 3000, 5000, 10000}
	svg := histogramSVG(latencies)
	for _, want := range []string{"p50", "p95", "p99"} {
		if !strings.Contains(svg, want) {
			t.Errorf("histogram must annotate %s", want)
		}
	}
}

func TestFormatBytes(t *testing.T) {
	cases := []struct {
		in  int
		out string
	}{
		{500, "500 B"},
		{1500, "1.5 KB"},
		{1500000, "1.5 MB"},
	}
	for _, c := range cases {
		if got := formatBytes(c.in); got != c.out {
			t.Errorf("formatBytes(%d)=%q, want %q", c.in, got, c.out)
		}
	}
}

func TestLoadJUnit_ParsesFailuresAndCases(t *testing.T) {
	xml := `<?xml version="1.0"?>
<testsuite name="chat-quality" tests="2" failures="1">
	<testcase name="pass-1" time="1.2"/>
	<testcase name="fail-1" time="0.5">
		<failure message="empty text answer">prompt=&quot;list x&quot; tools=[] text_len=0</failure>
	</testcase>
</testsuite>`
	suite, err := parseJUnit([]byte(xml))
	if err != nil {
		t.Fatalf("parseJUnit: %v", err)
	}
	if suite.Tests != 2 || suite.Failures != 1 {
		t.Fatalf("counts off: tests=%d failures=%d", suite.Tests, suite.Failures)
	}
	if suite.Cases[1].Failure == nil {
		t.Fatalf("expected failure on case 2")
	}
}

func TestRenderHTMLv2_IncludesExecSummaryAndToolExplorer(t *testing.T) {
	j := &junitSuite{
		Name:     "test",
		Tests:    2,
		Failures: 1,
		Cases: []junitCase{
			{Name: "p1", Time: 1.0},
			{Name: "p2", Time: 2.0, Failure: &junitFailure{Message: "nope"}},
		},
	}
	traces := map[string]*promptTrace{
		"p1": {PromptID: "p1", Stages: []stage{{Stage: "user_msg", Fields: map[string]any{"bytes": 10.0}}}},
	}
	cat := []catalogEntry{
		{Name: "list_resources", Category: "Observation", Description: "list k8s resources", PlainEnglish: "Shows things."},
	}
	var buf strings.Builder
	if err := renderHTMLv2(&buf, "test-suite", j, traces, cat, map[string]suitePrompt{"p1": {ID: "p1", Text: "test question", Scenario: "unit test"}}); err != nil {
		t.Fatalf("render: %v", err)
	}
	h := buf.String()
	for _, want := range []string{
		"test-suite", "1 / 2 passed", "list_resources", "Shows things.",
		"Observation", "<script", "tool-explorer",
	} {
		if !strings.Contains(h, want) {
			t.Errorf("v2 html missing %q", want)
		}
	}
}
