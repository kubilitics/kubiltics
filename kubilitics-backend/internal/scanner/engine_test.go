package scanner

import (
	"context"
	"testing"
	"time"
)

// mockScanner implements Scanner for testing.
type mockScanner struct {
	name      string
	available bool
	findings  []Finding
	err       error
	delay     time.Duration
}

func (m *mockScanner) Name() string    { return m.name }
func (m *mockScanner) Available() bool { return m.available }
func (m *mockScanner) Scan(ctx context.Context, target ScanTarget) (*ScanResult, error) {
	if m.delay > 0 {
		select {
		case <-time.After(m.delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if m.err != nil {
		return nil, m.err
	}
	return &ScanResult{
		Tool:     m.name,
		Findings: m.findings,
	}, nil
}

func TestEngineRunAllScanners(t *testing.T) {
	scanners := []Scanner{
		&mockScanner{
			name:      "tool-a",
			available: true,
			findings: []Finding{
				{Tool: "tool-a", RuleID: "R1", Severity: SeverityHigh, Title: "Finding 1", File: "a.go", StartLine: 10},
			},
		},
		&mockScanner{
			name:      "tool-b",
			available: true,
			findings: []Finding{
				{Tool: "tool-b", RuleID: "R2", Severity: SeverityMedium, Title: "Finding 2", File: "b.go", StartLine: 20},
			},
		},
	}

	engine := NewEngine(scanners, nil)
	results, findings, err := engine.Run(context.Background(), ScanConfig{
		Target:  ScanTarget{Type: TargetDirectory, Path: "."},
		Timeout: 10 * time.Second,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 2 {
		t.Errorf("expected 2 results, got %d", len(results))
	}
	if len(findings) != 2 {
		t.Errorf("expected 2 findings, got %d", len(findings))
	}
	// Verify IDs were computed
	for _, f := range findings {
		if f.ID == "" {
			t.Errorf("finding %s has empty ID", f.Title)
		}
	}
}

func TestEngineSkipsUnavailable(t *testing.T) {
	scanners := []Scanner{
		&mockScanner{name: "available", available: true, findings: []Finding{
			{Tool: "available", RuleID: "R1", Severity: SeverityLow, Title: "Found", File: "x.go", StartLine: 1},
		}},
		&mockScanner{name: "missing", available: false},
	}

	engine := NewEngine(scanners, nil)
	results, findings, err := engine.Run(context.Background(), ScanConfig{
		Target:  ScanTarget{Type: TargetDirectory, Path: "."},
		Timeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 2 {
		t.Errorf("expected 2 results, got %d", len(results))
	}

	var skipped int
	for _, r := range results {
		if r.Skipped {
			skipped++
		}
	}
	if skipped != 1 {
		t.Errorf("expected 1 skipped result, got %d", skipped)
	}
	if len(findings) != 1 {
		t.Errorf("expected 1 finding, got %d", len(findings))
	}
}

func TestEngineSelectsScanners(t *testing.T) {
	scanners := []Scanner{
		&mockScanner{name: "alpha", available: true, findings: []Finding{
			{Tool: "alpha", RuleID: "A1", Severity: SeverityHigh, Title: "A", File: "a.go", StartLine: 1},
		}},
		&mockScanner{name: "beta", available: true, findings: []Finding{
			{Tool: "beta", RuleID: "B1", Severity: SeverityLow, Title: "B", File: "b.go", StartLine: 1},
		}},
	}

	engine := NewEngine(scanners, nil)
	results, findings, err := engine.Run(context.Background(), ScanConfig{
		Target:   ScanTarget{Type: TargetDirectory, Path: "."},
		Scanners: []string{"alpha"},
		Timeout:  5 * time.Second,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 1 {
		t.Errorf("expected 1 result, got %d", len(results))
	}
	if len(findings) != 1 {
		t.Errorf("expected 1 finding, got %d", len(findings))
	}
	if findings[0].Tool != "alpha" {
		t.Errorf("expected alpha finding, got %s", findings[0].Tool)
	}
}

func TestEngineSeverityFilter(t *testing.T) {
	scanners := []Scanner{
		&mockScanner{name: "test", available: true, findings: []Finding{
			{Tool: "test", RuleID: "R1", Severity: SeverityCritical, Title: "Crit", File: "a.go", StartLine: 1},
			{Tool: "test", RuleID: "R2", Severity: SeverityHigh, Title: "High", File: "b.go", StartLine: 1},
			{Tool: "test", RuleID: "R3", Severity: SeverityLow, Title: "Low", File: "c.go", StartLine: 1},
		}},
	}

	engine := NewEngine(scanners, nil)
	_, findings, err := engine.Run(context.Background(), ScanConfig{
		Target:            ScanTarget{Type: TargetDirectory, Path: "."},
		SeverityThreshold: SeverityHigh,
		Timeout:           5 * time.Second,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should include CRITICAL and HIGH only
	if len(findings) != 2 {
		t.Errorf("expected 2 findings (CRITICAL+HIGH), got %d", len(findings))
	}
}
