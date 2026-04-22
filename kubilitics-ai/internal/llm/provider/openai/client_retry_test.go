package openai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/llm/types"
)

// TestRetry5xx_SucceedsAfterTwoFailures verifies the openai client retries
// transient 5xx responses with exponential backoff and succeeds when the
// third attempt returns 200.
func TestRetry5xx_SucceedsAfterTwoFailures(t *testing.T) {
	var attempts int32
	mux := http.NewServeMux()
	mux.HandleFunc("/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&attempts, 1)
		if n < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":"overloaded"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"ok"}}]}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c, err := NewOpenAIClient("k", "gpt-x")
	if err != nil {
		t.Fatalf("NewOpenAIClient: %v", err)
	}
	c.SetBaseURL(srv.URL)

	content, _, err := c.Complete(context.Background(),
		[]types.Message{{Role: "user", Content: "hi"}}, nil)
	if err != nil {
		t.Fatalf("after retries should succeed: %v", err)
	}
	if content != "ok" {
		t.Fatalf("content: got %q want %q", content, "ok")
	}
	if got := atomic.LoadInt32(&attempts); got != 3 {
		t.Fatalf("expected 3 attempts, got %d", got)
	}
}

// TestRetry5xx_GivesUpAfterMax — all 3 attempts return 503; client returns error.
func TestRetry5xx_GivesUpAfterMax(t *testing.T) {
	var attempts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&attempts, 1)
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"overloaded"}`))
	}))
	defer srv.Close()

	c, _ := NewOpenAIClient("k", "gpt-x")
	c.SetBaseURL(srv.URL)

	_, _, err := c.Complete(context.Background(),
		[]types.Message{{Role: "user", Content: "hi"}}, nil)
	if err == nil {
		t.Fatal("expected error after exhausted retries")
	}
	if got := atomic.LoadInt32(&attempts); got != 3 {
		t.Fatalf("expected 3 attempts, got %d", got)
	}
}

// TestRetry5xx_StopsOn4xx — 400 is not retried; single attempt.
func TestRetry5xx_StopsOn4xx(t *testing.T) {
	var attempts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&attempts, 1)
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	c, _ := NewOpenAIClient("k", "gpt-x")
	c.SetBaseURL(srv.URL)

	_, _, err := c.Complete(context.Background(),
		[]types.Message{{Role: "user", Content: "hi"}}, nil)
	if err == nil {
		t.Fatal("expected error on 400")
	}
	if got := atomic.LoadInt32(&attempts); got != 1 {
		t.Fatalf("4xx must not retry; got %d attempts", got)
	}
}

// TestRetry5xx_BackoffTiming — between-attempt waits respect the 100ms×2^n floor.
func TestRetry5xx_BackoffTiming(t *testing.T) {
	var attempts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&attempts, 1)
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	c, _ := NewOpenAIClient("k", "gpt-x")
	c.SetBaseURL(srv.URL)

	start := time.Now()
	_, _, _ = c.Complete(context.Background(),
		[]types.Message{{Role: "user", Content: "hi"}}, nil)
	elapsed := time.Since(start)

	// 3 attempts: waits 100ms (n=0) + 200ms (n=1) = 300ms minimum before final.
	if elapsed < 300*time.Millisecond {
		t.Fatalf("elapsed=%s < 300ms, backoff not applied", elapsed)
	}
}
