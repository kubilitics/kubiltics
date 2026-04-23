package triage

import (
	"testing"
	"time"
)

func TestScorePod(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name   string
		in     PodState
		minOut float64
		maxOut float64
	}{
		{"crashloop_high_restarts", PodState{Phase: "Running", WaitingReason: "CrashLoopBackOff", RestartCount: 47, LastExitCode: 137, FirstSeen: now.Add(-10 * time.Minute)}, 0.85, 1.00},
		{"oomkilled_recent", PodState{Phase: "Running", LastExitCode: 137, LastReason: "OOMKilled", FirstSeen: now.Add(-5 * time.Minute)}, 0.70, 0.95},
		{"pending_unsched", PodState{Phase: "Pending", SchedulingFailed: true, FirstSeen: now.Add(-2 * time.Minute)}, 0.55, 0.85},
		{"image_pull_error", PodState{Phase: "Pending", WaitingReason: "ImagePullBackOff", FirstSeen: now.Add(-1 * time.Minute)}, 0.55, 0.85},
		{"running_healthy", PodState{Phase: "Running", Ready: true, RestartCount: 0}, 0.00, 0.10},
		{"completed_job", PodState{Phase: "Succeeded", Ready: false}, 0.00, 0.10},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ScorePod(c.in)
			if got < c.minOut || got > c.maxOut {
				t.Fatalf("ScorePod = %.3f, want in [%.2f, %.2f]", got, c.minOut, c.maxOut)
			}
		})
	}
}

func TestScorePod_Monotonic(t *testing.T) {
	healthy := PodState{Phase: "Running", Ready: true}
	restarting := PodState{Phase: "Running", WaitingReason: "CrashLoopBackOff", RestartCount: 3}
	frequent := PodState{Phase: "Running", WaitingReason: "CrashLoopBackOff", RestartCount: 47, LastExitCode: 137}

	if !(ScorePod(healthy) < ScorePod(restarting) && ScorePod(restarting) < ScorePod(frequent)) {
		t.Fatalf("monotonicity broken: healthy=%.3f restarting=%.3f frequent=%.3f",
			ScorePod(healthy), ScorePod(restarting), ScorePod(frequent))
	}
}

func TestScoreNode(t *testing.T) {
	cases := []struct {
		name   string
		in     NodeState
		minOut float64
		maxOut float64
	}{
		{"memory_critical", NodeState{PressureKind: "memory", PressurePct: 94}, 0.75, 1.00},
		{"cpu_high", NodeState{PressureKind: "cpu", PressurePct: 85}, 0.50, 0.85},
		{"disk_critical", NodeState{PressureKind: "disk", PressurePct: 99}, 0.80, 1.00},
		{"healthy", NodeState{PressureKind: "memory", PressurePct: 40}, 0.00, 0.20},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ScoreNode(c.in)
			if got < c.minOut || got > c.maxOut {
				t.Fatalf("ScoreNode = %.3f, want in [%.2f, %.2f]", got, c.minOut, c.maxOut)
			}
		})
	}
}

func TestScoreEvent(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name   string
		in     EventState
		minOut float64
		maxOut float64
	}{
		{"warning_recent", EventState{Type: "Warning", Reason: "FailedScheduling", FirstSeen: now.Add(-1 * time.Minute)}, 0.55, 0.85},
		{"warning_old", EventState{Type: "Warning", Reason: "FailedScheduling", FirstSeen: now.Add(-2 * time.Hour)}, 0.20, 0.55},
		{"normal", EventState{Type: "Normal", Reason: "Pulled", FirstSeen: now.Add(-1 * time.Minute)}, 0.00, 0.15},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ScoreEvent(c.in)
			if got < c.minOut || got > c.maxOut {
				t.Fatalf("ScoreEvent = %.3f, want in [%.2f, %.2f]", got, c.minOut, c.maxOut)
			}
		})
	}
}
