package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"
)

//go:embed static/styles.css
var v2CSS string

//go:embed static/app.js
var v2JS string

// architectureSVG renders a simple annotated architecture diagram
// showing user -> frontend/chat -> backend -> brain (LLM) -> tools -> K8s.
// Kept intentionally small so it ships inline and opens offline.
func architectureSVG() string {
	return `<svg viewBox="0 0 780 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Kubilitics architecture">
  <style>
    .box { fill: #eef2ff; stroke: #4338ca; stroke-width: 1.5; }
    .box-llm { fill: #fef3c7; stroke: #d97706; }
    .box-k8s { fill: #dcfce7; stroke: #16a34a; }
    .lbl { font: 600 13px -apple-system, system-ui, sans-serif; fill: #111827; }
    .sub { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #4b5563; }
    .edge { stroke: #6b7280; stroke-width: 1.5; fill: none; marker-end: url(#arr); }
    .edge-redact { stroke: #16a34a; stroke-width: 2; }
    .note { font: 11px -apple-system, system-ui, sans-serif; fill: #065f46; }
  </style>
  <defs>
    <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#6b7280"/>
    </marker>
  </defs>
  <rect class="box" x="10"  y="90" width="120" height="60" rx="8"/>
  <text class="lbl" x="70"  y="118" text-anchor="middle">User</text>
  <text class="sub" x="70"  y="138" text-anchor="middle">chat panel</text>

  <rect class="box" x="170" y="90" width="140" height="60" rx="8"/>
  <text class="lbl" x="240" y="118" text-anchor="middle">Backend</text>
  <text class="sub" x="240" y="138" text-anchor="middle">privacy boundary</text>

  <rect class="box-llm box" x="350" y="90" width="140" height="60" rx="8"/>
  <text class="lbl" x="420" y="118" text-anchor="middle">LLM Brain</text>
  <text class="sub" x="420" y="138" text-anchor="middle">tool schemas + summaries</text>

  <rect class="box" x="530" y="20"  width="140" height="60" rx="8"/>
  <text class="lbl" x="600" y="48"  text-anchor="middle">MCP Tools</text>
  <text class="sub" x="600" y="68"  text-anchor="middle">166 tools</text>

  <rect class="box-k8s box" x="530" y="160" width="140" height="60" rx="8"/>
  <text class="lbl" x="600" y="188" text-anchor="middle">Kubernetes</text>
  <text class="sub" x="600" y="208" text-anchor="middle">read-only for bench</text>

  <path class="edge" d="M 130 120 L 170 120"/>
  <path class="edge edge-redact" d="M 310 120 L 350 120"/>
  <path class="edge" d="M 490 110 L 530 60"/>
  <path class="edge" d="M 490 130 L 530 180"/>
  <path class="edge" d="M 600 160 L 600 80"/>
  <text class="note" x="330" y="82">green edge = summarized / redacted</text>
</svg>`
}

// stagesPretty returns a compact human-readable bullet list of stages for
// the walkthrough. It is intentionally read-only — helps non-tech reviewers
// see "what happened" without drowning them in trace JSON.
func stagesPretty(stages []stage) string {
	if len(stages) == 0 {
		return `<li class="sub">(no stages recorded)</li>`
	}
	var b strings.Builder
	for _, s := range stages {
		b.WriteString("<li>")
		b.WriteString(htmlEscape(s.Stage))
		if extra := compactFields(s.Fields); extra != "" {
			b.WriteString(" — ")
			b.WriteString(extra)
		}
		b.WriteString("</li>")
	}
	return b.String()
}

// compactFields picks a couple of interesting fields per stage and renders
// them as "k=v" so the walkthrough stays one-line-per-stage.
func compactFields(f map[string]any) string {
	if f == nil {
		return ""
	}
	keys := []string{"tool_name", "bytes", "bytes_in", "bytes_out", "resp_bytes", "input_tokens", "output_tokens", "usd_total", "duration_ms"}
	var out []string
	for _, k := range keys {
		if v, ok := f[k]; ok {
			out = append(out, fmt.Sprintf("%s=%v", k, v))
		}
	}
	return htmlEscape(strings.Join(out, " "))
}

