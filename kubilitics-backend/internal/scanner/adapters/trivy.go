package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/scanner"
)

// TrivyAdapter wraps the Trivy CLI for vulnerability and misconfiguration scanning.
type TrivyAdapter struct {
	binary string
}

func NewTrivyAdapter() *TrivyAdapter {
	return &TrivyAdapter{binary: "trivy"}
}

func (t *TrivyAdapter) Name() string { return "trivy" }

func (t *TrivyAdapter) Available() bool {
	_, err := exec.LookPath(t.binary)
	return err == nil
}

// trivyOutput is the top-level Trivy JSON output.
type trivyOutput struct {
	Results []trivyResult `json:"Results"`
}

type trivyResult struct {
	Target            string                 `json:"Target"`
	Vulnerabilities   []trivyVulnerability   `json:"Vulnerabilities"`
	Misconfigurations []trivyMisconfiguration `json:"Misconfigurations"`
	Secrets           []trivySecret          `json:"Secrets"`
}

type trivyVulnerability struct {
	VulnerabilityID  string `json:"VulnerabilityID"`
	PkgName          string `json:"PkgName"`
	InstalledVersion string `json:"InstalledVersion"`
	FixedVersion     string `json:"FixedVersion"`
	Severity         string `json:"Severity"`
	Title            string `json:"Title"`
	Description      string `json:"Description"`
	PrimaryURL       string `json:"PrimaryURL"`
}

type trivyMisconfiguration struct {
	ID          string `json:"ID"`
	Title       string `json:"Title"`
	Description string `json:"Description"`
	Severity    string `json:"Severity"`
	Resolution  string `json:"Resolution"`
}

type trivySecret struct {
	RuleID    string `json:"RuleID"`
	Category  string `json:"Category"`
	Title     string `json:"Title"`
	Severity  string `json:"Severity"`
	StartLine int    `json:"StartLine"`
	EndLine   int    `json:"EndLine"`
	Match     string `json:"Match"`
}

func (t *TrivyAdapter) Scan(ctx context.Context, target scanner.ScanTarget) (*scanner.ScanResult, error) {
	args := t.buildArgs(target)
	cmd := exec.CommandContext(ctx, t.binary, args...)
	out, err := cmd.Output()
	if err != nil {
		// Trivy exits with non-zero when vulnerabilities found; check if we got JSON
		if len(out) == 0 {
			return nil, fmt.Errorf("trivy execution failed: %w", err)
		}
	}

	var output trivyOutput
	if err := json.Unmarshal(out, &output); err != nil {
		return nil, fmt.Errorf("trivy parse output: %w", err)
	}

	findings := t.mapFindings(output)
	return &scanner.ScanResult{
		Tool:     "trivy",
		Findings: findings,
	}, nil
}

func (t *TrivyAdapter) buildArgs(target scanner.ScanTarget) []string {
	switch target.Type {
	case scanner.TargetContainerImage:
		return []string{"image", "--format", "json", "--scanners", "vuln,misconfig,secret", "--quiet", target.Path}
	default:
		return []string{"fs", "--format", "json", "--scanners", "vuln,misconfig,secret", "--quiet", target.Path}
	}
}

func (t *TrivyAdapter) mapFindings(output trivyOutput) []scanner.Finding {
	var findings []scanner.Finding

	for _, result := range output.Results {
		for _, vuln := range result.Vulnerabilities {
			remediation := ""
			if vuln.FixedVersion != "" {
				remediation = fmt.Sprintf("Upgrade %s from %s to %s", vuln.PkgName, vuln.InstalledVersion, vuln.FixedVersion)
			}
			findings = append(findings, scanner.Finding{
				Tool:        "trivy",
				RuleID:      vuln.VulnerabilityID,
				Severity:    mapTrivySeverity(vuln.Severity),
				Title:       vuln.Title,
				Description: vuln.Description,
				File:        result.Target,
				Remediation: remediation,
				CVE:         []string{vuln.VulnerabilityID},
				Metadata: map[string]string{
					"package":           vuln.PkgName,
					"installed_version": vuln.InstalledVersion,
					"fixed_version":     vuln.FixedVersion,
					"primary_url":       vuln.PrimaryURL,
				},
			})
		}

		for _, misconfig := range result.Misconfigurations {
			findings = append(findings, scanner.Finding{
				Tool:        "trivy",
				RuleID:      misconfig.ID,
				Severity:    mapTrivySeverity(misconfig.Severity),
				Title:       misconfig.Title,
				Description: misconfig.Description,
				File:        result.Target,
				Remediation: misconfig.Resolution,
			})
		}

		for _, secret := range result.Secrets {
			findings = append(findings, scanner.Finding{
				Tool:      "trivy",
				RuleID:    secret.RuleID,
				Severity:  scanner.SeverityHigh,
				Title:     fmt.Sprintf("Secret detected: %s", secret.Title),
				File:      result.Target,
				StartLine: secret.StartLine,
				EndLine:   secret.EndLine,
				Metadata: map[string]string{
					"category": secret.Category,
				},
			})
		}
	}

	return findings
}

func mapTrivySeverity(s string) scanner.Severity {
	switch strings.ToUpper(s) {
	case "CRITICAL":
		return scanner.SeverityCritical
	case "HIGH":
		return scanner.SeverityHigh
	case "MEDIUM":
		return scanner.SeverityMedium
	case "LOW":
		return scanner.SeverityLow
	default:
		return scanner.SeverityInfo
	}
}
