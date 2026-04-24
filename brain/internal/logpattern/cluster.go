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
		count     int
		pods      map[string]struct{}
		firstSeen time.Time
		lastSeen  time.Time
		sample    string
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
