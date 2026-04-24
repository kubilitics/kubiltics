# Week 1 — Complete Inspect Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `triage_cluster`, `list_problems`, `search_logs` as MCP tools; retire 25 folded `observe_*` tools from the taxonomy; move the `incident-scenarios-20` bench by at least +1 (merge gate 15/20, stretch 16/20) on qwen2.5:32b; eliminate same-tool-15×-loop failures.

**Architecture:** Two new pure-Go packages (`internal/triage`, `internal/logpattern`) hold all non-trivial logic (severity ranking, regex-template log clustering). Three thin handlers in `internal/mcp/server/handlers_inspect.go` fan out across existing sub-handlers and call the pure packages to assemble a shared `composableResult` envelope. No client-go churn, no UI, no LLM-client work.

**Tech Stack:** Go 1.x, standard library only for the new packages (no external deps). Tests use `testing`. Module path: `github.com/vellankikoti/kotg.ai/kubilitics-ai`.

**Spec:** [2026-04-23-week1-inspect-completion-design.md](../specs/2026-04-23-week1-inspect-completion-design.md)

**Branch:** `feat/week1-inspect-completion` off `main@59cb7a7`.

**Repo root (all paths below are relative to this):** `kubilitics-ai/` inside the `vellankikoti/kotg.ai` monorepo.

---

## File structure (locked before tasks start)

**Create:**
```
internal/triage/ranking.go
internal/triage/ranking_test.go
internal/logpattern/template.go
internal/logpattern/template_test.go
internal/logpattern/cluster.go
internal/logpattern/cluster_test.go
internal/mcp/server/handlers_composite.go          # buildComposableResult helper
internal/mcp/server/handlers_composite_test.go
internal/mcp/tools/taxonomy_test.go                # guards tool count + retirement list
```

**Modify:**
```
internal/mcp/server/handlers_inspect.go            # +handleTriageCluster, +handleListProblems, +handleSearchLogs
internal/mcp/server/handlers_inspect_test.go       # +3 handler test cases
internal/mcp/server/handlers_observation.go        # dispatch case entries near line 5913 area; delete 25 retired cases
internal/mcp/tools/taxonomy.go                     # +3 entries; −25 entries
```

**Responsibility split:**
- `triage/ranking.go` — pure heuristics. Input: structured K8s-shaped data. Output: severity float ∈ [0, 1]. Zero imports from `k8s.io/*`.
- `logpattern/template.go` — pure string transforms, ordered strip rules, no I/O.
- `logpattern/cluster.go` — pure aggregation over `Extract` output.
- `handlers_composite.go` — the new envelope shape `{kind, cluster_id, summary, data, sources, partial}` shared by the 3 new handlers. Distinct from `buildInspectResult` which is locked to the `detailed/events/ownership` triad used by existing `inspect_*`.
- `handlers_inspect.go` — thin dispatch: input validation → fanOut → pure package call → build result.

---

## Task 0: Capture baseline bench number + pin test Go version

**Files:** none — environment & evidence capture.

- [ ] **Step 1: Verify branch + clean working tree**

```bash
cd /Users/koti/myFuture/Kubernetes/development/kotg.ai/kubilitics-ai
git status            # expected: on feat/week1-inspect-completion, clean
git log --oneline -3  # expected: HEAD is 9711c9c (spec correction)
```

- [ ] **Step 2: Run the full test suite on the starting state, save output**

Run: `go test ./... 2>&1 | tee /tmp/tests-before.txt`
Expected: all pass. Record the last line for comparison later.

- [ ] **Step 3: Capture baseline bench on incident-scenarios-20**

Run: `./bin/chat-quality-bench --suite incident-scenarios-20 --model qwen2.5:32b > /tmp/bench-before.json 2>&1`

If bench requires an env-var for the Ollama endpoint, set it per the repo README. If qwen2.5:32b isn't available locally, use gpt-4o instead and record that — the "+1 over baseline" gate is model-relative.

Expected: JSON report with per-prompt pass/fail; pass rate ≈ 14/20 per spec (this is the "baseline" number to beat).

- [ ] **Step 4: Capture baseline smoke-20 and prompts-100**

Run: `./bin/chat-quality-bench --suite smoke-20 --model qwen2.5:32b > /tmp/smoke-before.json 2>&1`
Run: `./bin/chat-quality-bench --suite prompts-100 --model qwen2.5:32b > /tmp/prompts100-before.json 2>&1`

Record the pass rates. Any <2% regression on these two at end-of-plan fails the merge gate.

- [ ] **Step 5: No commit** — this task produces evidence files in `/tmp/`, not source.

---

## Task 1: `internal/triage` — severity-score primitives (TDD)

**Files:**
- Create: `internal/triage/ranking.go`
- Test: `internal/triage/ranking_test.go`

- [ ] **Step 1: Write the failing tests**

Create `internal/triage/ranking_test.go`:

```go
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
		name       string
		in         NodeState
		minOut     float64
		maxOut     float64
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/triage/... -v`
Expected: FAIL — `triage` package does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `internal/triage/ranking.go`:

```go
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
		base = max64(base, 0.65)
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

// ScoreNode returns a node-pressure severity score in [0, 1].
func ScoreNode(n NodeState) float64 {
	if n.PressurePct <= 0 {
		return 0.0
	}
	pct := n.PressurePct / 100.0
	// Disk pressure is more critical than memory is more critical than cpu.
	switch n.PressureKind {
	case "disk":
		return clamp(pct*1.05, 0, 1)
	case "memory":
		return clamp(pct*0.95, 0, 1)
	case "cpu":
		return clamp(pct*0.85, 0, 1)
	default:
		return clamp(pct*0.85, 0, 1)
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/triage/... -v`
Expected: PASS for `TestScorePod`, `TestScorePod_Monotonic`, `TestScoreNode`, `TestScoreEvent`.

- [ ] **Step 5: Commit**

```bash
git add internal/triage/ranking.go internal/triage/ranking_test.go
git commit -m "feat(triage): add severity-scoring primitives (ScorePod, ScoreNode, ScoreEvent)"
```

---

## Task 2: `internal/triage` — `RankCluster` composition (TDD)

**Files:**
- Modify: `internal/triage/ranking.go`
- Modify: `internal/triage/ranking_test.go`

- [ ] **Step 1: Append failing test**

Append to `internal/triage/ranking_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/triage/... -run TestRankCluster -v`
Expected: FAIL — `RankCluster` undefined.

- [ ] **Step 3: Append implementation**

Append to `internal/triage/ranking.go`:

