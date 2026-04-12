package graph

import (
	"fmt"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/otel"

	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
)

// ClassificationResult holds the output of the full impact classification engine.
type ClassificationResult struct {
	LostPods        map[string]bool
	ServiceImpacts  []models.ServiceImpact
	IngressImpacts  []models.IngressImpact
	ConsumerImpacts []models.ConsumerImpact
	BlastRadiusPct  float64
	ImpactSummary   models.ImpactSummary
	CoverageLevel   string
	CoverageNote    string
	ConfidenceScore int
	ConfidenceNote  string
}

// classifyImpact is the top-level entry point for the impact classification engine.
// It runs Steps 1-7 in sequence: lost pods -> service impact -> ingress impact ->
// consumer impact -> infrastructure overrides -> control-plane override -> summary.
func classifyImpact(snap *GraphSnapshot, target models.ResourceRef, failureMode string) *ClassificationResult {
	// Step 1: Compute lost pods
	lostPods := computeLostPods(snap, target, failureMode)

	// Step 2: Classify service impact
	svcImpacts := classifyServiceImpact(snap.ServiceEndpoints, lostPods, snap.PDBs, snap.ServicePodLabels)

	// Step 3: Classify ingress impact
	ingImpacts := classifyIngressImpact(snap, svcImpacts)

	// Step 4: Classify consumer impact (OTel trace-based)
	consumerImpacts := classifyConsumerImpact(snap, svcImpacts, snap.OTelServiceMap)

	// Step 5: Apply infrastructure overrides
	applyInfrastructureOverrides(snap, svcImpacts)

	// Step 6: Compute blast radius percentage
	blastPct := computeBlastRadiusPercent(svcImpacts, ingImpacts, consumerImpacts, snap.TotalWorkloads)

	// Step 7: Control-plane override
	blastPct = applyControlPlaneOverride(snap, target, lostPods, svcImpacts, blastPct)

	// Build summary
	summary := buildImpactSummary(svcImpacts, ingImpacts, consumerImpacts, snap.TotalWorkloads)

	// Determine coverage level
	coverageLevel, coverageNote := determineCoverage(snap)

	// Compute confidence score based on data sources
	confidenceScore, confidenceNote := computeConfidence(snap)

	return &ClassificationResult{
		LostPods:        lostPods,
		ServiceImpacts:  svcImpacts,
		IngressImpacts:  ingImpacts,
		ConsumerImpacts: consumerImpacts,
		BlastRadiusPct:  blastPct,
		ImpactSummary:   summary,
		CoverageLevel:   coverageLevel,
		CoverageNote:    coverageNote,
		ConfidenceScore: confidenceScore,
		ConfidenceNote:  confidenceNote,
	}
}

// computeLostPods returns the set of pod keys that would be lost under the given failure mode.
func computeLostPods(snap *GraphSnapshot, target models.ResourceRef, failureMode string) map[string]bool {
	lost := make(map[string]bool)
	targetKey := refKey(target)

	switch failureMode {
	case FailureModePodCrash:
		// Only the target pod itself is lost
		if target.Kind == "Pod" {
			lost[targetKey] = true
		}

	case FailureModeWorkloadDeletion:
		// All pods owned by the target workload
		for podKey, ownerKey := range snap.PodOwners {
			if ownerKey == targetKey {
				lost[podKey] = true
			}
		}

	case FailureModeNamespaceDeletion:
		// All pods in the target's namespace
		ns := target.Namespace
		if target.Kind == "Namespace" {
			ns = target.Name
		}
		for key, ref := range snap.Nodes {
			if ref.Kind == "Pod" && ref.Namespace == ns {
				lost[key] = true
			}
		}

	case FailureModeNodeDrain:
		// All pods scheduled on the target node are evicted
		nodeName := target.Name
		for podKey, podNode := range snap.PodNodes {
			if podNode == nodeName {
				lost[podKey] = true
			}
		}
	}

	return lost
}

