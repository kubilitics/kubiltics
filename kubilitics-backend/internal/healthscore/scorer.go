package healthscore

import (
	"fmt"
	"math"
	"strings"
)

// ClusterState captures the live metrics needed by the scoring engine.
type ClusterState struct {
	TotalNodes    int `json:"total_nodes"`
	ReadyNodes    int `json:"ready_nodes"`
	DiskPressure  int `json:"disk_pressure"`
	MemPressure   int `json:"mem_pressure"`
	PIDPressure   int `json:"pid_pressure"`

	PodsRunning   int `json:"pods_running"`
	PodsPending   int `json:"pods_pending"`
	PodsFailed    int `json:"pods_failed"`
	PodsSucceeded int `json:"pods_succeeded"`
	PodsCrashLoop int `json:"pods_crash_loop"`
	PodsOOMKilled int `json:"pods_oom_killed"`

	DeploymentsTotal        int `json:"deployments_total"`
	DeploymentsAvailable    int `json:"deployments_available"`
	DeploymentsProgressing  int `json:"deployments_progressing"`
	DeploymentsUnavailable  int `json:"deployments_unavailable"`

	DaemonSetsTotal    int `json:"daemonsets_total"`
	DaemonSetsReady    int `json:"daemonsets_ready"`
	StatefulSetsTotal  int `json:"statefulsets_total"`
	StatefulSetsReady  int `json:"statefulsets_ready"`

	TotalRestarts  int `json:"total_restarts"`
	WarningEvents  int `json:"warning_events"`
	CriticalEvents int `json:"critical_events"`
}

// Score evaluates a ClusterState and returns a complete HealthResult.
func Score(state ClusterState) HealthResult {
	categories := map[Category]*CategoryScore{
		CategoryNodes:     {Name: CategoryNodes, Score: 100},
		CategoryWorkloads: {Name: CategoryWorkloads, Score: 100},
		CategoryPods:      {Name: CategoryPods, Score: 100},
		CategoryStability: {Name: CategoryStability, Score: 100},
		CategoryEvents:    {Name: CategoryEvents, Score: 100},
	}

	// --- Nodes ---
	scoreNodes(state, categories[CategoryNodes])

	// --- Workloads ---
	scoreWorkloads(state, categories[CategoryWorkloads])

	// --- Pods ---
	scorePods(state, categories[CategoryPods])

	// --- Stability ---
	scoreStability(state, categories[CategoryStability])

	// --- Events ---
	scoreEvents(state, categories[CategoryEvents])

	// Clamp individual category scores to [0, 100].
	for _, cs := range categories {
		if cs.Score < 0 {
			cs.Score = 0
		}
	}

	// Weighted composite.
	composite := 0.0
	for cat, cs := range categories {
		composite += float64(cs.Score) * CategoryWeight[cat]
	}
	score := int(math.Round(composite))

	// Circuit breakers — clamp DOWN for catastrophic conditions.
	score = applyCircuitBreakers(state, score)

	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}

	// Collect all findings.
	var allFindings []Finding
	for _, cs := range categories {
		allFindings = append(allFindings, cs.Findings...)
	}

	grade, status := gradeFromScore(score)
	insight := buildInsight(score, allFindings)

	return HealthResult{
		Score:      score,
		Grade:      grade,
		Status:     status,
		Categories: categories,
		Findings:   allFindings,
		Insight:    insight,
	}
}

// ---------------------------------------------------------------------------
// Category scorers
// ---------------------------------------------------------------------------

func scoreNodes(s ClusterState, cs *CategoryScore) {
	notReady := s.TotalNodes - s.ReadyNodes
	for i := 0; i < notReady; i++ {
		addFinding(cs, SeverityCritical, "node-not-ready",
			fmt.Sprintf("Node %d/%d is NotReady", i+1, s.TotalNodes), "")
	}
	if s.DiskPressure > 0 {
		addFinding(cs, SeverityCritical, "disk-pressure",
			fmt.Sprintf("%d node(s) with DiskPressure", s.DiskPressure), "")
	}
	if s.MemPressure > 0 {
		addFinding(cs, SeverityCritical, "memory-pressure",
			fmt.Sprintf("%d node(s) with MemoryPressure", s.MemPressure), "")
	}
	if s.PIDPressure > 0 {
		addFinding(cs, SeverityWarning, "pid-pressure",
			fmt.Sprintf("%d node(s) with PIDPressure", s.PIDPressure), "")
	}
}

func scoreWorkloads(s ClusterState, cs *CategoryScore) {
	if s.DeploymentsTotal > 0 {
		for i := 0; i < s.DeploymentsUnavailable; i++ {
			if s.DeploymentsAvailable == 0 {
				addFinding(cs, SeverityCritical, "deployment-unavailable",
					fmt.Sprintf("Deployment %d/%d has 0 available replicas", i+1, s.DeploymentsTotal), "")
			} else {
				addFinding(cs, SeverityWarning, "deployment-degraded",
					fmt.Sprintf("Deployment %d/%d is partially unavailable", i+1, s.DeploymentsTotal), "")
			}
		}
	}
	if s.DaemonSetsTotal > 0 {
		notReady := s.DaemonSetsTotal - s.DaemonSetsReady
		for i := 0; i < notReady; i++ {
			addFinding(cs, SeverityWarning, "daemonset-not-ready",
				fmt.Sprintf("DaemonSet %d/%d not fully ready", i+1, s.DaemonSetsTotal), "")
		}
	}
	if s.StatefulSetsTotal > 0 {
		notReady := s.StatefulSetsTotal - s.StatefulSetsReady
		for i := 0; i < notReady; i++ {
			addFinding(cs, SeverityWarning, "statefulset-not-ready",
				fmt.Sprintf("StatefulSet %d/%d not fully ready", i+1, s.StatefulSetsTotal), "")
		}
	}
}

