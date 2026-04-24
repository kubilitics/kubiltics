// bench-report — reads a JUnit XML + per-prompt routing traces and
// emits a single self-contained HTML file with:
//   - executive summary
//   - per-prompt SVG flow diagrams
//   - token/cost table
//   - latency histogram
//   - failure taxonomy
//   - honest methodology + limitations
//
// No external deps. All SVG/HTML/CSS inline. Offline-viewable.
//
// Usage:
//
//	bench-report \
//	    --junit    chat_quality_final.xml \
//	    --traces   /tmp/kubilitics-traces/ \
//	    --suite    investor-demo-50 \
//	    --out      docs/reports/2026-04-21-investor-bench/report.html
package main

import (
	"bufio"
	"encoding/json"
	"encoding/xml"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type junitSuite struct {
	XMLName  xml.Name    `xml:"testsuite"`
	Name     string      `xml:"name,attr"`
	Tests    int         `xml:"tests,attr"`
	Failures int         `xml:"failures,attr"`
	Cases    []junitCase `xml:"testcase"`
}
type junitCase struct {
	Name      string        `xml:"name,attr"`
	Time      float64       `xml:"time,attr"`
	Failure   *junitFailure `xml:"failure,omitempty"`
	SystemOut string        `xml:"system-out,omitempty"`
}

// judgeScore is parsed from <system-out>judge=<JSON> when
// chat-quality-bench was run with --judge-base-url. Fields mirror the
// JSON emitted by cmd/chat-quality-bench/judge.go.
type judgeScore struct {
	Factual      int    `json:"factual"`
	Completeness int    `json:"completeness"`
	Clarity      int    `json:"clarity"`
	ToolUse      int    `json:"tool_use"`
	Critique     string `json:"critique"`
}

func (j judgeScore) Mean() float64 {
	return float64(j.Factual+j.Completeness+j.Clarity+j.ToolUse) / 4.0
}

// parseJudgeFromSystemOut finds the "judge=<JSON>" fragment in a
// JUnit <system-out> block and parses it. Returns nil if absent.
func parseJudgeFromSystemOut(systemOut string) *judgeScore {
	systemOut = strings.TrimSpace(systemOut)
	idx := strings.Index(systemOut, "judge=")
	if idx < 0 {
		return nil
	}
	blob := strings.TrimSpace(systemOut[idx+len("judge="):])
	var j judgeScore
	if err := json.Unmarshal([]byte(blob), &j); err != nil {
		return nil
	}
	return &j
}
type junitFailure struct {
	Message string `xml:"message,attr"`
	Body    string `xml:",chardata"`
}

type stage struct {
	Stage  string
	Fields map[string]any
}

type promptTrace struct {
	PromptID  string
	Stages    []stage
	Text      string
	USD       float64
	TokensIn  int
	TokensOut int
	LatencyMs int
}

// suitePrompt mirrors one entry from a suite JSON (id/text/scenario/expect_tool).
// Used to inject the real question text and scenario blurb into walkthrough cards.
type suitePrompt struct {
	ID         string `json:"id"`
	Text       string `json:"text"`
	Scenario   string `json:"scenario,omitempty"`
	ExpectTool bool   `json:"expect_tool,omitempty"`
}

// catalogEntry mirrors the per-tool record emitted by cmd/tool-catalog.
// Only the fields consumed by the v2 report are declared; extras unmarshal into map/slice.
type catalogEntry struct {
	Name         string                 `json:"name"`
	Category     string                 `json:"category"`
	Description  string                 `json:"description"`
	Parameters   interface{}            `json:"parameters,omitempty"`
	Required     interface{}            `json:"required,omitempty"`
	PlainEnglish string                 `json:"plain_english"`
	Autonomy     int                    `json:"autonomy_level"`
}

func main() {
	junitPath := flag.String("junit", "", "path to JUnit XML")
	tracesDir := flag.String("traces", "", "per-prompt trace dir")
	suite := flag.String("suite", "chat-quality", "suite name (shown in report)")
	out := flag.String("out", "", "output HTML path")
	catalogPath := flag.String("catalog", "", "path to tool-catalog.json (optional; enables tool-explorer section)")
	suiteFile := flag.String("suite-file", "", "path to suite JSON (prompts + scenarios). Drives walkthrough-card question text.")
	useV2 := flag.Bool("v2", false, "use the v2 interactive report template")
	flag.Parse()
	if *junitPath == "" || *out == "" {
		log.Fatal("--junit and --out are required")
	}

	var catalog []catalogEntry
	if *catalogPath != "" {
		b, err := os.ReadFile(*catalogPath)
		if err != nil {
			log.Fatalf("read catalog: %v", err)
		}
		if err := json.Unmarshal(b, &catalog); err != nil {
			log.Fatalf("parse catalog: %v", err)
		}
	}

	xmlBytes, err := os.ReadFile(*junitPath)
	if err != nil {
		log.Fatalf("read junit: %v", err)
	}
	s, err := parseJUnit(xmlBytes)
	if err != nil {
		log.Fatalf("parse junit: %v", err)
	}

	traces := map[string]*promptTrace{}
	if *tracesDir != "" {
		if err := filepath.WalkDir(*tracesDir, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			if !strings.HasSuffix(p, ".jsonl") {
				return nil
			}
			// chat-quality-bench writes traces as "bench-<prompt-id>.jsonl" but
			// the JUnit testcase name is just "<prompt-id>". Strip the prefix so
			// the walkthrough-card badge can match against the junit case.
			id := strings.TrimPrefix(strings.TrimSuffix(filepath.Base(p), ".jsonl"), "bench-")
			pt, perr := loadTrace(p, id)
			if perr == nil {
				traces[id] = pt
			}
			return nil
		}); err != nil {
			log.Printf("warn: walk traces: %v", err)
		}
	}

	if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
		log.Fatalf("mkdir out: %v", err)
	}

	f, err := os.Create(*out)
	if err != nil {
		log.Fatalf("create out: %v", err)
	}
	defer f.Close()
	prompts := map[string]suitePrompt{}
	if *suiteFile != "" {
		b, rerr := os.ReadFile(*suiteFile)
		if rerr != nil {
			log.Fatalf("read suite-file: %v", rerr)
		}
		var sf struct {
			Prompts []suitePrompt `json:"prompts"`
		}
		if uerr := json.Unmarshal(b, &sf); uerr != nil {
			log.Fatalf("parse suite-file: %v", uerr)
		}
		for _, p := range sf.Prompts {
			prompts[p.ID] = p
		}
	}

	if *useV2 {
		err = renderHTMLv2(f, *suite, s, traces, catalog, prompts)
	} else {
		err = renderHTML(f, *suite, s, traces)
	}
	if err != nil {
		log.Fatalf("render: %v", err)
	}
	fmt.Printf("wrote %s (%d cases, %d traces)\n", *out, len(s.Cases), len(traces))
}

