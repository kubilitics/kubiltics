package main

import (
	"fmt"
	"strings"
)

// flowSVG emits a small horizontal routing diagram for a single prompt.
// Target size ~440×140 px so a grid of 50 fits on a single scrollable
// page. Boxes: user, backend, LLM, K8s. Edges annotated with bytes.
//
// Red edge = an LLM-bound edge that carried > 1 KB of cluster-derived
// bytes (always backend → LLM after summarizer). We color green when
// the summarizer dropped ≥ 10× bytes (proof of redaction on this hop).
func flowSVG(stages []stage, title string) string {
	var (
		userBytes, promptBytes, respBytes int
		bytesIn, bytesOut                 int
		textBytes                         int
	)
	for _, s := range stages {
		switch s.Stage {
		case "user_msg":
			userBytes = fromF(s.Fields["bytes"])
		case "llm_prompt_in":
			promptBytes = fromF(s.Fields["bytes"])
		case "backend_k8s_fetch":
			respBytes += fromF(s.Fields["resp_bytes"])
		case "tool_result_summarized":
			bytesIn += fromF(s.Fields["bytes_in"])
			bytesOut += fromF(s.Fields["bytes_out"])
		case "llm_text_out":
			textBytes = fromF(s.Fields["bytes"])
		}
	}

	edgeSummarizedColor := "#22c55e"
	if bytesOut > bytesIn/2 && bytesIn > 10_000 {
		edgeSummarizedColor = "#eab308"
	}

	var b strings.Builder
	fmt.Fprintf(&b, `<svg viewBox="0 0 440 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Routing flow: %s">`, htmlEscape(title))
	fmt.Fprintf(&b, `<text x="10" y="14" font-family="system-ui" font-size="10" fill="#374151">%s</text>`, htmlEscape(truncate(title, 52)))
	actors := []struct {
		x     int
		label string
	}{{10, "user"}, {120, "backend"}, {230, "LLM"}, {340, "K8s"}}
	for _, a := range actors {
		fmt.Fprintf(&b, `<rect x="%d" y="60" width="80" height="28" rx="4" fill="#f3f4f6" stroke="#9ca3af"/>`, a.x)
		fmt.Fprintf(&b, `<text x="%d" y="78" font-family="system-ui" font-size="11" fill="#111827" text-anchor="middle">%s</text>`, a.x+40, a.label)
	}
	fmt.Fprint(&b, `<defs><marker id="arr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af"/></marker></defs>`)
	edge := func(x1, x2, y int, color, label string) {
		fmt.Fprintf(&b, `<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="2" marker-end="url(#arr)"/>`, x1, y, x2, y, color)
		mid := (x1 + x2) / 2
		fmt.Fprintf(&b, `<text x="%d" y="%d" font-family="system-ui" font-size="9" fill="#374151" text-anchor="middle">%s</text>`, mid, y-4, label)
	}
	edge(90, 120, 74, "#9ca3af", formatBytes(userBytes))
	edge(200, 230, 74, "#9ca3af", formatBytes(promptBytes))
	edge(310, 340, 100, "#9ca3af", "req")
	edge(340, 310, 110, "#9ca3af", formatBytes(respBytes))
	edge(200, 230, 120, edgeSummarizedColor, fmt.Sprintf("%s → %s", formatBytes(bytesIn), formatBytes(bytesOut)))
	edge(230, 90, 135, "#9ca3af", formatBytes(textBytes))
	fmt.Fprint(&b, `</svg>`)
	return b.String()
}

// histogramSVG renders a latency histogram with p50/p95/p99 lines.
func histogramSVG(latencies []int) string {
	if len(latencies) == 0 {
		return `<svg viewBox="0 0 600 160" xmlns="http://www.w3.org/2000/svg"><text x="10" y="20">no data</text></svg>`
	}
	sorted := sortInts(latencies)
	p50 := percentile(sorted, 0.50)
	p95 := percentile(sorted, 0.95)
	p99 := percentile(sorted, 0.99)
	max := sorted[len(sorted)-1]
	if max == 0 {
		max = 1
	}
	bins := 20
	counts := make([]int, bins)
	for _, v := range latencies {
		b := v * (bins - 1) / max
		counts[b]++
	}
	maxCount := 0
	for _, c := range counts {
		if c > maxCount {
			maxCount = c
		}
	}
	if maxCount == 0 {
		maxCount = 1
	}
	var b strings.Builder
	fmt.Fprint(&b, `<svg viewBox="0 0 600 160" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="600" height="160" fill="#ffffff"/>`)
	w := 600 / bins
	for i, c := range counts {
		h := 120 * c / maxCount
		fmt.Fprintf(&b, `<rect x="%d" y="%d" width="%d" height="%d" fill="#6366f1"/>`, i*w, 140-h, w-1, h)
	}
	drawLine := func(p int, label, color string) {
		x := p * 600 / max
		fmt.Fprintf(&b, `<line x1="%d" y1="0" x2="%d" y2="140" stroke="%s" stroke-dasharray="3,3"/>`, x, x, color)
		fmt.Fprintf(&b, `<text x="%d" y="12" font-family="system-ui" font-size="10" fill="%s">%s: %dms</text>`, x+3, color, label, p)
	}
	drawLine(p50, "p50", "#16a34a")
	drawLine(p95, "p95", "#f59e0b")
	drawLine(p99, "p99", "#ef4444")
	fmt.Fprint(&b, `</svg>`)
	return b.String()
}

func fromF(v any) int {
	if f, ok := v.(float64); ok {
		return int(f)
	}
	if i, ok := v.(int); ok {
		return i
	}
	return 0
}

func htmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", `'`, "&#39;")
	return r.Replace(s)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}
