//go:build chaos

// Package chaos validates MCP tool resilience under adverse backend conditions.
// Run: go test -v -tags chaos -timeout 2m ./tests/tools/chaos/
package chaos

import (
	"context"
	"encoding/json"
	"fmt"
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
)

const chaosClusterID = "chaos-cluster"

// ─── helpers ──────────────────────────────────────────────────────────────────

type chaosBackend struct {
	handler func(w http.ResponseWriter, r *http.Request)
	srv     *httptest.Server
}

func newChaosBackend(t *testing.T, h func(w http.ResponseWriter, r *http.Request)) *chaosBackend {
	t.Helper()
	cb := &chaosBackend{handler: h}
	cb.srv = httptest.NewServer(http.HandlerFunc(h))
	t.Cleanup(cb.srv.Close)
	return cb
}

func newServerAt(t *testing.T, backendURL string) server.MCPServer {
	t.Helper()
	cfg := &config.Config{}
	cfg.Backend.HTTPBaseURL = backendURL

	auditCfg := &audit.Config{AuditLogPath: "/tmp/chaos-audit.log"}
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

// clusterListJSON returns a minimal cluster list JSON bytes.
func clusterListJSON() []byte {
	b, _ := json.Marshal([]map[string]interface{}{
		{"id": chaosClusterID, "name": "chaos-cluster"},
	})
	return b
}

// ─── Scenario 1: backend completely unreachable ────────────────────────────────

func TestChaos_BackendUnreachable(t *testing.T) {
	// Point at a port nothing is listening on.
	srv := newServerAt(t, "http://127.0.0.1:1")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := srv.ExecuteTool(ctx, "cluster_overview", map[string]interface{}{
		"cluster_id": chaosClusterID,
	})
	if err == nil {
		t.Fatal("expected error when backend is unreachable, got nil")
	}
}

// ─── Scenario 2: backend returns HTTP 500 ─────────────────────────────────────

func TestChaos_Backend500(t *testing.T) {
	cb := newChaosBackend(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/clusters") && !strings.Contains(r.URL.Path, "/clusters/") {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(clusterListJSON())
			return
		}
		http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
	})

	srv := newServerAt(t, cb.srv.URL)
	ctx := context.Background()

	_, err := srv.ExecuteTool(ctx, "cluster_overview", map[string]interface{}{
		"cluster_id": chaosClusterID,
	})
	if err == nil {
		t.Fatal("expected error on HTTP 500, got nil")
	}
	if !strings.Contains(err.Error(), "500") && !strings.Contains(strings.ToLower(err.Error()), "status") {
		t.Logf("error (acceptable form): %v", err)
	}
}

// ─── Scenario 3: backend returns invalid JSON ──────────────────────────────────

func TestChaos_BackendInvalidJSON(t *testing.T) {
	cb := newChaosBackend(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/clusters") && !strings.Contains(r.URL.Path, "/clusters/") {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(clusterListJSON())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{not valid json`))
	})

	srv := newServerAt(t, cb.srv.URL)
	ctx := context.Background()

	_, err := srv.ExecuteTool(ctx, "cluster_overview", map[string]interface{}{
		"cluster_id": chaosClusterID,
	})
	if err == nil {
		t.Fatal("expected error on invalid JSON, got nil")
	}
}

// ─── Scenario 4: context cancelled before response ────────────────────────────

func TestChaos_ContextCancelled(t *testing.T) {
	cb := newChaosBackend(t, func(w http.ResponseWriter, r *http.Request) {
		// Simulate slow backend.
		time.Sleep(500 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(clusterListJSON())
	})

	srv := newServerAt(t, cb.srv.URL)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	_, err := srv.ExecuteTool(ctx, "cluster_overview", map[string]interface{}{
		"cluster_id": chaosClusterID,
	})
	if err == nil {
		t.Fatal("expected context deadline error, got nil")
	}
}

// ─── Scenario 5: empty response body ─────────────────────────────────────────

func TestChaos_EmptyResponseBody(t *testing.T) {
	cb := newChaosBackend(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/clusters") && !strings.Contains(r.URL.Path, "/clusters/") {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(clusterListJSON())
			return
		}
		w.WriteHeader(http.StatusOK)
		// write nothing
	})

	srv := newServerAt(t, cb.srv.URL)
	ctx := context.Background()

	// Should not panic — may return error or empty result.
	result, err := srv.ExecuteTool(ctx, "cluster_overview", map[string]interface{}{
		"cluster_id": chaosClusterID,
	})
	// Either an error or an empty/nil result is acceptable; no panic is the contract.
	t.Logf("empty body result=%v err=%v", result, err)
}

