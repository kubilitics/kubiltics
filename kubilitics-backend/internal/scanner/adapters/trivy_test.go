package adapters

import (
	"encoding/json"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/scanner"
)

func TestTrivyMapFindings(t *testing.T) {
	raw := `{
		"Results": [
			{
				"Target": "go.sum",
				"Vulnerabilities": [
					{
						"VulnerabilityID": "CVE-2024-1234",
						"PkgName": "github.com/example/pkg",
						"InstalledVersion": "1.0.0",
						"FixedVersion": "1.0.1",
						"Severity": "HIGH",
						"Title": "Example vulnerability",
						"Description": "An example vulnerability description.",
						"PrimaryURL": "https://nvd.nist.gov/vuln/detail/CVE-2024-1234"
					}
				],
				"Misconfigurations": [
					{
						"ID": "DS002",
						"Title": "Image user should not be root",
						"Description": "Running as root is a security risk.",
						"Severity": "MEDIUM",
						"Resolution": "Add USER directive to Dockerfile"
					}
				]
			}
		]
	}`

	var output trivyOutput
	if err := json.Unmarshal([]byte(raw), &output); err != nil {
		t.Fatalf("failed to parse trivy output: %v", err)
	}

	adapter := &TrivyAdapter{binary: "trivy"}
	findings := adapter.mapFindings(output)

	if len(findings) != 2 {
		t.Fatalf("expected 2 findings, got %d", len(findings))
	}

	// Check vulnerability
	vuln := findings[0]
	if vuln.Tool != "trivy" {
		t.Errorf("expected tool=trivy, got %s", vuln.Tool)
	}
	if vuln.RuleID != "CVE-2024-1234" {
		t.Errorf("expected ruleID=CVE-2024-1234, got %s", vuln.RuleID)
	}
	if vuln.Severity != scanner.SeverityHigh {
		t.Errorf("expected severity=HIGH, got %s", vuln.Severity)
	}
	if len(vuln.CVE) != 1 || vuln.CVE[0] != "CVE-2024-1234" {
		t.Errorf("expected CVE=[CVE-2024-1234], got %v", vuln.CVE)
	}
	if vuln.Metadata["package"] != "github.com/example/pkg" {
		t.Errorf("expected package metadata, got %v", vuln.Metadata)
	}

	// Check misconfiguration
	misconf := findings[1]
	if misconf.RuleID != "DS002" {
		t.Errorf("expected ruleID=DS002, got %s", misconf.RuleID)
	}
	if misconf.Severity != scanner.SeverityMedium {
		t.Errorf("expected severity=MEDIUM, got %s", misconf.Severity)
	}
	if misconf.Remediation == "" {
		t.Error("expected non-empty remediation")
	}
}

func TestTrivySeverityMapping(t *testing.T) {
	cases := []struct {
		input    string
		expected scanner.Severity
	}{
		{"CRITICAL", scanner.SeverityCritical},
		{"HIGH", scanner.SeverityHigh},
		{"MEDIUM", scanner.SeverityMedium},
		{"LOW", scanner.SeverityLow},
		{"UNKNOWN", scanner.SeverityInfo},
		{"", scanner.SeverityInfo},
	}

	for _, tc := range cases {
		got := mapTrivySeverity(tc.input)
		if got != tc.expected {
			t.Errorf("mapTrivySeverity(%q) = %s, want %s", tc.input, got, tc.expected)
		}
	}
}