func errorBlockHTML(msg string) string {
	if msg == "" {
		return ""
	}
	if len(msg) > 400 {
		msg = msg[:397] + "…"
	}
	return `<div class="errblock">` + htmlEscape(msg) + `</div>`
}

// renderHTMLv2 emits the interactive v2 report. Layout:
//  1. hero + sticky nav
//  2. "what is this?" intro for non-tech reviewers
//  3. executive summary headline
//  4. annotated architecture SVG
//  5. searchable tool-explorer fed by the catalog JSON
//  6. expandable prompt walkthroughs
//  7. privacy guardrails section
//  8. methodology + limitations (reused text)
// toolSequenceFromTrace extracts the ordered list of tool names dispatched by
// the LLM for one prompt, from the trace's tool_dispatch stages. Drives the
// "journey" display on each walkthrough card.
func toolSequenceFromTrace(stages []stage) []string {
	var names []string
	for _, s := range stages {
		if s.Stage != "tool_dispatch" {
			continue
		}
		if n, ok := s.Fields["tool"].(string); ok && n != "" {
			names = append(names, n)
			continue
		}
		if n, ok := s.Fields["name"].(string); ok && n != "" {
			names = append(names, n)
		}
	}
	return names
}

// finalAnswerFromTrace pulls a short preview of the model's final answer text
// from the trace if the runtime recorded one. Falls back to "" when not present.
func finalAnswerFromTrace(stages []stage) string {
	for i := len(stages) - 1; i >= 0; i-- {
		if stages[i].Stage != "llm_text_out" {
			continue
		}
		if p, ok := stages[i].Fields["preview"].(string); ok && p != "" {
			return p
		}
	}
	return ""
}

