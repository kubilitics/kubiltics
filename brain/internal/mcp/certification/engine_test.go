package certification_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	mcptools "github.com/vellankikoti/kubilitics/brain/internal/mcp/tools"
	"github.com/vellankikoti/kubilitics/brain/internal/mcp/certification"
)

// ── Engine.Certify ────────────────────────────────────────────────────────────

func TestCertify_ReturnsAllTools(t *testing.T) {
	e := certification.NewEngine()
	report := e.Certify()
	if report.TotalTools != len(mcptools.ToolTaxonomy) {
		t.Errorf("TotalTools=%d want %d", report.TotalTools, len(mcptools.ToolTaxonomy))
	}
	if len(report.Tools) != len(mcptools.ToolTaxonomy) {
		t.Errorf("len(report.Tools)=%d want %d", len(report.Tools), len(mcptools.ToolTaxonomy))
	}
}

func TestCertify_CountsSumToTotal(t *testing.T) {
	e := certification.NewEngine()
	report := e.Certify()
	sum := report.Certified + report.Provisional + report.Uncertified
	if sum != report.TotalTools {
		t.Errorf("certified(%d)+provisional(%d)+uncertified(%d)=%d != totalTools(%d)",
			report.Certified, report.Provisional, report.Uncertified, sum, report.TotalTools)
	}
}

func TestCertify_SortedAlphabetically(t *testing.T) {
	e := certification.NewEngine()
	report := e.Certify()
	for i := 1; i < len(report.Tools); i++ {
		if report.Tools[i].ToolName < report.Tools[i-1].ToolName {
			t.Errorf("out of order: %s before %s", report.Tools[i-1].ToolName, report.Tools[i].ToolName)
		}
	}
}

func TestCertify_ZeroInputs_NoneAreCertified(t *testing.T) {
	// With zero inputs, ContractPass=false for every tool → all Uncertified.
	e := certification.NewEngine()
	report := e.Certify()
	for _, tc := range report.Tools {
		if tc.Grade == certification.GradeCertified {
			t.Errorf("tool %s is Certified with zero inputs (contract fails by default)", tc.ToolName)
		}
	}
}

func TestCertify_ZeroInputs_AllUncertified(t *testing.T) {
	// ContractPass=false (zero value) → hard contract failure → Uncertified for every tool.
	e := certification.NewEngine()
	report := e.Certify()
	for _, tc := range report.Tools {
		if tc.Grade != certification.GradeUncertified {
			t.Errorf("tool %s has grade %s with zero inputs; expected Uncertified (contract not passed)", tc.ToolName, tc.Grade)
		}
	}
}

func TestCertify_ZeroInputs_EachToolHas4Signals(t *testing.T) {
	e := certification.NewEngine()
	report := e.Certify()
	for _, tc := range report.Tools {
		if len(tc.Signals) != 4 {
			t.Errorf("tool %s has %d signals, want 4", tc.ToolName, len(tc.Signals))
		}
	}
}

// ── gradeOne signal logic ─────────────────────────────────────────────────────

func TestCertify_FullSignals_Certified(t *testing.T) {
	const tool = "inspect_pod"
	e := certification.NewEngine()
	e.SetInputs(tool, certification.Inputs{
		ContractPass:         true,
		LiveValidationPass:   true,
		LiveValidationTested: true,
		StatementCoverage:    85.0, // ≥ 80 → certified
		ChaosPass:            true,
		ChaosTestedCount:     5,
	})
	report := e.Certify()
	tc := findTool(t, report, tool)
	if tc.Grade != certification.GradeCertified {
		t.Errorf("grade=%s want Certified", tc.Grade)
	}
	if tc.Score < 80 {
		t.Errorf("score=%d want ≥80", tc.Score)
	}
}

func TestCertify_PartialSignals_Provisional(t *testing.T) {
	const tool = "inspect_deployment"
	e := certification.NewEngine()
	e.SetInputs(tool, certification.Inputs{
		ContractPass:         true,
		LiveValidationPass:   true,
		LiveValidationTested: true,
		StatementCoverage:    65.0, // ≥50 but <80 → provisional
		ChaosPass:            false,
		ChaosTestedCount:     0,
	})
	report := e.Certify()
	tc := findTool(t, report, tool)
	if tc.Grade != certification.GradeProvisional {
		t.Errorf("grade=%s want Provisional", tc.Grade)
	}
}

func TestCertify_CoverageNotMeasured_Provisional(t *testing.T) {
	// StatementCoverage=-1 means not measured → benefit of doubt → Provisional.
	const tool = "inspect_namespace"
	e := certification.NewEngine()
	e.SetInputs(tool, certification.Inputs{
		ContractPass:         true,
		LiveValidationPass:   true,
		LiveValidationTested: true,
		StatementCoverage:    -1, // not measured
	})
	report := e.Certify()
	tc := findTool(t, report, tool)
	if tc.Grade != certification.GradeProvisional {
		t.Errorf("grade=%s want Provisional (coverage not measured → benefit of doubt)", tc.Grade)
	}
}

