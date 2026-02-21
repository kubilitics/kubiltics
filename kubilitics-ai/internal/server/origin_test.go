package server

import (
	"net/http"
	"testing"
)

// makeRequest creates a fake http.Request with the given Origin header.
func makeRequest(origin string) *http.Request {
	r, _ := http.NewRequest("GET", "/ws/chat", nil)
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	return r
}

func TestOriginChecking(t *testing.T) {
	tests := []struct {
		name      string
		origins   []string // allowedOrigins config
		reqOrigin string
		want      bool
	}{
		// Default / development origins
		{"allow localhost:3000", nil, "http://localhost:3000", true},
		{"allow localhost:5173", nil, "http://localhost:5173", true},
		{"block localhost:8080 by default", nil, "http://localhost:8080", false},
		{"block external by default", nil, "https://evil.example.com", false},

		// Wildcard mode
		{"wildcard allows anything", []string{"*"}, "https://example.com", true},
		{"wildcard allows localhost", []string{"*"}, "http://localhost:3000", true},

		// Explicit allow list
		{"explicit allow match", []string{"https://app.example.com"}, "https://app.example.com", true},
		{"explicit allow mismatch", []string{"https://app.example.com"}, "https://evil.com", false},
		{"case-insensitive origin", []string{"https://App.Example.Com"}, "https://app.example.com", true},

		// No origin header (non-browser clients / same-host)
		{"no origin header allowed", nil, "", true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			up := newUpgrader(tc.origins)
			r := makeRequest(tc.reqOrigin)
			got := up.CheckOrigin(r)
			if got != tc.want {
				t.Errorf("origin=%q, allowed=%v: got %v, want %v",
					tc.reqOrigin, tc.origins, got, tc.want)
			}
		})
	}
}
