package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/scanner"
)

// SemgrepAdapter wraps the Semgrep CLI for SAST scanning.
type SemgrepAdapter struct {
	binary string
}

func NewSemgrepAdapter() *SemgrepAdapter {
	return &SemgrepAdapter{binary: "semgrep"}
}

func (s *SemgrepAdapter) Name() string { return "semgrep" }

func (s *SemgrepAdapter) Available() bool {
	_, err := exec.LookPath(s.binary)
	return err == nil
}

type semgrepOutput struct {
	Results []semgrepResult `json:"results"`
	Errors  []semgrepError  `json:"errors"`
}

type semgrepResult struct {
	CheckID string        `json:"check_id"`
	Path    string        `json:"path"`
	Start   semgrepPos    `json:"start"`
	End     semgrepPos    `json:"end"`
	Extra   semgrepExtra  `json:"extra"`
}

type semgrepPos struct {
	Line int `json:"line"`
	Col  int `json:"col"`
}

type semgrepExtra struct {
	Message  string          `json:"message"`
	Severity string          `json:"severity"`
	Metadata semgrepMetadata `json:"metadata"`
	Lines    string          `json:"lines"`
}

type semgrepMetadata struct {
	CWE        interface{} `json:"cwe"`        // can be string or []string
	Confidence string      `json:"confidence"`
	Impact     string      `json:"impact"`
	Category   string      `json:"category"`
	Technology []string    `json:"technology"`
	References []string    `json:"references"`
}

type semgrepError struct {
	Message string `json:"message"`
	Level   string `json:"level"`
}

func (s *SemgrepAdapter) Scan(ctx context.Context, target scanner.ScanTarget) (*scanner.ScanResult, error) {
	args := []string{"scan", "--json", "--config", "auto", "--quiet", target.Path}
	cmd := exec.CommandContext(ctx, "semgrep", args...) //nolint:gosec // binary is hardcoded
	out, err := cmd.Output()
	if err != nil {
		// Semgrep exits non-zero when findings exist
		if len(out) == 0 {
			return nil, fmt.Errorf("semgrep execution failed: %w", err)
		}
	}

	var output semgrepOutput
	if err := json.Unmarshal(out, &output); err != nil {
		return nil, fmt.Errorf("semgrep parse output: %w", err)
	}

	findings := s.mapFindings(output)
	return &scanner.ScanResult{
		Tool:     "semgrep",
		Findings: findings,
	}, nil
}

func (s *SemgrepAdapter) mapFindings(output semgrepOutput) []scanner.Finding {
	var findings []scanner.Finding

	for _, r := range output.Results {
		cweList := parseCWE(r.Extra.Metadata.CWE)
		findings = append(findings, scanner.Finding{
			Tool:        "semgrep",
			RuleID:      r.CheckID,
			Severity:    mapSemgrepSeverity(r.Extra.Severity),
			Title:       r.Extra.Message,
			Description: r.Extra.Message,
			File:        r.Path,
			StartLine:   r.Start.Line,
			EndLine:     r.End.Line,
			CWE:         cweList,
			Confidence:  r.Extra.Metadata.Confidence,
			Metadata: map[string]string{
				"category": r.Extra.Metadata.Category,
			},
		})
	}

	return findings
}

func mapSemgrepSeverity(s string) scanner.Severity {
	switch strings.ToUpper(s) {
	case "ERROR":
		return scanner.SeverityHigh
	case "WARNING":
		return scanner.SeverityMedium
	case "INFO":
		return scanner.SeverityLow
	default:
		return scanner.SeverityInfo
	}
}

func parseCWE(raw interface{}) []string {
	if raw == nil {
		return nil
	}
	switch v := raw.(type) {
	case string:
		if v != "" {
			return []string{v}
		}
	case []interface{}:
		var result []string
		for _, item := range v {
			if s, ok := item.(string); ok {
				result = append(result, s)
			}
		}
		return result
	}
	return nil
}