func renderHTMLv2(w io.Writer, suite string, junit *junitSuite, traces map[string]*promptTrace, catalog []catalogEntry, prompts map[string]suitePrompt) error {
	caseByName := make(map[string]*junitCase, len(junit.Cases))
	for i := range junit.Cases {
		caseByName[junit.Cases[i].Name] = &junit.Cases[i]
	}

	var passCount, failCount int
	for _, c := range junit.Cases {
		if c.Failure == nil {
			passCount++
		} else {
			failCount++
		}
	}
	total := len(junit.Cases)
	passPct := 0.0
	if total > 0 {
		passPct = 100 * float64(passCount) / float64(total)
	}
	headline := "red"
	if passPct >= 95 {
		headline = "green"
	} else if passPct > 0 {
		headline = "amber"
	}

	var totalUSD float64
	for _, t := range traces {
		totalUSD += t.USD
	}

	catJSON, err := json.Marshal(catalog)
	if err != nil {
		return fmt.Errorf("marshal catalog: %w", err)
	}

	// Head.
	fmt.Fprintf(w, `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Kubilitics Bench v2 — %s</title>
<style>%s</style></head><body>`, htmlEscape(suite), v2CSS)

	// Hero.
	fmt.Fprintf(w, `<header class="hero">
<h1>Kubilitics Privacy-First Validation Bench</h1>
<div class="meta">Suite: %s · Generated: %s</div>
</header>`, htmlEscape(suite), time.Now().UTC().Format("2006-01-02 15:04 UTC"))

	// Sticky nav.
	fmt.Fprint(w, `<nav class="toc">
<a href="#intro">What is this?</a>
<a href="#summary">Summary</a>
<a href="#architecture">Architecture</a>
<a href="#tool-explorer">Tools</a>
<a href="#walkthroughs">Walkthroughs</a>
<a href="#guardrails">Privacy</a>
<a href="#method">Methodology</a>
</nav>`)

	fmt.Fprint(w, `<main>`)

	// Non-tech intro.
	fmt.Fprint(w, `<section class="panel" id="intro">
<h2>What is this report?</h2>
<p class="lede">Kubilitics is an AI copilot for Kubernetes. This report is our honest, reproducible proof that the copilot works and — more importantly — that your cluster data never leaves your boundary.</p>
<p>Every prompt in this run hit a real cluster through a real backend and a real language model. For each prompt we recorded every hop: what the user typed, what the model saw, which tool was called, how many bytes travelled where, and the final answer. Green edges in the architecture diagram below mark the spots where we summarize or redact <em>before</em> anything is shown to the model.</p>
</section>`)

	// Executive summary.
	fmt.Fprintf(w, `<section class="panel" id="summary">
<h2>Executive summary</h2>
<div class="big %s">%d / %d passed (%.1f%%)</div>
<div class="sub">Traces captured: %d · LLM cost: $%.4f · Failures: %d</div>
</section>`, headline, passCount, total, passPct, len(traces), totalUSD, failCount)

	// Architecture.
	fmt.Fprintf(w, `<section class="panel" id="architecture">
<h2>Architecture at a glance</h2>
<div class="arch-wrap">%s</div>
<p class="sub">The model only ever sees tool schemas and summarized tool results. Raw Kubernetes responses (Secrets, env vars, managedFields, last-applied-configuration) stay between the backend and the cluster.</p>
</section>`, architectureSVG())

	// Tool explorer.
	fmt.Fprintf(w, `<section class="panel" id="tool-explorer">
<h2>Tool explorer</h2>
<p>All %d tools the copilot can call, searchable by name or plain-English description. Filter by category to explore what the copilot can do without writing code.</p>
<div class="tool-explorer-controls">
  <input id="tool-search" type="search" placeholder="Search tools by name or what they do…" autocomplete="off"/>
  <select id="tool-category" aria-label="Filter by category">
    <option value="">All categories</option>
  </select>
</div>
<div id="tool-explorer-count"></div>
<div id="tool-grid" class="tool-grid"></div>
</section>`, len(catalog))

	// Walkthroughs.
	fmt.Fprint(w, `<section class="panel" id="walkthroughs">
<h2>Prompt walkthroughs</h2>
<p>Each entry expands to the stage-by-stage trace of a single prompt: user bytes in, model tokens, tool dispatched, bytes returned, final text out. Click any row to open.</p>`)
	if len(traces) > total {
		fmt.Fprintf(w, `<div class="note">Bench captured %d traces but JUnit recorded %d cases — the extra %d were in-flight when the run ended and are flagged <strong class="badge-incomplete">INCOMPLETE</strong>.</div>`, len(traces), total, len(traces)-total)
	}
	ids := make([]string, 0, len(traces))
	for id := range traces {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		t := traces[id]
		badge := `<span class="badge-incomplete">INCOMPLETE</span>`
		errHTML := ""
		var judge *judgeScore
		if c, ok := caseByName[id]; ok {
			if c.Failure != nil {
				badge = `<span class="badge-fail">FAIL</span>`
				errHTML = errorBlockHTML(c.Failure.Message)
			} else {
				badge = `<span class="badge-pass">PASS</span>`
			}
			judge = parseJudgeFromSystemOut(c.SystemOut)
		}
		latMs := traceDurationMs(t)

		// Journey: question → tools-in-order → final answer preview.
		promptText := ""
		scenarioText := ""
		if p, ok := prompts[id]; ok {
			promptText = p.Text
			scenarioText = p.Scenario
		}
		tools := toolSequenceFromTrace(t.Stages)
		answer := finalAnswerFromTrace(t.Stages)

		questionHTML := ""
		if promptText != "" {
			questionHTML = fmt.Sprintf(`<div class="wt-question"><span class="wt-label">You asked</span><div class="wt-question-text">%s</div></div>`, htmlEscape(promptText))
		}
		scenarioHTML := ""
		if scenarioText != "" {
			scenarioHTML = fmt.Sprintf(`<div class="wt-scenario"><span class="wt-label">Real-world scenario</span><div class="wt-scenario-text">%s</div></div>`, htmlEscape(scenarioText))
		}
		journeyHTML := `<div class="wt-journey"><span class="wt-label">Kubilitics picked tools (in order)</span>`
		if len(tools) == 0 {
			journeyHTML += `<div class="wt-empty">— no tools dispatched —</div>`
		} else {
			journeyHTML += `<ol class="wt-tool-list">`
			for _, tn := range tools {
				journeyHTML += fmt.Sprintf(`<li><code>%s</code></li>`, htmlEscape(tn))
			}
			journeyHTML += `</ol>`
		}
		journeyHTML += `</div>`
		answerHTML := ""
		if answer != "" {
			answerHTML = fmt.Sprintf(`<div class="wt-answer"><span class="wt-label">Assistant answered</span><div class="wt-answer-text">%s</div></div>`, htmlEscape(answer))
		}

		judgeSummaryHTML := ""
		judgeCardHTML := ""
		if judge != nil {
			judgeSummaryHTML = fmt.Sprintf(` · judge <strong>%.1f</strong>`, judge.Mean())
			judgeCardHTML = fmt.Sprintf(`<div class="wt-judge"><span class="wt-label">LLM-as-judge</span>
<div class="wt-judge-row">
  <span class="wt-judge-metric">factual <strong>%d</strong>/5</span>
  <span class="wt-judge-metric">completeness <strong>%d</strong>/5</span>
  <span class="wt-judge-metric">clarity <strong>%d</strong>/5</span>
  <span class="wt-judge-metric">tool_use <strong>%d</strong>/5</span>
  <span class="wt-judge-metric">mean <strong>%.1f</strong></span>
</div>
<div class="wt-judge-critique">%s</div>
</div>`, judge.Factual, judge.Completeness, judge.Clarity, judge.ToolUse, judge.Mean(), htmlEscape(judge.Critique))
		}

		fmt.Fprintf(w, `<details class="walkthrough">
<summary><span class="wt-id">%s</span><span class="wt-stat">%s · %d ms · %d tools · $%.5f%s</span></summary>
<div class="wt-body">
%s
%s
%s
%s
%s
<details class="wt-raw"><summary>raw stage log</summary><ul class="stage-list">%s</ul></details>
%s
</div>
</details>`, htmlEscape(id), badge, latMs, len(tools), t.USD, judgeSummaryHTML,
			questionHTML, scenarioHTML, journeyHTML, answerHTML, judgeCardHTML,
			stagesPretty(t.Stages), errHTML)
	}
	fmt.Fprint(w, `</section>`)

	// Privacy guardrails.
	fmt.Fprint(w, `<section class="panel" id="guardrails">
<h2>Privacy guardrails</h2>
<div class="guardrails">
<strong>Seven automated guardrail tests gate every commit</strong> — <code>internal/mcp/server/privacy_test.go</code>. Scenarios covered: Secret.data plaintext, Secret.data base64, ConfigMap.data, Pod env <code>DB_PASSWORD</code>, <code>last-applied-configuration</code> annotation, <code>managedFields</code>, ServiceAccount token refs. Plus one positive case: benign node.status.nodeInfo.kubeletVersion must pass through.
</div>
</section>`)

	// Methodology (reused wording from v1).
	fmt.Fprint(w, `<section class="panel" id="method">
<h2>Methodology &amp; honest limitations</h2>
<p>Real Kubernetes cluster (docker-desktop, 3 nodes, 49 pods, 7 namespaces). Real Kubilitics backend. Real brain process. Real LLM via Ollama on an AWS g4dn.xlarge GPU VM (or OpenAI / Claude for spot validation). No canned answers.</p>
<p><strong>Pass criteria (strict):</strong> the assistant produced natural-language text <em>and</em> called at least one tool when <code>expect_tool</code> was true. A turn that calls the right tool but fails to summarize back into natural language is marked FAIL.</p>
<ul>
<li><code>kagent</code> engine is a registered skeleton — not in the hot path for this bench.</li>
<li>Destructive tools (delete, patch, scale) are not exercised; bench is read-only.</li>
<li>When the recorder does not emit an explicit <code>done</code> stage, latency is derived from trace timestamp deltas.</li>
</ul>
</section>`)

	fmt.Fprint(w, `</main><footer>Kubilitics Privacy-First Bench — generated by <code>cmd/bench-report --v2</code></footer>`)

	// Inject catalog + app.js. json.Marshal already escapes < and > when safe,
	// but to be extra defensive against </script> sequences inside string
	// fields we manually escape "</" -> "<\\/".
	safeJSON := strings.ReplaceAll(string(catJSON), "</", `<\/`)
	fmt.Fprintf(w, `<script>window.__CATALOG__ = %s;</script>`, safeJSON)
	fmt.Fprintf(w, `<script>%s</script>`, v2JS)
	fmt.Fprint(w, `</body></html>`)
	return nil
}