func parseJUnit(b []byte) (*junitSuite, error) {
	var s junitSuite
	if err := xml.Unmarshal(b, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func loadTrace(path, id string) (*promptTrace, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	pt := &promptTrace{PromptID: id}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		var m map[string]any
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			continue
		}
		name, _ := m["stage"].(string)
		delete(m, "stage")
		// Keep ts in Fields — traceDurationMs in template.go parses it
		// to derive wall-clock latency when no explicit done stage fires.
		delete(m, "turn_id")
		pt.Stages = append(pt.Stages, stage{Stage: name, Fields: m})
		switch name {
		case "llm_prompt_in":
			if v, ok := m["input_tokens"].(float64); ok {
				pt.TokensIn += int(v)
			}
		case "llm_text_out":
			if v, ok := m["output_tokens"].(float64); ok {
				pt.TokensOut += int(v)
			}
		case "cost":
			if v, ok := m["usd_total"].(float64); ok {
				pt.USD = v
			}
		case "done":
			if v, ok := m["duration_ms"].(float64); ok {
				pt.LatencyMs = int(v)
			}
		}
	}
	return pt, sc.Err()
}

func formatBytes(n int) string {
	switch {
	case n >= 1_000_000:
		return fmt.Sprintf("%.1f MB", float64(n)/1_000_000)
	case n >= 1_000:
		return fmt.Sprintf("%.1f KB", float64(n)/1_000)
	default:
		return fmt.Sprintf("%d B", n)
	}
}

func percentile(sorted []int, p float64) int {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(float64(len(sorted)-1) * p)
	return sorted[idx]
}

func sortInts(xs []int) []int {
	cp := append([]int(nil), xs...)
	sort.Ints(cp)
	return cp
}
