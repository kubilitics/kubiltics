package middleware

import (
	"bufio"
	"fmt"
	"net"
	"net/http"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/audit"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// responseRecorder wraps http.ResponseWriter to capture status code.
// Embedding the interface drops Flusher/Hijacker passthrough; we re-expose
// them explicitly so SSE handlers (text/event-stream) and WebSocket upgrades
// that land behind AuditLog continue to function. Missing these methods
// caused the /api/v1/presence/events stream to return 500
// "streaming not supported" in production — httptest.NewRecorder hides the
// regression because it implements Flusher natively.
type responseRecorder struct {
	http.ResponseWriter
	statusCode int
}

func (r *responseRecorder) WriteHeader(code int) {
	r.statusCode = code
	r.ResponseWriter.WriteHeader(code)
}

// Flush forwards to the underlying ResponseWriter when it supports
// http.Flusher. No-op otherwise so callers never panic.
func (r *responseRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack forwards to the underlying ResponseWriter when it supports
// http.Hijacker (e.g. for WebSocket upgrades). Returns an explicit
// not-supported error otherwise.
func (r *responseRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := r.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, fmt.Errorf("http.ResponseWriter does not support hijacking")
}

// AuditLog returns middleware that logs mutating operations (POST, PATCH, DELETE) to audit_log (BE-SEC-002).
// Skips auth routes and GET/HEAD/OPTIONS.
func AuditLog(repo *repository.SQLiteRepository) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			method := r.Method
			if method != http.MethodPost && method != http.MethodPatch && method != http.MethodDelete {
				next.ServeHTTP(w, r)
				return
			}
			path := r.URL.Path
			if path == "" {
				path = r.URL.RawPath
			}
			// Skip auth routes
			if strings.HasPrefix(path, "/api/v1/auth/") || strings.HasPrefix(path, "/auth/") {
				next.ServeHTTP(w, r)
				return
			}
			// Skip login, refresh, logout
			if strings.HasSuffix(path, "/login") || strings.HasSuffix(path, "/refresh") || strings.HasSuffix(path, "/logout") {
				next.ServeHTTP(w, r)
				return
			}

			rec := &responseRecorder{ResponseWriter: w, statusCode: http.StatusOK}
			next.ServeHTTP(rec, r)

			if repo == nil {
				return
			}
			userID, username, requestIP := audit.RequestInfo(r, rec.statusCode)
			action, clusterID, resourceKind, resourceNamespace, resourceName := audit.ActionFromRequest(r)
			statusCode := rec.statusCode
			entry := &models.AuditLogEntry{
				UserID:            userID,
				Username:         username,
				ClusterID:        clusterID,
				Action:           action,
				ResourceKind:     resourceKind,
				ResourceNamespace: resourceNamespace,
				ResourceName:     resourceName,
				StatusCode:       &statusCode,
				RequestIP:        requestIP,
				Details:          method + " " + path,
			}
			audit.CreateEntry(r.Context(), repo, entry)
		})
	}
}
