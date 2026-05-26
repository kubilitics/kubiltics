package certification_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/mcp/certification"
)

// writeTestReport is a helper that writes a certification report to a temp file and returns its path.
func writeTestReport(t *testing.T, report *certification.Report) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "tool-certifications.json")
	if err := certification.WriteJSON(report, path); err != nil {
		t.Fatalf("writeTestReport: %v", err)
	}
	return path
}

// zeroReport builds a report with zero inputs (all tools Uncertified).
func zeroReport() *certification.Report {
	return certification.NewEngine().Certify()
}

// ── NewGate ───────────────────────────────────────────────────────────────────

func TestNewGate_MissingFile_Permissive(t *testing.T) {
	g := certification.NewGate("/nonexistent/path/report.json")
	// Permissive mode: even destructive tools should pass the gate.
	if err := g.Check("restart_pod"); err != nil {
		t.Errorf("permissive gate blocked restart_pod: %v", err)
	}
}

func TestNewGate_ValidReport_LoadsGrades(t *testing.T) {
	// Zero inputs → restart_pod (destructive) is Uncertified → should be blocked.
	path := writeTestReport(t, zeroReport())
	g := certification.NewGate(path)
	if err := g.Check("restart_pod"); err == nil {
		t.Error("expected gate to block restart_pod (destructive + uncertified)")
	}
}

func TestNewGate_ValidReport_PassesNonDestructive(t *testing.T) {
	path := writeTestReport(t, zeroReport())
	g := certification.NewGate(path)
	// Non-destructive tools are never in the blocked map, regardless of grade.
	if err := g.Check("inspect_pod"); err != nil {
		t.Errorf("gate blocked non-destructive tool inspect_pod: %v", err)
	}
}

// ── Check ─────────────────────────────────────────────────────────────────────

func TestCheck_BlocksDestructiveUncertified(t *testing.T) {
	path := writeTestReport(t, zeroReport())
	g := certification.NewGate(path)

	destructiveTools := []string{
		"restart_pod", "scale_deployment", "delete_resource",
		"cordon_node", "drain_node",
	}
	for _, tool := range destructiveTools {
		if err := g.Check(tool); err == nil {
			t.Errorf("expected gate to block %s (destructive + uncertified)", tool)
		}
	}
}

func TestCheck_AllowsCertifiedDestructive(t *testing.T) {
	const tool = "restart_pod"
	e := certification.NewEngine()
	e.SetInputs(tool, certification.Inputs{
		ContractPass:         true,
		LiveValidationTested: false, // destructive: live skipped
		StatementCoverage:    85.0,
		ChaosPass:            true,
		ChaosTestedCount:     3,
	})
	path := writeTestReport(t, e.Certify())
	g := certification.NewGate(path)
	if err := g.Check(tool); err != nil {
		t.Errorf("gate blocked certified destructive tool %s: %v", tool, err)
	}
}

func TestCheck_UnknownTool_Passes(t *testing.T) {
	path := writeTestReport(t, zeroReport())
	g := certification.NewGate(path)
	// Unknown tools aren't in the blocked map → pass by default.
	if err := g.Check("totally_unknown_tool"); err != nil {
		t.Errorf("gate blocked unknown tool: %v", err)
	}
}

// ── Grade ─────────────────────────────────────────────────────────────────────

func TestGrade_CertifiedTool(t *testing.T) {
	const tool = "inspect_pod"
	e := certification.NewEngine()
	e.SetInputs(tool, certification.Inputs{
		ContractPass:         true,
		LiveValidationPass:   true,
		LiveValidationTested: true,
		StatementCoverage:    85.0,
		ChaosPass:            true,
		ChaosTestedCount:     2,
	})
	path := writeTestReport(t, e.Certify())
	g := certification.NewGate(path)
	if g.Grade(tool) != certification.GradeCertified {
		t.Errorf("Grade(%s)=%s want Certified", tool, g.Grade(tool))
	}
}

func TestGrade_UnknownTool_ReturnsProvisional(t *testing.T) {
	path := writeTestReport(t, zeroReport())
	g := certification.NewGate(path)
	// Unknown tool → not in grades map → returns Provisional (permissive default).
	if g.Grade("unknown_brand_new_tool") != certification.GradeProvisional {
		t.Errorf("Grade(unknown)=%s want Provisional (permissive default)", g.Grade("unknown_brand_new_tool"))
	}
}

// ── Warn ──────────────────────────────────────────────────────────────────────

