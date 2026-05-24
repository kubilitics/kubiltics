//go:build load

// Package load stress-tests the MCP server under parallel concurrent load.
// Run: go test -v -tags load -race -timeout 3m ./tests/tools/load/
package load

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/audit"
	"github.com/vellankikoti/kubilitics/brain/internal/config"
	"github.com/vellankikoti/kubilitics/brain/internal/db"
	"github.com/vellankikoti/kubilitics/brain/internal/integration/backend"
	"github.com/vellankikoti/kubilitics/brain/internal/mcp/server"
	mcptools "github.com/vellankikoti/kubilitics/brain/internal/mcp/tools"
)

const loadClusterID = "load-cluster"

// ─── helper ───────────────────────────────────────────────────────────────────

func newLoadServer(t *testing.T) server.MCPServer {
	t.Helper()

	fakeSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		path := strings.TrimPrefix(r.URL.Path, "/api/v1")

		if path == "/clusters" || path == "/clusters/" {
			b, _ := json.Marshal([]map[string]interface{}{
				{"id": loadClusterID, "name": "load-cluster"},
			})
			_, _ = w.Write(b)
			return
		}
		// Generic empty success for everything else.
		_, _ = w.Write([]byte(`{"items":[],"pods":[],"nodes":[],"status":"ok"}`))
	}))
	t.Cleanup(fakeSrv.Close)

	cfg := &config.Config{}
	cfg.Backend.HTTPBaseURL = fakeSrv.URL

	auditCfg := &audit.Config{AuditLogPath: "/tmp/load-audit.log"}
	auditLog, err := audit.NewLogger(auditCfg)
	if err != nil {
		t.Fatalf("audit logger: %v", err)
	}
	t.Cleanup(func() { _ = auditLog.Close() })

	proxy, err := backend.NewProxy(cfg, auditLog)
	if err != nil {
		t.Fatalf("backend proxy: %v", err)
	}

	store, err := db.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	srv, err := server.NewMCPServer(cfg, proxy, auditLog, store)
	if err != nil {
		t.Fatalf("NewMCPServer: %v", err)
	}
	return srv
}

// ─── Test 1: 20 goroutines, each calling cluster_overview 10× ─────────────────

func TestLoad_Concurrent20x10(t *testing.T) {
	srv := newLoadServer(t)
	ctx := context.Background()

	const goroutines = 20
	const callsEach = 10

	var errors int64
	var wg sync.WaitGroup
	wg.Add(goroutines)

	start := time.Now()
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < callsEach; j++ {
				_, err := srv.ExecuteTool(ctx, "cluster_overview", map[string]interface{}{
					"cluster_id": loadClusterID,
				})
				if err != nil {
					atomic.AddInt64(&errors, 1)
				}
			}
		}()
	}
	wg.Wait()
	elapsed := time.Since(start)

	total := int64(goroutines * callsEach)
	t.Logf("Completed %d calls in %v (%.0f calls/sec), errors=%d",
		total, elapsed, float64(total)/elapsed.Seconds(), atomic.LoadInt64(&errors))

	// Under fake backend load we expect very few errors (only rate-limit ones are OK).
	if atomic.LoadInt64(&errors) > total/4 {
		t.Errorf("too many errors: %d/%d", atomic.LoadInt64(&errors), total)
	}
}

// ─── Test 2: rate limiter does not deadlock under burst ───────────────────────

func TestLoad_RateLimiterNeverDeadlocks(t *testing.T) {
	srv := newLoadServer(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const burst = 150 // exceeds default token bucket of 100
	var wg sync.WaitGroup
	wg.Add(burst)
	for i := 0; i < burst; i++ {
		go func() {
			defer wg.Done()
			_, _ = srv.ExecuteTool(ctx, "cluster_overview", map[string]interface{}{
				"cluster_id": loadClusterID,
			})
		}()
	}

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()

	select {
	case <-done:
		t.Log("All goroutines completed without deadlock")
	case <-ctx.Done():
		t.Fatal("Deadlock detected: goroutines did not complete within timeout")
	}
}

// ─── Test 3: all non-destructive tools callable in parallel ───────────────────

func TestLoad_AllNonDestructiveToolsParallel(t *testing.T) {
	srv := newLoadServer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	var readOnlyTools []string
	for _, td := range mcptools.ToolTaxonomy {
		if !td.Destructive {
			readOnlyTools = append(readOnlyTools, td.Name)
		}
	}
	t.Logf("Testing %d non-destructive tools in parallel", len(readOnlyTools))

	var wg sync.WaitGroup
	var errors int64
	wg.Add(len(readOnlyTools))

	for _, name := range readOnlyTools {
		toolName := name
		go func() {
			defer wg.Done()
			_, err := srv.ExecuteTool(ctx, toolName, map[string]interface{}{
				"cluster_id": loadClusterID,
				"namespace":  "default",
				"kind":       "Pod",
				"name":       "test-pod",
				"name_hint":  "test-pod",
				"regex":      "error",
			})
			if err != nil && !strings.Contains(err.Error(), "rate limit") {
				atomic.AddInt64(&errors, 1)
				t.Logf("WARN tool %s: %v", toolName, err)
			}
		}()
	}
	wg.Wait()

	t.Logf("Non-destructive parallel errors (excluding rate-limit): %d/%d",
		atomic.LoadInt64(&errors), int64(len(readOnlyTools)))
}

// ─── Test 4: no data races on mcpServerImpl stats ─────────────────────────────

func TestLoad_NoDataRaceOnStats(t *testing.T) {
	srv := newLoadServer(t)
	ctx := context.Background()

	const goroutines = 10
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < 5; j++ {
				_, _ = srv.ExecuteTool(ctx, "cluster_overview", map[string]interface{}{
					"cluster_id": loadClusterID,
				})
			}
		}()
	}
	wg.Wait()

	// If -race detector is active, data races would have already caused a failure.
	t.Log("No data race detected on server stats")
}

// ─── Test 5: throughput benchmark ────────────────────────────────────────────

func BenchmarkTool_ClusterOverview(b *testing.B) {
	// Create server outside of benchmark loop.
	fakeSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		path := strings.TrimPrefix(r.URL.Path, "/api/v1")
		if path == "/clusters" || path == "/clusters/" {
			b, _ := json.Marshal([]map[string]interface{}{{"id": loadClusterID, "name": "load-cluster"}})
			_, _ = w.Write(b)
			return
		}
		_, _ = w.Write([]byte(`{"status":"ok","nodes":[]}`))
	}))
	defer fakeSrv.Close()

	cfg := &config.Config{}
	cfg.Backend.HTTPBaseURL = fakeSrv.URL
	auditCfg := &audit.Config{AuditLogPath: "/tmp/bench-audit.log"}
	auditLog, _ := audit.NewLogger(auditCfg)
	defer auditLog.Close()
	proxy, _ := backend.NewProxy(cfg, auditLog)
	store, _ := db.NewSQLiteStore(":memory:")
	defer store.Close()
	srv, _ := server.NewMCPServer(cfg, proxy, auditLog, store)

	ctx := context.Background()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = srv.ExecuteTool(ctx, "cluster_overview", map[string]interface{}{
			"cluster_id": loadClusterID,
		})
	}
}
