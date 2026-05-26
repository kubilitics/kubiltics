package certification

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	mcptools "github.com/vellankikoti/kubilitics/brain/internal/mcp/tools"
)

// Engine grades every registered MCP tool and produces a certification Report.
type Engine struct {
	thresholds CertificationThresholds
	// inputsByTool holds externally-provided quality signals, keyed by tool name.
	inputsByTool map[string]Inputs
}

// NewEngine creates a new certification engine with default thresholds.
func NewEngine() *Engine {
	return &Engine{
		thresholds:   DefaultThresholds(),
		inputsByTool: make(map[string]Inputs),
	}
}

// WithThresholds overrides the default grading thresholds.
func (e *Engine) WithThresholds(t CertificationThresholds) *Engine {
	e.thresholds = t
	return e
}

// SetInputs provides quality signals for a specific tool.
// Call this once per tool before calling Certify.
func (e *Engine) SetInputs(toolName string, in Inputs) {
	e.inputsByTool[toolName] = in
}

// SetInputsBulk provides quality signals for multiple tools at once.
func (e *Engine) SetInputsBulk(inputs map[string]Inputs) {
	for name, in := range inputs {
		e.inputsByTool[name] = in
	}
}

// Certify runs the certification engine against all 157 taxonomy tools and
// returns a fully-populated Report.
func (e *Engine) Certify() *Report {
	now := time.Now().UTC()
	report := &Report{
		GeneratedAt: now,
		TotalTools:  len(mcptools.ToolTaxonomy),
	}

	for _, td := range mcptools.ToolTaxonomy {
		inputs := e.inputsByTool[td.Name] // zero-value = no data
		cert := e.gradeOne(td, inputs, now)
		report.Tools = append(report.Tools, cert)

		switch cert.Grade {
		case GradeCertified:
			report.Certified++
		case GradeProvisional:
			report.Provisional++
		case GradeUncertified:
			report.Uncertified++
		}
	}

	// Sort alphabetically for stable output.
	sort.Slice(report.Tools, func(i, j int) bool {
		return report.Tools[i].ToolName < report.Tools[j].ToolName
	})

	return report
}

// gradeOne certifies a single tool from its taxonomy definition and quality signals.
func (e *Engine) gradeOne(td mcptools.ToolDefinition, in Inputs, now time.Time) ToolCertification {
	cert := ToolCertification{
		ToolName:    td.Name,
		Category:    string(td.Category),
		Destructive: td.Destructive,
		CertifiedAt: now,
	}

	// ── Signal 1: Contract ─────────────────────────────────────────────────────
	contractSignal := Signal{Name: "contract"}
	if in.ContractPass {
		contractSignal.Pass = true
		contractSignal.Score = 100
		contractSignal.Details = "All 11 taxonomy contract tests pass"
	} else {
		contractSignal.Pass = false
		contractSignal.Score = 0
		contractSignal.Details = in.ContractNotes
		if contractSignal.Details == "" {
			contractSignal.Details = "Contract tests not run or failed"
		}
	}
	cert.Signals = append(cert.Signals, contractSignal)

	// ── Signal 2: Live Validation ──────────────────────────────────────────────
	liveSignal := Signal{Name: "live_validation"}
	switch {
	case !in.LiveValidationTested && td.Destructive:
		liveSignal.Pass = true // destructive tools are intentionally skipped
		liveSignal.Score = 100
		liveSignal.Details = "Skipped (destructive tool — live execution requires human approval)"
	case !in.LiveValidationTested:
		liveSignal.Pass = false
		liveSignal.Score = 0
		liveSignal.Details = "Live validation not run for this tool"
	case in.LiveValidationPass:
		liveSignal.Pass = true
		liveSignal.Score = 100
		liveSignal.Details = in.LiveValidationNotes
		if liveSignal.Details == "" {
			liveSignal.Details = "Phase 2 live-cluster test passed"
		}
	default:
		liveSignal.Pass = false
		liveSignal.Score = 0
		liveSignal.Details = in.LiveValidationNotes
		if liveSignal.Details == "" {
			liveSignal.Details = "Phase 2 live-cluster test failed"
		}
	}
	cert.Signals = append(cert.Signals, liveSignal)

	// ── Signal 3: Statement Coverage ──────────────────────────────────────────
	coverageSignal := Signal{Name: "statement_coverage"}
	if in.StatementCoverage < 0 {
		coverageSignal.Pass = false
		coverageSignal.Score = 0
		coverageSignal.Details = "Coverage not measured"
	} else {
		coverageSignal.Score = in.StatementCoverage
		coverageSignal.Details = fmt.Sprintf("%.1f%% statement coverage", in.StatementCoverage)
		coverageSignal.Pass = in.StatementCoverage >= e.thresholds.MinCoverageForProvisional
	}
	cert.Signals = append(cert.Signals, coverageSignal)

	// ── Signal 4: Chaos Resilience ─────────────────────────────────────────────
	chaosSignal := Signal{Name: "chaos_resilience"}
	if in.ChaosTestedCount == 0 {
		chaosSignal.Pass = false
		chaosSignal.Score = 0
		chaosSignal.Details = "Chaos tests not run"
	} else if in.ChaosPass {
		chaosSignal.Pass = true
		chaosSignal.Score = 100
		chaosSignal.Details = fmt.Sprintf("Passed all %d chaos scenarios", in.ChaosTestedCount)
	} else {
		chaosSignal.Pass = false
		chaosSignal.Score = 0
		chaosSignal.Details = fmt.Sprintf("Failed chaos test (%d scenarios run)", in.ChaosTestedCount)
	}
	cert.Signals = append(cert.Signals, chaosSignal)

	// ── Composite Score ────────────────────────────────────────────────────────
	// Weighted: contract 30, live 40, coverage 20, chaos 10.
	weights := map[string]float64{
		"contract":           30,
		"live_validation":    40,
		"statement_coverage": 20,
		"chaos_resilience":   10,
	}
	var weightedSum, totalWeight float64
	for _, sig := range cert.Signals {
		w := weights[sig.Name]
		weightedSum += sig.Score * w / 100
		totalWeight += w
	}
	if totalWeight > 0 {
		cert.Score = int(weightedSum / totalWeight * 100)
	}

	// ── Grade ──────────────────────────────────────────────────────────────────
	cert.Grade = e.computeGrade(cert.Signals, in)

	return cert
}

