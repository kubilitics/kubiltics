package openai

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// TestRetryAfter_HonorsStandardHeader verifies the retry wrapper waits at
// least the number of seconds specified by the standard HTTP `Retry-After`
// header before the next attempt.
func TestRetryAfter_HonorsStandardHeader(t *testing.T) {
	var attempts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&attempts, 1)
		if n == 1 {
			// Use a short (but measurable) delay so the test is fast but
			// provably observes the Retry-After seconds.
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":"rate limited"}`))
			return
		}
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL, nil)
	start := time.Now()
	resp, err := doWithRetryOn429(http.DefaultClient, req, 3)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	if elapsed < time.Second {
		t.Fatalf("Retry-After: 1 not honored: elapsed=%s < 1s", elapsed)
	}
}

// TestParseRetryAfterHeader_Seconds tests the parser accepts integer
// seconds form of Retry-After.
func TestParseRetryAfterHeader_Seconds(t *testing.T) {
	cases := []struct {
		in   string
		want time.Duration
	}{
		{"", 0},
		{"0", 0},
		{"2", 2 * time.Second},
		{"30", 30 * time.Second},
		{"abc", 0},
	}
	for _, c := range cases {
		got := parseRetryAfterHeader(c.in)
		if got != c.want {
			t.Errorf("parseRetryAfterHeader(%q) = %v want %v", c.in, got, c.want)
		}
	}
}

// TestParseRetryAfterHeader_HTTPDate accepts an HTTP-date form.
func TestParseRetryAfterHeader_HTTPDate(t *testing.T) {
	future := time.Now().Add(3 * time.Second).UTC().Format(http.TimeFormat)
	got := parseRetryAfterHeader(future)
	if got < time.Second || got > 5*time.Second {
		t.Fatalf("parseRetryAfterHeader(http-date future) = %v, want roughly 3s", got)
	}
	// A past date → 0.
	past := time.Now().Add(-1 * time.Hour).UTC().Format(http.TimeFormat)
	if d := parseRetryAfterHeader(past); d != 0 {
		t.Fatalf("parseRetryAfterHeader(past) = %v, want 0", d)
	}
}

// Compile guard: strings import used implicitly for docs/IDE hints.
var _ = strings.Contains
