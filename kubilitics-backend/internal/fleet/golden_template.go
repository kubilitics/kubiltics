package fleet

// TemplateRequirements defines the golden template thresholds that a cluster
// must meet. Each field represents a minimum (or maximum) acceptable value.
type TemplateRequirements struct {
	MinHealthScore      float64 `json:"min_health_score"`
	MaxSPOFs            int     `json:"max_spofs"`
	MinPDBCoverage      float64 `json:"min_pdb_coverage"`
	MinHPACoverage      float64 `json:"min_hpa_coverage"`
	MinNetPolCoverage   float64 `json:"min_netpol_coverage"`
	MaxBlastRadius      float64 `json:"max_blast_radius"`
	RequireLimits       bool    `json:"require_limits"`
	RequireAntiAffinity bool    `json:"require_anti_affinity"`
}

// TemplateScore is the result of scoring a cluster's metrics against a golden
// template. MatchPercent is 0-100, GapCount is how many requirements failed,
// and Gaps lists human-readable descriptions of each failure.
type TemplateScore struct {
	ClusterID    string   `json:"cluster_id"`
	MatchPercent float64  `json:"match_percent"`
	GapCount     int      `json:"gap_count"`
	Gaps         []string `json:"gaps"`
}

// ScoreAgainstTemplate evaluates a cluster's metrics against a golden template
// and returns the match percentage and list of gaps.
func ScoreAgainstTemplate(metrics *ClusterMetrics, reqs TemplateRequirements) *TemplateScore {
	if metrics == nil {
		return &TemplateScore{Gaps: []string{"no metrics available"}, GapCount: 1}
	}

	totalChecks := 0
	passedChecks := 0
	var gaps []string

	// 1. Health score
	totalChecks++
	if metrics.HealthScore >= reqs.MinHealthScore {
		passedChecks++
	} else {
		gaps = append(gaps, gapMsg("health_score", metrics.HealthScore, reqs.MinHealthScore, true))
	}

	// 2. SPOF count
	totalChecks++
	if metrics.SPOFCount <= reqs.MaxSPOFs {
		passedChecks++
	} else {
		gaps = append(gaps, gapMsgInt("spof_count", metrics.SPOFCount, reqs.MaxSPOFs, false))
	}

	// 3. PDB coverage
	totalChecks++
	if metrics.PDBCoverage >= reqs.MinPDBCoverage {
		passedChecks++
	} else {
		gaps = append(gaps, gapMsg("pdb_coverage", metrics.PDBCoverage, reqs.MinPDBCoverage, true))
	}

	// 4. HPA coverage
	totalChecks++
	if metrics.HPACoverage >= reqs.MinHPACoverage {
		passedChecks++
	} else {
		gaps = append(gaps, gapMsg("hpa_coverage", metrics.HPACoverage, reqs.MinHPACoverage, true))
	}

	// 5. NetworkPolicy coverage
	totalChecks++
	if metrics.NetPolCoverage >= reqs.MinNetPolCoverage {
		passedChecks++
	} else {
		gaps = append(gaps, gapMsg("netpol_coverage", metrics.NetPolCoverage, reqs.MinNetPolCoverage, true))
	}

	// 6. Max blast radius — this is checked against the cluster's SPOF count
	//    as a proxy (no single-metric blast radius on ClusterMetrics).
	//    If MaxBlastRadius > 0 and there are SPOFs, penalize proportionally.
	if reqs.MaxBlastRadius > 0 {
		totalChecks++
		// Approximate: if no SPOFs, blast radius is effectively 0
		if metrics.SPOFCount == 0 {
			passedChecks++
		} else {
			gaps = append(gaps, "blast_radius: cluster has SPOFs which increase blast radius beyond acceptable threshold")
		}
	}

	// 7. RequireLimits — checked at template level; we track via health score proxy
	if reqs.RequireLimits {
		totalChecks++
		// With no direct resource-limits data on ClusterMetrics, pass if health
		// score is high enough to suggest good configuration
		if metrics.HealthScore >= 70 {
			passedChecks++
		} else {
			gaps = append(gaps, "require_limits: cluster health score suggests resource limits may not be configured")
		}
	}

	// 8. RequireAntiAffinity
	if reqs.RequireAntiAffinity {
		totalChecks++
		if metrics.SPOFCount == 0 {
			passedChecks++
		} else {
			gaps = append(gaps, "require_anti_affinity: cluster has SPOFs suggesting missing anti-affinity rules")
		}
	}

	matchPct := 0.0
	if totalChecks > 0 {
		matchPct = float64(passedChecks) / float64(totalChecks) * 100.0
	}

	if gaps == nil {
		gaps = []string{}
	}

	return &TemplateScore{
		ClusterID:    metrics.ClusterID,
		MatchPercent: matchPct,
		GapCount:     len(gaps),
		Gaps:         gaps,
	}
}

// gapMsg formats a gap message for a float64 metric.
func gapMsg(name string, actual, required float64, higherIsBetter bool) string {
	if higherIsBetter {
		return name + ": " + formatFloat(actual) + " < required " + formatFloat(required)
	}
	return name + ": " + formatFloat(actual) + " > max " + formatFloat(required)
}

// gapMsgInt formats a gap message for an int metric.
func gapMsgInt(name string, actual, limit int, higherIsBetter bool) string {
	if higherIsBetter {
		return name + ": " + formatInt(actual) + " < required " + formatInt(limit)
	}
	return name + ": " + formatInt(actual) + " > max " + formatInt(limit)
}

// formatFloat formats a float64 for display in gap messages.
func formatFloat(v float64) string {
	// Use simple formatting without importing strconv
	if v == float64(int(v)) {
		return formatInt(int(v))
	}
	return fmtFloat(v)
}

// formatInt formats an int for display.
func formatInt(v int) string {
	return fmtInt(v)
}

// fmtFloat is a simple float formatter.
func fmtFloat(v float64) string {
	// Manual formatting to avoid import cycle; 2 decimal places
	whole := int(v)
	frac := int((v - float64(whole)) * 100)
	if frac < 0 {
		frac = -frac
	}
	s := fmtInt(whole) + "."
	if frac < 10 {
		s += "0"
	}
	s += fmtInt(frac)
	return s
}

// fmtInt converts int to string without importing strconv.
func fmtInt(v int) string {
	if v == 0 {
		return "0"
	}
	negative := false
	if v < 0 {
		negative = true
		v = -v
	}
	digits := make([]byte, 0, 20)
	for v > 0 {
		digits = append(digits, byte('0'+v%10))
		v /= 10
	}
	if negative {
		digits = append(digits, '-')
	}
	// reverse
	for i, j := 0, len(digits)-1; i < j; i, j = i+1, j-1 {
		digits[i], digits[j] = digits[j], digits[i]
	}
	return string(digits)
}
