// Package middleware provides request body size limiting for enterprise safety (BE-DATA-001).
package middleware

import (
	"encoding/json"
	"net/http"
	"strings"
)

const (
	// DefaultStandardMaxBodyBytes is the default max request body for non-apply API requests (512KB).
	DefaultStandardMaxBodyBytes = 512 * 1024
	// DefaultApplyMaxBodyBytes is the default max request body for POST .../apply (5MB).
	DefaultApplyMaxBodyBytes = 5 * 1024 * 1024
)

// MaxBodySize returns middleware that limits request body size: applyMax for POST .../apply, standardMax otherwise.
// Use for methods that may have a body (POST, PUT, PATCH). GET/HEAD/DELETE are not limited.
//
// Two-layer enforcement:
//  1. Content-Length header check: rejects oversized requests immediately with 413, before reading any body data.
//     This catches clients that declare their body size upfront and prevents wasted I/O.
//  2. MaxBytesReader wrapper: safety net for chunked transfers (no Content-Length) and clients that
//     send a misleading Content-Length. Enforces the limit during actual body reads.
func MaxBodySize(standardMax, applyMax int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body == nil {
				next.ServeHTTP(w, r)
				return
			}
			max := standardMax
			if (r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch) &&
				strings.HasSuffix(strings.TrimSuffix(r.URL.Path, "/"), "/apply") {
				max = applyMax
			}
			// Layer 1: Reject early if Content-Length exceeds limit (avoids reading body).
			if r.ContentLength > max {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusRequestEntityTooLarge)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "Request body too large",
				})
				return
			}
			// Layer 2: Wrap body reader as safety net for chunked transfers or mismatched Content-Length.
			r.Body = http.MaxBytesReader(w, r.Body, max)
			next.ServeHTTP(w, r)
		})
	}
}