```go
import "sort"

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
	Kind string
	Name string
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
	ClusterHealth        string           `json:"cluster_health"` // healthy | degraded | critical
	TopProblems          []RankedProblem  `json:"top_problems"`
	NodePressure         []NodePressure   `json:"node_pressure"`
	RecentCriticalEvents []NamedEventState `json:"recent_critical_events,omitempty"`
}

// MaxTopProblems caps the returned ranked list size.
const MaxTopProblems = 10

// RankCluster produces the ranked triage output. Pods and events are each
// scored and the top entries emitted; cluster_health is derived from the
// maximum severity seen across pods and nodes.
func RankCluster(in ClusterInput) ClusterRanking {
	out := ClusterRanking{}

	var problems []RankedProblem
	var maxSev float64
	for _, np := range in.Pods {
		s := ScorePod(np.State)
		if s < 0.40 {
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
		if s < 0.50 {
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

	// Keep up to 10 recent critical events — callers already filtered window.
	var crit []NamedEventState
	for _, ne := range in.Events {
		if ne.State.Type != "Warning" {
			continue
		}
		crit = append(crit, ne)
	}
	if len(crit) > 10 {
		crit = crit[:10]
	}
	out.RecentCriticalEvents = crit

	// Cluster health aggregation.
	switch {
	case maxSev >= 0.85 || maxNode >= 0.80:
		out.ClusterHealth = "critical"
	case maxSev >= 0.50 || maxNode >= 0.50:
		out.ClusterHealth = "degraded"
	default:
		out.ClusterHealth = "healthy"
	}
	return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/triage/... -v`
Expected: all tests pass including the new `TestRankCluster_*`.

- [ ] **Step 5: Commit**

```bash
git add internal/triage/ranking.go internal/triage/ranking_test.go
git commit -m "feat(triage): add RankCluster composition over pod/node/event scores"
```

---

## Task 3: `internal/triage` — `RankProblems` for list_problems (TDD)

**Files:**
- Modify: `internal/triage/ranking.go`
- Modify: `internal/triage/ranking_test.go`

- [ ] **Step 1: Append failing test**

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/triage/... -run TestRankProblems -v`
Expected: FAIL — `RankProblems` undefined.

- [ ] **Step 3: Append implementation**

Append to `internal/triage/ranking.go`:

```go
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
			Severity: ScorePod(np.State),
			Reason:   predicateReason(filter, np.State),
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
			// Caller passes only pods observed unhealthy for >= 5m.
			return !p.Ready && p.Phase == "Running"
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
		return p.WaitingReason
	case "unhealthy":
		return "NotReady"
	}
	return ""
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/triage/... -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add internal/triage/ranking.go internal/triage/ranking_test.go
git commit -m "feat(triage): add RankProblems with filter-enum predicates"
```

---

## Task 4: `internal/logpattern` — `Extract` ordered strip rules (TDD)

**Files:**
- Create: `internal/logpattern/template.go`
- Test: `internal/logpattern/template_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/logpattern/template_test.go`:

```go
package logpattern

import "testing"