func scorePods(s ClusterState, cs *CategoryScore) {
	// CrashLoopBackOff — Critical, cap additional findings at 5.
	crashFindings := s.PodsCrashLoop
	if crashFindings > 5 {
		crashFindings = 5
	}
	for i := 0; i < crashFindings; i++ {
		addFinding(cs, SeverityCritical, "pod-crashloop",
			fmt.Sprintf("Pod in CrashLoopBackOff (%d total)", s.PodsCrashLoop), "")
	}

	// OOMKilled — Critical.
	if s.PodsOOMKilled > 0 {
		addFinding(cs, SeverityCritical, "pod-oomkilled",
			fmt.Sprintf("%d pod(s) OOMKilled", s.PodsOOMKilled), "")
	}

	// Failed — Critical.
	if s.PodsFailed > 0 {
		addFinding(cs, SeverityCritical, "pod-failed",
			fmt.Sprintf("%d pod(s) in Failed state", s.PodsFailed), "")
	}

	// Pending — Warning normally, Critical if >5.
	if s.PodsPending > 0 {
		sev := SeverityWarning
		if s.PodsPending > 5 {
			sev = SeverityCritical
		}
		addFinding(cs, sev, "pod-pending",
			fmt.Sprintf("%d pod(s) stuck Pending", s.PodsPending), "")
	}
}

func scoreStability(s ClusterState, cs *CategoryScore) {
	switch {
	case s.TotalRestarts > 50:
		addFinding(cs, SeverityCritical, "high-restarts",
			fmt.Sprintf("%d total container restarts detected", s.TotalRestarts), "")
	case s.TotalRestarts > 20:
		addFinding(cs, SeverityWarning, "moderate-restarts",
			fmt.Sprintf("%d total container restarts detected", s.TotalRestarts), "")
	case s.TotalRestarts > 5:
		addFinding(cs, SeverityInfo, "low-restarts",
			fmt.Sprintf("%d total container restarts detected", s.TotalRestarts), "")
	}
}

func scoreEvents(s ClusterState, cs *CategoryScore) {
	if s.CriticalEvents > 0 {
		addFinding(cs, SeverityCritical, "critical-events",
			fmt.Sprintf("%d critical event(s) detected", s.CriticalEvents), "")
	}
	switch {
	case s.WarningEvents > 10:
		addFinding(cs, SeverityWarning, "warning-events",
			fmt.Sprintf("%d warning events in recent window", s.WarningEvents), "")
	case s.WarningEvents > 3:
		addFinding(cs, SeverityInfo, "warning-events",
			fmt.Sprintf("%d warning events in recent window", s.WarningEvents), "")
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func addFinding(cs *CategoryScore, sev Severity, check, message, resource string) {
	f := Finding{
		Category: cs.Name,
		Severity: sev,
		Check:    check,
		Message:  message,
		Resource: resource,
	}
	cs.Findings = append(cs.Findings, f)
	cs.Score -= severityPenalty[sev]
}

func applyCircuitBreakers(s ClusterState, score int) int {
	// All nodes NotReady.
	if s.TotalNodes > 0 && s.ReadyNodes == 0 {
		if score > 10 {
			score = 10
		}
	} else if s.TotalNodes > 0 && float64(s.TotalNodes-s.ReadyNodes)/float64(s.TotalNodes) > 0.5 {
		// >50% nodes NotReady.
		if score > 30 {
			score = 30
		}
	}

	// All deployments unavailable.
	if s.DeploymentsTotal > 0 && s.DeploymentsAvailable == 0 {
		if score > 15 {
			score = 15
		}
	}

	// >50% pods Failed/CrashLoop.
	totalPods := s.PodsRunning + s.PodsPending + s.PodsFailed + s.PodsSucceeded
	badPods := s.PodsFailed + s.PodsCrashLoop
	if totalPods > 0 && float64(badPods)/float64(totalPods) > 0.5 {
		if score > 25 {
			score = 25
		}
	}

	return score
}

func gradeFromScore(score int) (string, string) {
	switch {
	case score >= 90:
		return "A", "healthy"
	case score >= 75:
		return "B", "good"
	case score >= 60:
		return "C", "degraded"
	case score >= 40:
		return "D", "unhealthy"
	default:
		return "F", "critical"
	}
}

func buildInsight(score int, findings []Finding) string {
	seen := make(map[string]bool)
	var criticals, warnings []string

	for _, f := range findings {
		if seen[f.Message] {
			continue
		}
		seen[f.Message] = true
		switch f.Severity {
		case SeverityCritical:
			criticals = append(criticals, f.Message)
		case SeverityWarning:
			warnings = append(warnings, f.Message)
		}
	}

	var parts []string
	// Collect unique critical messages first, then warnings, top 2 total.
	for _, msg := range criticals {
		if len(parts) >= 2 {
			break
		}
		parts = append(parts, msg)
	}
	for _, msg := range warnings {
		if len(parts) >= 2 {
			break
		}
		parts = append(parts, msg)
	}

	if len(parts) == 0 {
		return "Cluster is operating normally."
	}

	insight := strings.Join(parts, "; ")
	if score < 60 {
		insight += " Immediate investigation recommended."
	}
	return insight
}
