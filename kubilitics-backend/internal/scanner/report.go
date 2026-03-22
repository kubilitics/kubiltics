package scanner

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"sort"
	"strings"
	"time"
)

// Report holds a complete scan report.
type Report struct {
	RunID       string        `json:"run_id"`
	Status      string        `json:"status"`
	Target      ScanTarget    `json:"target"`
	Findings    []Finding     `json:"findings"`
	Results     []ScanResult  `json:"results"`
	Summary     ReportSummary `json:"summary"`
	GeneratedAt time.Time     `json:"generated_at"`
}

// ReportSummary contains aggregate counts.
type ReportSummary struct {
	TotalFindings int            `json:"total_findings"`
	BySeverity    map[string]int `json:"by_severity"`
	ByTool        map[string]int `json:"by_tool"`
}

// BuildSummary computes the summary from findings.
func (r *Report) BuildSummary() {
	r.Summary = ReportSummary{
		TotalFindings: len(r.Findings),
		BySeverity:    make(map[string]int),
		ByTool:        make(map[string]int),
	}
	for _, f := range r.Findings {
		r.Summary.BySeverity[string(f.Severity)]++
		r.Summary.ByTool[f.Tool]++
	}
}

// GenerateJSON returns the report as indented JSON.
func (r *Report) GenerateJSON() ([]byte, error) {
	return json.MarshalIndent(r, "", "  ")
}

// GenerateMarkdown returns the report as GitHub-flavored Markdown.
func (r *Report) GenerateMarkdown() ([]byte, error) {
	r.BuildSummary()

	sort.Slice(r.Findings, func(i, j int) bool {
		return SeverityRank(r.Findings[i].Severity) < SeverityRank(r.Findings[j].Severity)
	})

	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf("# Security Scan Report\n\n"))
	buf.WriteString(fmt.Sprintf("**Run ID:** %s  \n", r.RunID))
	buf.WriteString(fmt.Sprintf("**Target:** %s (`%s`)  \n", r.Target.Type, r.Target.Path))
	buf.WriteString(fmt.Sprintf("**Generated:** %s  \n", r.GeneratedAt.Format(time.RFC3339)))
	buf.WriteString(fmt.Sprintf("**Total Findings:** %d\n\n", r.Summary.TotalFindings))

	buf.WriteString("## Summary\n\n")
	buf.WriteString("| Severity | Count |\n|----------|-------|\n")
	for _, sev := range []string{"CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"} {
		if count, ok := r.Summary.BySeverity[sev]; ok {
			emoji := severityEmoji(sev)
			buf.WriteString(fmt.Sprintf("| %s %s | %d |\n", emoji, sev, count))
		}
	}

	buf.WriteString("\n| Tool | Findings |\n|------|----------|\n")
	for tool, count := range r.Summary.ByTool {
		buf.WriteString(fmt.Sprintf("| %s | %d |\n", tool, count))
	}

	buf.WriteString("\n## Findings\n\n")
	for i, f := range r.Findings {
		emoji := severityEmoji(string(f.Severity))
		buf.WriteString(fmt.Sprintf("### %d. %s %s — %s\n\n", i+1, emoji, f.Severity, f.Title))
		buf.WriteString(fmt.Sprintf("- **Tool:** %s\n", f.Tool))
		buf.WriteString(fmt.Sprintf("- **Rule:** %s\n", f.RuleID))
		if f.File != "" {
			location := f.File
			if f.StartLine > 0 {
				location = fmt.Sprintf("%s:%d", f.File, f.StartLine)
			}
			buf.WriteString(fmt.Sprintf("- **Location:** `%s`\n", location))
		}
		if f.Description != "" {
			buf.WriteString(fmt.Sprintf("- **Description:** %s\n", f.Description))
		}
		if f.Remediation != "" {
			buf.WriteString(fmt.Sprintf("- **Remediation:** %s\n", f.Remediation))
		}
		if len(f.CVE) > 0 {
			buf.WriteString(fmt.Sprintf("- **CVE:** %s\n", strings.Join(f.CVE, ", ")))
		}
		if len(f.CWE) > 0 {
			buf.WriteString(fmt.Sprintf("- **CWE:** %s\n", strings.Join(f.CWE, ", ")))
		}
		buf.WriteString("\n")
	}

	return buf.Bytes(), nil
}