func TestCertify_ContractFail_Uncertified(t *testing.T) {
	const tool = "inspect_namespace"
	e := certification.NewEngine()
	e.SetInputs(tool, certification.Inputs{
		ContractPass:         false, // hard failure
		ContractNotes:        "missing cluster_id property",
		LiveValidationPass:   true,
		LiveValidationTested: true,
		StatementCoverage:    90.0,
		ChaosPass:            true,
		ChaosTestedCount:     3,
	})
	report := e.Certify()
	tc := findTool(t, report, tool)
	if tc.Grade != certification.GradeUncertified {
		t.Errorf("grade=%s want Uncertified (contract failed)", tc.Grade)
	}
}

func TestCertify_LiveFail_NonDestructive_Uncertified(t *testing.T) {
	const tool = "inspect_pod"
	e := certification.NewEngine()
	e.SetInputs(tool, certification.Inputs{
		ContractPass:         true,
		LiveValidationPass:   false, // hard failure
		LiveValidationTested: true,
		StatementCoverage:    90.0,
	})
	report := e.Certify()
	tc := findTool(t, report, tool)
	if tc.Grade != certification.GradeUncertified {
		t.Errorf("grade=%s want Uncertified (live failed)", tc.Grade)
	}
}

func TestCertify_DestructiveTool_LiveSkipped_CanBeCertified(t *testing.T) {
	// Destructive tools skip live validation; contract+coverage+chaos can still certify.
	const tool = "restart_pod"
	e := certification.NewEngine()
	e.SetInputs(tool, certification.Inputs{
		ContractPass:         true,
		LiveValidationTested: false, // skipped (destructive)
		StatementCoverage:    82.0,
		ChaosPass:            true,
		ChaosTestedCount:     3,
	})
	report := e.Certify()
	tc := findTool(t, report, tool)
	if tc.Grade != certification.GradeCertified {
		t.Errorf("grade=%s want Certified (destructive skips live, contract+cov+chaos green)", tc.Grade)
	}
}

func TestCertify_LowCoverage_Uncertified(t *testing.T) {
	const tool = "inspect_service"
	e := certification.NewEngine()
	e.SetInputs(tool, certification.Inputs{
		ContractPass:         true,
		LiveValidationPass:   true,
		LiveValidationTested: true,
		StatementCoverage:    30.0, // below 50% → Uncertified
	})
	report := e.Certify()
	tc := findTool(t, report, tool)
	if tc.Grade != certification.GradeUncertified {
		t.Errorf("grade=%s want Uncertified (coverage 30%% < 50%%)", tc.Grade)
	}
}

// ── SetInputsBulk ─────────────────────────────────────────────────────────────

func TestSetInputsBulk(t *testing.T) {
	e := certification.NewEngine()
	bulk := map[string]certification.Inputs{
		"inspect_pod":        {ContractPass: true, LiveValidationPass: true, LiveValidationTested: true, StatementCoverage: 80.0, ChaosPass: true, ChaosTestedCount: 2},
		"inspect_deployment": {ContractPass: true, LiveValidationPass: true, LiveValidationTested: true, StatementCoverage: 80.0, ChaosPass: true, ChaosTestedCount: 2},
	}
	e.SetInputsBulk(bulk)
	report := e.Certify()
	count := 0
	for _, tc := range report.Tools {
		if tc.ToolName == "inspect_pod" || tc.ToolName == "inspect_deployment" {
			if tc.Grade != certification.GradeCertified {
				t.Errorf("tool %s: grade=%s want Certified", tc.ToolName, tc.Grade)
			}
			count++
		}
	}
	if count != 2 {
		t.Errorf("found %d matching tools, want 2", count)
	}
}

// ── CustomThresholds ──────────────────────────────────────────────────────────

func TestCertify_CustomThresholds(t *testing.T) {
	const tool = "inspect_pod"
	e := certification.NewEngine().WithThresholds(certification.CertificationThresholds{
		MinCoverageForCertified:   60.0,
		MinCoverageForProvisional: 30.0,
	})
	e.SetInputs(tool, certification.Inputs{
		ContractPass:         true,
		LiveValidationPass:   true,
		LiveValidationTested: true,
		StatementCoverage:    65.0, // ≥60 custom threshold → Certified
		ChaosPass:            true,
		ChaosTestedCount:     1,
	})
	report := e.Certify()
	tc := findTool(t, report, tool)
	if tc.Grade != certification.GradeCertified {
		t.Errorf("grade=%s want Certified with custom threshold 60%%", tc.Grade)
	}
}

// ── BlockedTools ──────────────────────────────────────────────────────────────

