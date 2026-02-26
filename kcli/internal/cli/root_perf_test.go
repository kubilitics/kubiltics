package cli

import (
	"testing"
	"time"
)

func TestAIClientIsMemoized(t *testing.T) {
	a := &app{aiTimeout: 3 * time.Second}
	c1 := a.aiClient()
	c2 := a.aiClient()
	if c1 != c2 {
		t.Fatal("expected aiClient() to return memoized instance")
	}
}

// TestRootCommandInitTime verifies that constructing the cobra command tree
// (config load + app init + all sub-command registration) completes within
// the startup time budget.
//
// This test runs in-process so it cannot account for binary loading time, but
// it catches regressions introduced by expensive init() calls, blocking
// sync.Once initializers, or O(n) command registration loops.
//
// We use a generous 500 ms limit to avoid false positives on loaded CI runners
// while still catching catastrophic regressions (e.g. an accidental blocking
// network call in an init() function).
func TestRootCommandInitTime(t *testing.T) {
	if raceDetectorEnabled {
		t.Skip("skipping startup timing test under race detector")
	}

	const limit = 500 * time.Millisecond
	const iterations = 5 // average over several runs to reduce noise

	var total time.Duration
	for i := 0; i < iterations; i++ {
		start := time.Now()
		_ = NewRootCommandWithIO(nil, nil, nil)
		total += time.Since(start)
	}
	avg := total / iterations
	if avg > limit {
		t.Fatalf("NewRootCommand init too slow: avg %v over %d iterations (limit %v)\n"+
			"Profile with: go test -cpuprofile=cpu.pprof -run TestRootCommandInitTime ./internal/cli/...",
			avg.Round(time.Millisecond), iterations, limit)
	}
	t.Logf("NewRootCommand avg init: %v", avg.Round(time.Millisecond))
}

// TestSetProcessStart verifies that SetProcessStart / ProcessStart round-trip.
func TestSetProcessStart(t *testing.T) {
	orig := processStart
	defer func() { processStart = orig }()

	now := time.Now()
	SetProcessStart(now)
	if got := ProcessStart(); !got.Equal(now) {
		t.Fatalf("ProcessStart() = %v, want %v", got, now)
	}
}
