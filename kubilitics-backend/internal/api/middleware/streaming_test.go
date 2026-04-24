// Package middleware streaming_test.go verifies that response-writer wrappers
// used by middleware passthrough http.Flusher so downstream handlers that serve
// Server-Sent Events (text/event-stream) can call w.(http.Flusher) without
// receiving 500 "streaming not supported".
//
// Regression context: StructuredLog wraps every response in
// responseWriter; AuditLog additionally wraps POST/PATCH/DELETE in
// responseRecorder. Prior to Phase 6 task 6.0 neither exposed Flush, so the
// /api/v1/presence/events SSE handler erroneously failed in production
// (`rest.PresenceHandler.StreamEvents` type-asserts Flusher on the writer).
// httptest.NewServer is used rather than httptest.NewRecorder because the
// latter already implements http.Flusher out of the box and therefore cannot
// catch this regression.
package middleware

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// TestStructuredLog_PassesThroughFlusher: StructuredLog's responseWriter must
// expose Flush so SSE handlers work through a live HTTP server (which is the
// production code path — unlike httptest.NewRecorder).
func TestStructuredLog_PassesThroughFlusher(t *testing.T) {
	var isFlusher atomic.Bool
	var flushed atomic.Bool
	done := make(chan struct{})

	sseHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(done)
		w.Header().Set("Content-Type", "text/event-stream")
		f, ok := w.(http.Flusher)
		isFlusher.Store(ok)
		if ok {
			f.Flush()
			flushed.Store(true)
			_, _ = w.Write([]byte("data: hello\n\n"))
			f.Flush()
		}
	})

	srv := httptest.NewServer(StructuredLog(sseHandler))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v1/test/stream")
	if err != nil {
		t.Fatalf("GET failed: %v", err)
	}
	defer resp.Body.Close()
	<-done

	if !isFlusher.Load() {
		t.Fatal("downstream handler could not type-assert http.Flusher on StructuredLog.responseWriter — SSE regression")
	}
	if !flushed.Load() {
		t.Fatal("Flush was not invoked on StructuredLog.responseWriter wrapper")
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", resp.StatusCode)
	}
	br := bufio.NewReader(resp.Body)
	line, err := br.ReadString('\n')
	if err != nil {
		t.Fatalf("read first SSE line: %v", err)
	}
	if !strings.Contains(line, "data: hello") {
		t.Fatalf("expected SSE data frame, got %q", line)
	}
}

func setupStreamingAuditRepo(t *testing.T) *repository.SQLiteRepository {
	t.Helper()
	repo, err := repository.NewSQLiteRepository(":memory:")
	if err != nil {
		t.Fatalf("repo: %v", err)
	}
	migrationSQL := `
	CREATE TABLE IF NOT EXISTS audit_log (
		id TEXT PRIMARY KEY,
		timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		user_id TEXT,
		username TEXT NOT NULL,
		cluster_id TEXT,
		action TEXT NOT NULL,
		resource_kind TEXT,
		resource_namespace TEXT,
		resource_name TEXT,
		status_code INTEGER,
		request_ip TEXT NOT NULL,
		details TEXT,
		session_id TEXT,
		device_info TEXT,
		geolocation TEXT,
		risk_score INTEGER,
		correlation_id TEXT
	);
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { repo.Close() })
	return repo
}

// TestAuditLog_PassesThroughFlusher: AuditLog's responseRecorder wraps
// POST/PATCH/DELETE responses and must also propagate Flush. This matters
// for mutating endpoints that stream progress (e.g. future
// long-running delete/install flows).
func TestAuditLog_PassesThroughFlusher(t *testing.T) {
	repo := setupStreamingAuditRepo(t)

	var mu sync.Mutex
	var isFlusher, flushed bool

	mutatingStream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		f, ok := w.(http.Flusher)
		mu.Lock()
		isFlusher = ok
		mu.Unlock()
		if ok {
			f.Flush()
			mu.Lock()
			flushed = true
			mu.Unlock()
		}
	})

	srv := httptest.NewServer(AuditLog(repo)(mutatingStream))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/clusters/c/resources/x", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()

	mu.Lock()
	defer mu.Unlock()
	if !isFlusher {
		t.Fatal("AuditLog.responseRecorder did not propagate http.Flusher")
	}
	if !flushed {
		t.Fatal("Flush was not callable on AuditLog.responseRecorder")
	}
}

// TestAuditLog_PassesThroughHijacker: AuditLog wraps POST/PATCH/DELETE; a
// handler that attempts to hijack (e.g. websocket upgrade wired behind a
// mutating endpoint) must still succeed.
func TestAuditLog_PassesThroughHijacker(t *testing.T) {
	repo := setupStreamingAuditRepo(t)

	var mu sync.Mutex
	var isHijacker bool

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, ok := w.(http.Hijacker)
		mu.Lock()
		isHijacker = ok
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	})

	srv := httptest.NewServer(AuditLog(repo)(handler))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/clusters/c/resources/x", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()

	mu.Lock()
	defer mu.Unlock()
	if !isHijacker {
		t.Fatal("AuditLog.responseRecorder did not propagate http.Hijacker — WebSocket upgrades behind mutating endpoints would fail")
	}
}
