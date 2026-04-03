package fleet

import (
	"fmt"
	"sort"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// DRAssessment holds the disaster recovery readiness assessment between
// a primary and backup cluster.
type DRAssessment struct {
	PrimaryID        string      `json:"primary_id"`
	BackupID         string      `json:"backup_id"`
	ReadinessScore   float64     `json:"readiness_score"`    // 0-100
	WorkloadCoverage float64     `json:"workload_coverage"`  // % of primary workloads present in backup
	ResilienceParity float64     `json:"resilience_parity"`  // % of critical workloads equally resilient
	MissingWorkloads []string    `json:"missing_workloads"`
	ParityGaps       []ParityGap `json:"parity_gaps"`
	Recommendations  []string    `json:"recommendations"`
}

// ParityGap describes a single workload where the backup cluster's resilience
// configuration does not match the primary.
type ParityGap struct {
	WorkloadKey  string `json:"workload_key"`
	PrimaryState string `json:"primary_state"`
	BackupState  string `json:"backup_state"`
	Issue        string `json:"issue"`
}

// AssessDR compares a primary and backup cluster's snapshots to evaluate
// disaster recovery readiness. It checks:
//  1. Workload coverage: what fraction of primary workloads exist in the backup
//  2. Resilience parity: for workloads in both, whether they have equal resilience
//  3. Generates recommendations for improving DR posture
func AssessDR(primary, backup *graph.GraphSnapshot) *DRAssessment {
	result := &DRAssessment{
		MissingWorkloads: []string{},
		ParityGaps:       []ParityGap{},
		Recommendations:  []string{},
	}

	if primary == nil || backup == nil {
		result.Recommendations = append(result.Recommendations, "Unable to assess DR: one or both cluster snapshots unavailable")
		return result
	}

	// Build workload maps: "Kind/Namespace/Name" -> refKey
	primaryWorkloads := buildWorkloadMap(primary)
	backupWorkloads := buildWorkloadMap(backup)

	if len(primaryWorkloads) == 0 {
		result.WorkloadCoverage = 100
		result.ResilienceParity = 100
		result.ReadinessScore = 100
		return result
	}

	// --- Step 1: Workload coverage ---
	coveredCount := 0
	var missingWorkloads []string
	for wKey := range primaryWorkloads {
		if _, ok := backupWorkloads[wKey]; ok {
			coveredCount++
		} else {
			missingWorkloads = append(missingWorkloads, wKey)
		}
	}
	sort.Strings(missingWorkloads)
	result.MissingWorkloads = missingWorkloads
	result.WorkloadCoverage = float64(coveredCount) / float64(len(primaryWorkloads)) * 100.0

	// --- Step 2: Resilience parity for critical workloads ---
	// A workload is "critical" if its score >= 50 in the primary cluster.
	criticalWorkloads := make(map[string]string) // wKey -> refKey in primary
	for wKey, refKey := range primaryWorkloads {
		if primary.NodeScores[refKey] >= 50.0 {
			criticalWorkloads[wKey] = refKey
		}
	}

	parityMatches := 0
	totalCritical := 0
	var parityGaps []ParityGap

	for wKey, primaryRefKey := range criticalWorkloads {
		backupRefKey, inBackup := backupWorkloads[wKey]
		if !inBackup {
			continue // already counted as missing
		}
		totalCritical++

		pReplicas := primary.NodeReplicas[primaryRefKey]
		bReplicas := backup.NodeReplicas[backupRefKey]
		pHPA := primary.NodeHasHPA[primaryRefKey]
		bHPA := backup.NodeHasHPA[backupRefKey]
		pPDB := primary.NodeHasPDB[primaryRefKey]
		bPDB := backup.NodeHasPDB[backupRefKey]

		hasParity := true

		// Check replica parity
		if bReplicas < pReplicas {
			hasParity = false
			parityGaps = append(parityGaps, ParityGap{
				WorkloadKey:  wKey,
				PrimaryState: fmt.Sprintf("replicas=%d", pReplicas),
				BackupState:  fmt.Sprintf("replicas=%d", bReplicas),
				Issue:        "backup has fewer replicas",
			})
		}

		// Check HPA parity
		if pHPA && !bHPA {
			hasParity = false
			parityGaps = append(parityGaps, ParityGap{
				WorkloadKey:  wKey,
				PrimaryState: "has_hpa=true",
				BackupState:  "has_hpa=false",
				Issue:        "backup missing HPA",
			})
		}

		// Check PDB parity
		if pPDB && !bPDB {
			hasParity = false
			parityGaps = append(parityGaps, ParityGap{
				WorkloadKey:  wKey,
				PrimaryState: "has_pdb=true",
				BackupState:  "has_pdb=false",
				Issue:        "backup missing PDB",
			})
		}

		if hasParity {
			parityMatches++
		}
	}

	sort.Slice(parityGaps, func(i, j int) bool {
		if parityGaps[i].WorkloadKey != parityGaps[j].WorkloadKey {
			return parityGaps[i].WorkloadKey < parityGaps[j].WorkloadKey
		}
		return parityGaps[i].Issue < parityGaps[j].Issue
	})
	result.ParityGaps = parityGaps

	if totalCritical > 0 {
		result.ResilienceParity = float64(parityMatches) / float64(totalCritical) * 100.0
	} else {
		result.ResilienceParity = 100.0 // no critical workloads to compare
	}

	// --- Step 3: Readiness score ---
	// Weighted: 50% workload coverage + 30% resilience parity + 20% backup health
	backupMetrics := AggregateCluster(backup)
	backupHealthNorm := backupMetrics.HealthScore // already 0-100

	result.ReadinessScore = result.WorkloadCoverage*0.50 +
		result.ResilienceParity*0.30 +
		backupHealthNorm*0.20

	if result.ReadinessScore > 100 {
		result.ReadinessScore = 100
	}
	if result.ReadinessScore < 0 {
		result.ReadinessScore = 0
	}

	// --- Step 4: Recommendations ---
	result.Recommendations = generateDRRecommendations(result)

	return result
}

// generateDRRecommendations produces actionable recommendations based on the
// DR assessment results.
func generateDRRecommendations(a *DRAssessment) []string {
	var recs []string

	if a.WorkloadCoverage < 100 {
		recs = append(recs, fmt.Sprintf(
			"Deploy %d missing workloads to backup cluster to achieve full coverage",
			len(a.MissingWorkloads),
		))
	}

	if a.ResilienceParity < 80 {
		recs = append(recs, "Critical workloads in backup lack resilience parity with primary; review replica counts, HPAs, and PDBs")
	}

	// Count specific gap types
	missingHPA := 0
	missingPDB := 0
	lowerReplicas := 0
	for _, g := range a.ParityGaps {
		switch g.Issue {
		case "backup missing HPA":
			missingHPA++
		case "backup missing PDB":
			missingPDB++
		case "backup has fewer replicas":
			lowerReplicas++
		}
	}

	if missingPDB > 0 {
		recs = append(recs, fmt.Sprintf(
			"Add PodDisruptionBudgets to %d critical workloads in backup cluster",
			missingPDB,
		))
	}
	if missingHPA > 0 {
		recs = append(recs, fmt.Sprintf(
			"Add HorizontalPodAutoscalers to %d critical workloads in backup cluster",
			missingHPA,
		))
	}
	if lowerReplicas > 0 {
		recs = append(recs, fmt.Sprintf(
			"Increase replica count for %d workloads in backup to match primary",
			lowerReplicas,
		))
	}

	if a.ReadinessScore >= 90 {
		recs = append(recs, "DR readiness is strong; schedule regular failover drills to validate")
	}

	if len(recs) == 0 {
		recs = []string{"No DR issues detected"}
	}

	return recs
}

// allWorkloadKeys returns a deduplicated, sorted list of all workload keys
// across both snapshots. This helper is used for comprehensive comparison.
func allWorkloadKeys(primary, backup *graph.GraphSnapshot) []string {
	seen := make(map[string]bool)
	for _, ref := range primary.Nodes {
		if isWorkloadKind(ref.Kind) {
			seen[workloadKey(ref)] = true
		}
	}
	for _, ref := range backup.Nodes {
		if isWorkloadKind(ref.Kind) {
			seen[workloadKey(ref)] = true
		}
	}
	keys := make([]string, 0, len(seen))
	for k := range seen {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// workloadKeyToRef parses a "Kind/Namespace/Name" key back to a ResourceRef.
func workloadKeyToRef(key string) models.ResourceRef {
	// Split on "/" — format is "Kind/Namespace/Name"
	parts := splitKey(key)
	if len(parts) != 3 {
		return models.ResourceRef{}
	}
	return models.ResourceRef{Kind: parts[0], Namespace: parts[1], Name: parts[2]}
}

// splitKey splits a "Kind/Namespace/Name" key into its parts.
func splitKey(key string) []string {
	var parts []string
	start := 0
	for i := 0; i < len(key); i++ {
		if key[i] == '/' {
			parts = append(parts, key[start:i])
			start = i + 1
		}
	}
	parts = append(parts, key[start:])
	return parts
}
