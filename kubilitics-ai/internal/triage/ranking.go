// Package triage holds pure heuristics for ranking severity of Kubernetes
// workload problems. Callers shape upstream API data into the input structs
// here; this package imports no k8s.io/* types.
package triage

import "time"

// PodState is the minimal shape needed to score a Pod's problem severity.
// All fields optional; zero-value represents "not observed".
type PodState struct {
	Phase            string // Pending, Running, Succeeded, Failed
	WaitingReason   string // CrashLoopBackOff, ImagePullBackOff, ErrImagePull, etc.
	LastReason      string // OOMKilled, Error, etc.
	LastExitCode    int
	RestartCount    int
	Ready           bool
	SchedulingFailed bool
	FirstSeen       time.Time
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
