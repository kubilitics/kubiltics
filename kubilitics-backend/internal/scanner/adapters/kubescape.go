package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/kubilitics/kubilitics-backend/internal/scanner"
)

// KubescapeAdapter wraps the Kubescape CLI for Kubernetes security scanning.
// Uses SARIF output format for stable, well-documented parsing.
type KubescapeAdapter struct {
	binary string
}

func NewKubescapeAdapter() *KubescapeAdapter {
	return &KubescapeAdapter{binary: "kubescape"}
}

func (k *KubescapeAdapter) Name() string { return "kubescape" }

func (k *KubescapeAdapter) Available() bool {
	_, err := exec.LookPath(k.binary)
	return err == nil
}

// SARIF structures (subset needed for parsing Kubescape output).
type sarifReport struct {
	Runs []sarifRun `json:"runs"`
}

type sarifRun struct {
	Tool    sarifTool     `json:"tool"`
	Results []sarifResult `json:"results"`
}

type sarifTool struct {
	Driver sarifDriver `json:"driver"`
}

type sarifDriver struct {
	Rules []sarifRule `json:"rules"`
}

type sarifRule struct {
	ID               string         `json:"id"`
	Name             string         `json:"name"`
	ShortDescription sarifMessage   `json:"shortDescription"`
	FullDescription  sarifMessage   `json:"fullDescription"`
	Help             sarifMessage   `json:"help"`
	Properties       sarifRuleProps `json:"properties"`
}

type sarifMessage struct {
	Text string `json:"text"`
}

type sarifRuleProps struct {
	SecuritySeverity string `json:"security-severity"`
}

type sarifResult struct {
	RuleID    string           `json:"ruleId"`
	RuleIndex int              `json:"ruleIndex"`
	Level     string           `json:"level"`
	Message   sarifMessage     `json:"message"`
	Locations []sarifLocation  `json:"locations"`
}

type sarifLocation struct {
	PhysicalLocation sarifPhysicalLocation `json:"physicalLocation"`
}

type sarifPhysicalLocation struct {
	ArtifactLocation sarifArtifact `json:"artifactLocation"`
	Region           sarifRegion   `json:"region"`
}

type sarifArtifact struct {
	URI string `json:"uri"`
}

type sarifRegion struct {
	StartLine   int `json:"startLine"`
	StartColumn int `json:"startColumn"`
	EndLine     int `json:"endLine"`
	EndColumn   int `json:"endColumn"`
}

func (k *KubescapeAdapter) Scan(ctx context.Context, target scanner.ScanTarget) (*scanner.ScanResult, error) {
	// Write SARIF output to a temp file (kubescape requires a file path for --output)
	tmpDir, err := os.MkdirTemp("", "kubescape-*")
	if err != nil {
		return nil, fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)
	outputFile := filepath.Join(tmpDir, "results.sarif")

	var args []string
	if target.Type == scanner.TargetHelmChart {
		args = []string{"scan", "framework", "nsa,mitre", target.Path, "--format", "sarif", "--output", outputFile}
	} else {
		args = []string{"scan", target.Path, "--format", "sarif", "--output", outputFile}
	}

	cmd := exec.CommandContext(ctx, k.binary, args...)
	// Kubescape exits non-zero when findings exist; ignore exit code if output file was produced
	cmd.Run()

	out, err := os.ReadFile(outputFile)
	if err != nil {
		return nil, fmt.Errorf("kubescape produced no output: %w", err)
	}

	var report sarifReport
	if err := json.Unmarshal(out, &report); err != nil {
		return nil, fmt.Errorf("kubescape parse sarif: %w", err)
	}

	findings := k.mapSARIF(report)
	return &scanner.ScanResult{
		Tool:     "kubescape",
		Findings: findings,
	}, nil
}

func (k *KubescapeAdapter) mapSARIF(report sarifReport) []scanner.Finding {
	var findings []scanner.Finding

	for _, run := range report.Runs {
		// Build rule lookup
		ruleMap := make(map[string]sarifRule, len(run.Tool.Driver.Rules))
		for _, rule := range run.Tool.Driver.Rules {
			ruleMap[rule.ID] = rule
		}

		for _, result := range run.Results {
			if result.Level == "none" || result.Level == "note" {
				continue
			}

			rule := ruleMap[result.RuleID]
			title := result.Message.Text
			if title == "" {
				title = rule.ShortDescription.Text
			}

			var file string
			var startLine, endLine int
			if len(result.Locations) > 0 {
				loc := result.Locations[0]
				file = loc.PhysicalLocation.ArtifactLocation.URI
				startLine = loc.PhysicalLocation.Region.StartLine
				endLine = loc.PhysicalLocation.Region.EndLine
			}

			findings = append(findings, scanner.Finding{
				Tool:        "kubescape",
				RuleID:      result.RuleID,
				Severity:    mapSARIFLevel(result.Level, rule.Properties.SecuritySeverity),
				Title:       title,
				Description: rule.FullDescription.Text,
				File:        file,
				StartLine:   startLine,
				EndLine:     endLine,
				Remediation: rule.Help.Text,
			})
		}
	}

	return findings
}

func mapSARIFLevel(level, secSeverity string) scanner.Severity {
	// SARIF security-severity is a float string like "9.0", "7.5", etc.
	// Fall back to level-based mapping if not present.
	if secSeverity != "" {
		var score float64
		fmt.Sscanf(secSeverity, "%f", &score)
		switch {
		case score >= 9.0:
			return scanner.SeverityCritical
		case score >= 7.0:
			return scanner.SeverityHigh
		case score >= 4.0:
			return scanner.SeverityMedium
		case score >= 0.1:
			return scanner.SeverityLow
		}
	}

	switch level {
	case "error":
		return scanner.SeverityHigh
	case "warning":
		return scanner.SeverityMedium
	default:
		return scanner.SeverityLow
	}
}