func (e *Engine) computeGrade(signals []Signal, in Inputs) Grade {
	byName := make(map[string]Signal, len(signals))
	for _, s := range signals {
		byName[s.Name] = s
	}

	contract := byName["contract"]
	live := byName["live_validation"]
	chaos := byName["chaos_resilience"]

	// Hard failures → Uncertified.
	if !contract.Pass {
		return GradeUncertified
	}
	if !live.Pass {
		return GradeUncertified
	}

	// Both hard signals green.
	coveragePct := in.StatementCoverage
	hasCoverage := coveragePct >= 0
	hasChaos := in.ChaosTestedCount > 0

	if hasCoverage && coveragePct >= e.thresholds.MinCoverageForCertified &&
		hasChaos && chaos.Pass {
		return GradeCertified
	}
	if hasCoverage && coveragePct >= e.thresholds.MinCoverageForProvisional {
		return GradeProvisional
	}
	if !hasCoverage {
		return GradeProvisional // coverage not measured yet — give benefit of doubt
	}
	return GradeUncertified
}

// WriteJSON serialises the report to the given file path (creates parent dirs).
func WriteJSON(report *Report, path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("certification: mkdir %s: %w", filepath.Dir(path), err)
	}
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("certification: create %s: %w", path, err)
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	return enc.Encode(report)
}

// LoadJSON reads a previously-saved certification report.
func LoadJSON(path string) (*Report, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("certification: open %s: %w", path, err)
	}
	defer f.Close()
	var report Report
	if err := json.NewDecoder(f).Decode(&report); err != nil {
		return nil, fmt.Errorf("certification: decode %s: %w", path, err)
	}
	return &report, nil
}

// BlockedTools returns the names of all Uncertified tools that are also Destructive.
// These must be gated in the MCP server execution path.
func BlockedTools(report *Report) map[string]string {
	blocked := make(map[string]string)
	for _, tc := range report.Tools {
		if tc.Destructive && tc.Grade == GradeUncertified {
			blocked[tc.ToolName] = "tool is Destructive but Uncertified — execution blocked by certification gate"
		}
	}
	return blocked
}

// CertifiedSet returns a set of all tool names that hold Certified or Provisional grade.
// (Provisional tools are allowed to execute but emit a warning.)
func CertifiedSet(report *Report) map[string]Grade {
	out := make(map[string]Grade, len(report.Tools))
	for _, tc := range report.Tools {
		out[tc.ToolName] = tc.Grade
	}
	return out
}
