package fleet

import (
	"testing"
)

func TestScoreAgainstTemplate_PerfectMatch(t *testing.T) {
	metrics := &ClusterMetrics{
		ClusterID:      "cluster-1",
		HealthScore:    95,
		SPOFCount:      0,
		PDBCoverage:    100,
		HPACoverage:    80,
		NetPolCoverage: 100,
	}

	reqs := TemplateRequirements{
		MinHealthScore:    80,
		MaxSPOFs:          2,
		MinPDBCoverage:    90,
		MinHPACoverage:    50,
		MinNetPolCoverage: 80,
	}

	score := ScoreAgainstTemplate(metrics, reqs)

	if score.ClusterID != "cluster-1" {
		t.Errorf("expected cluster ID 'cluster-1', got %q", score.ClusterID)
	}
	if score.MatchPercent != 100 {
		t.Errorf("expected 100%% match, got %f", score.MatchPercent)
	}
	if score.GapCount != 0 {
		t.Errorf("expected 0 gaps, got %d: %v", score.GapCount, score.Gaps)
	}
}

func TestScoreAgainstTemplate_MultipleGaps(t *testing.T) {
	metrics := &ClusterMetrics{
		ClusterID:      "cluster-2",
		HealthScore:    40,
		SPOFCount:      10,
		PDBCoverage:    20,
		HPACoverage:    10,
		NetPolCoverage: 0,
	}

	reqs := TemplateRequirements{
		MinHealthScore:    80,
		MaxSPOFs:          2,
		MinPDBCoverage:    90,
		MinHPACoverage:    50,
		MinNetPolCoverage: 80,
	}

	score := ScoreAgainstTemplate(metrics, reqs)

	if score.MatchPercent >= 50 {
		t.Errorf("expected <50%% match for many gaps, got %f", score.MatchPercent)
	}
	if score.GapCount == 0 {
		t.Error("expected non-zero gap count")
	}
	if len(score.Gaps) != score.GapCount {
		t.Errorf("gap count mismatch: GapCount=%d, len(Gaps)=%d", score.GapCount, len(score.Gaps))
	}

	// Should have gaps for: health_score, spof_count, pdb_coverage, hpa_coverage, netpol_coverage
	if score.GapCount < 5 {
		t.Errorf("expected at least 5 gaps, got %d", score.GapCount)
	}
}

func TestScoreAgainstTemplate_NilMetrics(t *testing.T) {
	reqs := TemplateRequirements{MinHealthScore: 80}
	score := ScoreAgainstTemplate(nil, reqs)

	if score.GapCount == 0 {
		t.Error("expected gap for nil metrics")
	}
	if score.MatchPercent != 0 {
		t.Errorf("expected 0%% match for nil metrics, got %f", score.MatchPercent)
	}
}

func TestScoreAgainstTemplate_OptionalChecks(t *testing.T) {
	metrics := &ClusterMetrics{
		ClusterID:      "cluster-3",
		HealthScore:    90,
		SPOFCount:      0,
		PDBCoverage:    100,
		HPACoverage:    100,
		NetPolCoverage: 100,
	}

	reqs := TemplateRequirements{
		MinHealthScore:      80,
		MaxSPOFs:            0,
		MinPDBCoverage:      90,
		MinHPACoverage:      50,
		MinNetPolCoverage:   80,
		MaxBlastRadius:      10,
		RequireLimits:       true,
		RequireAntiAffinity: true,
	}

	score := ScoreAgainstTemplate(metrics, reqs)

	// With SPOFCount=0, health=90: all checks should pass
	// 5 base checks + MaxBlastRadius + RequireLimits + RequireAntiAffinity = 8 total
	if score.GapCount != 0 {
		t.Errorf("expected 0 gaps for good cluster with optional checks, got %d: %v",
			score.GapCount, score.Gaps)
	}
	if score.MatchPercent != 100 {
		t.Errorf("expected 100%% match, got %f", score.MatchPercent)
	}
}

func TestScoreAgainstTemplate_SPOFsFailBlastRadius(t *testing.T) {
	metrics := &ClusterMetrics{
		ClusterID:      "cluster-4",
		HealthScore:    60,
		SPOFCount:      5,
		PDBCoverage:    100,
		HPACoverage:    100,
		NetPolCoverage: 100,
	}

	reqs := TemplateRequirements{
		MinHealthScore:    50,
		MaxSPOFs:          10,
		MinPDBCoverage:    50,
		MinHPACoverage:    50,
		MinNetPolCoverage: 50,
		MaxBlastRadius:    5,
	}

	score := ScoreAgainstTemplate(metrics, reqs)

	// SPOFCount=5 <= MaxSPOFs=10 passes, but MaxBlastRadius check fails because SPOFCount > 0
	blastRadiusGap := false
	for _, g := range score.Gaps {
		if g == "blast_radius: cluster has SPOFs which increase blast radius beyond acceptable threshold" {
			blastRadiusGap = true
		}
	}
	if !blastRadiusGap {
		t.Error("expected blast_radius gap when cluster has SPOFs")
	}
}

func TestFormatFloat(t *testing.T) {
	tests := []struct {
		input    float64
		expected string
	}{
		{100, "100"},
		{0, "0"},
		{50.25, "50.25"},
		{3.10, "3.10"},
	}
	for _, tt := range tests {
		got := formatFloat(tt.input)
		if got != tt.expected {
			t.Errorf("formatFloat(%f) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestFormatInt(t *testing.T) {
	tests := []struct {
		input    int
		expected string
	}{
		{0, "0"},
		{42, "42"},
		{-5, "-5"},
		{1000, "1000"},
	}
	for _, tt := range tests {
		got := formatInt(tt.input)
		if got != tt.expected {
			t.Errorf("formatInt(%d) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}
