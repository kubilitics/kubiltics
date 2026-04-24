package main

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBenchDryRun(t *testing.T) {
	tmp := t.TempDir()
	out := filepath.Join(tmp, "results.ndjson")

	cfg := benchConfig{
		promptFile: "prompts/smoke.yaml",
		clusterID:  "test-cluster",
		output:     out,
		warmup:     0,
		iterations: 2,
		timeout:    5 * time.Second,
		tag:        "unittest",
		dryRun:     true,
	}

	d, _, stop, err := startMock()
	if err != nil {
		t.Fatalf("startMock: %v", err)
	}
	defer stop()

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	if err := run(ctx, cfg, d); err != nil {
		t.Fatalf("run: %v", err)
	}

	f, err := os.Open(out)
	if err != nil {
		t.Fatalf("open output: %v", err)
	}
	defer func() { _ = f.Close() }()

	var rows []wideEvent
	var summary summaryEvent
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 1<<20)
	for scanner.Scan() {
		line := scanner.Bytes()
		if strings.Contains(string(line), `"bench.summary"`) {
			if err := json.Unmarshal(line, &summary); err != nil {
				t.Fatalf("decode summary: %v", err)
			}
			continue
		}
		var r wideEvent
		if err := json.Unmarshal(line, &r); err != nil {
			t.Fatalf("decode row: %v", err)
		}
		rows = append(rows, r)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scanner: %v", err)
	}

	if len(rows) == 0 {
		t.Fatal("expected at least one row")
	}
	for i, r := range rows {
		if r.SchemaVersion != schemaVersion {
			t.Errorf("row %d: schema_version=%d want %d", i, r.SchemaVersion, schemaVersion)
		}
		if r.CorrelationID == "" {
			t.Errorf("row %d: empty correlation_id", i)
		}
		if r.Result != "success" {
			t.Errorf("row %d: result=%q error=%q", i, r.Result, r.ErrorMessage)
		}
		if r.TTFTMs <= 0 {
			t.Errorf("row %d: ttft_ms=%d", i, r.TTFTMs)
		}
		if r.TotalMs < r.TTFTMs {
			t.Errorf("row %d: total_ms=%d < ttft_ms=%d", i, r.TotalMs, r.TTFTMs)
		}
		if r.Chunks == 0 {
			t.Errorf("row %d: chunks=0", i)
		}
		if r.Tag != "unittest" {
			t.Errorf("row %d: tag=%q", i, r.Tag)
		}
	}
	if summary.EventType != "bench.summary" {
		t.Errorf("summary missing or wrong event_type: %q", summary.EventType)
	}
	if summary.TotalIters != len(rows) {
		t.Errorf("summary total_iterations=%d != row count %d", summary.TotalIters, len(rows))
	}
}

func TestPercentileInt(t *testing.T) {
	// Nearest-rank: index = ceil(p/100 * N) - 1.
	xs := []int64{10, 20, 30, 40, 50, 60, 70, 80, 90, 100}
	cases := []struct {
		p    int
		want int64
	}{
		{50, 50},
		{95, 100},
		{99, 100},
		{10, 10},
	}
	for _, c := range cases {
		got := percentileInt(xs, c.p)
		if got != c.want {
			t.Errorf("p%d = %d, want %d", c.p, got, c.want)
		}
	}
	if percentileInt(nil, 50) != 0 {
		t.Errorf("nil should be 0")
	}
	if percentileInt([]int64{42}, 99) != 42 {
		t.Errorf("single element wrong")
	}
}
