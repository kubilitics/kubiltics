package openai

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestRetry429_HonorsRetryAfterHint(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n == 1 {
			w.WriteHeader(429)
			_, _ = w.Write([]byte("{\"error\":{\"message\":\"Rate limit reached. Please try again in 120ms.\",\"type\":\"tokens\",\"code\":\"rate_limit_exceeded\"}}"))
			return
		}
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), "GET", srv.URL, nil)
	resp, err := doWithRetryOn429(http.DefaultClient, req, 3)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&calls) != 2 {
		t.Fatalf("want 2 attempts (1 x 429 + 1 x 200), got %d", calls)
	}
}

func TestRetry429_GivesUpAfterMax(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(429)
		_, _ = w.Write([]byte("{\"error\":{\"message\":\"Rate limit. Please try again in 50ms.\"}}"))
	}))
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), "GET", srv.URL, nil)
	resp, err := doWithRetryOn429(http.DefaultClient, req, 3)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 429 {
		t.Fatalf("want final 429, got %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&calls) != 3 {
		t.Fatalf("want 3 attempts, got %d", calls)
	}
}

func TestRetry429_NonRetryableStatusPassesThrough(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(400)
	}))
	defer srv.Close()

	req, _ := http.NewRequestWithContext(context.Background(), "GET", srv.URL, nil)
	resp, err := doWithRetryOn429(http.DefaultClient, req, 3)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("want 400, got %d", resp.StatusCode)
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("400 must not retry; got %d calls", calls)
	}
}

func TestParseRetryAfterMs(t *testing.T) {
	cases := []struct {
		body string
		want time.Duration
	}{
		{"{\"error\":{\"message\":\"try again in 120ms.\"}}", 120 * time.Millisecond},
		{"{\"error\":{\"message\":\"try again in 2s.\"}}", 2 * time.Second},
		{"{\"error\":{\"message\":\"unavailable\"}}", 0},
	}
	for _, c := range cases {
		got := parseRetryAfterMs(strings.NewReader(c.body))
		if got != c.want {
			t.Errorf("parseRetryAfterMs(%q) = %v, want %v", c.body, got, c.want)
		}
	}
}

// Compile-time use so the file parses cleanly even if the test body
// uses neither directly.
var _ = bytes.Buffer{}
var _ io.Reader = (*bytes.Buffer)(nil)
