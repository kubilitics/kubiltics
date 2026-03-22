package scanner

import "testing"

func TestDeduplicateRemovesDuplicates(t *testing.T) {
	findings := []Finding{
		{Tool: "trivy", RuleID: "CVE-2024-001", File: "go.sum", StartLine: 10},
		{Tool: "trivy", RuleID: "CVE-2024-001", File: "go.sum", StartLine: 10}, // exact duplicate
		{Tool: "trivy", RuleID: "CVE-2024-002", File: "go.sum", StartLine: 20}, // different rule
	}

	// Compute IDs
	for i := range findings {
		findings[i].ComputeID()
	}

	result := Deduplicate(findings)
	if len(result) != 2 {
		t.Errorf("expected 2 unique findings, got %d", len(result))
	}
}

func TestDeduplicatePreservesOrder(t *testing.T) {
	findings := []Finding{
		{Tool: "semgrep", RuleID: "rule-1", Severity: SeverityHigh, File: "a.py", StartLine: 1},
		{Tool: "trivy", RuleID: "CVE-1", Severity: SeverityCritical, File: "b.go", StartLine: 5},
		{Tool: "gitleaks", RuleID: "secret-1", Severity: SeverityHigh, File: "c.env", StartLine: 1},
	}

	for i := range findings {
		findings[i].ComputeID()
	}

	result := Deduplicate(findings)
	if len(result) != 3 {
		t.Fatalf("expected 3 findings, got %d", len(result))
	}
	if result[0].Tool != "semgrep" {
		t.Errorf("expected first finding from semgrep, got %s", result[0].Tool)
	}
}

func TestDeduplicateEmpty(t *testing.T) {
	result := Deduplicate(nil)
	if len(result) != 0 {
		t.Errorf("expected 0 findings, got %d", len(result))
	}
}

func TestComputeIDDeterministic(t *testing.T) {
	f1 := Finding{Tool: "trivy", RuleID: "CVE-2024-001", File: "go.sum", StartLine: 10}
	f2 := Finding{Tool: "trivy", RuleID: "CVE-2024-001", File: "go.sum", StartLine: 10}

	id1 := f1.ComputeID()
	id2 := f2.ComputeID()

	if id1 != id2 {
		t.Errorf("IDs should be equal for identical findings: %s != %s", id1, id2)
	}
	if id1 == "" {
		t.Error("ID should not be empty")
	}
}

func TestComputeIDDifferent(t *testing.T) {
	f1 := Finding{Tool: "trivy", RuleID: "CVE-2024-001", File: "a.go", StartLine: 1}
	f2 := Finding{Tool: "trivy", RuleID: "CVE-2024-002", File: "a.go", StartLine: 1}

	id1 := f1.ComputeID()
	id2 := f2.ComputeID()

	if id1 == id2 {
		t.Errorf("IDs should differ for different rules: %s == %s", id1, id2)
	}
}