func TestBlockedTools_OnlyDestructiveUncertified(t *testing.T) {
	e := certification.NewEngine() // zero inputs → all Uncertified
	report := e.Certify()
	blocked := certification.BlockedTools(report)

	// All blocked tools must be destructive and Uncertified.
	for toolName := range blocked {
		var found bool
		for _, tc := range report.Tools {
			if tc.ToolName == toolName {
				found = true
				if !tc.Destructive {
					t.Errorf("blocked tool %s is not Destructive", toolName)
				}
				if tc.Grade != certification.GradeUncertified {
					t.Errorf("blocked tool %s has grade %s, want Uncertified", toolName, tc.Grade)
				}
			}
		}
		if !found {
			t.Errorf("blocked tool %s not found in report", toolName)
		}
	}
}

func TestBlockedTools_NonDestructiveNeverBlocked(t *testing.T) {
	e := certification.NewEngine() // all Uncertified
	report := e.Certify()
	blocked := certification.BlockedTools(report)

	// Even though all tools are Uncertified, non-destructive tools must not be blocked.
	for _, tc := range report.Tools {
		if !tc.Destructive {
			if _, ok := blocked[tc.ToolName]; ok {
				t.Errorf("non-destructive tool %s is in blocked list", tc.ToolName)
			}
		}
	}
}

func TestBlockedTools_CertifiedDestructiveNotBlocked(t *testing.T) {
	const tool = "restart_pod"
	e := certification.NewEngine()
	e.SetInputs(tool, certification.Inputs{
		ContractPass:         true,
		LiveValidationTested: false, // destructive skips live
		StatementCoverage:    85.0,
		ChaosPass:            true,
		ChaosTestedCount:     3,
	})
	report := e.Certify()
	blocked := certification.BlockedTools(report)
	if _, ok := blocked[tool]; ok {
		t.Errorf("tool %s is blocked despite being Certified", tool)
	}
}

// ── CertifiedSet ─────────────────────────────────────────────────────────────

func TestCertifiedSet_ContainsAllTools(t *testing.T) {
	e := certification.NewEngine()
	report := e.Certify()
	cs := certification.CertifiedSet(report)
	if len(cs) != len(report.Tools) {
		t.Errorf("CertifiedSet len=%d want %d", len(cs), len(report.Tools))
	}
}

func TestCertifiedSet_GradesMatch(t *testing.T) {
	e := certification.NewEngine()
	e.SetInputs("inspect_pod", certification.Inputs{
		ContractPass: true, LiveValidationPass: true, LiveValidationTested: true,
		StatementCoverage: 85.0, ChaosPass: true, ChaosTestedCount: 2,
	})
	report := e.Certify()
	cs := certification.CertifiedSet(report)
	for _, tc := range report.Tools {
		if cs[tc.ToolName] != tc.Grade {
			t.Errorf("CertifiedSet[%s]=%s want %s", tc.ToolName, cs[tc.ToolName], tc.Grade)
		}
	}
}

// ── WriteJSON / LoadJSON round-trip ──────────────────────────────────────────

func TestWriteLoadJSON_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "report.json")

	e := certification.NewEngine()
	e.SetInputs("inspect_pod", certification.Inputs{
		ContractPass: true, LiveValidationPass: true, LiveValidationTested: true,
		StatementCoverage: 85.0, ChaosPass: true, ChaosTestedCount: 2,
	})
	original := e.Certify()

	if err := certification.WriteJSON(original, path); err != nil {
		t.Fatalf("WriteJSON: %v", err)
	}

	loaded, err := certification.LoadJSON(path)
	if err != nil {
		t.Fatalf("LoadJSON: %v", err)
	}

	if loaded.TotalTools != original.TotalTools {
		t.Errorf("TotalTools: got %d want %d", loaded.TotalTools, original.TotalTools)
	}
	if loaded.Certified != original.Certified {
		t.Errorf("Certified: got %d want %d", loaded.Certified, original.Certified)
	}
}

func TestWriteJSON_CreatesParentDirs(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "deep", "report.json")

	e := certification.NewEngine()
	if err := certification.WriteJSON(e.Certify(), path); err != nil {
		t.Fatalf("WriteJSON with nested dirs: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("file not created: %v", err)
	}
}

func TestLoadJSON_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.json")
	if err := os.WriteFile(path, []byte("{invalid}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := certification.LoadJSON(path); err == nil {
		t.Error("expected error loading invalid JSON")
	}
}

func TestLoadJSON_NonExistentFile(t *testing.T) {
	if _, err := certification.LoadJSON("/nonexistent/path/report.json"); err == nil {
		t.Error("expected error loading non-existent file")
	}
}

func TestWriteJSON_IsValidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "report.json")
	e := certification.NewEngine()
	if err := certification.WriteJSON(e.Certify(), path); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Errorf("output is not valid JSON: %v", err)
	}
}

// ── helper ────────────────────────────────────────────────────────────────────

func findTool(t *testing.T, report *certification.Report, name string) certification.ToolCertification {
	t.Helper()
	for _, tc := range report.Tools {
		if tc.ToolName == name {
			return tc
		}
	}
	t.Fatalf("tool %q not found in report", name)
	return certification.ToolCertification{}
}