func severityEmoji(s string) string {
	switch s {
	case "CRITICAL":
		return "\U0001F534" // red circle
	case "HIGH":
		return "\U0001F7E0" // orange circle
	case "MEDIUM":
		return "\U0001F7E1" // yellow circle
	case "LOW":
		return "\U0001F535" // blue circle
	case "INFO":
		return "\u26AA" // white circle
	default:
		return "\u2B55"
	}
}

var htmlTemplate = template.Must(template.New("report").Funcs(template.FuncMap{
	"lower": strings.ToLower,
	"sevClass": func(s Severity) string {
		switch s {
		case SeverityCritical:
			return "critical"
		case SeverityHigh:
			return "high"
		case SeverityMedium:
			return "medium"
		case SeverityLow:
			return "low"
		default:
			return "info"
		}
	},
	"location": func(f Finding) string {
		if f.File == "" {
			return "-"
		}
		if f.StartLine > 0 {
			return fmt.Sprintf("%s:%d", f.File, f.StartLine)
		}
		return f.File
	},
}).Parse(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Security Scan Report — {{.RunID}}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;padding:2rem}
.container{max-width:1200px;margin:0 auto}
h1{font-size:1.75rem;margin-bottom:.5rem;color:#f8fafc}
.meta{color:#94a3b8;margin-bottom:2rem;font-size:.875rem}
.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:2rem}
.stat-card{background:#1e293b;border-radius:.75rem;padding:1.25rem;text-align:center;border:1px solid #334155}
.stat-card .count{font-size:2rem;font-weight:700}
.stat-card .label{font-size:.75rem;text-transform:uppercase;color:#94a3b8;margin-top:.25rem;letter-spacing:.05em}
.critical .count{color:#ef4444}
.high .count{color:#f97316}
.medium .count{color:#eab308}
.low .count{color:#3b82f6}
.info .count{color:#6b7280}
table{width:100%;border-collapse:collapse;background:#1e293b;border-radius:.75rem;overflow:hidden;border:1px solid #334155}
th{background:#0f172a;text-align:left;padding:.75rem 1rem;font-size:.75rem;text-transform:uppercase;color:#94a3b8;letter-spacing:.05em}
td{padding:.75rem 1rem;border-top:1px solid #334155;font-size:.875rem}
tr:hover td{background:#334155}
.badge{display:inline-block;padding:.125rem .5rem;border-radius:9999px;font-size:.75rem;font-weight:600}
.badge.critical{background:#7f1d1d;color:#fca5a5}
.badge.high{background:#7c2d12;color:#fdba74}
.badge.medium{background:#713f12;color:#fde047}
.badge.low{background:#1e3a5f;color:#93c5fd}
.badge.info{background:#374151;color:#9ca3af}
.file{font-family:monospace;font-size:.8rem;color:#94a3b8}
</style>
</head>
<body>
<div class="container">
<h1>Security Scan Report</h1>
<div class="meta">
Run: {{.RunID}} &bull; Target: {{.Target.Type}} — {{.Target.Path}} &bull; Generated: {{.GeneratedAt.Format "2006-01-02 15:04:05 UTC"}}
</div>
<div class="summary-grid">
{{range $sev, $count := .Summary.BySeverity}}
<div class="stat-card {{$sev | lower}}"><div class="count">{{$count}}</div><div class="label">{{$sev}}</div></div>
{{end}}
<div class="stat-card"><div class="count">{{.Summary.TotalFindings}}</div><div class="label">Total</div></div>
</div>
<table>
<thead><tr><th>Severity</th><th>Tool</th><th>Title</th><th>Location</th><th>Rule</th></tr></thead>
<tbody>
{{range .Findings}}
<tr>
<td><span class="badge {{sevClass .Severity}}">{{.Severity}}</span></td>
<td>{{.Tool}}</td>
<td>{{.Title}}</td>
<td class="file">{{location .}}</td>
<td>{{.RuleID}}</td>
</tr>
{{end}}
</tbody>
</table>
</div>
</body>
</html>`))

// GenerateHTML returns a self-contained HTML report.
func (r *Report) GenerateHTML() ([]byte, error) {
	r.BuildSummary()

	sort.Slice(r.Findings, func(i, j int) bool {
		return SeverityRank(r.Findings[i].Severity) < SeverityRank(r.Findings[j].Severity)
	})

	var buf bytes.Buffer
	if err := htmlTemplate.Execute(&buf, r); err != nil {
		return nil, fmt.Errorf("render html report: %w", err)
	}
	return buf.Bytes(), nil
}
