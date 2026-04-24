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
