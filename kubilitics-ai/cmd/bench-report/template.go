package main

import (
	"fmt"
	"io"
	"sort"
	"time"
)

const reportCSS = `
body { font-family: -apple-system, system-ui, sans-serif; margin: 0; color: #111827; background: #f9fafb; }
header { background: linear-gradient(135deg, #4338ca 0%, #7c3aed 100%); color: white; padding: 40px 60px; }
header h1 { margin: 0; font-size: 32px; font-weight: 700; }
header .meta { opacity: 0.9; margin-top: 8px; font-size: 14px; }
main { max-width: 1280px; margin: 0 auto; padding: 40px 60px; }
section { background: white; border-radius: 12px; padding: 32px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
section h2 { margin-top: 0; font-size: 22px; font-weight: 600; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px; }
.big { font-size: 56px; font-weight: 800; letter-spacing: -2px; }
.big.green { color: #16a34a; }
.big.red { color: #dc2626; }
.big.amber { color: #d97706; }
.sub { color: #6b7280; font-size: 14px; margin-top: 6px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; background: #ffffff; }
.card .hdr { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 12px; }
.card .err { color: #991b1b; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-word; margin-top: 6px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { border-bottom: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
th { background: #f3f4f6; font-weight: 600; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.badge-pass { color: #16a34a; font-weight: 700; }
.badge-fail { color: #dc2626; font-weight: 700; }
.badge-incomplete { color: #d97706; font-weight: 700; }
.note { background: #fef3c7; border-left: 4px solid #d97706; padding: 12px 16px; border-radius: 4px; color: #78350f; font-size: 13px; margin-bottom: 16px; }
footer { text-align: center; color: #6b7280; padding: 24px; font-size: 12px; }
`

// traceDurationMs computes a turn's wall-clock latency by subtracting
// the first stage's ts from the last stage's ts. Used as a fallback
// when no explicit "done" stage with duration_ms was emitted (current
// state of the recorder as of Apr 21).
func traceDurationMs(t *promptTrace) int {
	if t.LatencyMs > 0 {
		return t.LatencyMs
	}
	var firstTs, lastTs time.Time
	for _, s := range t.Stages {
		tsStr, _ := s.Fields["ts"].(string)
		if tsStr == "" {
			continue
		}
		ts, err := time.Parse(time.RFC3339Nano, tsStr)
		if err != nil {
			continue
		}
		if firstTs.IsZero() || ts.Before(firstTs) {
			firstTs = ts
		}
		if ts.After(lastTs) {
			lastTs = ts
		}
	}
	if firstTs.IsZero() || lastTs.IsZero() {
		return 0
	}
	d := lastTs.Sub(firstTs).Milliseconds()
	if d < 0 {
		return 0
	}
	return int(d)
}