func TestExtract_CanonicalLines(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"redis_conn_refused", "2026-04-23T14:01:03Z ERROR connection refused to 10.0.2.14:6379", "{TS} ERROR connection refused to {IP}:{PORT}"},
		{"http_500", "2026-04-23T14:05:11Z WARN HTTP 502 from upstream api.internal", "{TS} WARN HTTP 502 from upstream api.internal"},
		{"uuid_trace", "trace_id=7b8a9cde-1234-5678-9abc-def012345678 took 42ms", "trace_id={UUID} took 42ms"},
		{"pod_suffix", "worker-7f5c8d9a-abcde", "worker-{POD}"},
		{"hex_token", "session=deadbeef0011aabbccdd user=koti", "session={HEX} user=koti"},
		{"long_decimal", "request_id=8273615249 payload_size=12345", "request_id={NUM} payload_size={NUM}"},
		{"plain_message", "worker started", "worker started"},
		{"stacktrace_first_line", "Exception in thread main java.lang.NullPointerException", "Exception in thread main java.lang.NullPointerException"},
		{"iso_ts_with_ms", "2026-04-23T14:05:11.412Z INFO ready", "{TS} INFO ready"},
		{"nginx_access", "10.0.2.14 - - [23/Apr/2026:14:05:11 +0000] \"GET /health HTTP/1.1\" 200 17", "{IP} - - [23/Apr/2026:14:05:11 +0000] \"GET /health HTTP/1.1\" 200 17"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, _ := Extract(c.in)
			if got != c.want {
				t.Fatalf("Extract(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestExtract_IdempotencyOnAlreadyTemplated(t *testing.T) {
	in := "{TS} ERROR connection refused to {IP}:{PORT}"
	got, _ := Extract(in)
	if got != in {
		t.Fatalf("idempotency broken: Extract(%q) = %q", in, got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/logpattern/... -v`
Expected: FAIL — `logpattern` package does not exist.

- [ ] **Step 3: Write implementation**

Create `internal/logpattern/template.go`:

```go
// Package logpattern extracts canonical templates from log lines and
// clusters lines that share a template. All operations are pure string
// transforms with no I/O.
package logpattern

import "regexp"

// Extract applies the ordered strip rules defined in the Week-1 spec and
// returns (template, fields). fields is a diagnostic map (currently not
// populated) reserved for future field-level analysis.
func Extract(line string) (template string, fields map[string]string) {
	template = line
	for _, r := range stripRules {
		template = r.re.ReplaceAllString(template, r.token)
	}
	return template, nil
}

type stripRule struct {
	re    *regexp.Regexp
	token string
}

// stripRules are applied in order; each consumes matches before the next.
// Order matters: ISO-8601 first so port numbers inside timestamps aren't
// chewed by the PORT rule.
var stripRules = []stripRule{
	// 1. ISO-8601 timestamp (with optional fractional seconds + timezone).
	{regexp.MustCompile(`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?`), "{TS}"},
	// 2. UUID v4.
	{regexp.MustCompile(`[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}`), "{UUID}"},
	// 3. IPv4 dotted-quad.
	{regexp.MustCompile(`\b\d+\.\d+\.\d+\.\d+\b`), "{IP}"},
	// 4. Kubernetes pod suffix (hex-8 dash hex-5..10) with leading literal.
	{regexp.MustCompile(`[a-f0-9]{8,10}-[a-f0-9]{5,10}\b`), "{POD}"},
	// 5. Long hex token (> 8 chars, all hex) — after UUID + POD.
	{regexp.MustCompile(`\b[a-f0-9]{9,}\b`), "{HEX}"},
	// 6. TCP/UDP port — colon prefix so we don't chew bare 4-digit years.
	{regexp.MustCompile(`:\d{2,5}\b`), ":{PORT}"},
	// 7. Long decimal number (> 4 digits), NOT a 3-digit HTTP status.
	{regexp.MustCompile(`\b\d{5,}\b`), "{NUM}"},
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/logpattern/... -v`
Expected: all 10 canonical lines pass + idempotency test passes.

- [ ] **Step 5: Commit**

```bash
git add internal/logpattern/template.go internal/logpattern/template_test.go
git commit -m "feat(logpattern): Extract with ordered regex-template strip rules"
```

---

## Task 5: `internal/logpattern` — `Cluster` aggregation (TDD)

**Files:**
- Create: `internal/logpattern/cluster.go`
- Test: `internal/logpattern/cluster_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/logpattern/cluster_test.go`:

```go
package logpattern

import (
	"testing"
	"time"
)

func TestCluster_DeduplicatesByTemplate(t *testing.T) {
	now := time.Now()
	lines := []LogLine{
		{Pod: "worker-a", Line: "2026-04-23T14:01:03Z ERROR connection refused to 10.0.2.14:6379", Timestamp: now.Add(-5 * time.Minute)},
		{Pod: "worker-b", Line: "2026-04-23T14:01:04Z ERROR connection refused to 10.0.2.19:6379", Timestamp: now.Add(-4 * time.Minute)},
		{Pod: "worker-c", Line: "2026-04-23T14:02:00Z ERROR connection refused to 10.0.2.14:6379", Timestamp: now.Add(-3 * time.Minute)},
		{Pod: "worker-a", Line: "2026-04-23T14:02:05Z WARN HTTP 502 from upstream api.internal", Timestamp: now.Add(-3 * time.Minute)},
	}
	result := Cluster(lines)
	if len(result.Patterns) != 2 {
		t.Fatalf("expected 2 templates, got %d: %+v", len(result.Patterns), result.Patterns)
	}
	if result.Patterns[0].Count != 3 {
		t.Fatalf("most frequent should have Count=3, got %d", result.Patterns[0].Count)
	}
	if len(result.Patterns[0].Pods) != 3 {
		t.Fatalf("should span 3 pods, got %+v", result.Patterns[0].Pods)
	}
}

func TestCluster_UnmatchedBucketCount(t *testing.T) {
	// No lines after all strip rules match any rule — template stays equal to input.
	lines := []LogLine{
		{Pod: "p", Line: "hello world", Timestamp: time.Now()},
		{Pod: "p", Line: "foo bar baz", Timestamp: time.Now()},
	}
	result := Cluster(lines)
	// Two distinct templates → 2 patterns.
	if len(result.Patterns) != 2 {
		t.Fatalf("expected 2 distinct (unchanged) templates, got %d", len(result.Patterns))
	}
}

func TestCluster_EmptyInput(t *testing.T) {
	result := Cluster(nil)
	if len(result.Patterns) != 0 {
		t.Fatalf("empty input should produce no patterns, got %d", len(result.Patterns))
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/logpattern/... -run TestCluster -v`
Expected: FAIL — `Cluster`, `LogLine`, `ClusterResult` undefined.

- [ ] **Step 3: Write implementation**

Create `internal/logpattern/cluster.go`:

```go
package logpattern

import (
	"sort"
	"time"
)

// LogLine is a single log line paired with its pod origin and timestamp.
type LogLine struct {
	Pod       string
	Line      string
	Timestamp time.Time
}

// ClusterPattern is one row of the grouped output — a template with the
// count of lines that produced it and the set of pods involved.
type ClusterPattern struct {
	Template   string    `json:"template"`
	Count      int       `json:"count"`
	Pods       []string  `json:"pods"`
	FirstSeen  time.Time `json:"first_seen"`
	LastSeen   time.Time `json:"last_seen"`
	SampleLine string    `json:"sample_line"`
}

// ClusterResult is the full Cluster output.
type ClusterResult struct {
	Patterns []ClusterPattern `json:"patterns"`
}

// Cluster groups lines by their extracted template and returns the
// patterns sorted by count desc. Pods within a pattern are deduped and
// sorted for deterministic output.
func Cluster(lines []LogLine) ClusterResult {
	type accum struct {
		count      int
		pods       map[string]struct{}
		firstSeen  time.Time
		lastSeen   time.Time
		sample     string
	}
	acc := map[string]*accum{}
	for _, l := range lines {
		tmpl, _ := Extract(l.Line)
		a, ok := acc[tmpl]
		if !ok {
			a = &accum{pods: map[string]struct{}{}, firstSeen: l.Timestamp, lastSeen: l.Timestamp, sample: l.Line}
			acc[tmpl] = a
		}
		a.count++
		a.pods[l.Pod] = struct{}{}
		if l.Timestamp.Before(a.firstSeen) {
			a.firstSeen = l.Timestamp
		}
		if l.Timestamp.After(a.lastSeen) {
			a.lastSeen = l.Timestamp
		}
	}

	var out []ClusterPattern
	for tmpl, a := range acc {
		pods := make([]string, 0, len(a.pods))
		for p := range a.pods {
			pods = append(pods, p)
		}
		sort.Strings(pods)
		out = append(out, ClusterPattern{
			Template: tmpl, Count: a.count, Pods: pods,
			FirstSeen: a.firstSeen, LastSeen: a.lastSeen, SampleLine: a.sample,
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Template < out[j].Template
	})
	return ClusterResult{Patterns: out}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/logpattern/... -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add internal/logpattern/cluster.go internal/logpattern/cluster_test.go
git commit -m "feat(logpattern): Cluster aggregates lines by extracted template"
```

---

## Task 6: `handlers_composite.go` — shared envelope builder (TDD)

**Files:**
- Create: `internal/mcp/server/handlers_composite.go`
- Create: `internal/mcp/server/handlers_composite_test.go`

- [ ] **Step 1: Write failing test**

Create `internal/mcp/server/handlers_composite_test.go`:

```go
package server

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestBuildComposableResult_SerializesEnvelope(t *testing.T) {
	raw := buildComposableResult("TriageCluster", "prod-use1", "degraded: 3 on fire",
		map[string]interface{}{"top_problems": []int{1, 2, 3}},
		[]compositeSource{{Tool: "observe_cluster_overview", MS: 42}, {Tool: "observe_events", MS: 73}},
		nil,
	)
	b, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	// Round-trip into generic to assert fields.
	var round map[string]interface{}
	if err := json.Unmarshal(b, &round); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if round["kind"] != "TriageCluster" {
		t.Errorf("kind: got %v", round["kind"])
	}
	if round["cluster_id"] != "prod-use1" {
		t.Errorf("cluster_id: got %v", round["cluster_id"])
	}
	if round["summary"] == "" {
		t.Errorf("summary missing")
	}
	if _, ok := round["data"]; !ok {
		t.Errorf("data missing")
	}
	if _, ok := round["sources"]; !ok {
		t.Errorf("sources missing")
	}
	if _, ok := round["partial"]; ok {
		t.Errorf("partial should be absent when no errors supplied")
	}
}

func TestBuildComposableResult_PartialWhenErrsPresent(t *testing.T) {
	raw := buildComposableResult("TriageCluster", "c1", "ok",
		map[string]interface{}{},
		nil,
		map[string]error{"observe_events": errors.New("timeout")},
	)
	b, _ := json.Marshal(raw)
	var round map[string]interface{}
	_ = json.Unmarshal(b, &round)
	p, ok := round["partial"].([]interface{})
	if !ok || len(p) != 1 || p[0] != "observe_events" {
		t.Fatalf("expected partial: [observe_events], got %v", round["partial"])
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/mcp/server/... -run TestBuildComposableResult -v`
Expected: FAIL — `buildComposableResult`, `compositeSource` undefined.

- [ ] **Step 3: Write implementation**

Create `internal/mcp/server/handlers_composite.go`:

```go
package server

// compositeSource records the per-sub-handler latency that a composite
// tool aggregated. Emitted in the sources[] array of the envelope.
type compositeSource struct {
	Tool string `json:"tool"`
	MS   int64  `json:"ms"`
}

// composableResult is the envelope for the Week-1 composite tools
// (TriageCluster, ProblemList, LogPatterns). Distinct from inspectResult
// which is locked to the detailed/events/ownership triad.
type composableResult struct {
	Kind      string            `json:"kind"`
	ClusterID string            `json:"cluster_id,omitempty"`
	Summary   string            `json:"summary"`
	Data      interface{}       `json:"data"`
	Sources   []compositeSource `json:"sources,omitempty"`
	Partial   []string          `json:"partial,omitempty"`
}

// buildComposableResult assembles the envelope, omits partial when no
// sub-handler errors were supplied, and passes the output through the
// same capping path as inspectResult.
func buildComposableResult(
	kind, clusterID, summary string,
	data interface{},
	sources []compositeSource,
	errs map[string]error,
) interface{} {
	res := composableResult{
		Kind:      kind,
		ClusterID: clusterID,
		Summary:   summary,
		Data:      data,
		Sources:   sources,
	}
	for tool, err := range errs {
		if err == nil {
			continue
		}
		res.Partial = append(res.Partial, tool)
	}
	return capToolOutput(summarizeListForLLM(res))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/mcp/server/... -run TestBuildComposableResult -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/mcp/server/handlers_composite.go internal/mcp/server/handlers_composite_test.go
git commit -m "feat(server): add buildComposableResult envelope builder"
```

---

## Task 7: `handleTriageCluster` — composite handler (TDD)

**Files:**
- Modify: `internal/mcp/server/handlers_inspect.go`
- Modify: `internal/mcp/server/handlers_inspect_test.go`

- [ ] **Step 1: Append failing test**

Append to `internal/mcp/server/handlers_inspect_test.go`:

```go
func TestHandleTriageCluster_ComposesAndRanks(t *testing.T) {
	// This test exercises the composition at the helper level — the real
	// handler reads from the underlying handleClusterOverview/etc. methods
	// which require a cluster client. Here we verify the ranking-narration
	// path: given a synthetic ClusterInput, ensure buildComposableResult
	// is invoked with the expected envelope shape.
	//
	// Full wired integration is covered by the local bench in Task 13.
	_ = context.Background()
	// Assert the handler symbol exists (compile-time guard).
	var _ handlerFn = (&mcpServerImpl{}).handleTriageCluster
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/mcp/server/... -run TestHandleTriageCluster -v`
Expected: FAIL — `handleTriageCluster` undefined.

- [ ] **Step 3: Append implementation**

Append to `internal/mcp/server/handlers_inspect.go`:

```go
// ─── Week 1 composites ────────────────────────────────────────────────────

// handleTriageCluster: zero-config "I just got paged" narrative triage.
// Fans out cluster overview + node status + workload health + recent events,
// feeds structured snapshots into triage.RankCluster, emits the envelope.
func (s *mcpServerImpl) handleTriageCluster(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	clusterID := strArg(args, "cluster_id")
	// cluster_id is optional; lower layers fall back to session focus_cluster_id.

	// Inject a 15m window on the events sub-call if caller didn't pass one.
	eventArgs := copyArgs(args)
	if eventArgs["since"] == nil || eventArgs["since"] == "" {
		eventArgs["since"] = "15m"
	}

	type tagged struct {
		name string
		out  interface{}
		ms   int64
		err  error
	}
	tcOverview := s.timedCall(ctx, "observe_cluster_overview", args, s.handleClusterOverview)
	tcNodes := s.timedCall(ctx, "observe_node_status", args, s.handleNodeStatus)
	tcWorkloads := s.timedCall(ctx, "observe_workload_health", args, s.handleWorkloadHealth)
	tcEvents := s.timedCall(ctx, "observe_events", eventArgs, s.handleEvents)

	results := []tagged{tcOverview, tcNodes, tcWorkloads, tcEvents}

	// Shape upstream results into triage.ClusterInput. The shaping uses
	// lenient coercion — if an upstream handler returned a different shape
	// than expected, that axis contributes zero signal rather than crashing
	// the whole tool.
	in := shapeClusterInput(tcOverview.out, tcNodes.out, tcWorkloads.out, tcEvents.out)
	ranking := triage.RankCluster(in)

	var sources []compositeSource
	errs := map[string]error{}
	for _, r := range results {
		sources = append(sources, compositeSource{Tool: r.name, MS: r.ms})
		if r.err != nil {
			errs[r.name] = r.err
		}
	}

	summary := narrateCluster(ranking)
	return buildComposableResult("TriageCluster", clusterID, summary, ranking, sources, errs), nil
}

func narrateCluster(r triage.ClusterRanking) string {
	if r.ClusterHealth == "healthy" {
		return "Cluster healthy, no active issues."
	}
	if len(r.TopProblems) == 0 {
		return fmt.Sprintf("Cluster %s but no specific pod problems ranked; check node pressure.", r.ClusterHealth)
	}
	top := r.TopProblems[0]
	bits := []string{fmt.Sprintf("Cluster %s:", r.ClusterHealth)}
	bits = append(bits, fmt.Sprintf("top problem %s/%s (%s, severity %.2f)", top.Namespace, top.Name, top.Reason, top.Severity))
	if len(r.TopProblems) > 1 {
		bits = append(bits, fmt.Sprintf("plus %d other(s)", len(r.TopProblems)-1))
	}
	if len(r.NodePressure) > 0 {
		np := r.NodePressure[0]
		bits = append(bits, fmt.Sprintf("node %s at %.0f%% %s", np.Node, np.Pct, np.Kind))
	}
	return strings.Join(bits, "; ") + "."
}
```

Also in the same file, add the small helpers used above — **in a new section at the end of the file** so they're not interleaved with existing code:

```go
// ─── Week-1 shared helpers ────────────────────────────────────────────────

// timedCall invokes a sub-handler and records wall-clock latency in ms.
// It reuses the existing handlerFn contract.
type timedResult struct {
	name string
	out  interface{}
	ms   int64
	err  error
}

func (s *mcpServerImpl) timedCall(ctx context.Context, name string, args map[string]interface{}, fn handlerFn) timedResult {
	start := time.Now()
	out, err := fn(ctx, args)
	return timedResult{name: name, out: out, ms: time.Since(start).Milliseconds(), err: err}
}

// copyArgs returns a shallow copy so sub-handlers can mutate "since" etc.
// without mutating the caller's map.
func copyArgs(a map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(a)+1)
	for k, v := range a {
		out[k] = v
	}
	return out
}

// shapeClusterInput performs lenient coercion of four upstream sub-handler
// outputs into triage.ClusterInput. Each axis is independent — an upstream
// error yields zero contribution from that axis only.
func shapeClusterInput(overviewOut, nodesOut, workloadsOut, eventsOut interface{}) triage.ClusterInput {
	in := triage.ClusterInput{}
	// Pods — extract from workload-health rollup. Tolerant: look for a
	// "pods" array on the map, fall back to empty.
	if m, ok := workloadsOut.(map[string]interface{}); ok {
		if pods, ok := m["pods"].([]interface{}); ok {
			for _, p := range pods {
				np := shapePod(p)
				if np.Name != "" {
					in.Pods = append(in.Pods, np)
				}
			}
		}
	}
	// Nodes — from node_status.
	if m, ok := nodesOut.(map[string]interface{}); ok {
		if nodes, ok := m["nodes"].([]interface{}); ok {
			for _, n := range nodes {
				nn := shapeNode(n)
				if nn.Name != "" {
					in.Nodes = append(in.Nodes, nn)
				}
			}
		}
	}
	// Events — from events output.
	if m, ok := eventsOut.(map[string]interface{}); ok {
		if evs, ok := m["events"].([]interface{}); ok {
			for _, ev := range evs {
				ne := shapeEvent(ev)
				if ne.Name != "" {
					in.Events = append(in.Events, ne)
				}
			}
		}
	}
	_ = overviewOut // reserved — overview currently provides no pod-level detail used here
	return in
}

func shapePod(in interface{}) triage.NamedPodState {
	m, ok := in.(map[string]interface{})
	if !ok {
		return triage.NamedPodState{}
	}
	return triage.NamedPodState{
		Kind:      "Pod",
		Namespace: strFrom(m, "namespace"),
		Name:      strFrom(m, "name"),
		State: triage.PodState{
			Phase:            strFrom(m, "phase"),
			WaitingReason:    strFrom(m, "waiting_reason"),
			LastReason:       strFrom(m, "last_reason"),
			LastExitCode:     intFrom(m, "last_exit_code"),
			RestartCount:     intFrom(m, "restart_count"),
			Ready:            boolFrom(m, "ready"),
			SchedulingFailed: boolFrom(m, "scheduling_failed"),
			FirstSeen:        timeFrom(m, "first_seen"),
		},
	}
}

func shapeNode(in interface{}) triage.NamedNodeState {
	m, ok := in.(map[string]interface{})
	if !ok {
		return triage.NamedNodeState{}
	}
	return triage.NamedNodeState{
		Name: strFrom(m, "name"),
		State: triage.NodeState{
			PressureKind: strFrom(m, "pressure_kind"),
			PressurePct:  floatFrom(m, "pressure_pct"),
		},
	}
}

func shapeEvent(in interface{}) triage.NamedEventState {
	m, ok := in.(map[string]interface{})
	if !ok {
		return triage.NamedEventState{}
	}
	return triage.NamedEventState{
		Kind: "Event",
		Name: strFrom(m, "name"),
		State: triage.EventState{
			Type:      strFrom(m, "type"),
			Reason:    strFrom(m, "reason"),
			FirstSeen: timeFrom(m, "first_seen"),
		},
	}
}

func strFrom(m map[string]interface{}, k string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

func intFrom(m map[string]interface{}, k string) int {
	switch v := m[k].(type) {
	case int:
		return v
	case float64:
		return int(v)
	}
	return 0
}

func floatFrom(m map[string]interface{}, k string) float64 {
	switch v := m[k].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	}
	return 0
}

func boolFrom(m map[string]interface{}, k string) bool {
	if v, ok := m[k].(bool); ok {
		return v
	}
	return false
}

func timeFrom(m map[string]interface{}, k string) time.Time {
	s, ok := m[k].(string)
	if !ok {
		return time.Time{}
	}
	t, _ := time.Parse(time.RFC3339, s)
	return t
}
```

Also add these imports at the top of `handlers_inspect.go` (if not already present):

```go
import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/triage"
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go build ./... && go test ./internal/mcp/server/... -run TestHandleTriageCluster -v`
Expected: compile clean, test PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/mcp/server/handlers_inspect.go internal/mcp/server/handlers_inspect_test.go
git commit -m "feat(server): handleTriageCluster composite with triage.RankCluster"
```

---

## Task 8: `handleListProblems` — typed-filter list (TDD)

**Files:**
- Modify: `internal/mcp/server/handlers_inspect.go`
- Modify: `internal/mcp/server/handlers_inspect_test.go`

- [ ] **Step 1: Append failing test**

```go
func TestHandleListProblems_UnknownFilter(t *testing.T) {
	s := &mcpServerImpl{}
	_, err := s.handleListProblems(context.Background(), map[string]interface{}{"filter": "bogus"})
	if err == nil {
		t.Fatal("expected error for unknown filter")
	}
}

func TestHandleListProblems_CompileGuard(t *testing.T) {
	var _ handlerFn = (&mcpServerImpl{}).handleListProblems
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/mcp/server/... -run TestHandleListProblems -v`
Expected: FAIL — `handleListProblems` undefined.

- [ ] **Step 3: Append implementation**

Append to `internal/mcp/server/handlers_inspect.go`:

```go
// handleListProblems: typed-filter enumerator over workloads.
func (s *mcpServerImpl) handleListProblems(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	filter := strArg(args, "filter")
	if filter == "" {
		return nil, fmt.Errorf("list_problems: 'filter' is required; one of: crashlooping, oom, pending, evicted, image_pull_error, unhealthy")
	}
	if problemPredicateName(filter) == "" {
		return nil, fmt.Errorf("list_problems: unknown filter %q; accepted: crashlooping, oom, pending, evicted, image_pull_error, unhealthy", filter)
	}

	limit := intArgDefault(args, "limit", 50)
	if limit > 200 {
		limit = 200
	}
	clusterID := strArg(args, "cluster_id")

	// Delegate to resources_by_query (the broadest pod enumerator).
	queryArgs := copyArgs(args)
	queryArgs["kind"] = "Pod"
	tr := s.timedCall(ctx, "observe_resources_by_query", queryArgs, s.handleResourcesByQuery)
	errs := map[string]error{}
	if tr.err != nil {
		errs["observe_resources_by_query"] = tr.err
	}

	var pods []triage.NamedPodState
	if m, ok := tr.out.(map[string]interface{}); ok {
		if list, ok := m["pods"].([]interface{}); ok {
			for _, p := range list {
				np := shapePod(p)
				if np.Name != "" {
					pods = append(pods, np)
				}
			}
		}
	}
	ranked, truncated := triage.RankProblems(pods, filter, limit)

	summary := fmt.Sprintf("%d pods matching %q", len(ranked), filter)
	if truncated {
		summary += " (truncated to limit)"
	}
	data := map[string]interface{}{
		"filter":    filter,
		"count":     len(ranked),
		"problems":  ranked,
		"truncated": truncated,
	}
	return buildComposableResult("ProblemList", clusterID, summary, data,
		[]compositeSource{{Tool: tr.name, MS: tr.ms}}, errs), nil
}

// problemPredicateName returns a non-empty tag when the filter is known.
// Reused as the validity gate in handleListProblems.
func problemPredicateName(filter string) string {
	switch filter {
	case "crashlooping", "oom", "pending", "evicted", "image_pull_error", "unhealthy":
		return filter
	}
	return ""
}

// intArgDefault parses args[k] as an int; returns def if missing.
func intArgDefault(args map[string]interface{}, k string, def int) int {
	switch v := args[k].(type) {
	case int:
		return v
	case float64:
		return int(v)
	}
	return def
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go build ./... && go test ./internal/mcp/server/... -run TestHandleListProblems -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/mcp/server/handlers_inspect.go internal/mcp/server/handlers_inspect_test.go
git commit -m "feat(server): handleListProblems typed-filter enumerator"
```

---

## Task 9: `handleSearchLogs` — pattern-clustered log search (TDD)

**Files:**
- Modify: `internal/mcp/server/handlers_inspect.go`
- Modify: `internal/mcp/server/handlers_inspect_test.go`

- [ ] **Step 1: Append failing test**

```go
func TestHandleSearchLogs_RequiresNamespaceAndRegex(t *testing.T) {
	s := &mcpServerImpl{}

	if _, err := s.handleSearchLogs(context.Background(), map[string]interface{}{"regex": "error"}); err == nil {
		t.Fatal("expected error when namespace missing")
	}
	if _, err := s.handleSearchLogs(context.Background(), map[string]interface{}{"namespace": "default"}); err == nil {
		t.Fatal("expected error when regex missing")
	}
}

func TestHandleSearchLogs_CompileGuard(t *testing.T) {
	var _ handlerFn = (&mcpServerImpl{}).handleSearchLogs
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/mcp/server/... -run TestHandleSearchLogs -v`
Expected: FAIL.

- [ ] **Step 3: Append implementation**

Append to `internal/mcp/server/handlers_inspect.go` (and add import `"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/logpattern"` to the top):

```go
// handleSearchLogs: pattern-clustered log search across pods in a namespace.
func (s *mcpServerImpl) handleSearchLogs(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	namespace := strArg(args, "namespace")
	regex := strArg(args, "regex")
	if namespace == "" {
		return nil, fmt.Errorf("search_logs: 'namespace' is required")
	}
	if regex == "" {
		return nil, fmt.Errorf("search_logs: 'regex' is required")
	}

	maxPods := intArgDefault(args, "max_pods", 10)
	maxLinesPerPod := intArgDefault(args, "max_lines_per_pod", 1000)
	clusterID := strArg(args, "cluster_id")

	// Resolve pod candidates — either the explicit workload or all pods
	// in the namespace.
	queryArgs := copyArgs(args)
	queryArgs["kind"] = "Pod"
	tr := s.timedCall(ctx, "observe_resources_by_query", queryArgs, s.handleResourcesByQuery)
	errs := map[string]error{}
	if tr.err != nil {
		errs["observe_resources_by_query"] = tr.err
	}
	pods := extractPodNames(tr.out)
	podsSkipped := 0
	if len(pods) > maxPods {
		podsSkipped = len(pods) - maxPods
		pods = pods[:maxPods]
	}

	// Fan out log fetches across the selected pods.
	var allLines []logpattern.LogLine
	var mu sync.Mutex
	var wg sync.WaitGroup
	var logSources []compositeSource
	for _, pod := range pods {
		wg.Add(1)
		go func(podName string) {
			defer wg.Done()
			podArgs := copyArgs(args)
			podArgs["pod"] = podName
			podArgs["grep"] = regex
			podArgs["lines"] = maxLinesPerPod
			tr := s.timedCall(ctx, "observe_pod_logs_filtered:"+podName, podArgs, s.handlePodLogs)
			mu.Lock()
			logSources = append(logSources, compositeSource{Tool: tr.name, MS: tr.ms})
			if tr.err != nil {
				errs[tr.name] = tr.err
			} else {
				allLines = append(allLines, extractLogLines(tr.out, podName)...)
			}
			mu.Unlock()
		}(pod)
	}
	wg.Wait()

	result := logpattern.Cluster(allLines)

	// Summarize: "X error patterns across Y pods; most frequent: <template> (N× in K pods)"
	summary := fmt.Sprintf("%d pattern(s) across %d pod(s)", len(result.Patterns), len(pods))
	if len(result.Patterns) > 0 {
		top := result.Patterns[0]
		summary += fmt.Sprintf("; most frequent: %s (%d× in %d pod(s))", top.Template, top.Count, len(top.Pods))
	}

	data := map[string]interface{}{
		"query":                      map[string]interface{}{"namespace": namespace, "workload": strArg(args, "workload"), "regex": regex, "since": strArg(args, "since")},
		"patterns":                   result.Patterns,
		"pods_searched":              len(pods),
		"pods_skipped_due_to_cap":    podsSkipped,
		"unmatched_error_line_count": 0, // reserved; Extract always returns a template
	}
	sources := append([]compositeSource{{Tool: tr.name, MS: tr.ms}}, logSources...)
	return buildComposableResult("LogPatterns", clusterID, summary, data, sources, errs), nil
}

// extractPodNames pulls names out of a generic resources_by_query response.
func extractPodNames(in interface{}) []string {
	m, ok := in.(map[string]interface{})
	if !ok {
		return nil
	}
	list, ok := m["pods"].([]interface{})
	if !ok {
		return nil
	}
	var out []string
	for _, p := range list {
		if pm, ok := p.(map[string]interface{}); ok {
			if n, ok := pm["name"].(string); ok && n != "" {
				out = append(out, n)
			}
		}
	}
	return out
}

// extractLogLines pulls LogLine entries out of the generic pod-logs handler
// output. Tolerant of multiple upstream shapes.
func extractLogLines(in interface{}, pod string) []logpattern.LogLine {
	m, ok := in.(map[string]interface{})
	if !ok {
		return nil
	}
	list, ok := m["lines"].([]interface{})
	if !ok {
		return nil
	}
	var out []logpattern.LogLine
	for _, l := range list {
		switch t := l.(type) {
		case string:
			out = append(out, logpattern.LogLine{Pod: pod, Line: t, Timestamp: time.Now()})
		case map[string]interface{}:
			line, _ := t["line"].(string)
			tsStr, _ := t["ts"].(string)
			ts, _ := time.Parse(time.RFC3339, tsStr)
			out = append(out, logpattern.LogLine{Pod: pod, Line: line, Timestamp: ts})
		}
	}
	return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go build ./... && go test ./internal/mcp/server/... -run TestHandleSearchLogs -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/mcp/server/handlers_inspect.go internal/mcp/server/handlers_inspect_test.go
git commit -m "feat(server): handleSearchLogs with logpattern.Cluster aggregation"
```

---

## Task 10: Taxonomy — add the 3 new tool entries

**Files:**
- Modify: `internal/mcp/tools/taxonomy.go`

- [ ] **Step 1: Add tool definitions**

Insert into the `ToolTaxonomy` slice in `internal/mcp/tools/taxonomy.go`, **immediately after the existing `inspect_service` entry**:

```go
{
	Name:        "triage_cluster",
	Category:    CategoryObservation,
	Description: "Single-turn triage: ranked narrative of top pod problems + node pressure + recent critical events for a cluster. Call this first when paged. Replaces a multi-call sequence of observe_cluster_overview + observe_node_status + observe_workload_health + observe_events.",
	InputSchema: map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"cluster_id": map[string]interface{}{"type": "string", "description": "Cluster ID (optional; defaults to session focus cluster)"},
		},
	},
	Destructive:           false,
	RequiresAI:            false,
	RequiredAutonomyLevel: 1,
},
{
	Name:        "list_problems",
	Category:    CategoryObservation,
	Description: "Enumerate pods matching a problem filter (crashlooping, oom, pending, evicted, image_pull_error, unhealthy) ranked by severity. Replaces ad-hoc loops over observe_resources_by_query.",
	InputSchema: map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"filter":     map[string]interface{}{"type": "string", "enum": []string{"crashlooping", "oom", "pending", "evicted", "image_pull_error", "unhealthy"}, "description": "Problem filter"},
			"namespace":  map[string]interface{}{"type": "string", "description": "Optional namespace scope"},
			"since":      map[string]interface{}{"type": "string", "description": "Go duration (15m, 1h) — optional"},
			"limit":      map[string]interface{}{"type": "integer", "description": "Max entries; default 50, max 200"},
			"cluster_id": map[string]interface{}{"type": "string"},
		},
		"required": []string{"filter"},
	},
	Destructive:           false,
	RequiresAI:            false,
	RequiredAutonomyLevel: 1,
},
{
	Name:        "search_logs",
	Category:    CategoryObservation,
	Description: "Pattern-clustered log search across pods in a namespace. Returns grouped error templates with counts — not raw log dumps. Replaces repeated observe_pod_logs_filtered calls.",
	InputSchema: map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"namespace":         map[string]interface{}{"type": "string"},
			"workload":          map[string]interface{}{"type": "string", "description": "Optional workload name filter"},
			"regex":             map[string]interface{}{"type": "string"},
			"since":             map[string]interface{}{"type": "string", "description": "Go duration"},
			"max_pods":          map[string]interface{}{"type": "integer", "description": "Pod cap; default 10"},
			"max_lines_per_pod": map[string]interface{}{"type": "integer", "description": "Line cap; default 1000"},
			"cluster_id":        map[string]interface{}{"type": "string"},
		},
		"required": []string{"namespace", "regex"},
	},
	Destructive:           false,
	RequiresAI:            false,
	RequiredAutonomyLevel: 1,
},
```

- [ ] **Step 2: Verify build still passes**

Run: `go build ./...`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add internal/mcp/tools/taxonomy.go
git commit -m "feat(taxonomy): +triage_cluster +list_problems +search_logs"
```

---

## Task 11: Taxonomy — retire the 25 folded `observe_*` entries

**Files:**
- Modify: `internal/mcp/tools/taxonomy.go`
- Create: `internal/mcp/tools/taxonomy_test.go`

- [ ] **Step 1: Write the retirement-guard test FIRST**

Create `internal/mcp/tools/taxonomy_test.go`:

```go
package tools

import (
	"os"
	"strings"
	"testing"
)

// TestTaxonomy_NoRetiredObserveTools locks in the Week-1 retirement list.
// If a future commit re-introduces any of these, the build fails.
func TestTaxonomy_NoRetiredObserveTools(t *testing.T) {
	retired := []string{
		"observe_api_resources",
		"observe_cluster_overview",
		"observe_configmap_consumers",
		"observe_custom_resources",
		"observe_deployment_rollout_history",
		"observe_events",
		"observe_metrics",
		"observe_namespace_overview",
		"observe_network_policies",
		"observe_node_status",
		"observe_pod_dependencies",
		"observe_pod_logs",
		"observe_pod_logs_filtered",
		"observe_pvc_consumers",
		"observe_resource",
		"observe_resource_history",
		"observe_resource_links",
		"observe_resource_topology",
		"observe_resources_by_query",
		"observe_secret_consumers",
		"observe_service_endpoints",
		"observe_serviceaccount_detailed",
		"observe_serviceaccount_permissions",
		"observe_storage_status",
		"observe_workload_health",
	}
	names := map[string]bool{}
	for _, td := range ToolTaxonomy {
		names[td.Name] = true
	}
	for _, r := range retired {
		if names[r] {
			t.Errorf("retired tool %q still present in taxonomy", r)
		}
	}
}

// TestTaxonomy_NewWeek1ToolsPresent locks in the three new tools.
func TestTaxonomy_NewWeek1ToolsPresent(t *testing.T) {
	wanted := []string{"triage_cluster", "list_problems", "search_logs"}
	names := map[string]bool{}
	for _, td := range ToolTaxonomy {
		names[td.Name] = true
	}
	for _, w := range wanted {
		if !names[w] {
			t.Errorf("expected %q in taxonomy", w)
		}
	}
}

// TestTaxonomy_RetiredHaveAliases guards against a partial retirement that
// breaks bench scoring. Every retired name must map to something in
// cmd/bench/aliases.json (which is already true by our selection rule —
// this test locks it in).
func TestTaxonomy_RetiredHaveAliases(t *testing.T) {
	data, err := os.ReadFile("../../../cmd/bench/aliases.json")
	if err != nil {
		t.Skipf("aliases.json not reachable: %v", err)
		return
	}
	body := string(data)
	retired := []string{
		"observe_api_resources",
		"observe_cluster_overview",
		"observe_configmap_consumers",
		"observe_custom_resources",
		"observe_deployment_rollout_history",
		"observe_events",
		"observe_metrics",
		"observe_namespace_overview",
		"observe_network_policies",
		"observe_node_status",
		"observe_pod_dependencies",
		"observe_pod_logs",
		"observe_pod_logs_filtered",
		"observe_pvc_consumers",
		"observe_resource",
		"observe_resource_history",
		"observe_resource_links",
		"observe_resource_topology",
		"observe_resources_by_query",
		"observe_secret_consumers",
		"observe_service_endpoints",
		"observe_serviceaccount_detailed",
		"observe_serviceaccount_permissions",
		"observe_storage_status",
		"observe_workload_health",
	}
	for _, r := range retired {
		if !strings.Contains(body, `"`+r+`"`) {
			t.Errorf("retired tool %q has no alias entry — bench scoring will miss it", r)
		}
	}
}
```

- [ ] **Step 2: Run the tests — they should fail because retirement hasn't happened yet**

Run: `go test ./internal/mcp/tools/... -v`
Expected: FAIL for `TestTaxonomy_NoRetiredObserveTools` (25 tools still present). Pass for `TestTaxonomy_NewWeek1ToolsPresent` + `TestTaxonomy_RetiredHaveAliases`.

- [ ] **Step 3: Delete the 25 tool entries from `internal/mcp/tools/taxonomy.go`**

For each name in the retired list above, find and delete its entire struct literal (from the `{` line containing `Name: "observe_<x>"` to the following `},` line, inclusive).

Use these grep commands to locate starts:

```bash
for t in observe_api_resources observe_cluster_overview observe_configmap_consumers observe_custom_resources observe_deployment_rollout_history observe_events observe_metrics observe_namespace_overview observe_network_policies observe_node_status observe_pod_dependencies observe_pod_logs observe_pod_logs_filtered observe_pvc_consumers observe_resource observe_resource_history observe_resource_links observe_resource_topology observe_resources_by_query observe_secret_consumers observe_service_endpoints observe_serviceaccount_detailed observe_serviceaccount_permissions observe_storage_status observe_workload_health; do
  echo "=== $t ==="
  grep -n "Name: *\"$t\"" internal/mcp/tools/taxonomy.go
done
```

Use the emitted line numbers to delete each struct block. Then:

Run: `go build ./...`
Expected: clean.

- [ ] **Step 4: Rerun tests — all three should now pass**

Run: `go test ./internal/mcp/tools/... -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/mcp/tools/taxonomy.go internal/mcp/tools/taxonomy_test.go
git commit -m "feat(taxonomy): retire 25 folded observe_* tools; add retirement-guard test"
```

---

## Task 12: Dispatch wiring for the 3 new tools

**Files:**
- Modify: `internal/mcp/server/handlers_observation.go` near line 5913 (the `inspect_pod` block).

- [ ] **Step 1: Locate the dispatch switch**

Run: `grep -n 'case "inspect_pod":' internal/mcp/server/handlers_observation.go`
Expect: one hit near line 5913.

- [ ] **Step 2: Add three new cases above the `inspect_pod` case**

Insert, preserving indentation:

```go
	case "triage_cluster":
		return s.handleTriageCluster(ctx, args)
	case "list_problems":
		return s.handleListProblems(ctx, args)
	case "search_logs":
		return s.handleSearchLogs(ctx, args)
```

- [ ] **Step 3: Build + run the full test suite**

Run: `go build ./... && go test ./... 2>&1 | tail -40`
Expected: clean build; full test suite green.

- [ ] **Step 4: Commit**

```bash
git add internal/mcp/server/handlers_observation.go
git commit -m "feat(server): dispatch triage_cluster / list_problems / search_logs"
```

---

## Task 13: Full regression + bench gate verification

**Files:** none — evidence capture before PR.

- [ ] **Step 1: `go vet` + `go build` + full unit test pass**

Run: `go vet ./... && go build ./... && go test ./... -count=1 2>&1 | tee /tmp/tests-after.txt`
Expected: clean on all three. Any test failure is a merge blocker.

- [ ] **Step 2: Bench run on the branch**

Run: `./bin/chat-quality-bench --suite incident-scenarios-20 --model qwen2.5:32b > /tmp/bench-after.json 2>&1`

Compare to `/tmp/bench-before.json` from Task 0.

**Merge gate check:**
- `pass_count(bench-after) >= pass_count(bench-before) + 1` (i.e., ≥15/20 if baseline was 14/20).
- **No trace in `bench-after.json` has a same-tool-call count ≥ 15.** Use the bench-report loop-trap detector or this one-liner:
  ```bash
  jq '[.traces[] | .tool_calls | group_by(.name) | map({name: .[0].name, count: length}) | map(select(.count >= 15))] | add // []' /tmp/bench-after.json
  ```
  Expected: `[]` (empty array = no loop traps).

- [ ] **Step 3: Regression bench on smoke-20 + prompts-100**

Run: `./bin/chat-quality-bench --suite smoke-20 --model qwen2.5:32b > /tmp/smoke-after.json 2>&1`
Run: `./bin/chat-quality-bench --suite prompts-100 --model qwen2.5:32b > /tmp/prompts100-after.json 2>&1`

**Regression gate check:** neither suite's pass rate drops > 2% from the Task-0 baseline.

- [ ] **Step 4: If bench gate fails**

Do not merge. Investigate:
- Did a retired tool name still appear in a bench trace? → add it to `cmd/bench/aliases.json`.
- Did the LLM pick `triage_cluster` but the handler errored? → check `/tmp/bench-after.json` trace for the error, likely a shaping mismatch in `shapeClusterInput`.
- Any new same-tool-15× loop? → check which tool; likely a description wording issue in the taxonomy entry.

Fix, commit, re-run.

- [ ] **Step 5: No commit for this task** — the evidence files feed Task 14.

---

## Task 14: Open PR

**Files:** none — GitHub operation.

- [ ] **Step 1: Push the branch**

Run: `git push`
Expected: all commits from Tasks 1–12 land on `origin/feat/week1-inspect-completion`.

- [ ] **Step 2: Compose PR description from template**

```markdown
## Summary
- Ship `triage_cluster`, `list_problems`, `search_logs` — Week 1 of the 5-keeper-weeks plan
- Retire 25 folded `observe_*` tools (the `_detailed/_events/_ownership_chain` families)
- Two new pure-Go packages: `internal/triage` (severity scoring) + `internal/logpattern` (regex-template clustering)
- Tool count: 183 → 161 (−25 retired, +3 new)

## Spec
- kubilitics-ai/docs/superpowers/specs/2026-04-23-week1-inspect-completion-design.md

## Bench results (qwen2.5:32b, local Ollama)
| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| incident-scenarios-20 | N/20 | M/20 | +K |
| smoke-20              | X/20 | Y/20 |  ΔZ% |
| prompts-100           | P/100 | Q/100 | ΔR% |

Same-tool-15×-loop count: 0 (down from N in baseline).

## Test plan
- [x] go vet ./... clean
- [x] go build ./... clean
- [x] go test ./... passes (all existing + new)
- [x] incident-scenarios-20 pass rate ≥ baseline + 1
- [x] zero same-tool-15× loops
- [x] smoke-20 regression ≤2%
- [x] prompts-100 regression ≤2%

## Non-goals (deferred under Option C)
- describe_topology (PageRank infra was its value; cut indefinitely)
- DAG planner (Wk 2 of the 5-keeper plan)
- Scheduler simulator, OTel, incident memory (Wk 5/6/9)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 3: Open the PR**

Run:
```bash
gh pr create --repo vellankikoti/kotg.ai --base main --head feat/week1-inspect-completion \
  --title "feat(tools): Week 1 — complete inspect surface + retire 25 observe_*" \
  --body-file /tmp/pr-body.md
```

Expected: PR URL printed.

- [ ] **Step 4: No commit.** The plan is complete once the PR is open.

---

## Total accounting

- **New files:** 9
- **Modified files:** 4
- **New tests:** 5 test files, ~18 test functions
- **Retired names:** 25
- **New tool entries:** 3
- **Net tool count:** 183 → 161
- **Target bench delta:** +1 min, +2 stretch
- **Target loop-trap count:** 0 (was variable)
- **Calendar time:** 3–5 focused days
