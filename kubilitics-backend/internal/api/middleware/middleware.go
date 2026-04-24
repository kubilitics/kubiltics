// Package middleware provides HTTP middleware for request ID, structured logging, and Prometheus metrics.
package middleware

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
)

const ResponseRequestIDHeader = "X-Request-ID"

var requestLogOut = os.Stderr

// RequestID adds a unique request ID to the context and response header.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqID := r.Header.Get(ResponseRequestIDHeader)
		if reqID == "" {
			reqID = uuid.New().String()
		}
		ctx := context.WithValue(r.Context(), logger.RequestIDKey, reqID)
		w.Header().Set(ResponseRequestIDHeader, reqID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// responseWriter captures status code for logging.
//
// Embedding the http.ResponseWriter interface drops optional methods
// (Flusher, Hijacker, Pusher). We re-expose Flusher + Hijacker explicitly
// because StructuredLog wraps every request in this writer, and downstream
// handlers rely on them:
//   - http.Flusher: SSE handlers (rest.PresenceHandler.StreamEvents,
//     events.StreamEvents, etc.) type-assert *http.Flusher* on the writer
//     and return 500 "streaming not supported" if it's missing.
//   - http.Hijacker: WebSocket upgrades need the raw net.Conn.
// Missing Flusher caused a production regression on the /api/v1/presence/events
// SSE stream that httptest.NewRecorder could not surface (it implements
// Flusher natively, unlike a real net/http server's writer).
type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := rw.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, fmt.Errorf("http.ResponseWriter does not support hijacking")
}

// StructuredLog logs each request as a single JSON line (request_id, user_id, cluster_id, method, path, status, duration). BE-OBS-002.
func StructuredLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		reqID := logger.FromContext(r.Context())
		userID := ""
		// Extract user_id from auth claims if available
		if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
			userID = claims.UserID
		}
		clusterID := ""
		if vars := mux.Vars(r); vars != nil {
			clusterID = vars["clusterId"]
		}
		rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)
		duration := time.Since(start)
		errMsg := ""
		if rw.status >= 400 {
			errMsg = http.StatusText(rw.status)
		}
		logger.RequestLog(requestLogOut, reqID, userID, clusterID, r.Method, r.URL.Path, rw.status, duration, errMsg)

		// Prometheus: path normalized via route template to avoid high cardinality
		pathLabel := r.URL.Path
		if route := mux.CurrentRoute(r); route != nil {
			if tpl, err := route.GetPathTemplate(); err == nil && tpl != "" {
				pathLabel = tpl
			}
		}
		statusStr := strconv.Itoa(rw.status)
		metrics.HTTPRequestTotal.WithLabelValues(r.Method, pathLabel, statusStr).Inc()
		metrics.HTTPRequestDurationSeconds.WithLabelValues(r.Method, pathLabel).Observe(duration.Seconds())
	})
}