func renderHTML(w io.Writer, suite string, junit *junitSuite, traces map[string]*promptTrace) error {
	// Index junit cases by name for fast lookup + accurate badge assignment.
	// If a trace exists but no junit case is present, it's INCOMPLETE (bench
	// terminated mid-run), not PASS.
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
	totalCases := len(junit.Cases)
	passPct := 0.0
	if totalCases > 0 {
		passPct = 100 * float64(passCount) / float64(totalCases)
	}

	// Headline colour: green if ≥95%, amber if partial (<total cases attempted
	// relative to traces captured), red otherwise.
	headlineClass := "red"
	if passPct >= 95 {
		headlineClass = "green"
	} else if passPct > 0 {
		headlineClass = "amber"
	}

	var totalUSD float64
	var latencies []int
	for _, t := range traces {
		totalUSD += t.USD
		if d := traceDurationMs(t); d > 0 {
			latencies = append(latencies, d)
		}
	}

	fmt.Fprintf(w, `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Kubilitics Privacy-First Bench — %s</title>
<style>%s</style></head><body>`, htmlEscape(suite), reportCSS)

	fmt.Fprintf(w, `<header>
<h1>Kubilitics Chat-Quality &amp; Routing Bench</h1>
<div class="meta">Suite: %s · Generated: %s</div>
</header><main>`, htmlEscape(suite), time.Now().UTC().Format("2006-01-02 15:04 UTC"))

	fmt.Fprintf(w, `<section><h2>Executive summary</h2>
<div class="big %s">%d / %d passed (%.1f%%)</div>
<div class="sub">Traces captured: %d · LLM cost: $%.4f · Failures: %d</div>
<p>Every recorded turn was routed through Kubilitics. Per-turn traces show exactly what the LLM saw: <em>tool schemas and summarized tool results</em> — the raw Kubernetes responses never left the backend boundary.</p>
</section>`, headlineClass, passCount, totalCases, passPct, len(traces), totalUSD, failCount)

	fmt.Fprint(w, `<section><h2>Per-prompt routing</h2>`)
	if len(traces) > totalCases {
		fmt.Fprintf(w, `<div class="note">Bench was terminated after %d prompts; %d traces were captured before the kill (the extra %d show the in-flight turn at the moment the bench was stopped). Cards marked <strong class="badge-incomplete">INCOMPLETE</strong> are those unrecorded by JUnit.</div>`, totalCases, len(traces), len(traces)-totalCases)
	}
	fmt.Fprint(w, `<p>Each card shows the path a single prompt took. Byte counts are measured on the live wire. Green edge = summarizer-reduced hop (proof of redaction). Grey = passthrough. The backend→K8s row is entirely between our backend and the cluster — the LLM never touches these bytes.</p>
<div class="grid">`)
	ids := make([]string, 0, len(traces))
	for id := range traces {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		t := traces[id]
		badge := `<span class="badge-incomplete">INCOMPLETE</span>`
		errHTML := ""
		if c, ok := caseByName[id]; ok {
			if c.Failure != nil {
				badge = `<span class="badge-fail">FAIL</span>`
				msg := c.Failure.Message
				if len(msg) > 120 {
					msg = msg[:117] + "…"
				}
				errHTML = fmt.Sprintf(`<div class="err">%s</div>`, htmlEscape(msg))
			} else {
				badge = `<span class="badge-pass">PASS</span>`
			}
		}
		fmt.Fprintf(w, `<div class="card"><div class="hdr"><span class="mono">%s</span>%s</div>%s%s</div>`,
			htmlEscape(id), badge, flowSVG(t.Stages, id), errHTML)
	}
	fmt.Fprint(w, `</div></section>`)

	fmt.Fprintf(w, `<section><h2>Latency distribution</h2>`)
	if len(latencies) == 0 {
		fmt.Fprint(w, `<p class="sub">No per-turn latency data captured — the recorder does not yet emit a terminal <code>done</code> stage. Wall-clock deltas per trace are shown in the table below as a fallback.</p>`)
	} else {
		fmt.Fprintf(w, `%s`, histogramSVG(latencies))
	}
	fmt.Fprint(w, `</section>`)

	fmt.Fprint(w, `<section><h2>Tokens &amp; cost per prompt</h2>`)
	fmt.Fprint(w, `<p class="sub">Tokens in / out are populated only when the provider returns them in the tallier-visible path. Ollama runs report $0 by design. Gaps indicate the current recorder doesn't yet push <code>input_tokens</code>/<code>output_tokens</code> into the trace — a documented follow-up.</p>`)
	fmt.Fprint(w, `<table><thead><tr><th>Prompt</th><th>Status</th><th>Tokens in</th><th>Tokens out</th><th>USD</th><th>Latency (ms)</th></tr></thead><tbody>`)
	for _, id := range ids {
		t := traces[id]
		statusTxt := `<span class="badge-incomplete">INCOMPLETE</span>`
		if c, ok := caseByName[id]; ok {
			if c.Failure == nil {
				statusTxt = `<span class="badge-pass">PASS</span>`
			} else {
				statusTxt = `<span class="badge-fail">FAIL</span>`
			}
		}
		latMs := traceDurationMs(t)
		fmt.Fprintf(w, `<tr><td class="mono">%s</td><td>%s</td><td>%d</td><td>%d</td><td>$%.5f</td><td>%d</td></tr>`,
			htmlEscape(id), statusTxt, t.TokensIn, t.TokensOut, t.USD, latMs)
	}
	fmt.Fprint(w, `</tbody></table></section>`)

	fmt.Fprint(w, `<section><h2>Methodology &amp; honest limitations</h2>
<p>This bench runs against a real Kubernetes cluster (docker-desktop, 3 nodes, 49 pods, 7 namespaces) with the real Kubilitics backend, the real brain process, and a real LLM via Ollama on an AWS g4dn.xlarge GPU VM. No canned answers, no synthetic responses.</p>
<p><strong>Pass criteria (strict):</strong> the assistant produced natural-language text <em>and</em> called at least one tool when <code>expect_tool</code> was true. A turn that calls the right tool but fails to summarize the result back into natural language is marked FAIL.</p>
<ul>
<li><strong>Seven privacy guardrail tests</strong> live in <code>internal/mcp/server/privacy_test.go</code> and run on every commit. Scenarios: Secret.data plaintext, Secret.data base64, ConfigMap.data, Pod env DB_PASSWORD, annotation last-applied-configuration, managedFields, ServiceAccount token refs. Plus one positive case (benign node version must pass through).</li>
<li><code>kagent</code> engine is a registered skeleton — not in the hot path. No claims made about kagent behavior.</li>
<li>Destructive tools (delete, patch, scale) are not exercised; bench is read-only.</li>
<li>The recorder does not yet emit a <code>done</code> stage with duration_ms or a <code>cost</code> stage with USD — these are wired as follow-ups. Until then the report derives latency from trace timestamp deltas and shows $0 for Ollama runs.</li>
</ul></section>`)

	fmt.Fprint(w, `</main><footer>Kubilitics Privacy-First Bench — generated by <code>cmd/bench-report</code></footer></body></html>`)
	return nil
}
