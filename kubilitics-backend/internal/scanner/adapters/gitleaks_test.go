package adapters

import (
	"encoding/json"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/scanner"
)

func TestGitleaksMapFindings(t *testing.T) {
	raw := `[
		{
			"RuleID": "aws-access-key-id",
			"Description": "AWS Access Key ID",
			"File": "config/prod.env",
			"StartLine": 5,
			"EndLine": 5,
			"Match": "AKIAIOSFODNN7EXAMPLE",
			"Secret": "AKIAIOSFODNN7EXAMPLE",
			"Commit": "abc123",
			"Author": "dev@example.com",
			"Date": "2024-01-15",
			"Fingerprint": "config/prod.env:aws-access-key-id:5"
		},
		{
			"RuleID": "generic-api-key",
			"Description": "Generic API Key",
			"File": "src/config.ts",
			"StartLine": 12,
			"EndLine": 12,
			"Match": "api_key=sk_live_1234567890",
			"Secret": "sk_live_1234567890",
			"Commit": "def456",
			"Author": "dev@example.com",
			"Date": "2024-02-01",
			"Fingerprint": "src/config.ts:generic-api-key:12"
		}
	]`

	var results []gitleaksFinding
	if err := json.Unmarshal([]byte(raw), &results); err != nil {
		t.Fatalf("failed to parse gitleaks output: %v", err)
	}

	adapter := &GitleaksAdapter{binary: "gitleaks"}
	findings := adapter.mapFindings(results)

	if len(findings) != 2 {
		t.Fatalf("expected 2 findings, got %d", len(findings))
	}

	// All gitleaks findings should be HIGH severity
	for _, f := range findings {
		if f.Severity != scanner.SeverityHigh {
			t.Errorf("expected severity=HIGH for all gitleaks findings, got %s for %s", f.Severity, f.RuleID)
		}
		if f.Tool != "gitleaks" {
			t.Errorf("expected tool=gitleaks, got %s", f.Tool)
		}
		if f.Remediation == "" {
			t.Error("expected non-empty remediation")
		}
	}

	// Check first finding
	f := findings[0]
	if f.RuleID != "aws-access-key-id" {
		t.Errorf("expected ruleID=aws-access-key-id, got %s", f.RuleID)
	}
	if f.File != "config/prod.env" {
		t.Errorf("expected file=config/prod.env, got %s", f.File)
	}
	if f.StartLine != 5 {
		t.Errorf("expected startLine=5, got %d", f.StartLine)
	}
	if f.Metadata["fingerprint"] != "config/prod.env:aws-access-key-id:5" {
		t.Errorf("expected fingerprint in metadata, got %v", f.Metadata)
	}
}

func TestGitleaksEmptyOutput(t *testing.T) {
	adapter := &GitleaksAdapter{binary: "gitleaks"}
	findings := adapter.mapFindings(nil)
	if len(findings) != 0 {
		t.Errorf("expected 0 findings for nil input, got %d", len(findings))
	}
}