func TestWarn_ProvisionalTool_NonEmpty(t *testing.T) {
	const tool = "inspect_pod"
	e := certification.NewEngine()
	e.SetInputs(tool, certification.Inputs{
		ContractPass:         true,
		LiveValidationPass:   true,
		LiveValidationTested: true,
		StatementCoverage:    65.0, // Provisional range
	})
	path := writeTestReport(t, e.Certify())
	g := certification.NewGate(path)
	if g.Warn(tool) == "" {
		t.Error("Warn(provisional tool) should return non-empty string")
	}
}

func TestWarn_CertifiedTool_Empty(t *testing.T) {
	const tool = "inspect_pod"
	e := certification.NewEngine()
	e.SetInputs(tool, certification.Inputs{
		ContractPass:         true,
		LiveValidationPass:   true,
		LiveValidationTested: true,
		StatementCoverage:    85.0,
		ChaosPass:            true,
		ChaosTestedCount:     2,
	})
	path := writeTestReport(t, e.Certify())
	g := certification.NewGate(path)
	if g.Warn(tool) != "" {
		t.Errorf("Warn(certified tool) should be empty, got %q", g.Warn(tool))
	}
}

// ── Summary ───────────────────────────────────────────────────────────────────

func TestSummary_HasExpectedKeys(t *testing.T) {
	path := writeTestReport(t, zeroReport())
	g := certification.NewGate(path)
	s := g.Summary()
	for _, key := range []string{"certified", "provisional", "uncertified", "blocked"} {
		if _, ok := s[key]; !ok {
			t.Errorf("Summary missing key %q", key)
		}
	}
}

func TestSummary_BlockedCountMatchesBlockedTools(t *testing.T) {
	report := zeroReport()
	path := writeTestReport(t, report)
	g := certification.NewGate(path)
	blocked := certification.BlockedTools(report)
	s := g.Summary()
	if s["blocked"] != len(blocked) {
		t.Errorf("Summary[blocked]=%d want %d", s["blocked"], len(blocked))
	}
}

// ── Background refresh ────────────────────────────────────────────────────────

func TestStart_RefreshUpdatesGrades(t *testing.T) {
	// Start: restart_pod is Uncertified → blocked.
	path := writeTestReport(t, zeroReport())
	g := certification.NewGateWithRefresh(path, 50*time.Millisecond)
	if err := g.Check("restart_pod"); err == nil {
		t.Fatal("expected restart_pod to be blocked initially")
	}

	// Overwrite report: restart_pod now Certified.
	e2 := certification.NewEngine()
	e2.SetInputs("restart_pod", certification.Inputs{
		ContractPass:         true,
		LiveValidationTested: false,
		StatementCoverage:    85.0,
		ChaosPass:            true,
		ChaosTestedCount:     3,
	})
	updatedReport := e2.Certify()
	data, _ := json.Marshal(updatedReport)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	g.Start(ctx)

	// Poll until the gate picks up the updated report.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if g.Check("restart_pod") == nil {
			return // success
		}
		time.Sleep(60 * time.Millisecond)
	}
	t.Error("gate did not refresh within 2s to allow certified restart_pod")
}

func TestStart_CancelStopsRefresh(t *testing.T) {
	path := writeTestReport(t, zeroReport())
	g := certification.NewGateWithRefresh(path, 50*time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	g.Start(ctx)
	cancel() // must not panic or deadlock
	time.Sleep(100 * time.Millisecond)
}

func TestNewGateWithRefresh_CustomInterval(t *testing.T) {
	path := writeTestReport(t, zeroReport())
	// Just verify construction and a basic Check — no hang.
	g := certification.NewGateWithRefresh(path, 1*time.Hour)
	if err := g.Check("inspect_pod"); err != nil {
		t.Errorf("non-destructive tool blocked: %v", err)
	}
}

// ── Concurrent safety ─────────────────────────────────────────────────────────

func TestGate_ConcurrentChecks(t *testing.T) {
	path := writeTestReport(t, zeroReport())
	g := certification.NewGate(path)

	done := make(chan struct{})
	for i := 0; i < 20; i++ {
		go func() {
			for j := 0; j < 50; j++ {
				_ = g.Check("inspect_pod")
				_ = g.Check("restart_pod")
				_ = g.Grade("inspect_pod")
				_ = g.Summary()
			}
			done <- struct{}{}
		}()
	}
	for i := 0; i < 20; i++ {
		<-done
	}
}