// classifyServiceImpact classifies each Service's impact based on endpoint loss.
// For each service, it counts how many endpoints are lost, applies a threshold
// (from PDB or 50% default), and classifies as broken/degraded/self-healing.
func classifyServiceImpact(
	endpoints map[string][]corev1.EndpointAddress,
	lostPods map[string]bool,
	pdbs []policyv1.PodDisruptionBudget,
	servicePodLabels map[string]map[string]string,
) []models.ServiceImpact {
	var impacts []models.ServiceImpact

	for svcKey, addrs := range endpoints {
		total := len(addrs)
		if total == 0 {
			continue
		}

		// Count lost endpoints
		lostCount := 0
		for _, addr := range addrs {
			if addr.TargetRef != nil {
				podKey := fmt.Sprintf("Pod/%s/%s", addr.TargetRef.Namespace, addr.TargetRef.Name)
				if lostPods[podKey] {
					lostCount++
				}
			}
		}

		if lostCount == 0 {
			continue
		}

		remaining := total - lostCount
		svcRef := parseRefKey(svcKey)

		// Determine threshold from PDB or default 50%
		threshold := 0.5
		thresholdSource := "default:50%"

		podLabels := servicePodLabels[svcKey]
		if pdb, found := findMatchingPDBByLabels(pdbs, svcRef, podLabels, total); found {
			threshold = resolveIntOrPercent(*pdb.Spec.MinAvailable, total)
			thresholdSource = fmt.Sprintf("pdb:%s", pdb.Name)
		}

		// Classify
		remainingRatio := float64(remaining) / float64(total)
		var classification string
		switch {
		case remaining == 0:
			classification = "broken"
		case remainingRatio < threshold:
			classification = "degraded"
		default:
			classification = "self-healing"
		}

		impacts = append(impacts, models.ServiceImpact{
			Service:            svcRef,
			Classification:     classification,
			TotalEndpoints:     total,
			RemainingEndpoints: remaining,
			Threshold:          threshold,
			ThresholdSource:    thresholdSource,
			Note:               fmt.Sprintf("%d/%d endpoints lost", lostCount, total),
		})
	}

	return impacts
}

// classifyIngressImpact propagates worst-case backend service classification to ingresses.
func classifyIngressImpact(snap *GraphSnapshot, svcImpacts []models.ServiceImpact) []models.IngressImpact {
	if snap == nil {
		return nil
	}

	// Build a lookup of service key -> worst classification
	svcClassification := make(map[string]string)
	for _, si := range svcImpacts {
		key := refKey(si.Service)
		svcClassification[key] = si.Classification
	}

	var impacts []models.IngressImpact

	for nodeKey, ref := range snap.Nodes {
		if ref.Kind != "Ingress" {
			continue
		}

		hosts := snap.NodeIngress[nodeKey]
		worstCls := ""

		// Check forward edges: what services does this ingress depend on?
		for depKey := range snap.Forward[nodeKey] {
			depRef := snap.Nodes[depKey]
			if depRef.Kind == "Service" {
				if cls, ok := svcClassification[depKey]; ok {
					if worstCls == "" || classificationWorse(cls, worstCls) {
						worstCls = cls
					}
				}
			}
		}

		if worstCls == "" {
			continue
		}

		host := ""
		if len(hosts) > 0 {
			host = hosts[0]
		}

		impacts = append(impacts, models.IngressImpact{
			Ingress:        ref,
			Classification: worstCls,
			Host:           host,
			BackendService: "", // Could be enriched later
			Note:           fmt.Sprintf("worst backend: %s", worstCls),
		})
	}

	return impacts
}

// classifyConsumerImpact identifies consumer workloads via OTel trace data that
// depend on impacted services.
func classifyConsumerImpact(
	snap *GraphSnapshot,
	svcImpacts []models.ServiceImpact,
	serviceMap *otel.ServiceMap,
) []models.ConsumerImpact {
	if serviceMap == nil || len(svcImpacts) == 0 {
		return nil
	}

	// Build lookup: otel service name -> worst classification of impacted K8s services
	impactedWorkloads := make(map[string]string) // workload key -> classification
	for _, si := range svcImpacts {
		// Map K8s service to potential OTel service name
		// Convention: OTel service_name often matches the K8s service or deployment name
		impactedWorkloads[si.Service.Name] = si.Classification
	}

	var impacts []models.ConsumerImpact

	// For each edge in the OTel service map, if the target is impacted,
	// the source is a consumer
	for _, edge := range serviceMap.Edges {
		targetCls, ok := impactedWorkloads[edge.Target]
		if !ok {
			continue
		}

		// Resolve OTel source service to a K8s workload
		workloadRef := resolveOTelServiceToWorkload(snap, edge.Source)
		if workloadRef == nil {
			continue
		}

		impacts = append(impacts, models.ConsumerImpact{
			Workload:       *workloadRef,
			Classification: targetCls,
			DependsOn:      edge.Target,
			Note:           fmt.Sprintf("calls %s (%s) via traces", edge.Target, targetCls),
		})
	}

	return impacts
}

