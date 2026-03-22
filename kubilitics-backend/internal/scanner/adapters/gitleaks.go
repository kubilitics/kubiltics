package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"

	"github.com/kubilitics/kubilitics-backend/internal/scanner"
)

// GitleaksAdapter wraps the Gitleaks CLI for secrets detection.
type GitleaksAdapter struct {
	binary string
}

func NewGitleaksAdapter() *GitleaksAdapter {
	return &GitleaksAdapter{binary: "gitleaks"}
}

func (g *GitleaksAdapter) Name() string { return "gitleaks" }

func (g *GitleaksAdapter) Available() bool {
	_, err := exec.LookPath(g.binary)
	return err == nil
}

type gitleaksFinding struct {
	RuleID      string `json:"RuleID"`
	Description string `json:"Description"`
	File        string `json:"File"`
	StartLine   int    `json:"StartLine"`
	EndLine     int    `json:"EndLine"`
	Match       string `json:"Match"`
	Secret      string `json:"Secret"`
	Commit      string `json:"Commit"`
	Author      string `json:"Author"`
	Date        string `json:"Date"`
	Fingerprint string `json:"Fingerprint"`
}

func (g *GitleaksAdapter) Scan(ctx context.Context, target scanner.ScanTarget) (*scanner.ScanResult, error) {
	args := []string{
		"detect",
		"--source", target.Path,
		"--report-format", "json",
		"--report-path", "/dev/stdout",
		"--no-git",
		"--exit-code", "0",
	}
	cmd := exec.CommandContext(ctx, g.binary, args...)
	out, err := cmd.Output()
	if err != nil {
		if len(out) == 0 {
			return nil, fmt.Errorf("gitleaks execution failed: %w", err)
		}
	}

	// Gitleaks outputs an array directly
	var results []gitleaksFinding
	if len(out) > 0 {
		if err := json.Unmarshal(out, &results); err != nil {
			// Empty output or "[]" is valid
			if string(out) != "null" && string(out) != "" {
				return nil, fmt.Errorf("gitleaks parse output: %w", err)
			}
		}
	}

	findings := g.mapFindings(results)
	return &scanner.ScanResult{
		Tool:     "gitleaks",
		Findings: findings,
	}, nil
}

func (g *GitleaksAdapter) mapFindings(results []gitleaksFinding) []scanner.Finding {
	findings := make([]scanner.Finding, 0, len(results))

	for _, r := range results {
		findings = append(findings, scanner.Finding{
			Tool:        "gitleaks",
			RuleID:      r.RuleID,
			Severity:    scanner.SeverityHigh,
			Title:       fmt.Sprintf("Secret detected: %s", r.Description),
			Description: fmt.Sprintf("Potential %s found in source code", r.Description),
			File:        r.File,
			StartLine:   r.StartLine,
			EndLine:     r.EndLine,
			Remediation: "Remove the secret from source code and rotate the credential immediately.",
			Metadata: map[string]string{
				"fingerprint": r.Fingerprint,
			},
		})
	}

	return findings
}