// ─── Scenario 6: backend hangs mid-response (chunked data stall) ──────────────

func TestChaos_BackendHangsMidResponse(t *testing.T) {
	cb := newChaosBackend(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/clusters") && !strings.Contains(r.URL.Path, "/clusters/") {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(clusterListJSON())
			return
		}
		// Send partial JSON then stall until client closes.
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"status":`)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		time.Sleep(2 * time.Second)
	})

	srv := newServerAt(t, cb.srv.URL)

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	_, err := srv.ExecuteTool(ctx, "cluster_overview", map[string]interface{}{
		"cluster_id": chaosClusterID,
	})
	if err == nil {
		t.Fatal("expected timeout error on stalled backend, got nil")
	}
}

// ─── Scenario 7: unknown tool name ────────────────────────────────────────────

func TestChaos_UnknownToolName(t *testing.T) {
	cb := newChaosBackend(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(clusterListJSON())
	})

	srv := newServerAt(t, cb.srv.URL)
	ctx := context.Background()

	_, err := srv.ExecuteTool(ctx, "this_tool_does_not_exist", map[string]interface{}{})
	if err == nil {
		t.Fatal("expected error for unknown tool, got nil")
	}
}

// ─── Scenario 8: nil args map ─────────────────────────────────────────────────

func TestChaos_NilArgs(t *testing.T) {
	cb := newChaosBackend(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/clusters") && !strings.Contains(r.URL.Path, "/clusters/") {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(clusterListJSON())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	})

	srv := newServerAt(t, cb.srv.URL)
	ctx := context.Background()

	// Must not panic with nil args.
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("ExecuteTool panicked with nil args: %v", r)
		}
	}()
	_, _ = srv.ExecuteTool(ctx, "cluster_overview", nil)
}

// ─── Scenario 9: concurrent calls do not race ─────────────────────────────────

func TestChaos_ConcurrentCallsNoRace(t *testing.T) {
	var requestCount int64
	cb := newChaosBackend(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&requestCount, 1)
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "/clusters") && !strings.Contains(r.URL.Path, "/clusters/") {
			_, _ = w.Write(clusterListJSON())
			return
		}
		_, _ = w.Write([]byte(`{"status":"ok","nodes":[]}`))
	})

	srv := newServerAt(t, cb.srv.URL)
	ctx := context.Background()

	const goroutines = 20
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			_, _ = srv.ExecuteTool(ctx, "cluster_overview", map[string]interface{}{
				"cluster_id": chaosClusterID,
			})
		}()
	}
	wg.Wait()
	t.Logf("Total backend requests during concurrent test: %d", atomic.LoadInt64(&requestCount))
}

// ─── Scenario 10: read-only tools never mutate state ─────────────────────────

func TestChaos_ReadOnlyToolsNeverMutate(t *testing.T) {
	var mutations []string
	var mu sync.Mutex

	cb := newChaosBackend(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			mu.Lock()
			mutations = append(mutations, fmt.Sprintf("%s %s", r.Method, r.URL.Path))
			mu.Unlock()
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "/clusters") && !strings.Contains(r.URL.Path, "/clusters/") {
			_, _ = w.Write(clusterListJSON())
			return
		}
		_, _ = w.Write([]byte(`{"items":[],"nodes":[],"pods":[]}`))
	})

	srv := newServerAt(t, cb.srv.URL)
	ctx := context.Background()

	// Call a representative set of read-only (observation) tools.
	readOnlyTools := []string{
		"cluster_overview",
		"list_resources",
		"get_logs",
		"get_events",
		"get_node_metrics",
	}
	for _, tool := range readOnlyTools {
		_, _ = srv.ExecuteTool(ctx, tool, map[string]interface{}{
			"cluster_id": chaosClusterID,
			"kind":       "Pod",
			"namespace":  "default",
		})
	}

	mu.Lock()
	defer mu.Unlock()
	if len(mutations) > 0 {
		t.Errorf("read-only tools issued mutating HTTP calls: %v", mutations)
	}
}
