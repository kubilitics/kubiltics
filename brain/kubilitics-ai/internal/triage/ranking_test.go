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

func TestRankCluster_OrdersProblemsBySeverity(t *testing.T) {
	now := time.Now()
	in := ClusterInput{
		Pods: []NamedPodState{
			{Kind: "Pod", Namespace: "default", Name: "web-1", State: PodState{Phase: "Running", Ready: true}},
			{Kind: "Pod", Namespace: "payments", Name: "redis-primary-0", State: PodState{Phase: "Running", WaitingReason: "CrashLoopBackOff", RestartCount: 47, LastExitCode: 137, FirstSeen: now.Add(-5 * time.Minute)}},
			{Kind: "Pod", Namespace: "logs", Name: "fluent-q", State: PodState{Phase: "Pending", SchedulingFailed: true, FirstSeen: now.Add(-2 * time.Minute)}},
		},
		Nodes: []NamedNodeState{
			{Name: "ip-10-0-1-4", State: NodeState{PressureKind: "memory", PressurePct: 94}},
		},
		Events: []NamedEventState{
			{Kind: "Event", Name: "FailedScheduling/fluent-q", State: EventState{Type: "Warning", Reason: "FailedScheduling", FirstSeen: now.Add(-1 * time.Minute)}},
		},
	}
	out := RankCluster(in)

	if len(out.TopProblems) < 2 {
		t.Fatalf("want at least 2 top problems, got %d", len(out.TopProblems))
	}
	// redis (0.70 base + restart bonus) must outrank fluent-q (Pending).
	if out.TopProblems[0].Name != "redis-primary-0" {
		t.Fatalf("expected redis-primary-0 first, got %q", out.TopProblems[0].Name)
	}
	if out.ClusterHealth != "critical" {
		t.Fatalf("cluster with CrashLoopBackOff should be critical, got %q", out.ClusterHealth)
	}
	if len(out.NodePressure) != 1 || out.NodePressure[0].Severity < 0.75 {
		t.Fatalf("expected 1 node pressure ≥ 0.75, got %+v", out.NodePressure)
	}
}

func TestRankCluster_HealthyAggregation(t *testing.T) {
	in := ClusterInput{
		Pods:   []NamedPodState{{Kind: "Pod", Namespace: "default", Name: "web-1", State: PodState{Phase: "Running", Ready: true}}},
		Nodes:  []NamedNodeState{{Name: "ip-10-0-1-1", State: NodeState{PressureKind: "memory", PressurePct: 35}}},
		Events: nil,
	}
	out := RankCluster(in)
	if out.ClusterHealth != "healthy" {
		t.Fatalf("expected healthy, got %q", out.ClusterHealth)
	}
	if len(out.TopProblems) != 0 {
		t.Fatalf("expected 0 problems, got %d", len(out.TopProblems))
	}
}

func TestRankProblems_CrashloopingFilter(t *testing.T) {
	now := time.Now()
	pods := []NamedPodState{
		{Kind: "Pod", Namespace: "a", Name: "healthy", State: PodState{Phase: "Running", Ready: true}},
		{Kind: "Pod", Namespace: "b", Name: "crash-x", State: PodState{Phase: "Running", WaitingReason: "CrashLoopBackOff", RestartCount: 9, FirstSeen: now.Add(-2 * time.Minute)}},
		{Kind: "Pod", Namespace: "b", Name: "crash-y", State: PodState{Phase: "Running", WaitingReason: "CrashLoopBackOff", RestartCount: 47, LastExitCode: 137, FirstSeen: now.Add(-20 * time.Minute)}},
	}
	out, truncated := RankProblems(pods, "crashlooping", 50)
	if truncated {
		t.Fatalf("unexpected truncation")
	}
	if len(out) != 2 {
		t.Fatalf("expected 2 crashlooping entries, got %d", len(out))
	}
	// crash-y (47 restarts + OOM) outranks crash-x (9 restarts).
	if out[0].Name != "crash-y" {
		t.Fatalf("expected crash-y first, got %q", out[0].Name)
	}
}