// resolveOTelServiceToWorkload matches an OTel service_name to a K8s Deployment/StatefulSet/DaemonSet.
func resolveOTelServiceToWorkload(snap *GraphSnapshot, otelServiceName string) *models.ResourceRef {
	if snap == nil {
		return nil
	}

	lower := strings.ToLower(otelServiceName)

	// Try to match against Deployment, StatefulSet, DaemonSet nodes
	for _, ref := range snap.Nodes {
		switch ref.Kind {
		case "Deployment", "StatefulSet", "DaemonSet":
			if strings.ToLower(ref.Name) == lower {
				r := ref
				return &r
			}
		}
	}

	return nil
}

// applyInfrastructureOverrides adds notes for critical system components.
func applyInfrastructureOverrides(snap *GraphSnapshot, svcImpacts []models.ServiceImpact) {
	if snap == nil {
		return
	}

	for i := range svcImpacts {
		si := &svcImpacts[i]
		comp, isCritical := matchCriticalComponent(si.Service.Namespace, si.Service.Name)
		if isCritical {
			si.Note = fmt.Sprintf("%s [CRITICAL: %s — %s]", si.Note, comp.ImpactScope, comp.Description)
		}
	}
}

// applyControlPlaneOverride returns 100% blast radius if the target is a broken control-plane component.
func applyControlPlaneOverride(
	snap *GraphSnapshot,
	target models.ResourceRef,
	lostPods map[string]bool,
	svcImpacts []models.ServiceImpact,
	blastPct float64,
) float64 {
	comp, isCritical := matchCriticalComponent(target.Namespace, target.Name)
	if !isCritical {
		return blastPct
	}

	if comp.ImpactScope == "control-plane" {
		// Control-plane failure is cluster-wide
		return 100.0
	}

	return blastPct
}

// computeBlastRadiusPercent computes a weighted blast radius percentage.
// Each impacted service contributes its classification weight (broken=1.0, degraded=0.5, self-healing=0.0).
// Non-critical kube-system resources get a 1.5x multiplier.
func computeBlastRadiusPercent(
	svcImpacts []models.ServiceImpact,
	ingImpacts []models.IngressImpact,
	consumerImpacts []models.ConsumerImpact,
	totalWorkloads int,
) float64 {
	if totalWorkloads == 0 {
		return 0
	}

	var totalWeight float64

	for _, si := range svcImpacts {
		weight := classificationWeight(si.Classification)
		if weight > 0 && isKubeSystemResource(si.Service.Namespace) {
			if _, isCritical := matchCriticalComponent(si.Service.Namespace, si.Service.Name); !isCritical {
				weight *= 1.5
			}
		}
		totalWeight += weight
	}

	for _, ii := range ingImpacts {
		totalWeight += classificationWeight(ii.Classification)
	}

	for _, ci := range consumerImpacts {
		totalWeight += classificationWeight(ci.Classification)
	}

	pct := (totalWeight / float64(totalWorkloads)) * 100.0
	if pct > 100.0 {
		pct = 100.0
	}
	return pct
}

// buildImpactSummary builds the summary counts and capacity notes.
func buildImpactSummary(
	svcImpacts []models.ServiceImpact,
	ingImpacts []models.IngressImpact,
	consumerImpacts []models.ConsumerImpact,
	totalWorkloads int,
) models.ImpactSummary {
	var broken, degraded, selfHealing int
	var notes []string

	for _, si := range svcImpacts {
		switch si.Classification {
		case "broken":
			broken++
		case "degraded":
			degraded++
		case "self-healing":
			selfHealing++
		}
	}

	for _, ii := range ingImpacts {
		switch ii.Classification {
		case "broken":
			broken++
		case "degraded":
			degraded++
		}
	}

	for _, ci := range consumerImpacts {
		switch ci.Classification {
		case "broken":
			broken++
			notes = append(notes, fmt.Sprintf("consumer %s/%s depends on broken service %s", ci.Workload.Namespace, ci.Workload.Name, ci.DependsOn))
		case "degraded":
			degraded++
		}
	}

	if notes == nil {
		notes = []string{}
	}

	return models.ImpactSummary{
		BrokenCount:      broken,
		DegradedCount:    degraded,
		SelfHealingCount: selfHealing,
		TotalWorkloads:   totalWorkloads,
		CapacityNotes:    notes,
	}
}

// determineCoverage returns the coverage level based on available data sources.
func determineCoverage(snap *GraphSnapshot) (string, string) {
	hasEndpoints := len(snap.ServiceEndpoints) > 0
	hasTraces := snap.OTelServiceMap != nil && len(snap.OTelServiceMap.Edges) > 0

	switch {
	case hasEndpoints && hasTraces:
		return "full", "endpoint + trace data available"
	case hasEndpoints:
		return "partial", "endpoint data only, no trace data"
	case hasTraces:
		return "partial", "trace data only, no endpoint data"
	default:
		return "graph-only", "no endpoint or trace data — classification based on graph topology only"
	}
}

