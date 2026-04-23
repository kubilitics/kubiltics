// Package triage holds pure heuristics for ranking severity of Kubernetes
// workload problems. Callers shape upstream API data into the input structs
// here; this package imports no k8s.io/* types.
package triage

import (
	"sort"
	"time"
)

// PodState is the minimal shape needed to score a Pod's problem severity.
// All fields optional; zero-value represents "not observed".
type PodState struct {
	Phase            string // Pending, Running, Succeeded, Failed
	WaitingReason    string // CrashLoopBackOff, ImagePullBackOff, ErrImagePull, etc.
	LastReason       string // OOMKilled, Error, etc.
	LastExitCode     int
	RestartCount     int
	Ready            bool
	SchedulingFailed bool
	FirstSeen        time.Time
}

// NodeState captures resource-pressure signal from a single node.
type NodeState struct {
	PressureKind string  // memory | cpu | disk
	PressurePct  float64 // 0-100
}

// EventState captures the minimal shape of a K8s event for severity scoring.
type EventState struct {
	Type      string // Warning | Normal
	Reason    string
	FirstSeen time.Time
}

// ScorePod returns a severity score in [0, 1]. Higher = more broken.
func ScorePod(p PodState) float64 {
	// Succeeded jobs are not a problem.
	if p.Phase == "Succeeded" {
		return 0.0
	}
	// Healthy running pods score near zero.
	if p.Phase == "Running" && p.Ready && p.WaitingReason == "" && p.RestartCount == 0 {
		return 0.0
	}

	base := 0.0
	switch p.WaitingReason {
	case "CrashLoopBackOff":
		base = 0.70
	case "ImagePullBackOff", "ErrImagePull":
		base = 0.60
	case "CreateContainerConfigError":
		base = 0.55
	}
	if p.LastReason == "OOMKilled" || p.LastExitCode == 137 {
		base = max64(base, 0.70)
	}
	if p.Phase == "Pending" && p.SchedulingFailed {
		base = max64(base, 0.60)
	}
	if p.Phase == "Failed" {
		base = max64(base, 0.50)
	}

	// Add restart-frequency signal — caps at +0.25.
	if p.RestartCount > 0 {
		rf := float64(p.RestartCount) / 50.0
		if rf > 0.25 {
			rf = 0.25
		}
		base += rf
	}

	if base > 1.0 {
		base = 1.0
	}
	if base < 0.0 {
		base = 0.0
	}
	return base
}

// ScoreNode returns a node-pressure severity score in [0, 1]. Uses a
// quadratic curve so low utilization (<= 50%) stays near-zero while
// high utilization ramps sharply. Weights express category importance:
// disk > memory > cpu.
func ScoreNode(n NodeState) float64 {
	if n.PressurePct <= 0 {
		return 0.0
	}
	pct := n.PressurePct / 100.0
	curve := pct * pct
	switch n.PressureKind {
	case "disk":
		return clamp(curve*1.05, 0, 1)
	case "memory":
		return clamp(curve*0.95, 0, 1)
	case "cpu":
		return clamp(curve*0.85, 0, 1)
	default:
		return clamp(curve*0.85, 0, 1)
	}
}