func TestRankProblems_TruncatesToLimit(t *testing.T) {
	var pods []NamedPodState
	for i := 0; i < 60; i++ {
		pods = append(pods, NamedPodState{Kind: "Pod", Namespace: "x", Name: "p", State: PodState{WaitingReason: "CrashLoopBackOff", RestartCount: 5}})
	}
	out, truncated := RankProblems(pods, "crashlooping", 50)
	if !truncated || len(out) != 50 {
		t.Fatalf("expected len=50 & truncated, got len=%d truncated=%v", len(out), truncated)
	}
}

func TestRankProblems_UnknownFilterReturnsEmpty(t *testing.T) {
	out, _ := RankProblems(nil, "unknownfilter", 50)
	if len(out) != 0 {
		t.Fatalf("unknown filter must return empty, got %d", len(out))
	}
}

func TestRankProblems_AllFiltersMatchOnlyExpected(t *testing.T) {
	now := time.Now()
	cases := []struct {
		filter     string
		match      PodState
		noMatch    PodState
		wantReason string
	}{
		{
			filter:     "oom",
			match:      PodState{Phase: "Running", LastReason: "OOMKilled", LastExitCode: 137},
			noMatch:    PodState{Phase: "Running", Ready: true},
			wantReason: "OOMKilled",
		},
		{
			filter:     "pending",
			match:      PodState{Phase: "Pending", SchedulingFailed: true},
			noMatch:    PodState{Phase: "Pending"}, // pending but NOT scheduling-failed
			wantReason: "FailedScheduling",
		},
		{
			filter:     "evicted",
			match:      PodState{Phase: "Failed", LastReason: "Evicted"},
			noMatch:    PodState{Phase: "Failed", LastReason: "Error"},
			wantReason: "Evicted",
		},
		{
			filter:     "image_pull_error",
			match:      PodState{Phase: "Pending", WaitingReason: "ErrImagePull"},
			noMatch:    PodState{Phase: "Running", WaitingReason: "CrashLoopBackOff"},
			wantReason: "ErrImagePull",
		},
		{
			filter:     "unhealthy",
			match:      PodState{Phase: "Running", Ready: false, FirstSeen: now.Add(-10 * time.Minute)},
			noMatch:    PodState{Phase: "Running", Ready: true},
			wantReason: "NotReady",
		},
	}
	for _, c := range cases {
		t.Run(c.filter, func(t *testing.T) {
			pods := []NamedPodState{
				{Kind: "Pod", Namespace: "ns", Name: "match", State: c.match},
				{Kind: "Pod", Namespace: "ns", Name: "nomatch", State: c.noMatch},
			}
			out, _ := RankProblems(pods, c.filter, 50)
			if len(out) != 1 {
				t.Fatalf("filter %q: expected exactly 1 match, got %d", c.filter, len(out))
			}
			if out[0].Name != "match" {
				t.Fatalf("filter %q: wrong pod matched: %q", c.filter, out[0].Name)
			}
			if out[0].Reason != c.wantReason {
				t.Fatalf("filter %q: reason=%q, want %q", c.filter, out[0].Reason, c.wantReason)
			}
		})
	}
}

func TestRankProblems_StableSortPreservesInputOrder(t *testing.T) {
	// Two pods with identical severity — stable sort must preserve input order.
	same := PodState{Phase: "Running", WaitingReason: "CrashLoopBackOff", RestartCount: 5}
	pods := []NamedPodState{
		{Kind: "Pod", Namespace: "a", Name: "first", State: same},
		{Kind: "Pod", Namespace: "a", Name: "second", State: same},
	}
	out, _ := RankProblems(pods, "crashlooping", 50)
	if len(out) != 2 || out[0].Name != "first" || out[1].Name != "second" {
		t.Fatalf("stable order broken: %+v", out)
	}
}