// --- Helper functions ---

// classificationWeight returns the numeric weight for a classification string.
func classificationWeight(cls string) float64 {
	switch cls {
	case "broken":
		return 1.0
	case "degraded":
		return 0.5
	case "self-healing":
		return 0.0
	default:
		return 0.0
	}
}

// classificationWorse returns true if a is worse than b.
func classificationWorse(a, b string) bool {
	return classificationRank(a) > classificationRank(b)
}

// classificationRank returns a numeric rank for comparison. Higher = worse.
func classificationRank(cls string) int {
	switch cls {
	case "broken":
		return 3
	case "degraded":
		return 2
	case "self-healing":
		return 1
	default:
		return 0
	}
}

// extractNamespace splits a "Kind/Namespace/Name" key and returns the Namespace.
func extractNamespace(refKeyStr string) string {
	parts := strings.SplitN(refKeyStr, "/", 3)
	if len(parts) >= 2 {
		return parts[1]
	}
	return ""
}

// parseRefKey parses a "Kind/Namespace/Name" key into a ResourceRef.
func parseRefKey(key string) models.ResourceRef {
	parts := strings.SplitN(key, "/", 3)
	if len(parts) == 3 {
		return models.ResourceRef{Kind: parts[0], Namespace: parts[1], Name: parts[2]}
	}
	return models.ResourceRef{Name: key}
}

// resolveIntOrPercent converts an IntOrString value to a ratio (0.0 to 1.0) relative to total.
func resolveIntOrPercent(val intstr.IntOrString, total int) float64 {
	if total == 0 {
		return 0
	}
	switch val.Type {
	case intstr.Int:
		return float64(val.IntVal) / float64(total)
	case intstr.String:
		// Parse percentage string like "50%"
		s := strings.TrimSuffix(val.StrVal, "%")
		var pct float64
		fmt.Sscanf(s, "%f", &pct)
		return pct / 100.0
	default:
		return 0.5
	}
}

// findMatchingPDBByLabels finds a PDB whose selector matches the actual pod labels
// backing a service. Falls back to a name-contains heuristic if pod labels are unavailable.
func findMatchingPDBByLabels(
	pdbs []policyv1.PodDisruptionBudget,
	svcRef models.ResourceRef,
	podLabels map[string]string,
	totalEndpoints int,
) (*policyv1.PodDisruptionBudget, bool) {
	for i := range pdbs {
		pdb := &pdbs[i]
		if pdb.Namespace != svcRef.Namespace {
			continue
		}
		if pdb.Spec.MinAvailable == nil {
			continue
		}
		if pdb.Spec.Selector == nil {
			continue
		}
		// Primary: match PDB selector against actual pod labels
		if podLabels != nil && len(pdb.Spec.Selector.MatchLabels) > 0 {
			allMatch := true
			for k, v := range pdb.Spec.Selector.MatchLabels {
				if podLabels[k] != v {
					allMatch = false
					break
				}
			}
			if allMatch {
				return pdb, true
			}
		}
		// Fallback: name heuristic
		for _, v := range pdb.Spec.Selector.MatchLabels {
			if strings.Contains(svcRef.Name, v) {
				return pdb, true
			}
		}
	}
	return nil, false
}

// computeConfidence scores how much to trust the blast-radius result based on
// which data sources were available during classification.
func computeConfidence(snap *GraphSnapshot) (int, string) {
	score := 0
	var sources []string

	hasEndpoints := len(snap.ServiceEndpoints) > 0
	hasTraces := snap.OTelServiceMap != nil && len(snap.OTelServiceMap.Edges) > 0
	hasPDBs := len(snap.PDBs) > 0
	hasHPAs := false
	for _, v := range snap.NodeHasHPA {
		if v {
			hasHPAs = true
			break
		}
	}

	if hasEndpoints {
		score += 30
		sources = append(sources, "endpoints")
	}
	if hasTraces {
		score += 30
		sources = append(sources, "traces")
	}
	if hasPDBs {
		score += 15
		sources = append(sources, "PDBs")
	}
	if hasHPAs {
		score += 10
		sources = append(sources, "HPAs")
	}
	if snap.TotalWorkloads > 10 {
		score += 15
		sources = append(sources, "large cluster")
	}

	if score > 100 {
		score = 100
	}

	note := ""
	if len(sources) == 0 {
		note = "Graph topology only — no runtime data available"
	} else {
		note = fmt.Sprintf("Based on: %s", strings.Join(sources, ", "))
	}

	return score, note
}
