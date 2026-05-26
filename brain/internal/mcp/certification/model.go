// Package certification implements the Kubilitics tool certification engine.
//
// A "certification" is a structured quality verdict for each MCP tool,
// aggregating four independent signals:
//
//  1. Contract — does the tool satisfy all taxonomy invariants?
//  2. LiveValidation — did the tool pass Phase 2 live-cluster testing?
//  3. StatementCoverage — what % of its handler code is covered by tests?
//  4. ChaosResilience — did the tool survive the chaos test scenarios?
//
// The engine grades each tool as one of:
//
//	Certified   — all 4 signals green + coverage ≥ 80%
//	Provisional — contract + live pass, coverage 50-79%, no chaos data
//	Uncertified — contract fail OR live fail OR coverage < 50%
//
// Certification results are written to reports/certification/tool-certifications.json
// and checked at MCP server startup to gate destructive tool execution.
package certification

import "time"

// Grade is the certification verdict for a tool.
type Grade string

const (
	GradeCertified   Grade = "certified"   // all signals green, ready for production
	GradeProvisional Grade = "provisional" // contract+live pass, missing coverage or chaos
	GradeUncertified Grade = "uncertified" // hard failure on contract or live signal
)

// Signal is the result of one quality check.
type Signal struct {
	Name    string `json:"name"`
	Pass    bool   `json:"pass"`
	Score   float64 `json:"score,omitempty"` // 0-100 where applicable
	Details string `json:"details,omitempty"`
}

// ToolCertification holds the full certification result for one tool.
type ToolCertification struct {
	ToolName    string    `json:"tool_name"`
	Category    string    `json:"category"`
	Destructive bool      `json:"destructive"`
	Grade       Grade     `json:"grade"`
	Score       int       `json:"score"` // 0-100 composite
	Signals     []Signal  `json:"signals"`
	CertifiedAt time.Time `json:"certified_at"`
	Notes       string    `json:"notes,omitempty"`
}

// Report is the full certification run output.
type Report struct {
	GeneratedAt  time.Time           `json:"generated_at"`
	TotalTools   int                 `json:"total_tools"`
	Certified    int                 `json:"certified"`
	Provisional  int                 `json:"provisional"`
	Uncertified  int                 `json:"uncertified"`
	Tools        []ToolCertification `json:"tools"`
}

// Inputs holds all quality signals for a tool provided externally.
// Callers populate this from test results, coverage data, and live validation reports.
type Inputs struct {
	// ContractPass is true when all 11 taxonomy contract tests pass for this tool.
	ContractPass bool
	ContractNotes string

	// LiveValidationPass is true when Phase 2 live-cluster test passed.
	// LiveValidationTested is false if the tool was skipped (e.g. destructive).
	LiveValidationPass   bool
	LiveValidationTested bool
	LiveValidationNotes  string

	// StatementCoverage is the % of handler statements covered by tests (0-100).
	// -1 means not measured.
	StatementCoverage float64

	// ChaosPass is true when the tool survived all chaos test scenarios.
	// ChaosTestedCount is the number of scenarios executed (0 = not tested).
	ChaosPass       bool
	ChaosTestedCount int
}

// CertificationThresholds controls the grading cut-offs.
type CertificationThresholds struct {
	// MinCoverageForCertified is the minimum statement coverage % for Certified grade.
	MinCoverageForCertified float64 // default: 80.0
	// MinCoverageForProvisional is the minimum statement coverage % for Provisional grade.
	MinCoverageForProvisional float64 // default: 50.0
}

// DefaultThresholds returns the production thresholds.
func DefaultThresholds() CertificationThresholds {
	return CertificationThresholds{
		MinCoverageForCertified:   80.0,
		MinCoverageForProvisional: 50.0,
	}
}