// ScoreEvent returns a severity score in [0, 1]. Warnings age out linearly
// over one hour; Normal events always near zero.
func ScoreEvent(e EventState) float64 {
	if e.Type != "Warning" {
		return 0.05
	}
	age := time.Since(e.FirstSeen)
	if age < 0 {
		age = 0
	}
	// Linear decay: 0 min → 0.85, 60 min → 0.35, >60 min → floor 0.20.
	const recencyFloor = 0.20
	recencyBonus := 0.65 * (1.0 - clamp(age.Minutes()/60.0, 0, 1))
	return clamp(recencyFloor+recencyBonus, 0, 1)
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func max64(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

// NamedPodState tags a PodState with identity so RankCluster can emit
// human-addressable problem references.
type NamedPodState struct {
	Kind      string
	Namespace string
	Name      string
	State     PodState
}

// NamedNodeState tags a NodeState with a node name.
type NamedNodeState struct {
	Name  string
	State NodeState
}

// NamedEventState tags an EventState with a display identifier.
type NamedEventState struct {
	Kind  string
	Name  string
	State EventState
}

// ClusterInput is the structured bundle RankCluster operates on.
type ClusterInput struct {
	Pods   []NamedPodState
	Nodes  []NamedNodeState
	Events []NamedEventState
}

// RankedProblem is a single ranked entry for the triage top_problems list.
type RankedProblem struct {
	Kind      string    `json:"kind"`
	Namespace string    `json:"namespace,omitempty"`
	Name      string    `json:"name"`
	Severity  float64   `json:"severity"`
	Reason    string    `json:"reason,omitempty"`
	FirstSeen time.Time `json:"first_seen,omitempty"`
}

// NodePressure is a single ranked node-pressure entry.
type NodePressure struct {
	Node     string  `json:"node"`
	Kind     string  `json:"kind"`
	Pct      float64 `json:"pct"`
	Severity float64 `json:"severity"`
}

// ClusterRanking is the RankCluster output.
type ClusterRanking struct {
	ClusterHealth        string            `json:"cluster_health"` // healthy | degraded | critical
	TopProblems          []RankedProblem   `json:"top_problems"`
	NodePressure         []NodePressure    `json:"node_pressure"`
	RecentCriticalEvents []NamedEventState `json:"recent_critical_events,omitempty"`
}

const (
	// Filter thresholds — pods/nodes scoring below these are excluded from
	// the ranked output entirely. Tune via bench feedback.
	minPodSeverity  = 0.40
	minNodeSeverity = 0.50

	// Cluster-health aggregation cutoffs. "critical" wins if either axis
	// crosses its threshold; "degraded" is the shared secondary line.
	criticalPodSeverity  = 0.85
	criticalNodeSeverity = 0.80
	degradedSeverity     = 0.50

	// MaxTopProblems caps the returned ranked list size.
	MaxTopProblems = 10

	// maxRecentCriticalEvents caps the recent-warnings list emitted
	// alongside TopProblems.
	maxRecentCriticalEvents = 10
)

// RankCluster produces the ranked triage output. Pods and events are each
// scored and the top entries emitted; cluster_health is derived from the
// maximum severity seen across pods and nodes.
func RankCluster(in ClusterInput) ClusterRanking {
	out := ClusterRanking{}

	var problems []RankedProblem
	var maxSev float64
	for _, np := range in.Pods {
		s := ScorePod(np.State)
		if s < minPodSeverity {
			continue
		}
		reason := np.State.WaitingReason
		if reason == "" {
			reason = np.State.LastReason
		}
		if reason == "" && np.State.Phase == "Pending" && np.State.SchedulingFailed {
			reason = "FailedScheduling"
		}
		problems = append(problems, RankedProblem{
			Kind: np.Kind, Namespace: np.Namespace, Name: np.Name,
			Severity: s, Reason: reason, FirstSeen: np.State.FirstSeen,
		})
		if s > maxSev {
			maxSev = s
		}
	}
	sort.SliceStable(problems, func(i, j int) bool {
		return problems[i].Severity > problems[j].Severity
	})
	if len(problems) > MaxTopProblems {
		problems = problems[:MaxTopProblems]
	}
	out.TopProblems = problems

	var nodes []NodePressure
	var maxNode float64
	for _, nn := range in.Nodes {
		s := ScoreNode(nn.State)
		if s < minNodeSeverity {
			continue
		}
		nodes = append(nodes, NodePressure{
			Node: nn.Name, Kind: nn.State.PressureKind, Pct: nn.State.PressurePct, Severity: s,
		})
		if s > maxNode {
			maxNode = s
		}
	}
	sort.SliceStable(nodes, func(i, j int) bool { return nodes[i].Severity > nodes[j].Severity })
	out.NodePressure = nodes

	// Score each warning event, keep the top-N recent-critical entries.
	type scoredEvent struct {
		ne  NamedEventState
		sev float64
	}
	var scored []scoredEvent
	for _, ne := range in.Events {
		if ne.State.Type != "Warning" {
			continue
		}
		scored = append(scored, scoredEvent{ne: ne, sev: ScoreEvent(ne.State)})
	}
	sort.SliceStable(scored, func(i, j int) bool { return scored[i].sev > scored[j].sev })
	if len(scored) > maxRecentCriticalEvents {
		scored = scored[:maxRecentCriticalEvents]
	}
	crit := make([]NamedEventState, 0, len(scored))
	for _, s := range scored {
		crit = append(crit, s.ne)
	}
	out.RecentCriticalEvents = crit

	// Cluster health aggregation.
	switch {
	case maxSev >= criticalPodSeverity || maxNode >= criticalNodeSeverity:
		out.ClusterHealth = "critical"
	case maxSev >= degradedSeverity || maxNode >= degradedSeverity:
		out.ClusterHealth = "degraded"
	default:
		out.ClusterHealth = "healthy"
	}
	return out
}

// RankProblems applies a filter-enum predicate over NamedPodState and
// returns the severity-ranked matches. truncated=true signals the list
// hit the cap.
func RankProblems(pods []NamedPodState, filter string, limit int) (out []RankedProblem, truncated bool) {
	pred := problemPredicate(filter)
	if pred == nil {
		return nil, false
	}
	for _, np := range pods {
		if !pred(np.State) {
			continue
		}
		out = append(out, RankedProblem{
			Kind: np.Kind, Namespace: np.Namespace, Name: np.Name,
			Severity:  ScorePod(np.State),
			Reason:    predicateReason(filter, np.State),
			FirstSeen: np.State.FirstSeen,
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Severity > out[j].Severity })
	if limit > 0 && len(out) > limit {
		return out[:limit], true
	}
	return out, false
}

type podPredicate func(PodState) bool

func problemPredicate(filter string) podPredicate {
	switch filter {
	case "crashlooping":
		return func(p PodState) bool {
			return p.WaitingReason == "CrashLoopBackOff" || p.RestartCount > 5
		}
	case "oom":
		return func(p PodState) bool {
			return p.LastReason == "OOMKilled" || p.LastExitCode == 137
		}
	case "pending":
		return func(p PodState) bool {
			return p.Phase == "Pending" && p.SchedulingFailed
		}
	case "evicted":
		return func(p PodState) bool {
			return p.Phase == "Failed" && p.LastReason == "Evicted"
		}
	case "image_pull_error":
		return func(p PodState) bool {
			return p.WaitingReason == "ImagePullBackOff" || p.WaitingReason == "ErrImagePull"
		}
	case "unhealthy":
		return func(p PodState) bool {
			if p.Ready || p.Phase != "Running" {
				return false
			}
			// Require ≥5m unhealthy observation window. FirstSeen zero-value
			// fails the test — upstream callers must populate it for the
			// unhealthy filter to match.
			return !p.FirstSeen.IsZero() && time.Since(p.FirstSeen) >= 5*time.Minute
		}
	default:
		return nil
	}
}

func predicateReason(filter string, p PodState) string {
	switch filter {
	case "crashlooping":
		if p.WaitingReason != "" {
			return p.WaitingReason
		}
		return "RestartStorm"
	case "oom":
		return "OOMKilled"
	case "pending":
		return "FailedScheduling"
	case "evicted":
		return "Evicted"
	case "image_pull_error":
		if p.WaitingReason != "" {
			return p.WaitingReason
		}
		return "ImagePullError"
	case "unhealthy":
		return "NotReady"
	}
	return ""
}
